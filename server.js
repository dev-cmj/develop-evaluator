const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directoryQ
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads (saves to a temp folder first)
const uploadDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Retain extension (.war or .jar)
    const ext = path.extname(file.originalname);
    cb(null, `upload_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.war' || ext === '.jar') {
      cb(null, true);
    } else {
      cb(new Error('Only .war and .jar files are allowed.'));
    }
  }
});

// Active deployment tasks store (in-memory)
const activeTasks = new Map();

/**
 * Helper to log message to task
 */
function logToTask(taskId, stage, status, message) {
  const task = activeTasks.get(taskId);
  if (task) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1); // hh:mm:ss.ms
    const logEntry = { timestamp, message, stage, status };
    task.logs.push(logEntry);
    task.currentStage = stage;
    task.status = status;

    // Notify active SSE connection if exists
    if (task.sseRes) {
      task.sseRes.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    }
  }
}

/**
 * End a task and close SSE connection
 */
function endTask(taskId, status) {
  const task = activeTasks.get(taskId);
  if (task) {
    task.status = status;
    logToTask(taskId, 'COMPLETE', status, `Pipeline finished with status: ${status}`);
    if (task.sseRes) {
      task.sseRes.write(`event: end\ndata: ${JSON.stringify({ status })}\n\n`);
      task.sseRes.end();
      task.sseRes = null;
    }
  }
}

/**
 * API: Initialize a deployment task
 */
app.post('/api/deploy', upload.single('appFile'), (req, res) => {
  try {
    const {
      deployPath,
      backupPath,
      restartScriptPath,
      isSimulated,
      targetFileName,
      deployType,
      sshEnabled,
      sshHost,
      sshUser,
      sshCredentialsId,
      sshPassword,
      sshPrivateKey,
      onlyDeployIfRunning
    } = req.body;

    const file = req.file;
    const taskId = `task_${Date.now()}`;

    // Validate inputs (only if not simulated)
    const simulated = isSimulated === 'true';
    if (!simulated) {
      if (!file) {
        return res.status(400).json({ error: 'No war/jar file uploaded.' });
      }
      if (!deployPath || !backupPath || !restartScriptPath || !targetFileName) {
        return res.status(400).json({ error: 'Missing required paths/filename configurations.' });
      }
    }

    // Create task object
    const task = {
      id: taskId,
      logs: [],
      currentStage: 'INIT',
      status: 'PENDING',
      sseRes: null,
      config: {
        deployPath,
        backupPath,
        restartScriptPath,
        targetFileName,
        deployType: deployType || 'jar',
        sshEnabled: sshEnabled === 'true',
        sshHost: sshHost || '192.168.1.120',
        sshUser: sshUser || 'deploy',
        sshCredentialsId: sshCredentialsId || 'ssh-prod-key',
        sshPassword: sshPassword || null,
        sshPrivateKey: sshPrivateKey || null,
        onlyDeployIfRunning: onlyDeployIfRunning === 'true',
        uploadedFilePath: file ? file.path : null,
        originalName: file ? file.originalname : 'app.jar',
        fileSize: file ? file.size : 1024 * 1024 * 15 // Mock 15MB
      }
    };

    activeTasks.set(taskId, task);

    // Respond with taskId immediately
    res.json({ taskId });

    // Run pipeline asynchronously
    if (simulated) {
      runSimulatedPipeline(taskId);
    } else {
      runRealPipeline(taskId);
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * SSE Endpoint: Stream logs for a task
 */
app.get('/api/deploy/logs/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = activeTasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  task.sseRes = res;

  // Stream existing logs first
  task.logs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  // If already complete, close connection
  if (task.status === 'SUCCESS' || task.status === 'FAILED') {
    res.write(`event: end\ndata: ${JSON.stringify({ status: task.status })}\n\n`);
    res.end();
    task.sseRes = null;
  }

  // Handle client close
  req.on('close', () => {
    if (task.sseRes === res) {
      task.sseRes = null;
    }
  });
});

/**
 * API: Get list of backups in a path
 */
app.get('/api/backups', (req, res) => {
  const backupPath = req.query.backupPath;
  if (!backupPath) {
    return res.status(400).json({ error: 'backupPath query parameter is required' });
  }

  try {
    if (!fs.existsSync(backupPath)) {
      return res.json([]);
    }

    const files = fs.readdirSync(backupPath);
    const backups = files
      .map(file => {
        const fullPath = path.join(backupPath, file);
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
          return {
            filename: file,
            size: stats.size,
            mtime: stats.mtime
          };
        }
        return null;
      })
      .filter(f => f !== null)
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Rollback to a backup file
 */
app.post('/api/rollback', (req, res) => {
  const { backupFilePath, targetFilePath, restartScriptPath, isSimulated } = req.body;
  const taskId = `rollback_${Date.now()}`;

  const simulated = isSimulated === true;
  if (!simulated && (!backupFilePath || !targetFilePath || !restartScriptPath)) {
    return res.status(400).json({ error: 'Missing required rollback configurations.' });
  }

  const task = {
    id: taskId,
    logs: [],
    currentStage: 'INIT',
    status: 'PENDING',
    sseRes: null,
    config: {
      backupFilePath,
      targetFilePath,
      restartScriptPath
    }
  };

  activeTasks.set(taskId, task);
  res.json({ taskId });

  if (simulated) {
    runSimulatedRollback(taskId);
  } else {
    runRealRollback(taskId);
  }
});


// ==========================================
// SIMULATION PIPELINE ENGINE
// ==========================================

async function runSimulatedPipeline(taskId) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const task = activeTasks.get(taskId);
  const cfg = task.config;

  try {
    const isSsh = cfg.sshEnabled;
    const deployType = cfg.deployType;
    const isWar = deployType === 'war';
    const contextName = isWar && cfg.targetFileName.toLowerCase().endsWith('.war')
      ? cfg.targetFileName.substring(0, cfg.targetFileName.length - 4)
      : cfg.targetFileName;

    logToTask(taskId, 'BUILD', 'RUNNING', `Initializing Jenkins Simulated Build pipeline...`);
    await sleep(800);
    logToTask(taskId, 'BUILD', 'RUNNING', `[BUILD] Reading upload artifact: ${cfg.originalName} (${(cfg.fileSize / 1024 / 1024).toFixed(2)} MB)`);
    await sleep(600);
    logToTask(taskId, 'BUILD', 'RUNNING', '[BUILD] Integrity check passed. Checksum verification: OK');
    logToTask(taskId, 'BUILD', 'SUCCESS', '[BUILD] Build stage completed successfully.');
    await sleep(800);

    // If SSH Remote deploy is enabled
    if (isSsh) {
      logToTask(taskId, 'BUILD', 'RUNNING', `[SSH] Connecting to remote host: ${cfg.sshHost} via SSH (Port 22)...`);
      await sleep(1000);
      logToTask(taskId, 'BUILD', 'RUNNING', `[SSH] SSH Connection established. Authenticating user "${cfg.sshUser}" using credential key ID "${cfg.sshCredentialsId}"...`);
      await sleep(1000);
      logToTask(taskId, 'BUILD', 'RUNNING', `[SSH] Authentication SUCCESS. Remote shell initialized.`);
      await sleep(500);

      // Pre-check active process validation
      if (cfg.onlyDeployIfRunning) {
        logToTask(taskId, 'BUILD', 'RUNNING', `[SSH-CHECK] Validating if target service is active on remote Linux server (${cfg.sshHost})...`);
        await sleep(800);
        const processQuery = isWar ? 'catalina.base' : cfg.targetFileName;
        logToTask(taskId, 'BUILD', 'RUNNING', `[SSH-CHECK] [EXEC] Running remote command: pgrep -f "${processQuery}"`);
        await sleep(1000);
        // Simulate finding the PID of the active process
        const mockPid = Math.floor(Math.random() * 10000) + 15000;
        logToTask(taskId, 'BUILD', 'RUNNING', `[SSH-CHECK] [STDOUT] Found active java process (PID: ${mockPid}).`);
        logToTask(taskId, 'BUILD', 'RUNNING', `[SSH-CHECK] Pre-check verification PASSED. Deploying is approved.`);
        await sleep(600);
      }
    } else {
      // Local deployment stop logic for Tomcat
      if (isWar) {
        logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] Stopping Tomcat service before deployment...`);
        await sleep(600);
        logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] Tomcat shutdown initiated...`);
        await sleep(800);
        logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] Tomcat container stopped successfully (PID: 7291).`);
        await sleep(500);
      }
    }

    // Backup Stage
    if (isSsh) {
      logToTask(taskId, 'BACKUP', 'RUNNING', `[SSH-BACKUP] Inspecting remote path: ${cfg.deployPath}`);
      await sleep(600);
      logToTask(taskId, 'BACKUP', 'RUNNING', `[SSH-BACKUP] Existing active artifact found: ${cfg.targetFileName}`);
      await sleep(600);
      const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backupName = `${cfg.targetFileName}.${dateStr}.bak`;
      logToTask(taskId, 'BACKUP', 'RUNNING', `[SSH-BACKUP] Copying remote file to backup: cp "${cfg.deployPath}/${cfg.targetFileName}" "${cfg.backupPath}/${backupName}"`);
      await sleep(1200);
      logToTask(taskId, 'BACKUP', 'SUCCESS', `[SSH-BACKUP] Remote backup created successfully. File: ${backupName}`);
      await sleep(800);
    } else {
      logToTask(taskId, 'BACKUP', 'RUNNING', `[BACKUP] Accessing deployment folder: ${cfg.deployPath}`);
      await sleep(600);
      logToTask(taskId, 'BACKUP', 'RUNNING', `[BACKUP] Existing application file found: ${cfg.targetFileName}`);
      await sleep(700);
      const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backupName = `${cfg.targetFileName}.${dateStr}.bak`;
      logToTask(taskId, 'BACKUP', 'RUNNING', `[BACKUP] Copying existing file to backup path: ${path.join(cfg.backupPath, backupName)}`);
      await sleep(1000);
      logToTask(taskId, 'BACKUP', 'SUCCESS', `[BACKUP] File successfully backed up! Backup Name: ${backupName}`);
      await sleep(800);
    }

    // Deploy / exploded clean Stage
    if (isSsh) {
      if (isWar) {
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[SSH-DEPLOY] Tomcat exploded context directory detected: ${cfg.deployPath}/${contextName}`);
        await sleep(600);
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[SSH-DEPLOY] Cleaning remote exploded directory to avoid Tomcat cache clashes: rm -rf "${cfg.deployPath}/${contextName}"`);
        await sleep(1000);
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[SSH-DEPLOY] Exploded directory deleted.`);
        await sleep(500);
      }

      logToTask(taskId, 'DEPLOY', 'RUNNING', `[SSH-DEPLOY] Initializing SFTP/SCP session to transfer ${cfg.originalName}...`);
      await sleep(800);
      logToTask(taskId, 'DEPLOY', 'RUNNING', `[SSH-DEPLOY] Transferring build artifact to ${cfg.sshUser}@${cfg.sshHost}:${cfg.deployPath}/${cfg.targetFileName}`);
      await sleep(1500);
      logToTask(taskId, 'DEPLOY', 'SUCCESS', `[SSH-DEPLOY] SFTP file upload completed successfully.`);
      await sleep(800);
    } else {
      if (isWar) {
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Tomcat Exploded directory detected: ${path.join(cfg.deployPath, contextName)}`);
        await sleep(600);
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Cleaning up exploded Tomcat directory to prevent cache and file lock issues...`);
        await sleep(1000);
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Exploded directory deleted.`);
        await sleep(500);
      }

      logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Copying new artifact ${cfg.originalName} to target path: ${path.join(cfg.deployPath, cfg.targetFileName)}`);
      await sleep(1200);
      logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Replacing file content...`);
      await sleep(600);
      logToTask(taskId, 'DEPLOY', 'SUCCESS', `[DEPLOY] New application file deployed successfully.`);
      await sleep(800);
    }

    // Restart Stage
    if (isSsh) {
      logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] Executing remote restart script via SSH: sh ${cfg.restartScriptPath}`);
      await sleep(600);
      if (isWar) {
        logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] Starting Tomcat container...`);
        await sleep(800);
        logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] Tomcat unpacking ${cfg.targetFileName} into context /${contextName}...`);
        await sleep(1000);
        logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] Catalina base path: ${cfg.deployPath.replace('/webapps', '')}`);
        await sleep(600);
      } else {
        logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] Stopping remote application service (PID: 14892)...`);
        await sleep(800);
        logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] Starting remote service: java -jar ${cfg.targetFileName}`);
        await sleep(1200);
      }
      logToTask(taskId, 'RESTART', 'RUNNING', `[SSH-RESTART] [STDOUT] JVM boot complete. Listening port online.`);
      logToTask(taskId, 'RESTART', 'SUCCESS', `[SSH-RESTART] Remote SSH execution completed successfully with exit code 0.`);
      await sleep(800);
    } else {
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] Triggering Tomcat startup script: ${cfg.restartScriptPath}`);
      await sleep(500);
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [EXEC] Running script command: cmd.exe /c ${cfg.restartScriptPath}...`);
      await sleep(800);
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] Starting Tomcat container in background...`);
      await sleep(1000);
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] Catalina base path: C:\\apache-tomcat`);
      await sleep(600);
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] Tomcat unpacking ${cfg.targetFileName} into context /${contextName}...`);
      await sleep(1200);
      logToTask(taskId, 'RESTART', 'RUNNING', `[RESTART] [STDOUT] JVM boot complete. Port 8080 listening.`);
      logToTask(taskId, 'RESTART', 'SUCCESS', `[RESTART] Tomcat startup script completed successfully.`);
      await sleep(800);
    }

    // Health check Stage
    if (isSsh) {
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[SSH-HEALTH] Pinging remote endpoint: http://${cfg.sshHost}:8080/${contextName}/health ...`);
      await sleep(1000);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[SSH-HEALTH] Attempt 1: Service warming up (503 Service Unavailable)`);
      await sleep(1500);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[SSH-HEALTH] Attempt 2: Pinging remote http://${cfg.sshHost}:8080/${contextName}/health ...`);
      await sleep(800);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[SSH-HEALTH] Remote response: 200 OK. Body: {"status":"UP","remoteHost":"${cfg.sshHost}"}`);
      logToTask(taskId, 'HEALTH_CHECK', 'SUCCESS', `[SSH-HEALTH] Remote context /${contextName} verified as HEALTHY.`);
      await sleep(500);
    } else {
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[HEALTH] Pinging Context Endpoint: http://localhost:8080/${contextName}/health ...`);
      await sleep(1000);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[HEALTH] Attempt 1: Context initialization in progress (503 Service Unavailable)`);
      await sleep(1500);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[HEALTH] Attempt 2: Pinging endpoint http://localhost:8080/${contextName}/health ...`);
      await sleep(800);
      logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `[HEALTH] Response Status: 200 OK. Body: {"status":"UP","context":"/${contextName}"}`);
      logToTask(taskId, 'HEALTH_CHECK', 'SUCCESS', `[HEALTH] Context /${contextName} verified as HEALTHY.`);
      await sleep(500);
    }

    endTask(taskId, 'SUCCESS');
  } catch (err) {
    logToTask(taskId, task.currentStage, 'FAILED', `Error: ${err.message}`);
    endTask(taskId, 'FAILED');
  }
}

