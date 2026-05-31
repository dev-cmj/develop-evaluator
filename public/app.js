document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const deployForm = document.getElementById('deploy-form');
  const btnDeploy = document.getElementById('btn-deploy');
  const appFileInput = document.getElementById('app-file');
  const fileChosenText = document.getElementById('file-chosen-text');
  const modeSimulated = document.getElementById('mode-simulated');
  const modeReal = document.getElementById('mode-real');
  const sysModePill = document.getElementById('sys-mode-pill');
  const sysModeText = document.getElementById('sys-mode-text');
  
  // Inputs
  const inputTargetFileName = document.getElementById('targetFileName');
  const inputDeployPath = document.getElementById('deployPath');
  const inputBackupPath = document.getElementById('backupPath');
  const inputRestartScriptPath = document.getElementById('restartScriptPath');
  const inputDeployType = document.getElementById('deployType');
  const appFile = document.getElementById('appFile');

  // Process Detect
  const btnDetectProcess = document.getElementById('btn-detect-process');
  const processDetectOverlay = document.getElementById('process-detect-overlay');
  const btnCloseDetect = document.getElementById('btn-close-detect');
  const processDetectList = document.getElementById('process-detect-list');
  
  // SSH Config
  const sshEnabled = document.getElementById('sshEnabled');
  const sshFields = document.getElementById('ssh-fields');
  const inputSshHost = document.getElementById('sshHost');
  const inputSshUser = document.getElementById('sshUser');
  const inputSshCredentialsId = document.getElementById('sshCredentialsId');
  const inputSshPassword = document.getElementById('sshPassword');
  const inputSshPrivateKey = document.getElementById('sshPrivateKey');
  const onlyDeployIfRunning = document.getElementById('onlyDeployIfRunning');
  
  // Profile Select
  const profileSelect = document.getElementById('profileSelect');
  
  // Terminal
  const terminalBody = document.getElementById('terminal-body');
  const btnClearTerminal = document.getElementById('btn-clear-terminal');
  const btnCopyTerminal = document.getElementById('btn-copy-terminal');
  
  // Jenkinsfile
  const jenkinsfileCode = document.getElementById('jenkinsfile-code');
  const btnCopyJenkinsfile = document.getElementById('btn-copy-jenkinsfile');
  
  // Pipeline Steps
  const stepBuild = document.getElementById('step-build');
  const stepBackup = document.getElementById('step-backup');
  const stepDeploy = document.getElementById('step-deploy');
  const stepRestart = document.getElementById('step-restart');
  const stepHealth = document.getElementById('step-health');
  const pipelineProgressBar = document.getElementById('pipeline-progress-bar');
  const pipelineTimer = document.getElementById('pipeline-timer');
  
  // Backups
  const btnRefreshBackups = document.getElementById('btn-refresh-backups');
  const backupListBody = document.getElementById('backup-list-body');
  
  // State
  let timerInterval = null;
  let startTime = 0;
  let eventSource = null;
  let profiles = [];
  let activeProfileIndex = 0;

  // Initializations
  loadProfiles();
  fetchBackups();

  // Deploy Type change triggers defaults
  inputDeployType.addEventListener('change', () => {
    const type = inputDeployType.value;
    if (type === 'war') {
      inputTargetFileName.value = 'ROOT.war';
      inputDeployPath.value = 'C:\\apache-tomcat\\webapps';
      inputRestartScriptPath.value = 'C:\\apache-tomcat\\bin\\startup.bat';
    } else {
      inputTargetFileName.value = 'app.jar';
      inputDeployPath.value = 'C:\\temp\\deploy';
      inputRestartScriptPath.value = 'C:\\temp\\deploy\\restart.bat';
    }
    updateJenkinsfile();
  });

  // Toggle SSH fields
  sshEnabled.addEventListener('change', () => {
    if (sshEnabled.checked) {
      sshFields.classList.remove('hidden');
      // Automatically convert paths to Unix style for remote Linux server convenience
      if (inputDeployPath.value.includes('\\')) {
        inputDeployPath.value = inputDeployPath.value.replace(/\\/g, '/');
      }
      if (inputBackupPath.value.includes('\\')) {
        inputBackupPath.value = inputBackupPath.value.replace(/\\/g, '/');
      }
      if (inputRestartScriptPath.value.includes('\\')) {
        inputRestartScriptPath.value = inputRestartScriptPath.value.replace(/\\/g, '/');
        if (inputRestartScriptPath.value.endsWith('.bat')) {
          inputRestartScriptPath.value = inputRestartScriptPath.value.replace('.bat', '.sh');
        }
      }
    } else {
      sshFields.classList.add('hidden');
    }
    updateJenkinsfile();
  });

  [inputSshHost, inputSshUser, inputSshCredentialsId, onlyDeployIfRunning].forEach(input => {
    input.addEventListener('input', updateJenkinsfile);
    input.addEventListener('change', updateJenkinsfile);
  });

  // ==========================================
  // PROFILE MANAGER OPERATIONS
  // ==========================================

  // ==========================================
  // PROFILE & TAB NAV & MODAL OPERATIONS
  // ==========================================

  // Tab elements
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const serversCountBadge = document.getElementById('servers-count');
  
  // Servers Grid & Actions
  const serversGrid = document.getElementById('servers-grid');
  const btnRefreshAllStatus = document.getElementById('btn-refresh-all-status');
  const btnCreateServer = document.getElementById('btn-create-server');
  
  // Modal Elements
  const profileModal = document.getElementById('profile-modal');
  const profileModalForm = document.getElementById('profile-modal-form');
  const modalTitle = document.getElementById('modal-title');
  const modalProfileIndex = document.getElementById('modal-profile-index');
  const modalName = document.getElementById('modal-name');
  const modalDeployType = document.getElementById('modal-deployType');
  const modalTargetFileName = document.getElementById('modal-targetFileName');
  const modalOnlyDeployIfRunning = document.getElementById('modal-onlyDeployIfRunning');
  const modalDeployPath = document.getElementById('modal-deployPath');
  const modalBackupPath = document.getElementById('modal-backupPath');
  const modalRestartScriptPath = document.getElementById('modal-restartScriptPath');
  const modalSshEnabled = document.getElementById('modal-sshEnabled');
  const modalSshFields = document.getElementById('modal-ssh-fields');
  const modalSshHost = document.getElementById('modal-sshHost');
  const modalSshUser = document.getElementById('modal-sshUser');
  const modalSshCredentialsId = document.getElementById('modal-sshCredentialsId');
  const modalSshPassword = document.getElementById('modal-sshPassword');
  const modalSshPrivateKey = document.getElementById('modal-sshPrivateKey');
  
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  // Tab Navigation switching
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');
      
      // Update tabs active state
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update tab contents visibility
      tabContents.forEach(content => {
        if (content.id === targetId) {
          content.classList.remove('hidden');
          content.classList.add('active');
        } else {
          content.classList.add('hidden');
          content.classList.remove('active');
        }
      });

      // Special action: if switched to servers tab, refresh and check statuses
      if (targetId === 'servers-tab') {
        renderServersDashboard();
      }
    });
  });

  async function loadProfiles() {
    try {
      const response = await fetch('/api/profiles');
      if (!response.ok) throw new Error('프로필 조회 실패');
      profiles = await response.json();
      
      renderProfilesDropdown();
      applyProfile(0);
      updateServersCount();
    } catch (err) {
      console.error(err);
      showToast('배포 프로필을 불러오지 못했습니다.', 'error');
    }
  }

  function renderProfilesDropdown() {
    if (!profileSelect) return;
    profileSelect.innerHTML = '';
    profiles.forEach((prof, idx) => {
      const option = document.createElement('option');
      option.value = idx;
      option.textContent = prof.name;
      profileSelect.appendChild(option);
    });
    profileSelect.value = activeProfileIndex;
  }

  function updateServersCount() {
    if (serversCountBadge) {
      serversCountBadge.textContent = profiles.length;
    }
  }

  function applyProfile(index) {
    if (!profiles[index]) return;
    activeProfileIndex = index;
    
    const prof = profiles[index];
    
    // Set form fields
    inputDeployType.value = prof.deployType;
    inputTargetFileName.value = prof.targetFileName;
    inputDeployPath.value = prof.deployPath;
    inputBackupPath.value = prof.backupPath;
    inputRestartScriptPath.value = prof.restartScriptPath;
    
    // SSH
    sshEnabled.checked = prof.sshEnabled;
    inputSshHost.value = prof.sshHost || '';
    inputSshUser.value = prof.sshUser || '';
    inputSshCredentialsId.value = prof.sshCredentialsId || '';
    inputSshPassword.value = prof.sshPassword || '';
    inputSshPrivateKey.value = prof.sshPrivateKey || '';
    onlyDeployIfRunning.checked = prof.onlyDeployIfRunning;
    
    // Toggle SSH fields visibility
    if (prof.sshEnabled) {
      sshFields.classList.remove('hidden');
    } else {
      sshFields.classList.add('hidden');
    }
    
    // Refresh backups path search
    fetchBackups();
    // Refresh Jenkinsfile preview
    updateJenkinsfile();
  }

  // Dropdown select change
  profileSelect.addEventListener('change', (e) => {
    applyProfile(parseInt(e.target.value, 10));
  });

  // Save current config to active profile
  document.getElementById('btn-save-profile').addEventListener('click', async () => {
    if (profiles.length === 0) return;
    
    const prof = profiles[activeProfileIndex];
    
    // Capture current values
    prof.deployType = inputDeployType.value;
    prof.targetFileName = inputTargetFileName.value;
    prof.deployPath = inputDeployPath.value;
    prof.backupPath = inputBackupPath.value;
    prof.restartScriptPath = inputRestartScriptPath.value;
    prof.sshEnabled = sshEnabled.checked;
    prof.sshHost = inputSshHost.value;
    prof.sshUser = inputSshUser.value;
    prof.sshCredentialsId = inputSshCredentialsId.value;
    prof.sshPassword = inputSshPassword.value;
    prof.sshPrivateKey = inputSshPrivateKey.value;
    prof.onlyDeployIfRunning = onlyDeployIfRunning.checked;
    
    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles)
      });
      
      if (!response.ok) throw new Error('프로필 저장 실패');
      showToast(`"${prof.name}" 프로필에 설정이 저장되었습니다.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Console quick Add button triggers the modal
  document.getElementById('btn-add-profile').addEventListener('click', () => {
    openAddProfileModal();
  });

  // Console quick Delete button
  document.getElementById('btn-delete-profile').addEventListener('click', () => {
    deleteProfileByIndex(activeProfileIndex);
  });

  // ==========================================
  // SERVER CARD DASHBOARD & STATUS CHECKS
  // ==========================================
  function renderServersDashboard() {
    if (!serversGrid) return;
    serversGrid.innerHTML = '';
    
    profiles.forEach((prof, idx) => {
      const card = document.createElement('div');
      card.className = 'server-card';
      
      const connectionType = prof.sshEnabled ? 'SSH Remote' : 'Local Machine';
      const hostIp = prof.sshEnabled ? prof.sshHost : 'localhost';
      const typeLabel = prof.deployType.toUpperCase();
      
      card.innerHTML = `
        <div class="server-card-header">
          <div class="server-title-area">
            <span class="server-card-title">${prof.name}</span>
            <span class="server-connection-desc"><i class="fa-solid fa-network-wired"></i> ${connectionType} | ${hostIp}</span>
          </div>
          <span class="status-badge checking" id="status-badge-${idx}">
            <span class="status-pulse-dot"></span>
            <span class="status-text">CHECKING</span>
          </span>
        </div>
        <div class="server-card-body">
          <div class="server-meta-item">
            <i class="fa-solid fa-file-code"></i>
            <span>배포 유형: <strong>${typeLabel}</strong></span>
          </div>
          <div class="server-meta-item">
            <i class="fa-solid fa-box"></i>
            <span>아티팩트: <strong>${prof.targetFileName}</strong></span>
          </div>
          <div class="server-meta-item">
            <i class="fa-solid fa-folder"></i>
            <span>배포 경로: <strong title="${prof.deployPath}">${truncatePath(prof.deployPath)}</strong></span>
          </div>
          <div class="server-meta-item">
            <i class="fa-solid fa-terminal"></i>
            <span>스크립트: <strong title="${prof.restartScriptPath}">${truncatePath(prof.restartScriptPath)}</strong></span>
          </div>
        </div>
        <div class="server-card-footer">
          <div class="server-actions-left" style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary btn-sm btn-select-server" data-index="${idx}" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: auto;">
              <i class="fa-solid fa-play"></i> 배포 선택
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-check-server" data-index="${idx}" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: auto;">
              <i class="fa-solid fa-arrows-rotate"></i> 상태 점검
            </button>
            ${prof.sshEnabled ? `
            <button type="button" class="btn btn-secondary btn-sm btn-test-ssh-card" data-index="${idx}" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: auto;">
              <i class="fa-solid fa-plug text-cyan"></i> 연결 테스트
            </button>
            ` : ''}
          </div>
          <div class="server-actions-right">
            <button type="button" class="btn btn-secondary btn-sm btn-edit-server" data-index="${idx}" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; min-width: auto; height: auto;" title="수정">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-delete-server" data-index="${idx}" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; color: var(--color-crimson); border-color: rgba(244, 63, 94, 0.25); min-width: auto; height: auto;" title="삭제">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
      
      card.querySelector('.btn-select-server').addEventListener('click', () => {
        applyProfile(idx);
        profileSelect.value = idx;
        
        const consoleTabBtn = document.querySelector('.nav-tab[data-target="console-tab"]');
        if (consoleTabBtn) consoleTabBtn.click();
        showToast(`"${prof.name}" 서버가 선택되어 배포 콘솔로 이동했습니다.`, 'success');
      });
      
      card.querySelector('.btn-check-server').addEventListener('click', () => {
        checkSingleServerStatus(idx);
      });
      
      if (prof.sshEnabled) {
        card.querySelector('.btn-test-ssh-card').addEventListener('click', (e) => {
          testSshConnection({
            host: prof.sshHost,
            username: prof.sshUser,
            password: prof.sshPassword || '',
            privateKey: prof.sshPrivateKey || ''
          }, e.currentTarget);
        });
      }
      
      card.querySelector('.btn-edit-server').addEventListener('click', () => {
        openEditProfileModal(idx);
      });
      
      card.querySelector('.btn-delete-server').addEventListener('click', () => {
        deleteProfileByIndex(idx);
      });
      
      serversGrid.appendChild(card);
      
      checkSingleServerStatus(idx);
    });
    
    const addCard = document.createElement('div');
    addCard.className = 'server-card add-card';
    addCard.innerHTML = `
      <div class="add-card-content">
        <i class="fa-solid fa-circle-plus"></i>
        <span>새 서버 추가</span>
      </div>
    `;
    addCard.addEventListener('click', () => {
      openAddProfileModal();
    });
    serversGrid.appendChild(addCard);
  }

  function truncatePath(pathStr) {
    if (pathStr.length > 28) {
      return '...' + pathStr.substring(pathStr.length - 25);
    }
    return pathStr;
  }

  async function checkSingleServerStatus(idx) {
    const prof = profiles[idx];
    if (!prof) return;
    
    const badge = document.getElementById(`status-badge-${idx}`);
    if (!badge) return;
    
    badge.className = 'status-badge checking';
    badge.querySelector('.status-text').textContent = 'CHECKING';
    
    try {
      const isSim = modeSimulated.checked;
      const response = await fetch(`/api/profiles/status?isSimulated=${isSim}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prof)
      });
      
      if (!response.ok) throw new Error('Status query failed');
      const data = await response.json();
      
      if (data.status === 'ONLINE') {
        badge.className = 'status-badge online';
        const pidStr = data.pid ? ` (${data.pid})` : '';
        badge.querySelector('.status-text').textContent = `ONLINE${pidStr}`;
      } else if (data.status === 'UNREACHABLE') {
        badge.className = 'status-badge unreachable';
        badge.querySelector('.status-text').textContent = 'UNREACHABLE';
      } else {
        badge.className = 'status-badge offline';
        badge.querySelector('.status-text').textContent = 'OFFLINE';
      }
    } catch (err) {
      console.error(err);
      badge.className = 'status-badge offline';
      badge.querySelector('.status-text').textContent = 'ERROR';
    }
  }

  // ==========================================
  // MODAL PROFILE EDITOR DIALOG CONTROL
  // ==========================================
  function showModal() {
    profileModal.classList.add('active');
    profileModal.classList.remove('hidden');
  }

  function hideModal() {
    profileModal.classList.remove('active');
    profileModal.classList.add('hidden');
    profileModalForm.reset();
    modalSshFields.classList.add('hidden');
  }

  modalSshEnabled.addEventListener('change', () => {
    if (modalSshEnabled.checked) {
      modalSshFields.classList.remove('hidden');
      if (modalDeployPath.value.includes('\\')) {
        modalDeployPath.value = modalDeployPath.value.replace(/\\/g, '/');
      }
      if (modalBackupPath.value.includes('\\')) {
        modalBackupPath.value = modalBackupPath.value.replace(/\\/g, '/');
      }
      if (modalRestartScriptPath.value.includes('\\')) {
        modalRestartScriptPath.value = modalRestartScriptPath.value.replace(/\\/g, '/');
        if (modalRestartScriptPath.value.endsWith('.bat')) {
          modalRestartScriptPath.value = modalRestartScriptPath.value.replace('.bat', '.sh');
        }
      }
    } else {
      modalSshFields.classList.add('hidden');
    }
  });

  modalDeployType.addEventListener('change', () => {
    const type = modalDeployType.value;
    const isSsh = modalSshEnabled.checked;
    if (type === 'war') {
      modalTargetFileName.value = 'ROOT.war';
      modalDeployPath.value = isSsh ? '/opt/tomcat/webapps' : 'C:\\apache-tomcat\\webapps';
      modalRestartScriptPath.value = isSsh ? '/opt/tomcat/bin/startup.sh' : 'C:\\apache-tomcat\\bin\\startup.bat';
    } else {
      modalTargetFileName.value = 'app.jar';
      modalDeployPath.value = isSsh ? '/var/www/deploy' : 'C:\\temp\\deploy';
      modalRestartScriptPath.value = isSsh ? '/var/www/deploy/restart.sh' : 'C:\\temp\\deploy\\restart.bat';
    }
  });

  function openEditProfileModal(index) {
    const prof = profiles[index];
    if (!prof) return;
    
    modalTitle.textContent = '서버 프로필 수정';
    modalProfileIndex.value = index;
    modalName.value = prof.name;
    modalDeployType.value = prof.deployType;
    modalTargetFileName.value = prof.targetFileName;
    modalOnlyDeployIfRunning.checked = prof.onlyDeployIfRunning;
    modalDeployPath.value = prof.deployPath;
    modalBackupPath.value = prof.backupPath;
    modalRestartScriptPath.value = prof.restartScriptPath;
    
    modalSshEnabled.checked = prof.sshEnabled;
    modalSshHost.value = prof.sshHost || '';
    modalSshUser.value = prof.sshUser || '';
    modalSshCredentialsId.value = prof.sshCredentialsId || '';
    modalSshPassword.value = prof.sshPassword || '';
    modalSshPrivateKey.value = prof.sshPrivateKey || '';
    
    if (prof.sshEnabled) {
      modalSshFields.classList.remove('hidden');
    } else {
      modalSshFields.classList.add('hidden');
    }
    
    showModal();
  }

  function openAddProfileModal() {
    modalTitle.textContent = '새 서버 프로필 추가';
    modalProfileIndex.value = 'new';
    
    modalName.value = '';
    modalDeployType.value = 'jar';
    modalTargetFileName.value = 'app.jar';
    modalOnlyDeployIfRunning.checked = true;
    modalDeployPath.value = 'C:\\temp\\deploy';
    modalBackupPath.value = 'C:\\temp\\backup';
    modalRestartScriptPath.value = 'C:\\temp\\deploy\\restart.bat';
    
    modalSshEnabled.checked = false;
    modalSshHost.value = '192.168.1.100';
    modalSshUser.value = 'deploy';
    modalSshCredentialsId.value = 'ssh-key-id';
    modalSshPassword.value = '';
    modalSshPrivateKey.value = '';
    modalSshFields.classList.add('hidden');
    
    showModal();
  }

  btnCloseModal.addEventListener('click', hideModal);
  btnCancelModal.addEventListener('click', hideModal);
  
  profileModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const indexStr = modalProfileIndex.value;
    const isNew = indexStr === 'new';
    
    const targetProfile = {
      name: modalName.value.trim(),
      deployType: modalDeployType.value,
      targetFileName: modalTargetFileName.value.trim(),
      deployPath: modalDeployPath.value.trim(),
      backupPath: modalBackupPath.value.trim(),
      restartScriptPath: modalRestartScriptPath.value.trim(),
      sshEnabled: modalSshEnabled.checked,
      sshHost: modalSshHost.value.trim(),
      sshUser: modalSshUser.value.trim(),
      sshCredentialsId: modalSshCredentialsId.value.trim(),
      sshPassword: modalSshPassword.value.trim(),
      sshPrivateKey: modalSshPrivateKey.value.trim(),
      onlyDeployIfRunning: modalOnlyDeployIfRunning.checked
    };
    
    if (isNew) {
      profiles.push(targetProfile);
    } else {
      const index = parseInt(indexStr, 10);
      profiles[index] = targetProfile;
    }
    
    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles)
      });
      
      if (!response.ok) throw new Error('프로필 저장 중 서버 오류 발생');
      
      showToast(isNew ? '새 서버 프로필이 추가되었습니다.' : '서버 프로필이 수정되었습니다.', 'success');
      hideModal();
      
      renderProfilesDropdown();
      updateServersCount();
      
      if (!isNew && parseInt(indexStr, 10) === activeProfileIndex) {
        applyProfile(activeProfileIndex);
      } else if (isNew) {
        activeProfileIndex = profiles.length - 1;
        applyProfile(activeProfileIndex);
        profileSelect.value = activeProfileIndex;
      }
      
      renderServersDashboard();
      
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function deleteProfileByIndex(index) {
    if (profiles.length <= 1) {
      showToast('최소 한 개의 프로필은 유지해야 합니다.', 'error');
      return;
    }
    
    const profName = profiles[index].name;
    if (!confirm(`"${profName}" 서버 프로필을 삭제하시겠습니까?`)) return;
    
    profiles.splice(index, 1);
    
    if (activeProfileIndex >= profiles.length) {
      activeProfileIndex = 0;
    }
    
    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles)
      });
      
      if (!response.ok) throw new Error('프로필 삭제 실패');
      
      showToast(`"${profName}" 프로필이 삭제되었습니다.`, 'success');
      renderProfilesDropdown();
      applyProfile(activeProfileIndex);
      profileSelect.value = activeProfileIndex;
      updateServersCount();
      renderServersDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (btnRefreshAllStatus) {
    btnRefreshAllStatus.addEventListener('click', () => {
      profiles.forEach((_, idx) => {
        checkSingleServerStatus(idx);
      });
      showToast('모든 서버의 가용성 상태를 재조회 중입니다.', 'info');
    });
  }

  if (btnCreateServer) {
    btnCreateServer.addEventListener('click', openAddProfileModal);
  }

  // File Upload Text change
  appFile.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      fileChosenText.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
      
      // Auto-detect deploy type based on file ext
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const isSsh = sshEnabled.checked;
      
      if (ext === '.war') {
        inputDeployType.value = 'war';
        inputDeployPath.value = isSsh ? '/opt/tomcat/webapps' : 'C:\\apache-tomcat\\webapps';
        inputRestartScriptPath.value = isSsh ? '/opt/tomcat/bin/startup.sh' : 'C:\\apache-tomcat\\bin\\startup.bat';
      } else if (ext === '.jar') {
        inputDeployType.value = 'jar';
        inputDeployPath.value = isSsh ? '/var/www/deploy' : 'C:\\temp\\deploy';
        inputRestartScriptPath.value = isSsh ? '/var/www/deploy/restart.sh' : 'C:\\temp\\deploy\\restart.bat';
      }

      inputTargetFileName.value = file.name;
      updateJenkinsfile();
    } else {
      fileChosenText.textContent = '파일 선택 (WAR, JAR)';
    }
  });

  // Event listeners for inputs to update Jenkinsfile in real-time
  [inputTargetFileName, inputDeployPath, inputBackupPath, inputRestartScriptPath, inputDeployType].forEach(input => {
    input.addEventListener('input', updateJenkinsfile);
  });

  // Mode radio triggers
  modeSimulated.addEventListener('change', updateModeUI);
  modeReal.addEventListener('change', updateModeUI);

  function updateModeUI() {
    if (modeSimulated.checked) {
      sysModePill.className = 'status-pill active';
      sysModeText.textContent = 'SIMULATION MODE';
      showToast('시뮬레이션 모드로 전환되었습니다. 실제 파일 작업이 생략됩니다.', 'info');
    } else {
      sysModePill.className = 'status-pill';
      sysModePill.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      sysModePill.style.background = 'rgba(245, 158, 11, 0.1)';
      sysModePill.style.color = '#f59e0b';
      sysModeText.textContent = 'REAL LOCAL MODE';
      showToast('실제 로컬 실행 모드로 전환되었습니다. 시스템 리소스를 변경합니다.', 'warning');
    }
  }

  // Process Detection logic
  btnDetectProcess.addEventListener('click', async () => {
    processDetectList.innerHTML = '<div style="text-align:center; padding:1.5rem; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin text-cyan"></i> 실행 중인 Java 프로세스 검색 중...</div>';
    processDetectOverlay.classList.remove('hidden');

    try {
      const response = await fetch(`/api/detect-processes?isSimulated=${modeSimulated.checked}`);
      if (!response.ok) throw new Error('프로세스 감지 실패');
      
      const data = await response.json();
      renderDetectedProcesses(data.processes);
    } catch (err) {
      processDetectList.innerHTML = `<div style="color:var(--color-crimson); padding:1rem; text-align:center;">오류: ${err.message}</div>`;
    }
  });

  btnCloseDetect.addEventListener('click', () => {
    processDetectOverlay.classList.add('hidden');
  });

  function renderDetectedProcesses(processes) {
    if (processes.length === 0) {
      processDetectList.innerHTML = '<div style="text-align:center; padding:1.5rem; color:var(--text-dark); font-style:italic;">현재 기동 중인 Java 프로세스가 없습니다. (로컬에 Java 프로세스를 띄운 뒤 시도해 보십시오)</div>';
      return;
    }

    processDetectList.innerHTML = '';
    processes.forEach(proc => {
      const item = document.createElement('div');
      item.className = 'process-item';
      
      const badgeClass = proc.type === 'war' ? 'tomcat' : 'jar';
      const label = proc.type === 'war' ? 'Tomcat' : 'JAR App';
      const displayName = proc.targetFile || (proc.type === 'war' ? 'Catalina (webapps)' : 'Java Application');

      item.innerHTML = `
        <div class="process-item-meta">
          <span class="process-pid">PID: ${proc.pid} ${proc.isMock ? '(시뮬레이션)' : ''}</span>
          <span class="process-type-badge ${badgeClass}">${label}</span>
        </div>
        <div class="process-command" title="${proc.command}">${proc.command}</div>
        <div class="process-detected-path">
          <i class="fa-solid fa-folder-open"></i> 배포 감지 경로: <strong>${proc.deployPath}</strong>
        </div>
      `;

      item.addEventListener('click', () => {
        // Populate form fields
        inputDeployType.value = proc.type;
        inputTargetFileName.value = proc.targetFile || (proc.type === 'war' ? 'ROOT.war' : 'app.jar');
        inputDeployPath.value = proc.deployPath;
        
        // Formulate restart script path
        if (proc.type === 'war') {
          inputRestartScriptPath.value = proc.deployPath.replace('webapps', 'bin\\startup.bat');
        } else {
          inputRestartScriptPath.value = `${proc.deployPath}\\restart.bat`;
        }

        processDetectOverlay.classList.add('hidden');
        updateJenkinsfile();
        showToast(`기동 중인 프로세스를 기준으로 설정이 자동 로드되었습니다. (${displayName})`, 'success');
        
        appendTerminalLine('sys', `[SYSTEM] Process auto-detection parsed: Type=${proc.type}, Path=${proc.deployPath}, File=${inputTargetFileName.value}`);
      });

      processDetectList.appendChild(item);
    });
  }

  // Clear Terminal
  btnClearTerminal.addEventListener('click', () => {
    terminalBody.innerHTML = '<div class="terminal-line sys">[SYSTEM] Terminal logs cleared. Ready.</div>';
  });

  // Copy Terminal Logs
  btnCopyTerminal.addEventListener('click', () => {
    const lines = Array.from(terminalBody.querySelectorAll('.terminal-line')).map(l => l.textContent);
    if (lines.length === 0) return;
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => showToast('로그가 클립보드에 복사되었습니다.', 'success'))
      .catch(() => showToast('복사 실패', 'error'));
  });

  // Copy Jenkinsfile Code
  btnCopyJenkinsfile.addEventListener('click', () => {
    const code = jenkinsfileCode.textContent;
    navigator.clipboard.writeText(code)
      .then(() => showToast('Jenkinsfile이 클립보드에 복사되었습니다.', 'success'))
      .catch(() => showToast('복사 실패', 'error'));
  });

  // Refresh Backups click
  btnRefreshBackups.addEventListener('click', fetchBackups);

  // Form Submit (Trigger Deploy)
  deployForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validate file upload if in real mode
    if (modeReal.checked && !appFile.files[0]) {
      showToast('실제 실행 모드에서는 WAR 또는 JAR 파일을 업로드해야 합니다.', 'error');
      appendTerminalLine('error', '[ERROR] Artifact file upload is required for real mode.');
      return;
    }

    // Reset UI and timers
    resetPipelineUI();
    startTimer();
    btnDeploy.disabled = true;
    appendTerminalLine('sys', `[SYSTEM] Preparing pipeline execution [Mode: ${modeSimulated.checked ? 'SIMULATION' : 'REAL'}]...`);

    // Prepare form data
    const formData = new FormData();
    formData.append('deployPath', inputDeployPath.value);
    formData.append('backupPath', inputBackupPath.value);
    formData.append('restartScriptPath', inputRestartScriptPath.value);
    formData.append('targetFileName', inputTargetFileName.value);
    formData.append('deployType', inputDeployType.value);
    formData.append('isSimulated', modeSimulated.checked);
    
    // SSH Params
    formData.append('sshEnabled', sshEnabled.checked);
    formData.append('sshHost', inputSshHost.value);
    formData.append('sshUser', inputSshUser.value);
    formData.append('sshCredentialsId', inputSshCredentialsId.value);
    formData.append('sshPassword', inputSshPassword.value.trim());
    formData.append('sshPrivateKey', inputSshPrivateKey.value.trim());
    formData.append('onlyDeployIfRunning', onlyDeployIfRunning.checked);

    if (appFile.files[0]) {
      formData.append('appFile', appFile.files[0]);
    }

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server error occurred.');
      }

      const { taskId } = await response.json();
      appendTerminalLine('sys', `[SYSTEM] Pipeline initialized. Task ID: ${taskId}`);
      
      // Connect to SSE log stream
      connectLogStream(taskId);

    } catch (err) {
      stopTimer();
      btnDeploy.disabled = false;
      appendTerminalLine('error', `[ERROR] Failed to start pipeline: ${err.message}`);
      showToast(err.message, 'error');
    }
  });

  // SSE Stream handler
  function connectLogStream(taskId) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/deploy/logs/${taskId}`);

    eventSource.onmessage = (event) => {
      const log = JSON.parse(event.data);
      renderLogLine(log);
      updatePipelineStep(log.stage, log.status);
    };

    eventSource.addEventListener('end', (event) => {
      const data = JSON.parse(event.data);
      stopTimer();
      btnDeploy.disabled = false;
      eventSource.close();
      eventSource = null;

      if (data.status === 'SUCCESS') {
        showToast('파이프라인 실행이 완료되었습니다!', 'success');
        // Update all remaining steps to complete/success
        setAllStepsSuccess();
        setTimeout(fetchBackups, 1000); // Reload backups list
      } else {
        showToast('파이프라인이 실행 중 실패했습니다.', 'error');
      }
    });

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      stopTimer();
      btnDeploy.disabled = false;
      appendTerminalLine('error', '[SYSTEM-ERROR] Connection to log stream interrupted.');
      eventSource.close();
      eventSource = null;
    };
  }

  // Format and print log line in terminal
  function renderLogLine(log) {
    let type = 'stdout';
    const msg = log.message;

    if (msg.startsWith('[BUILD]')) type = 'info';
    else if (msg.startsWith('[BACKUP]')) type = 'warning';
    else if (msg.startsWith('[DEPLOY]')) type = 'info';
    else if (msg.startsWith('[RESTART]')) type = 'stdout';
    else if (msg.startsWith('[HEALTH]')) type = 'success';
    else if (msg.startsWith('[ERROR]') || msg.includes('Error')) type = 'error';
    else if (msg.startsWith('[STDOUT]')) {
      type = 'stdout';
      log.message = msg.substring(8); // remove tag
    } else if (msg.startsWith('[STDERR]')) {
      type = 'stderr';
      log.message = msg.substring(8);
    } else if (msg.startsWith('Pipeline finished')) {
      type = 'sys';
    }

    appendTerminalLine(type, `[${log.timestamp}] ${log.message}`);
  }

  function appendTerminalLine(type, message) {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = message;
    terminalBody.appendChild(line);
    
    // Auto-scroll
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  // Update visual steps in pipeline UI
  function updatePipelineStep(stage, status) {
    let targetStep = null;
    let progressPct = 0;

    switch (stage) {
      case 'BUILD':
        targetStep = stepBuild;
        progressPct = 10;
        break;
      case 'BACKUP':
        targetStep = stepBackup;
        progressPct = 30;
        break;
      case 'DEPLOY':
        targetStep = stepDeploy;
        progressPct = 55;
        break;
      case 'RESTART':
        targetStep = stepRestart;
        progressPct = 80;
        break;
      case 'HEALTH_CHECK':
        targetStep = stepHealth;
        progressPct = 95;
        break;
    }

    if (!targetStep) return;

    // Reset other active running states
    document.querySelectorAll('.pipeline-step').forEach(step => {
      if (step !== targetStep && step.classList.contains('running')) {
        step.classList.remove('running');
      }
    });

    if (status === 'RUNNING') {
      targetStep.className = 'pipeline-step running';
      targetStep.querySelector('.step-status').textContent = 'Running';
    } else if (status === 'SUCCESS') {
      targetStep.className = 'pipeline-step success';
      targetStep.querySelector('.step-status').textContent = 'Success';
    } else if (status === 'FAILED') {
      targetStep.className = 'pipeline-step failed';
      targetStep.querySelector('.step-status').textContent = 'Failed';
      pipelineProgressBar.style.setProperty('--progress-pct', `${progressPct}%`);
      // Update progress bar glow color to error
      pipelineProgressBar.style.background = 'var(--color-crimson)';
      return;
    }

    // Set progress bar fill percentage
    pipelineProgressBar.style.setProperty('--progress-pct', `${progressPct}%`);
  }

  function setAllStepsSuccess() {
    const steps = [stepBuild, stepBackup, stepDeploy, stepRestart, stepHealth];
    steps.forEach(step => {
      if (!step.classList.contains('failed')) {
        step.className = 'pipeline-step success';
        step.querySelector('.step-status').textContent = 'Success';
      }
    });
    pipelineProgressBar.style.setProperty('--progress-pct', '100%');
  }

  function resetPipelineUI() {
    const steps = [stepBuild, stepBackup, stepDeploy, stepRestart, stepHealth];
    steps.forEach(step => {
      step.className = 'pipeline-step';
      step.querySelector('.step-status').textContent = 'Waiting';
    });
    pipelineProgressBar.style.setProperty('--progress-pct', '0%');
    pipelineProgressBar.style.background = 'rgba(255, 255, 255, 0.08)';
    pipelineTimer.textContent = 'Elapsed: 00.0s';
  }

  // Timer Control
  function startTimer() {
    startTime = Date.now();
    pipelineTimer.textContent = 'Elapsed: 00.0s';
    
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      pipelineTimer.textContent = `Elapsed: ${elapsed}s`;
    }, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Fetch backups from target backup path
  async function fetchBackups() {
    const backupPath = inputBackupPath.value;
    if (!backupPath) return;

    try {
      const response = await fetch(`/api/backups?backupPath=${encodeURIComponent(backupPath)}`);
      if (!response.ok) throw new Error('Failed to retrieve backup list');
      
      const backups = await response.json();
      renderBackupTable(backups);
    } catch (err) {
      console.warn('Backup fetch skipped/failed:', err.message);
      backupListBody.innerHTML = `<tr><td colspan="4" class="empty-message">백업 경로를 찾을 수 없거나 접근할 수 없습니다. (경로: ${backupPath})</td></tr>`;
    }
  }

  function renderBackupTable(backups) {
    if (backups.length === 0) {
      backupListBody.innerHTML = '<tr><td colspan="4" class="empty-message">백업이 존재하지 않습니다.</td></tr>';
      return;
    }

    backupListBody.innerHTML = '';
    backups.forEach(backup => {
      const tr = document.createElement('tr');
      const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
      const date = new Date(backup.mtime).toLocaleString();

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-size: 0.8rem;" title="${backup.filename}">${backup.filename.length > 30 ? backup.filename.substring(0,27) + '...' : backup.filename}</td>
        <td>${sizeMB} MB</td>
        <td>${date}</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-rollback" data-file="${backup.filename}">
            <i class="fa-solid fa-rotate-left"></i> 롤백
          </button>
        </td>
      `;

      // Rollback trigger
      tr.querySelector('.btn-rollback').addEventListener('click', (e) => {
        const file = e.currentTarget.getAttribute('data-file');
        triggerRollback(file);
      });

      backupListBody.appendChild(tr);
    });
  }

  // Handle rollback click
  async function triggerRollback(backupFilename) {
    if (!confirm(`${backupFilename} 파일로 롤백을 진행하시겠습니까?\n현재 라이브 파일이 대체되며 재기동이 수행됩니다.`)) {
      return;
    }

    resetPipelineUI();
    startTimer();
    btnDeploy.disabled = true;
    appendTerminalLine('warning', `[ROLLBACK] Starting Rollback sequence using backup: ${backupFilename}`);

    const backupFilePath = `${inputBackupPath.value}/${backupFilename}`;
    const targetFilePath = `${inputDeployPath.value}/${inputTargetFileName.value}`;

    try {
      const response = await fetch('/api/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupFilePath,
          targetFilePath,
          restartScriptPath: inputRestartScriptPath.value,
          isSimulated: modeSimulated.checked
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server error during rollback initiation.');
      }

      const { taskId } = await response.json();
      connectLogStream(taskId);

    } catch (err) {
      stopTimer();
      btnDeploy.disabled = false;
      appendTerminalLine('error', `[ROLLBACK-ERROR] Rollback failed: ${err.message}`);
      showToast(err.message, 'error');
    }
  }


  // Dynamic Jenkinsfile template updates
  function updateJenkinsfile() {
    // Read state
    const isSsh = sshEnabled.checked;
    const sshHost = inputSshHost.value;
    const sshUser = inputSshUser.value;
    const sshCreds = inputSshCredentialsId.value;
    const checkRunning = onlyDeployIfRunning.checked;
    
    const target = inputTargetFileName.value;
    const deployType = inputDeployType.value;
    const script = escapePath(inputRestartScriptPath.value);

    // Normalize slashes. If SSH remote is enabled, force Unix slashes since it targets Linux!
    let deploy = inputDeployPath.value;
    let backup = inputBackupPath.value;
    if (isSsh) {
      deploy = deploy.replace(/\\/g, '/');
      backup = backup.replace(/\\/g, '/');
    }
    
    deploy = escapePath(deploy);
    backup = escapePath(backup);

    const isWindows = !isSsh && (script.endsWith('.bat') || script.endsWith('.cmd') || script.endsWith('.ps1'));

    let rawTemplate = '';

    if (isSsh) {
      // Enterprise Remote SSH Linux deployment Groovy pipeline
      const contextName = deployType === 'war' && target.toLowerCase().endsWith('.war') 
        ? target.substring(0, target.length - 4) 
        : target;

      rawTemplate = `pipeline {
    agent any

    environment {
        SSH_HOST     = "${sshHost}"
        SSH_USER     = "${sshUser}"
        SSH_CREDS    = "${sshCreds}" // Jenkins SSH Credentials ID
        DEPLOY_DIR   = "${deploy}"
        BACKUP_DIR   = "${backup}"
        TARGET_FILE  = "${target}"
        SCRIPT_PATH  = "${script}"
        CONTEXT_NAME = "${contextName}"
    }

    stages {
        stage('Checkout & Build') {
            steps {
                echo "Checking out Git code and building ${deployType.toUpperCase()} file..."
                // sh './gradlew clean boot${deployType === 'war' ? 'War' : 'Jar'}'
            }
        }

        ${checkRunning ? `stage('Pre-check: Active Process Validation') {
            steps {
                echo "Validating if target service is active on remote Linux server (\${SSH_HOST})..."
                sshagent(credentials: ["\${SSH_CREDS}"]) {
                    script {
                        // Check if process (JAR name or Tomcat bootstrap) is currently running
                        def processQuery = "${deployType === 'war' ? 'catalina.base' : '\${TARGET_FILE}'}"
                        def checkCmd = "ssh -o StrictHostKeyChecking=no \${SSH_USER}@\${SSH_HOST} 'pgrep -f \\"\${processQuery}\\" || true'"
                        
                        def pid = sh(script: checkCmd, returnStdout: true).trim()
                        if (pid == "") {
                            // Service is NOT running - refuse to upload / fail pipeline!
                            error "Deploy Rejected: 원격 서버에서 해당 서비스가 구동 중이 아닙니다! 기동 중인 서비스에만 업로드가 가능합니다. (검색어: \${processQuery})"
                        } else {
                            echo "기동 중인 프로세스 감지됨 (PID: \${pid}). 배포를 승인합니다."
                        }
                    }
                }
            }
        }` : '// Pre-check stage skipped'}

        stage('Remote Backup') {
            steps {
                echo "Creating remote backup..."
                sshagent(credentials: ["\${SSH_CREDS}"]) {
                    script {
                        def timestamp = new Date().format("yyyyMMdd_HHmmss")
                        def remoteCmd = """
                            mkdir -p "\${BACKUP_DIR}"
                            # Backup existing war/jar if exists
                            if [ -f "\${DEPLOY_DIR}/\${TARGET_FILE}" ]; then
                                cp "\${DEPLOY_DIR}/\${TARGET_FILE}" "\${BACKUP_DIR}/\${TARGET_FILE}.\${timestamp}.bak"
                                echo "Backup created: \${TARGET_FILE}.\${timestamp}.bak"
                            fi
                            ${deployType === 'war' ? `
                            # Clear exploded context directory to avoid tomcat cache issues
                            if [ -d "\${DEPLOY_DIR}/\${CONTEXT_NAME}" ]; then
                                echo "Cleaning exploded Tomcat directory: \${DEPLOY_DIR}/\${CONTEXT_NAME}"
                                rm -rf "\${DEPLOY_DIR}/\${CONTEXT_NAME}"
                            fi` : ''}
                        """.stripIndent()

                        sh "ssh -o StrictHostKeyChecking=no \${SSH_USER}@\${SSH_HOST} '\${remoteCmd}'"
                    }
                }
            }
        }

        stage('Transfer Artifact (SFTP/SCP)') {
            steps {
                echo "Transferring new artifact to remote server..."
                sshagent(credentials: ["\${SSH_CREDS}"]) {
                    // Transfer the artifact using secure copy
                    sh "scp -o StrictHostKeyChecking=no build/libs/\${TARGET_FILE} \${SSH_USER}@\${SSH_HOST}:\${DEPLOY_DIR}/\${TARGET_FILE}"
                }
            }
        }

        stage('Remote Restart') {
            steps {
                echo "Triggering remote application restart..."
                sshagent(credentials: ["\${SSH_CREDS}"]) {
                    script {
                        // Run restart shell script remotely
                        sh "ssh -o StrictHostKeyChecking=no \${SSH_USER}@\${SSH_HOST} 'sh \${SCRIPT_PATH}'"
                    }
                }
            }
        }

        stage('Remote Health Check') {
            steps {
                echo "Verifying application health..."
                script {
                    // Ping remote server endpoint
                    def healthUrl = "http://\${SSH_HOST}:8080/\${CONTEXT_NAME}/health"
                    sh "curl --fail --retry 3 --retry-delay 5 \${healthUrl}"
                }
            }
        }
    }
}`;
    } else {
      // Local JAR/WAR deployment logic
      if (deployType === 'war') {
        const contextName = target.toLowerCase().endsWith('.war') 
          ? target.substring(0, target.length - 4) 
          : target;
        
        const tomcatHome = inputRestartScriptPath.value.includes('\\bin\\')
          ? escapePath(inputRestartScriptPath.value.substring(0, inputRestartScriptPath.value.indexOf('\\bin\\')))
          : 'C:\\\\apache-tomcat';

        let shutdownCmd = `sh "\${TOMCAT_HOME}/bin/shutdown.sh"`;
        let startupCmd = `sh "\${TOMCAT_HOME}/bin/startup.sh"`;
        let cleanCmd = `rm -rf "\${DEPLOY_DIR}/\${CONTEXT_NAME}"`;
        let backupCmd = `cp "\${DEPLOY_DIR}/\${TARGET_FILE}" "\${BACKUP_DIR}/\${TARGET_FILE}.\${TIMESTAMP}.bak"`;
        let deployCmd = `cp "\${WORKSPACE}/build/libs/\${TARGET_FILE}" "\${DEPLOY_DIR}/\${TARGET_FILE}"`;

        if (isWindows) {
          shutdownCmd = `cmd.exe /c "\${TOMCAT_HOME}\\\\bin\\\\shutdown.bat"`;
          startupCmd = `cmd.exe /c "\${TOMCAT_HOME}\\\\bin\\\\startup.bat"`;
          cleanCmd = `if exist "\${DEPLOY_DIR}\\\${CONTEXT_NAME}" rmdir /s /q "\${DEPLOY_DIR}\\\${CONTEXT_NAME}"`;
          backupCmd = `copy "\${DEPLOY_DIR}\\\${TARGET_FILE}" "\${BACKUP_DIR}\\\${TARGET_FILE}.\${TIMESTAMP}.bak"`;
          deployCmd = `copy "\${WORKSPACE}\\\\build\\\\libs\\\\\${TARGET_FILE}" "\${DEPLOY_DIR}\\\${TARGET_FILE}"`;
        }

        rawTemplate = `pipeline {
    agent any

    environment {
        TOMCAT_HOME  = "${tomcatHome}"
        DEPLOY_DIR   = "${deploy}" // Tomcat webapps directory
        BACKUP_DIR   = "${backup}"
        TARGET_FILE  = "${target}"
        CONTEXT_NAME = "${contextName}"
    }

    stages {
        stage('Checkout & Build') {
            steps {
                echo 'Checking out code and building WAR archive...'
                // sh './gradlew bootWar'
            }
        }

        stage('Stop Tomcat') {
            steps {
                echo "Shutting down Tomcat container..."
                script {
                    try {
                        if (isUnix()) {
                            sh "${shutdownCmd}"
                        } else {
                            bat "${shutdownCmd}"
                        }
                    } catch (Exception e) {
                        echo "Tomcat was not running or shutdown failed. Proceeding..."
                    }
                }
            }
        }

        stage('Backup & Clear Exploded App') {
            steps {
                script {
                    def timestamp = new Date().format("yyyyMMdd_HHmmss")
                    echo "Backing up active WAR file..."
                    if (isUnix()) {
                        sh "mkdir -p \${BACKUP_DIR}"
                        sh "if [ -f \${DEPLOY_DIR}/\${TARGET_FILE} ]; then ${backupCmd}; fi"
                        
                        echo "Cleaning exploded context directory \${DEPLOY_DIR}/\${CONTEXT_NAME} to prevent caching..."
                        sh "${cleanCmd}"
                    } else {
                        bat "if not exist \${BACKUP_DIR} mkdir \${BACKUP_DIR}"
                        bat "if exist \${DEPLOY_DIR}\\\${TARGET_FILE} ${backupCmd}"
                        
                        echo "Cleaning exploded context directory \${DEPLOY_DIR}\\\${CONTEXT_NAME} to prevent caching..."
                        bat "${cleanCmd}"
                    }
                }
            }
        }

        stage('Deploy WAR') {
            steps {
                echo "Copying new WAR file to webapps directory..."
                script {
                    if (isUnix()) {
                        sh "mkdir -p \${DEPLOY_DIR}"
                        sh "${deployCmd}"
                    } else {
                        bat "if not exist \${DEPLOY_DIR} mkdir \${DEPLOY_DIR}"
                        bat "${deployCmd}"
                    }
                }
            }
        }

        stage('Start Tomcat') {
            steps {
                echo "Starting Tomcat container..."
                script {
                    if (isUnix()) {
                        sh "${startupCmd}"
                    } else {
                        bat "${startupCmd}"
                    }
                }
            }
        }

        stage('Health Check') {
            steps {
                echo "Verifying Context [\${CONTEXT_NAME}] health..."
                // 예: sh 'curl -f http://localhost:8080/\${CONTEXT_NAME}/health'
            }
        }
    }
}`;
      } else {
        // Standard JAR deployment
        let backupCmd = `cp "\${DEPLOY_DIR}/\${TARGET_FILE}" "\${BACKUP_DIR}/\${TARGET_FILE}.\${TIMESTAMP}.bak"`;
        let deployCmd = `cp "\${WORKSPACE}/build/libs/\${TARGET_FILE}" "\${DEPLOY_DIR}/\${TARGET_FILE}"`;
        let runCmd = `sh "\${SCRIPT_PATH}"`;

        if (isWindows) {
          backupCmd = `copy "\${DEPLOY_DIR}\\\${TARGET_FILE}" "\${BACKUP_DIR}\\\${TARGET_FILE}.\${TIMESTAMP}.bak"`;
          deployCmd = `copy "\${WORKSPACE}\\build\\libs\\\${TARGET_FILE}" "\${DEPLOY_DIR}\\\${TARGET_FILE}"`;
          if (script.endsWith('.ps1')) {
            runCmd = `powershell -ExecutionPolicy Bypass -File "\${SCRIPT_PATH}"`;
          } else {
            runCmd = `cmd.exe /c "\${SCRIPT_PATH}"`;
          }
        }

        rawTemplate = `pipeline {
    agent any

    environment {
        DEPLOY_DIR  = "${deploy}"
        BACKUP_DIR  = "${backup}"
        TARGET_FILE = "${target}"
        SCRIPT_PATH = "${script}"
    }

    stages {
        stage('Checkout & Build') {
            steps {
                echo 'Checking out code and building JAR archive...'
                // sh './gradlew bootJar'
            }
        }

        stage('Backup Live App') {
            steps {
                script {
                    def timestamp = new Date().format("yyyyMMdd_HHmmss")
                    echo "Backing up existing file..."
                    if (isUnix()) {
                        sh "mkdir -p \${BACKUP_DIR}"
                        sh "if [ -f \${DEPLOY_DIR}/\${TARGET_FILE} ]; then ${backupCmd}; fi"
                    } else {
                        bat "if not exist \${BACKUP_DIR} mkdir \${BACKUP_DIR}"
                        bat "if exist \${DEPLOY_DIR}\\\${TARGET_FILE} ${backupCmd}"
                    }
                }
            }
        }

        stage('Deploy Artifact') {
            steps {
                echo "Replacing file in deployment directory..."
                script {
                    if (isUnix()) {
                        sh "mkdir -p \${DEPLOY_DIR}"
                        sh "${deployCmd}"
                    } else {
                        bat "if not exist \${DEPLOY_DIR} mkdir \${DEPLOY_DIR}"
                        bat "${deployCmd}"
                    }
                }
            }
        }

        stage('Restart Service') {
            steps {
                echo "Executing restart script: \${SCRIPT_PATH} ..."
                script {
                    if (isUnix()) {
                        sh "${runCmd}"
                    } else {
                        bat "${runCmd}"
                    }
                }
            }
        }

        stage('Health Check') {
            steps {
                echo 'Verifying application health...'
                // sh 'curl http://localhost:8080/health'
            }
        }
    }
}`;
      }
    }

    // Apply basic syntax highlighting markup
    jenkinsfileCode.innerHTML = highlightJenkinsfile(rawTemplate);
  }

  function escapePath(str) {
    // Escape backslashes for JS strings in Jenkinsfile
    return str.replace(/\\/g, '\\\\');
  }

  function highlightJenkinsfile(code) {
    // Custom regex highlighting for display
    return code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Keywords
      .replace(/\b(pipeline|agent|environment|stages|stage|steps|script|def|isUnix|sh|bat|echo)\b/g, '<span class="token-keyword">$1</span>')
      // Strings
      .replace(/(['"])(.*?)\1/g, '<span class="token-string">$1$2$1</span>')
      // Comments
      .replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>')
      // Environment variables reference
      .replace(/(\\\$\{\w+\})/g, '<span class="token-variable">$1</span>')
      .replace(/(\$\{\w+\})/g, '<span class="token-variable">$1</span>');
  }

  // ==========================================
  // SSH REMOTE TERMINAL UTILITY CLIENT LOGIC
  // ==========================================
  const sshTerminalProfileSelect = document.getElementById('ssh-terminal-profile-select');
  const sshTerminalPassword = document.getElementById('ssh-terminal-password');
  const sshTerminalPkey = document.getElementById('ssh-terminal-pkey');
  const btnSshTerminalConnect = document.getElementById('btn-ssh-terminal-connect');
  const sshTerminalBody = document.getElementById('ssh-terminal-body');
  const sshTerminalInput = document.getElementById('ssh-terminal-input');
  const sshTerminalPrompt = document.getElementById('ssh-terminal-prompt');
  const sshTerminalHeaderTitle = document.getElementById('ssh-terminal-header-title');
  const btnClearSshTerminal = document.getElementById('btn-clear-ssh-terminal');

  let sshConnected = false;
  let sshCurrentDir = '/var/www';
  let sshCommandHistory = [];
  let sshHistoryIndex = -1;

  const sshTabBtn = document.querySelector('.nav-tab[data-target="ssh-tab"]');
  if (sshTabBtn) {
    sshTabBtn.addEventListener('click', () => {
      populateSshTerminalProfiles();
    });
  }

  function populateSshTerminalProfiles() {
    if (!sshTerminalProfileSelect) return;
    sshTerminalProfileSelect.innerHTML = '';
    
    const sshProfiles = profiles.filter(p => p.sshEnabled);
    
    if (sshProfiles.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '-- 원격 SSH 프로필 없음 --';
      sshTerminalProfileSelect.appendChild(option);
      btnSshTerminalConnect.disabled = true;
      sshTerminalPassword.value = '';
      sshTerminalPkey.value = '';
    } else {
      sshProfiles.forEach((prof, idx) => {
        const option = document.createElement('option');
        const origIdx = profiles.indexOf(prof);
        option.value = origIdx;
        option.textContent = `${prof.name} (${prof.sshHost})`;
        sshTerminalProfileSelect.appendChild(option);
      });
      btnSshTerminalConnect.disabled = false;
      // Autofill first SSH profile credentials
      const firstProf = profiles[parseInt(sshTerminalProfileSelect.value, 10)];
      if (firstProf) {
        sshTerminalPassword.value = firstProf.sshPassword || '';
        sshTerminalPkey.value = firstProf.sshPrivateKey || '';
      }
    }
  }

  // Handle SSH Terminal profile select change
  if (sshTerminalProfileSelect) {
    sshTerminalProfileSelect.addEventListener('change', () => {
      const profileIndex = parseInt(sshTerminalProfileSelect.value, 10);
      const prof = profiles[profileIndex];
      if (prof) {
        sshTerminalPassword.value = prof.sshPassword || '';
        sshTerminalPkey.value = prof.sshPrivateKey || '';
      } else {
        sshTerminalPassword.value = '';
        sshTerminalPkey.value = '';
      }
    });
  }

  btnSshTerminalConnect.addEventListener('click', async () => {
    if (sshConnected) {
      disconnectSshSession();
    } else {
      const profileIndex = parseInt(sshTerminalProfileSelect.value, 10);
      const prof = profiles[profileIndex];
      if (!prof) {
        showToast('유효한 프로필을 선택해 주십시오.', 'error');
        return;
      }

      sshTerminalProfileSelect.disabled = true;
      sshTerminalPassword.disabled = true;
      sshTerminalPkey.disabled = true;
      btnSshTerminalConnect.disabled = true;
      btnSshTerminalConnect.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 연결 중...';

      appendSshTerminalLine('sys', `Connecting to ${prof.sshUser}@${prof.sshHost} (Port 22)...`);

      setTimeout(async () => {
        const isSim = modeSimulated.checked;
        if (isSim) {
          sshConnected = true;
          sshCurrentDir = prof.deployPath || `/var/www/${prof.targetFileName.split('.')[0]}`;
          
          btnSshTerminalConnect.disabled = false;
          btnSshTerminalConnect.innerHTML = '<i class="fa-solid fa-unlink"></i> SSH 세션 해제';
          btnSshTerminalConnect.className = 'btn btn-secondary';
          
          sshTerminalInput.disabled = false;
          sshTerminalHeaderTitle.textContent = `SSH Terminal Console (Connected to ${prof.sshHost})`;
          updateSshPromptPrefix(prof.sshUser, prof.sshHost);
          
          appendSshTerminalLine('sys', `Connection established. Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-88-generic x86_64)`);
          appendSshTerminalLine('sys', `* Documentation:  https://help.ubuntu.com\n* Management:     https://landscape.canonical.com\n* Support:        https://ubuntu.com/pro`);
          appendSshTerminalLine('sys', `Last login: ${new Date().toLocaleString()} from 10.200.1.45`);
          
          sshTerminalInput.focus();
        } else {
          try {
            const response = await fetch(`/api/ssh/execute?isSimulated=false`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                profile: prof,
                auth: {
                  password: sshTerminalPassword.value.trim(),
                  privateKey: sshTerminalPkey.value.trim()
                },
                command: 'whoami',
                currentDir: prof.deployPath
              })
            });

            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error || 'SSH Authentication failed.');
            }

            const data = await response.json();
            
            sshConnected = true;
            sshCurrentDir = data.currentDir || prof.deployPath;
            
            btnSshTerminalConnect.disabled = false;
            btnSshTerminalConnect.innerHTML = '<i class="fa-solid fa-unlink"></i> SSH 세션 해제';
            btnSshTerminalConnect.className = 'btn btn-secondary';
            
            sshTerminalInput.disabled = false;
            sshTerminalHeaderTitle.textContent = `SSH Terminal Console (Connected to ${prof.sshHost})`;
            updateSshPromptPrefix(data.output.trim() || prof.sshUser, prof.sshHost);
            
            appendSshTerminalLine('sys', `SSH Connection established successfully via ssh2 client.`);
            appendSshTerminalLine('sys', `User logged in: ${data.output.trim()}`);
            appendSshTerminalLine('sys', `Remote working directory: ${sshCurrentDir}`);
            
            sshTerminalInput.focus();

          } catch (err) {
            appendSshTerminalLine('cmd-error', `Connection Failed: ${err.message}`);
            showToast(err.message, 'error');
            resetSshConnectionUI();
          }
        }
      }, 1000);
    }
  });

  function disconnectSshSession() {
    sshConnected = false;
    appendSshTerminalLine('sys', `SSH session disconnected.`);
    resetSshConnectionUI();
  }

  function resetSshConnectionUI() {
    sshConnected = false;
    sshTerminalProfileSelect.disabled = false;
    sshTerminalPassword.disabled = false;
    sshTerminalPkey.disabled = false;
    btnSshTerminalConnect.disabled = false;
    btnSshTerminalConnect.innerHTML = '<i class="fa-solid fa-link"></i> SSH 세션 연결';
    btnSshTerminalConnect.className = 'btn btn-primary';
    
    sshTerminalInput.disabled = true;
    sshTerminalInput.value = '';
    sshTerminalPrompt.textContent = 'user@localhost:~$';
    sshTerminalHeaderTitle.textContent = 'SSH Terminal Console (Disconnected)';
  }

  function updateSshPromptPrefix(user, host) {
    sshTerminalPrompt.textContent = `${user}@${host}:${sshCurrentDir}$`;
  }

  function appendSshTerminalLine(type, text) {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    sshTerminalBody.appendChild(line);
    sshTerminalBody.scrollTop = sshTerminalBody.scrollHeight;
  }

  if (btnClearSshTerminal) {
    btnClearSshTerminal.addEventListener('click', () => {
      sshTerminalBody.innerHTML = '<div class="terminal-line sys">[SYSTEM] Terminal logs cleared. Connected.</div>';
    });
  }

  sshTerminalInput.addEventListener('keydown', async (e) => {
    if (!sshConnected) return;

    if (e.key === 'Enter') {
      const command = sshTerminalInput.value;
      const trimmedCmd = command.trim();
      if (trimmedCmd === '') return;

      const profileIndex = parseInt(sshTerminalProfileSelect.value, 10);
      const prof = profiles[profileIndex];
      const promptText = sshTerminalPrompt.textContent;
      
      const inputLine = document.createElement('div');
      inputLine.className = 'terminal-line cmd-input';
      inputLine.innerHTML = `<span style="color:var(--color-cyan); font-weight:600; font-family:var(--font-mono);">${promptText} </span>${escapeHtml(command)}`;
      sshTerminalBody.appendChild(inputLine);
      
      sshTerminalInput.value = '';
      sshTerminalInput.disabled = true;

      sshCommandHistory.push(command);
      sshHistoryIndex = sshCommandHistory.length;

      try {
        const isSim = modeSimulated.checked;
        const response = await fetch(`/api/ssh/execute?isSimulated=${isSim}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: prof,
            auth: {
              password: sshTerminalPassword.value.trim(),
              privateKey: sshTerminalPkey.value.trim()
            },
            command: command,
            currentDir: sshCurrentDir
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Server error occurred during execution.');
        }

        const data = await response.json();

        if (data.action === 'clear') {
          sshTerminalBody.innerHTML = '';
        } else {
          if (data.currentDir) {
            sshCurrentDir = data.currentDir;
            updateSshPromptPrefix(prof.sshUser, prof.sshHost);
          }

          if (data.output) {
            appendSshTerminalLine(data.success ? 'cmd-output' : 'cmd-error', data.output);
          } else if (!data.success && data.stderr) {
            appendSshTerminalLine('cmd-error', data.stderr);
          }
        }

      } catch (err) {
        appendSshTerminalLine('cmd-error', `Failed to execute: ${err.message}`);
      } finally {
        sshTerminalInput.disabled = false;
        sshTerminalInput.focus();
        sshTerminalBody.scrollTop = sshTerminalBody.scrollHeight;
      }

    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (sshCommandHistory.length > 0 && sshHistoryIndex > 0) {
        sshHistoryIndex--;
        sshTerminalInput.value = sshCommandHistory[sshHistoryIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (sshCommandHistory.length > 0 && sshHistoryIndex < sshCommandHistory.length - 1) {
        sshHistoryIndex++;
        sshTerminalInput.value = sshCommandHistory[sshHistoryIndex];
      } else {
        sshHistoryIndex = sshCommandHistory.length;
        sshTerminalInput.value = '';
      }
    }
  });

  async function testSshConnection(credentials, buttonEl) {
    const originalText = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 연결 테스트 중...';
    
    try {
      const isSim = modeSimulated.checked;
      const response = await fetch(`/api/ssh/test-connection?isSimulated=${isSim}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      
      const data = await response.json();
      if (response.ok && data.success) {
        showToast(data.message, 'success');
      } else {
        showToast(data.error || '연결 실패', 'error');
      }
    } catch (err) {
      showToast(`연결 실패: ${err.message}`, 'error');
    } finally {
      buttonEl.disabled = false;
      buttonEl.innerHTML = originalText;
    }
  }

  // Bind Main Form Connection Test
  const btnTestSshConnection = document.getElementById('btn-test-ssh-connection');
  if (btnTestSshConnection) {
    btnTestSshConnection.addEventListener('click', () => {
      testSshConnection({
        host: inputSshHost.value.trim(),
        username: inputSshUser.value.trim(),
        password: inputSshPassword.value.trim(),
        privateKey: inputSshPrivateKey.value.trim()
      }, btnTestSshConnection);
    });
  }

  // Bind Modal Form Connection Test
  const btnModalTestSsh = document.getElementById('btn-modal-test-ssh');
  if (btnModalTestSsh) {
    btnModalTestSsh.addEventListener('click', () => {
      testSshConnection({
        host: modalSshHost.value.trim(),
        username: modalSshUser.value.trim(),
        password: modalSshPassword.value.trim(),
        privateKey: modalSshPrivateKey.value.trim()
      }, btnModalTestSsh);
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Custom Toast Notifier
  function showToast(message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${icon}"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Remove toast after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'slide-in 0.3s reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
});
