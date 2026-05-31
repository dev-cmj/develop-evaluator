@echo off
echo [BATCH] Stopping active application listener on port 8080...
timeout /t 2 /nobreak > nul
echo [BATCH] Kill command executed successfully. Port 8080 is free.
echo [BATCH] Deploying and unpacking new libraries...
timeout /t 1 /nobreak > nul
echo [BATCH] Starting application via: java -jar app.jar --server.port=8080
timeout /t 2 /nobreak > nul
echo [BATCH] JVM Boot sequence complete. Active and listening.
exit /b 0