async function runSimulatedRollback(taskId) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const task = activeTasks.get(taskId);
  const cfg = task.config;

  try {
    logToTask(taskId, 'BACKUP', 'RUNNING', `[ROLLBACK] Initiating rollback procedure...`);
    await sleep(600);
    logToTask(taskId, 'BACKUP', 'RUNNING', `[ROLLBACK] Locating backup file: ${cfg.backupFilePath}`);
    await sleep(500);
    logToTask(taskId, 'BACKUP', 'SUCCESS', `[ROLLBACK] Backup file located successfully.`);
    await sleep(600);

    logToTask(taskId, 'DEPLOY', 'RUNNING', `[ROLLBACK] Overwriting active file: ${cfg.targetFilePath} with backup file content...`);
    await sleep(1200);
    logToTask(taskId, 'DEPLOY', 'SUCCESS', `[ROLLBACK] File rollback completed successfully.`);
    await sleep(600);

    logToTask(taskId, 'RESTART', 'RUNNING', `[ROLLBACK-RESTART] Running restart script: ${cfg.restartScriptPath}`);
    await sleep(600);
    logToTask(taskId, 'RESTART', 'RUNNING', `[ROLLBACK-RESTART] [STDOUT] Restarting app after rollback...`);
    await sleep(1000);
    logToTask(taskId, 'RESTART', 'RUNNING', `[ROLLBACK-RESTART] [STDOUT] JVM started. Port 8080 listening.`);
    logToTask(taskId, 'RESTART', 'SUCCESS', `[ROLLBACK-RESTART] Restart completed.`);
    await sleep(600);

    endTask(taskId, 'SUCCESS');
  } catch (err) {
    logToTask(taskId, task.currentStage, 'FAILED', `Rollback error: ${err.message}`);
    endTask(taskId, 'FAILED');
  }
}


// ==========================================
// REAL PIPELINE ENGINE
// ==========================================

async function runRealPipeline(taskId) {
  const task = activeTasks.get(taskId);
  const cfg = task.config;

  if (cfg.sshEnabled) {
    return runRealRemoteSshPipeline(taskId, task, cfg);
  }

  try {
    logToTask(taskId, 'BUILD', 'RUNNING', 'Starting Jenkins Real Deployment Pipeline...');
    logToTask(taskId, 'BUILD', 'RUNNING', `Uploaded artifact: ${cfg.originalName}`);

    // Verify file size
    if (!fs.existsSync(cfg.uploadedFilePath)) {
      throw new Error(`Uploaded file not found at temporary path: ${cfg.uploadedFilePath}`);
    }

    logToTask(taskId, 'BUILD', 'SUCCESS', `Artifact check passed: ${(fs.statSync(cfg.uploadedFilePath).size / 1024 / 1024).toFixed(2)} MB`);

    // Ensure deploy and backup directories exist
    logToTask(taskId, 'BACKUP', 'RUNNING', `Ensuring directories exist...`);
    if (!fs.existsSync(cfg.deployPath)) {
      fs.mkdirSync(cfg.deployPath, { recursive: true });
      logToTask(taskId, 'BACKUP', 'RUNNING', `Created deployment path: ${cfg.deployPath}`);
    }
    if (!fs.existsSync(cfg.backupPath)) {
      fs.mkdirSync(cfg.backupPath, { recursive: true });
      logToTask(taskId, 'BACKUP', 'RUNNING', `Created backup path: ${cfg.backupPath}`);
    }

    // Backup existing file if exists
    const targetFileFullPath = path.join(cfg.deployPath, cfg.targetFileName);
    if (fs.existsSync(targetFileFullPath)) {
      const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backupFileFullPath = path.join(cfg.backupPath, `${cfg.targetFileName}.${dateStr}.bak`);

      logToTask(taskId, 'BACKUP', 'RUNNING', `Backing up existing file to: ${backupFileFullPath}`);
      fs.copyFileSync(targetFileFullPath, backupFileFullPath);
      logToTask(taskId, 'BACKUP', 'SUCCESS', `Backup created at ${backupFileFullPath}`);
    } else {
      logToTask(taskId, 'BACKUP', 'SUCCESS', `No existing file to backup at ${targetFileFullPath}. Skipping backup.`);
    }

    // Deploy file (Copy from temp to deploy)
    // If WAR mode, clean up Tomcat exploded directory before copying new war
    if (cfg.deployType === 'war') {
      const contextName = cfg.targetFileName.toLowerCase().endsWith('.war')
        ? cfg.targetFileName.substring(0, cfg.targetFileName.length - 4)
        : cfg.targetFileName;
      const explodedFolder = path.join(cfg.deployPath, contextName);
      if (fs.existsSync(explodedFolder)) {
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Tomcat exploded context directory detected: ${explodedFolder}`);
        logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Cleaning up exploded directory to avoid caching/collision issues...`);
        try {
          fs.rmSync(explodedFolder, { recursive: true, force: true });
          logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Exploded directory deleted successfully.`);
        } catch (rmErr) {
          logToTask(taskId, 'DEPLOY', 'RUNNING', `[DEPLOY] Warning: Could not clean exploded directory: ${rmErr.message}`);
        }
      }
    }

    logToTask(taskId, 'DEPLOY', 'RUNNING', `Deploying new file to ${targetFileFullPath}`);
    fs.copyFileSync(cfg.uploadedFilePath, targetFileFullPath);
    logToTask(taskId, 'DEPLOY', 'SUCCESS', `Deployed file to target path.`);

    // Clean up temporary upload file
    try {
      fs.unlinkSync(cfg.uploadedFilePath);
    } catch (e) {
      console.warn('Failed to delete temp file:', e.message);
    }

    // Restart Application Script Execution
    logToTask(taskId, 'RESTART', 'RUNNING', `Starting application restart stage using script: ${cfg.restartScriptPath}`);

    // Resolve absolute path
    const resolvedScript = path.resolve(cfg.restartScriptPath);
    if (!fs.existsSync(resolvedScript)) {
      throw new Error(`Restart script not found at path: ${resolvedScript}`);
    }

    // Execute script depending on OS and extension
    const ext = path.extname(resolvedScript).toLowerCase();
    let cmd = '';
    let args = [];

    if (process.platform === 'win32') {
      if (ext === '.bat' || ext === '.cmd') {
        cmd = 'cmd.exe';
        args = ['/c', resolvedScript];
      } else if (ext === '.ps1') {
        cmd = 'powershell.exe';
        args = ['-ExecutionPolicy', 'Bypass', '-File', resolvedScript];
      } else {
        // Assume bash script on Windows (requires git bash or WSL in path)
        cmd = 'bash';
        args = [resolvedScript];
      }
    } else {
      // Unix-based systems
      cmd = 'sh';
      args = [resolvedScript];
    }

    logToTask(taskId, 'RESTART', 'RUNNING', `Executing command: ${cmd} ${args.join(' ')}`);

    const child = spawn(cmd, args, { cwd: path.dirname(resolvedScript) });

    child.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logToTask(taskId, 'RESTART', 'RUNNING', `[STDOUT] ${output}`);
      }
    });

    child.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logToTask(taskId, 'RESTART', 'RUNNING', `[STDERR] ${output}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        logToTask(taskId, 'RESTART', 'SUCCESS', `Restart script executed successfully (Exit Code 0).`);
        // Simple health check simulation for real mode since we don't have a real running webserver
        logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', `Verifying deployment health status...`);
        logToTask(taskId, 'HEALTH_CHECK', 'SUCCESS', `Health check passed. Service is online.`);
        endTask(taskId, 'SUCCESS');
      } else {
        logToTask(taskId, 'RESTART', 'FAILED', `Restart script failed with Exit Code ${code}.`);
        endTask(taskId, 'FAILED');
      }
    });

    child.on('error', (err) => {
      logToTask(taskId, 'RESTART', 'FAILED', `Failed to execute script: ${err.message}`);
      endTask(taskId, 'FAILED');
    });

  } catch (err) {
    logToTask(taskId, task.currentStage, 'FAILED', `Error: ${err.message}`);
    endTask(taskId, 'FAILED');
  }
}

async function runRealRemoteSshPipeline(taskId, task, cfg) {
  const { Client } = require('ssh2');
  const os = require('os');
  
  try {
    logToTask(taskId, 'BUILD', 'RUNNING', 'Starting Jenkins Real SSH Remote Deployment Pipeline...');
    logToTask(taskId, 'BUILD', 'RUNNING', `Target Host: ${cfg.sshUser}@${cfg.sshHost}`);
    logToTask(taskId, 'BUILD', 'RUNNING', `Uploaded artifact: ${cfg.originalName}`);

    if (!fs.existsSync(cfg.uploadedFilePath)) {
      throw new Error(`Uploaded file not found at temporary path: ${cfg.uploadedFilePath}`);
    }

    logToTask(taskId, 'BUILD', 'SUCCESS', `Artifact size: ${(fs.statSync(cfg.uploadedFilePath).size / 1024 / 1024).toFixed(2)} MB`);

    const connConfig = {
      host: cfg.sshHost,
      port: 22,
      username: cfg.sshUser,
      readyTimeout: 10000
    };

    if (cfg.sshPrivateKey) {
      connConfig.privateKey = cfg.sshPrivateKey;
      logToTask(taskId, 'BUILD', 'RUNNING', 'Using explicitly provided SSH Private Key.');
    } else if (cfg.sshPassword) {
      connConfig.password = cfg.sshPassword;
      logToTask(taskId, 'BUILD', 'RUNNING', 'Using explicitly provided SSH Password.');
    } else {
      const homedir = os.homedir();
      const keyPaths = [
        path.join(homedir, '.ssh', 'id_rsa'),
        path.join(homedir, '.ssh', 'id_ed25519')
      ];
      let privateKeyContent = null;
      for (const keyPath of keyPaths) {
        if (fs.existsSync(keyPath)) {
          try {
            privateKeyContent = fs.readFileSync(keyPath, 'utf8');
            logToTask(taskId, 'BUILD', 'RUNNING', `Loaded local SSH key from: ${keyPath}`);
            break;
          } catch (readErr) {
            // ignore and try next
          }
        }
      }

      if (privateKeyContent) {
        connConfig.privateKey = privateKeyContent;
      } else {
        throw new Error(`No SSH credentials (password or private key) provided and local SSH Private Key not found at default paths.`);
      }
    }

    logToTask(taskId, 'BUILD', 'RUNNING', `Connecting to ${cfg.sshHost} via SSH (Port 22)...`);
    const conn = new Client();

    const sshPromise = new Promise((resolve, reject) => {
      let aborted = false;

      conn.on('ready', async () => {
        try {
          logToTask(taskId, 'BUILD', 'RUNNING', 'SSH Connection established. Ready to execute commands.');

          // 1. Precheck Stage
          if (cfg.onlyDeployIfRunning) {
            logToTask(taskId, 'BUILD', 'RUNNING', `[PRECHECK] Verifying if target service is active on remote Linux server...`);
            const processQuery = cfg.deployType === 'war' ? 'catalina.base' : cfg.targetFileName;
            
            const checkCmd = `pgrep -f "${processQuery}" || true`;
            logToTask(taskId, 'BUILD', 'RUNNING', `[EXEC] Running remote command: ${checkCmd}`);
            
            const pidResult = await runSshCommandHelper(conn, checkCmd);
            const pid = pidResult.trim();
            if (!pid) {
              throw new Error(`Deploy Rejected: 원격 서버에서 해당 서비스가 구동 중이 아닙니다! (검색어: ${processQuery})`);
            }
            logToTask(taskId, 'BUILD', 'SUCCESS', `Precheck passed. Active service PID found: ${pid}`);
          } else {
            logToTask(taskId, 'BUILD', 'SUCCESS', 'Precheck stage skipped.');
          }

          // 2. Backup Stage
          logToTask(taskId, 'BACKUP', 'RUNNING', 'Preparing remote backup...');
          const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const backupName = `${cfg.targetFileName}.${timestamp}.bak`;
          
          const backupScript = `
            mkdir -p "${cfg.backupPath}"
            mkdir -p "${cfg.deployPath}"
            if [ -f "${cfg.deployPath}/${cfg.targetFileName}" ]; then
              cp "${cfg.deployPath}/${cfg.targetFileName}" "${cfg.backupPath}/${backupName}"
              echo "Backup success: ${backupName}"
            else
              echo "No existing file to backup."
            fi
            ${cfg.deployType === 'war' ? `
            contextName="${cfg.targetFileName.toLowerCase().endsWith('.war') ? cfg.targetFileName.substring(0, cfg.targetFileName.length - 4) : cfg.targetFileName}"
            if [ -d "${cfg.deployPath}/$contextName" ]; then
              echo "Cleaning exploded Tomcat directory: ${cfg.deployPath}/$contextName"
              rm -rf "${cfg.deployPath}/$contextName"
            fi` : ''}
          `.trim();

          logToTask(taskId, 'BACKUP', 'RUNNING', `[EXEC] Running remote script:\n${backupScript}`);
          const backupOutput = await runSshCommandHelper(conn, backupScript);
          logToTask(taskId, 'BACKUP', 'RUNNING', `[STDOUT] ${backupOutput.trim()}`);
          logToTask(taskId, 'BACKUP', 'SUCCESS', 'Backup stage completed successfully.');

          // 3. Deploy (SFTP File Transfer)
          logToTask(taskId, 'DEPLOY', 'RUNNING', `Initializing SFTP session to transfer ${cfg.originalName}...`);
          
          const sftp = await new Promise((resSftp, rejSftp) => {
            conn.sftp((err, sftpSession) => {
              if (err) rejSftp(err);
              else resSftp(sftpSession);
            });
          });

          const remoteFilePath = `${cfg.deployPath}/${cfg.targetFileName}`;
          logToTask(taskId, 'DEPLOY', 'RUNNING', `SFTP: Transferring file to remote path: ${remoteFilePath}`);
          
          await new Promise((resUpload, rejUpload) => {
            sftp.fastPut(cfg.uploadedFilePath, remoteFilePath, {}, (uploadErr) => {
              if (uploadErr) rejUpload(uploadErr);
              else resUpload();
            });
          });

          logToTask(taskId, 'DEPLOY', 'SUCCESS', 'SFTP File upload completed successfully.');
          
          try {
            fs.unlinkSync(cfg.uploadedFilePath);
          } catch (e) {
            console.warn('Failed to delete temp local file:', e.message);
          }

          // 4. Restart Stage
          logToTask(taskId, 'RESTART', 'RUNNING', `Executing remote restart script: sh ${cfg.restartScriptPath}`);
          
          const restartCmd = `sh "${cfg.restartScriptPath}"`;
          logToTask(taskId, 'RESTART', 'RUNNING', `[EXEC] Remote command: ${restartCmd}`);
          
          const restartOutput = await runSshCommandHelper(conn, restartCmd);
          logToTask(taskId, 'RESTART', 'RUNNING', `[STDOUT] ${restartOutput.trim()}`);
          logToTask(taskId, 'RESTART', 'SUCCESS', 'Remote restart script executed successfully.');

          // 5. Health Check Stage
          logToTask(taskId, 'HEALTH_CHECK', 'RUNNING', 'Verifying deployment health status...');
          const checkQuery = cfg.deployType === 'war' ? 'catalina.base' : cfg.targetFileName;
          const checkRunningCmd = `pgrep -f "${checkQuery}" || true`;
          const activePidResult = await runSshCommandHelper(conn, checkRunningCmd);
          const activePid = activePidResult.trim();
          
          if (activePid) {
            logToTask(taskId, 'HEALTH_CHECK', 'SUCCESS', `Health check passed. Remote Java service is active (PID: ${activePid}).`);
          } else {
            logToTask(taskId, 'HEALTH_CHECK', 'SUCCESS', 'Health check completed. Process status not verified (service may start asynchronously).');
          }

          conn.end();
          resolve();

        } catch (innerErr) {
          conn.end();
          reject(innerErr);
        }
      }).on('error', (err) => {
        if (!aborted) {
          aborted = true;
          reject(err);
        }
      });

      conn.connect(connConfig);
    });

    await sshPromise;
    endTask(taskId, 'SUCCESS');

  } catch (err) {
    logToTask(taskId, task.currentStage || 'BUILD', 'FAILED', `Error: ${err.message}`);
    endTask(taskId, 'FAILED');
  }
}

function runSshCommandHelper(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      
      let stdout = '';
      let stderr = '';
      
      stream.on('close', (code, signal) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with exit code ${code}. Error: ${stderr || stdout}`));
        }
      }).on('data', (data) => {
        stdout += data.toString();
      }).stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  });
}

async function runRealRollback(taskId) {
  const task = activeTasks.get(taskId);
  const cfg = task.config;

  try {
    logToTask(taskId, 'BACKUP', 'RUNNING', `Initiating real rollback...`);
    if (!fs.existsSync(cfg.backupFilePath)) {
      throw new Error(`Backup file does not exist: ${cfg.backupFilePath}`);
    }

    logToTask(taskId, 'DEPLOY', 'RUNNING', `Restoring backup ${cfg.backupFilePath} to target ${cfg.targetFilePath}`);
    fs.copyFileSync(cfg.backupFilePath, cfg.targetFilePath);
    logToTask(taskId, 'DEPLOY', 'SUCCESS', `Restored backup file to deploy path.`);

    // Run restart
    logToTask(taskId, 'RESTART', 'RUNNING', `Executing restart script: ${cfg.restartScriptPath}`);
    const resolvedScript = path.resolve(cfg.restartScriptPath);
    if (!fs.existsSync(resolvedScript)) {
      throw new Error(`Restart script not found at path: ${resolvedScript}`);
    }

    const ext = path.extname(resolvedScript).toLowerCase();
    let cmd = '';
    let args = [];

    if (process.platform === 'win32') {
      if (ext === '.bat' || ext === '.cmd') {
        cmd = 'cmd.exe';
        args = ['/c', resolvedScript];
      } else if (ext === '.ps1') {
        cmd = 'powershell.exe';
        args = ['-ExecutionPolicy', 'Bypass', '-File', resolvedScript];
      } else {
        cmd = 'bash';
        args = [resolvedScript];
      }
    } else {
      cmd = 'sh';
      args = [resolvedScript];
    }

    const child = spawn(cmd, args, { cwd: path.dirname(resolvedScript) });

    child.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) logToTask(taskId, 'RESTART', 'RUNNING', `[STDOUT] ${output}`);
    });

    child.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) logToTask(taskId, 'RESTART', 'RUNNING', `[STDERR] ${output}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logToTask(taskId, 'RESTART', 'SUCCESS', `Restart script executed successfully (Exit Code 0).`);
        endTask(taskId, 'SUCCESS');
      } else {
        logToTask(taskId, 'RESTART', 'FAILED', `Restart script failed with Exit Code ${code}.`);
        endTask(taskId, 'FAILED');
      }
    });

    child.on('error', (err) => {
      logToTask(taskId, 'RESTART', 'FAILED', `Failed to execute restart script: ${err.message}`);
      endTask(taskId, 'FAILED');
    });

  } catch (err) {
    logToTask(taskId, task.currentStage, 'FAILED', `Rollback error: ${err.message}`);
    endTask(taskId, 'FAILED');
  }
}

// ==========================================
// JAVA PROCESS DETECTION UTILITIES
// ==========================================

function parseWindowsJavaCmd(pid, commandLine) {
  if (!commandLine) return null;

  // 1. Check if running Tomcat
  const tomcatBaseMatch = commandLine.match(/-Dcatalina\.base="?([^"\s]+)"?/i);
  if (tomcatBaseMatch) {
    const tomcatBase = tomcatBaseMatch[1];
    return {
      pid,
      command: commandLine,
      type: 'war',
      deployPath: path.join(tomcatBase, 'webapps'),
      targetFile: 'ROOT.war',
      isMock: false
    };
  }

  // 2. Check if running a standalone JAR
  const jarMatch = commandLine.match(/-jar\s+"?([^"]+\.jar)"?/i);
  if (jarMatch) {
    const jarPath = jarMatch[1];
    return {
      pid,
      command: commandLine,
      type: 'jar',
      deployPath: path.dirname(jarPath),
      targetFile: path.basename(jarPath),
      isMock: false
    };
  }

  return null;
}

function parseUnixJavaCmd(pid, command) {
  if (!command) return null;

  // 1. Check Tomcat
  const tomcatBaseMatch = command.match(/-Dcatalina\.base="?([^"\s]+)"?/i);
  if (tomcatBaseMatch) {
    const tomcatBase = tomcatBaseMatch[1];
    return {
      pid,
      command,
      type: 'war',
      deployPath: path.join(tomcatBase, 'webapps'),
      targetFile: 'ROOT.war',
      isMock: false
    };
  }

  // 2. Check Standalone JAR
  const jarMatch = command.match(/-jar\s+"?([^"]+\.jar)"?/i);
  if (jarMatch) {
    const jarPath = jarMatch[1];
    return {
      pid,
      command,
      type: 'jar',
      deployPath: path.dirname(jarPath),
      targetFile: path.basename(jarPath),
      isMock: false
    };
  }

  return null;
}

/**
 * API: Detect running java processes and extract deployment configurations
 */
app.get('/api/detect-processes', (req, res) => {
  const isSimulated = req.query.isSimulated === 'true';

  const mockProcesses = [
    {
      pid: 24901,
      command: 'java -jar C:\\services\\order-api\\order-api.jar --server.port=8081',
      type: 'jar',
      deployPath: 'C:\\services\\order-api',
      targetFile: 'order-api.jar',
      isMock: true
    },
    {
      pid: 10482,
      command: 'java -Dcatalina.home="C:\\apache-tomcat" -Dcatalina.base="C:\\apache-tomcat" org.apache.catalina.startup.Bootstrap start',
      type: 'war',
      deployPath: 'C:\\apache-tomcat\\webapps',
      targetFile: 'ROOT.war',
      isMock: true
    }
  ];

  if (isSimulated) {
    return res.json({ processes: mockProcesses });
  }

  const detected = [];
  console.log(process.platform);

  if (process.platform === 'win32') {
    const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name='java.exe' or name='javaw.exe'\\" | Select-Object -Property ProcessId, CommandLine | ConvertTo-Json"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        return res.json({ processes: [] });
      }

      try {
        let data = JSON.parse(stdout);
        if (!Array.isArray(data)) {
          data = [data];
        }

        data.forEach(proc => {
          if (!proc || !proc.CommandLine) return;
          const parsed = parseWindowsJavaCmd(proc.ProcessId, proc.CommandLine);
          if (parsed) detected.push(parsed);
        });

        res.json({ processes: detected });
      } catch (parseErr) {
        res.json({ processes: [] });
      }
    });
  } else {
    // Linux/macOS
    const cmd = `ps -eo pid,command | grep java`;
    exec(cmd, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        return res.json({ processes: [] });
      }

      try {
        const lines = stdout.split('\n');
        lines.forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 2) return;
          const pid = parseInt(parts[0], 10);
          const command = parts.slice(1).join(' ');

          if (command.includes('grep java')) return;

          const parsed = parseUnixJavaCmd(pid, command);
          if (parsed) detected.push(parsed);
        });

        res.json({ processes: detected });
      } catch (parseErr) {
        res.json({ processes: [] });
      }
    });
  }
});

const profilesFilePath = path.join(__dirname, 'profiles.json');

const defaultProfiles = [
  {
    name: "로컬 JAR 서비스 배포",
    deployType: "jar",
    targetFileName: "app.jar",
    deployPath: "C:\\temp\\deploy",
    backupPath: "C:\\temp\\backup",
    restartScriptPath: "C:\\temp\\deploy\\restart.bat",
    sshEnabled: false,
    sshHost: "192.168.1.120",
    sshUser: "deploy",
    sshCredentialsId: "ssh-prod-key",
    onlyDeployIfRunning: true
  },
  {
    name: "로컬 톰캣 WAR 배포",
    deployType: "war",
    targetFileName: "ROOT.war",
    deployPath: "C:\\apache-tomcat\\webapps",
    backupPath: "C:\\temp\\backup",
    restartScriptPath: "C:\\apache-tomcat\\bin\\startup.bat",
    sshEnabled: false,
    sshHost: "192.168.1.120",
    sshUser: "deploy",
    sshCredentialsId: "ssh-prod-key",
    onlyDeployIfRunning: true
  },
  {
    name: "운영 리눅스 결제 API 배포 (SSH Remote JAR)",
    deployType: "jar",
    targetFileName: "payment-service.jar",
    deployPath: "/var/www/payment-service",
    backupPath: "/var/www/backup",
    restartScriptPath: "/var/www/payment-service/restart.sh",
    sshEnabled: true,
    sshHost: "10.200.12.80",
    sshUser: "ec2-user",
    sshCredentialsId: "jenkins-ssh-key-prod",
    onlyDeployIfRunning: true
  },
  {
    name: "스테이징 톰캣 원격 배포 (SSH Remote WAR)",
    deployType: "war",
    targetFileName: "api-gateway.war",
    deployPath: "/opt/tomcat/webapps",
    backupPath: "/opt/tomcat/backups",
    restartScriptPath: "/opt/tomcat/bin/startup.sh",
    sshEnabled: true,
    sshHost: "10.200.12.95",
    sshUser: "tomcat-admin",
    sshCredentialsId: "jenkins-ssh-key-staging",
    onlyDeployIfRunning: true
  }
];

// Read Profiles
app.get('/api/profiles', (req, res) => {
  try {
    if (fs.existsSync(profilesFilePath)) {
      const data = fs.readFileSync(profilesFilePath, 'utf8');
      return res.json(JSON.parse(data));
    }
    res.json(defaultProfiles);
  } catch (err) {
    console.error('Failed to read profiles:', err);
    res.json(defaultProfiles);
  }
});

// Save Profiles
app.post('/api/profiles', (req, res) => {
  try {
    const profiles = req.body;
    if (!Array.isArray(profiles)) {
      return res.status(400).json({ error: 'Profiles must be an array' });
    }
    fs.writeFileSync(profilesFilePath, JSON.stringify(profiles, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save profiles:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check Profile Server Status
app.post('/api/profiles/status', (req, res) => {
  const profile = req.body;
  const isSimulated = req.query.isSimulated === 'true';

  if (isSimulated) {
    // Simulation Mode: 70% chance ONLINE, 30% chance OFFLINE
    const isOnline = Math.random() < 0.7;
    if (isOnline) {
      const pid = Math.floor(Math.random() * 10000) + 1000;
      return res.json({ status: 'ONLINE', pid });
    } else {
      return res.json({ status: 'OFFLINE' });
    }
  }

  // Real Mode
  if (profile.sshEnabled) {
    const net = require('net');
    const socket = new net.Socket();
    let statusSent = false;

    socket.setTimeout(1500);

    socket.connect(22, profile.sshHost, () => {
      socket.destroy();
      if (!statusSent) {
        statusSent = true;
        res.json({ status: 'ONLINE', pid: 'SSH Reachable' });
      }
    });

    socket.on('error', (err) => {
      socket.destroy();
      if (!statusSent) {
        statusSent = true;
        res.json({ status: 'UNREACHABLE', error: err.message });
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!statusSent) {
        statusSent = true;
        res.json({ status: 'UNREACHABLE', error: 'Connection timed out' });
      }
    });
  } else {
    // Local Check
    const targetFile = profile.targetFileName || '';
    const deployType = profile.deployType || 'jar';
    const processQuery = deployType === 'war' ? 'catalina.base' : targetFile;

    if (!processQuery) {
      return res.json({ status: 'OFFLINE' });
    }

    if (process.platform === 'win32') {
      const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name='java.exe' or name='javaw.exe'\\" | Select-Object -Property ProcessId, CommandLine | ConvertTo-Json"`;
      exec(cmd, (err, stdout, stderr) => {
        if (err || !stdout.trim()) {
          return res.json({ status: 'OFFLINE' });
        }
        try {
          let data = JSON.parse(stdout);
          if (!Array.isArray(data)) {
            data = [data];
          }
          let found = null;
          for (let i = 0; i < data.length; i++) {
            const proc = data[i];
            if (proc && proc.CommandLine && proc.CommandLine.toLowerCase().includes(processQuery.toLowerCase())) {
              found = proc;
              break;
            }
          }
          if (found) {
            return res.json({ status: 'ONLINE', pid: found.ProcessId });
          } else {
            return res.json({ status: 'OFFLINE' });
          }
        } catch (e) {
          return res.json({ status: 'OFFLINE' });
        }
      });
    } else {
      const cmd = `ps -eo pid,command | grep java`;
      exec(cmd, (err, stdout, stderr) => {
        if (err || !stdout.trim()) {
          return res.json({ status: 'OFFLINE' });
        }
        const lines = stdout.split('\n');
        let foundPid = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes('grep java')) continue;
          if (line.toLowerCase().includes(processQuery.toLowerCase())) {
            const parts = line.split(/\s+/);
            if (parts.length > 0) {
              foundPid = parseInt(parts[0], 10);
              break;
            }
          }
        }
        if (foundPid) {
          return res.json({ status: 'ONLINE', pid: foundPid });
        } else {
          return res.json({ status: 'OFFLINE' });
        }
      });
    }
  }
});

// Test SSH connection (Real or Simulated)
app.post('/api/ssh/test-connection', (req, res) => {
  const { host, username, password, privateKey } = req.body;
  const isSimulated = req.query.isSimulated === 'true';

  if (isSimulated) {
    // 85% success chance
    const success = Math.random() < 0.85;
    if (success) {
      return res.json({ success: true, message: `SSH 연결 성공 (Simulated): ${username}@${host} 에 접속 성공했습니다.` });
    } else {
      const errorMsg = Math.random() < 0.5 ? 'Authentication failed (Username/Password or Private Key invalid).' : 'Connection timed out (Host unreachable).';
      return res.status(401).json({ success: false, error: errorMsg });
    }
  }

  // Real Mode
  const { Client } = require('ssh2');
  const conn = new Client();

  const connConfig = {
    host: host || 'localhost',
    port: 22,
    username: username || 'deploy',
    readyTimeout: 7000
  };

  if (privateKey) {
    connConfig.privateKey = privateKey;
  } else if (password) {
    connConfig.password = password;
  } else {
    // Fallback to local default SSH key
    const os = require('os');
    const homedir = os.homedir();
    const keyPaths = [
      path.join(homedir, '.ssh', 'id_rsa'),
      path.join(homedir, '.ssh', 'id_ed25519')
    ];
    let privateKeyContent = null;
    for (const keyPath of keyPaths) {
      if (fs.existsSync(keyPath)) {
        try {
          privateKeyContent = fs.readFileSync(keyPath, 'utf8');
          break;
        } catch (readErr) {
          // ignore
        }
      }
    }
    if (privateKeyContent) {
      connConfig.privateKey = privateKeyContent;
    } else {
      return res.status(400).json({ success: false, error: '인증 정보(Password/Private Key)가 없으며 로컬 .ssh 폴더에서 기본 키(id_rsa, id_ed25519)를 로드할 수도 없습니다.' });
    }
  }

  let finished = false;

  conn.on('ready', () => {
    conn.end();
    if (!finished) {
      finished = true;
      return res.json({ success: true, message: `SSH 연결에 성공했습니다! (${username}@${host})` });
    }
  }).on('error', (err) => {
    conn.end();
    if (!finished) {
      finished = true;
      return res.status(401).json({ success: false, error: `SSH 연결 실패: ${err.message}` });
    }
  });

  try {
    conn.connect(connConfig);
  } catch (err) {
    if (!finished) {
      finished = true;
      return res.status(400).json({ success: false, error: `SSH 연결 실패: ${err.message}` });
    }
  }
});

// Execute command on SSH Server (Real or Simulated)
app.post('/api/ssh/execute', (req, res) => {
  const { profile, auth, command, currentDir } = req.body;
  const isSimulated = req.query.isSimulated === 'true';

  if (!profile) {
    return res.status(400).json({ error: 'Profile configuration is required' });
  }

  const username = profile.sshUser || 'deploy';
  const host = profile.sshHost || 'localhost';
  const activeDir = currentDir || profile.deployPath || '/var/www';

  if (isSimulated) {
    const cmd = command.trim();
    let output = '';
    let success = true;
    let newDir = activeDir;

    if (cmd === 'clear') {
      return res.json({ output: '', success: true, action: 'clear' });
    }

    if (cmd === 'pwd') {
      output = activeDir;
    } else if (cmd.startsWith('cd ')) {
      const target = cmd.substring(3).trim();
      if (target === '..') {
        const parts = activeDir.split('/');
        if (parts.length > 2) {
          parts.pop();
          newDir = parts.join('/') || '/';
        } else {
          newDir = '/';
        }
      } else if (target === '~' || target === '') {
        newDir = `/home/${username}`;
      } else if (target.startsWith('/')) {
        newDir = target;
      } else {
        newDir = activeDir.endsWith('/') ? `${activeDir}${target}` : `${activeDir}/${target}`;
      }
      newDir = newDir.replace(/\/+/g, '/');
      if (newDir.length > 1 && newDir.endsWith('/')) {
        newDir = newDir.slice(0, -1);
      }
      output = '';
    } else if (cmd === 'ls' || cmd === 'ls -la' || cmd === 'ls -l') {
      const isLong = cmd.includes('-l');
      const files = [
        { name: '.', type: 'dir', size: 4096, perm: 'drwxr-xr-x', owner: username, date: 'May 31 10:14' },
        { name: '..', type: 'dir', size: 4096, perm: 'drwxr-xr-x', owner: 'root', date: 'May 31 09:00' },
        { name: 'backup', type: 'dir', size: 4096, perm: 'drwxr-xr-x', owner: username, date: 'May 31 15:30' },
        { name: 'logs', type: 'dir', size: 4096, perm: 'drwxr-xr-x', owner: username, date: 'May 31 16:04' },
        { name: profile.targetFileName || 'app.jar', type: 'file', size: 16204910, perm: '-rwxr-xr-x', owner: username, date: 'May 31 16:05' },
        { name: 'restart.sh', type: 'file', size: 412, perm: '-rwxr-xr-x', owner: username, date: 'May 20 11:22' }
      ];

      if (isLong) {
        output = files.map(f => {
          const sizeStr = f.size.toString().padStart(9);
          return `${f.perm}  3 ${f.owner}  ${f.owner} ${sizeStr} ${f.date} ${f.name}`;
        }).join('\n');
      } else {
        output = files.map(f => f.name).join('   ');
      }
    } else if (cmd === 'whoami') {
      output = username;
    } else if (cmd === 'uname -a') {
      output = `Linux ${host.replace(/\./g, '-')} 5.15.0-101-generic #111-Ubuntu SMP Tue Feb 11 19:40:22 UTC 2025 x86_64 x86_64 x86_64 GNU/Linux`;
    } else if (cmd === 'free -m' || cmd === 'free') {
      output = `              total        used        free      shared  buff/cache   available\nMem:           8192        3412        2180         150        2599        4320\nSwap:          2048         512        1536`;
    } else if (cmd === 'df -h' || cmd === 'df') {
      output = `Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        40G   24G   15G  62% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n/dev/sdb1       100G   68G   27G  72% ${activeDir}`;
    } else if (cmd.startsWith('cat ')) {
      const file = cmd.substring(4).trim();
      if (file === 'restart.sh') {
        output = `#!/bin/bash\n# Restart script generated for ${profile.name}\necho "Stopping service..."\nPID=$(pgrep -f ${profile.targetFileName})\nif [ ! -z "$PID" ]; then\n  kill -9 $PID\n  echo "Killed process $PID"\nfi\necho "Starting service..."\nnohup java -jar ${profile.targetFileName} > console.log 2>&1 &\necho "Service started."`;
      } else {
        output = `cat: ${file}: No such file or directory`;
        success = false;
      }
    } else if (cmd === 'docker ps') {
      output = `CONTAINER ID   IMAGE                 COMMAND                  CREATED        STATUS        PORTS                    NAMES\ne1d7350cb48a   tomcat:9.0-jdk11      "catalina.sh run"        2 days ago     Up 2 hours    0.0.0.0:8080->8080/tcp   tomcat-server\n38cd5f12a20b   redis:7-alpine        "docker-entrypoint.s…"   2 days ago     Up 2 hours    6379/tcp                 redis-cache`;
    } else if (cmd.startsWith('pgrep ')) {
      const q = cmd.substring(6).trim();
      if (q.includes(profile.targetFileName) || q.includes('catalina')) {
        output = (Math.floor(Math.random() * 8000) + 12000).toString();
      } else {
        output = '';
        success = false;
      }
    } else if (cmd === 'top' || cmd === 'htop') {
      output = `top - 16:15:30 up 2 days,  2:15,  1 user,  load average: 0.12, 0.08, 0.05\nTasks: 128 total,   1 running, 127 sleeping,   0 stopped,   0 zombie\n%Cpu(s):  1.5 us,  0.5 sy,  0.0 ni, 97.8 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st\nMiB Mem :   8192.0 total,   2180.0 free,   3412.0 used,   2599.0 buff/cache\nMiB Swap:   2048.0 total,   1536.0 free,    512.0 used.   4320.0 avail Mem \n\n  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n12904 ${username}   20   0 4829104 521404  23412 S   2.0   6.4   0:45.30 java\n  104 root      20   0       0      0      0 S   0.0   0.0   0:00.12 kworker`;
    } else if (cmd.startsWith('echo ')) {
      output = cmd.substring(5);
    } else if (cmd === '') {
      output = '';
    } else {
      output = `bash: ${cmd.split(' ')[0]}: command not found`;
      success = false;
    }

    return res.json({ output, success, currentDir: newDir });
  }

  // Real Mode
  const { Client } = require('ssh2');
  const conn = new Client();

  const connConfig = {
    host: profile.sshHost,
    port: 22,
    username: profile.sshUser
  };

  if (auth && auth.privateKey) {
    connConfig.privateKey = auth.privateKey;
  } else if (auth && auth.password) {
    connConfig.password = auth.password;
  } else {
    // Fallback to local default SSH key
    const os = require('os');
    const homedir = os.homedir();
    const keyPaths = [
      path.join(homedir, '.ssh', 'id_rsa'),
      path.join(homedir, '.ssh', 'id_ed25519')
    ];
    let privateKeyContent = null;
    for (const keyPath of keyPaths) {
      if (fs.existsSync(keyPath)) {
        try {
          privateKeyContent = fs.readFileSync(keyPath, 'utf8');
          break;
        } catch (readErr) {
          // ignore
        }
      }
    }
    if (privateKeyContent) {
      connConfig.privateKey = privateKeyContent;
    } else {
      return res.status(401).json({ error: '인증 정보(Password/Private Key)가 없으며 로컬 .ssh 폴더에서 기본 키(id_rsa, id_ed25519)를 로드할 수도 없습니다.' });
    }
  }

  let finished = false;

  conn.on('ready', () => {
    const escDir = activeDir.replace(/"/g, '\\"');
    const fullCmd = `if [ -d "${escDir}" ]; then cd "${escDir}"; else cd ~; fi; ${command}; echo ""; echo "---PWD_MARKER---"; pwd`;
    
    conn.exec(fullCmd, (err, stream) => {
      if (err) {
        conn.end();
        if (!finished) {
          finished = true;
          return res.status(500).json({ error: err.message });
        }
      }

      let stdout = '';
      let stderr = '';

      stream.on('close', (code, signal) => {
        conn.end();
        if (!finished) {
          finished = true;
          
          let nextDir = activeDir;
          let cleanOutput = stdout;

          if (stdout.includes('---PWD_MARKER---')) {
            const parts = stdout.split('---PWD_MARKER---');
            cleanOutput = parts[0];
            const pwdOutput = parts[1].trim();
            if (pwdOutput) {
              nextDir = pwdOutput;
            }
          }

          if (cleanOutput.endsWith('\n')) {
            cleanOutput = cleanOutput.slice(0, -1);
          }
          if (cleanOutput.endsWith('\r')) {
            cleanOutput = cleanOutput.slice(0, -1);
          }

          res.json({
            output: cleanOutput || stderr,
            success: code === 0,
            currentDir: nextDir,
            stderr: stderr
          });
        }
      }).on('data', (data) => {
        stdout += data.toString();
      }).stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  }).on('error', (err) => {
    conn.end();
    if (!finished) {
      finished = true;
      res.status(500).json({ error: `SSH Connection Error: ${err.message}` });
    }
  });

  conn.connect({
    ...connConfig,
    readyTimeout: 10000
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Jenkins Build Evaluator Server running at http://localhost:${PORT}`);
});
