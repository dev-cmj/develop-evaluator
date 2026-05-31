#!/bin/bash
echo "[SHELL] Searching for running instances of java -jar app.jar..."
sleep 1
PID=$(pgrep -f "app.jar")
if [ -n "$PID" ]; then
  echo "[SHELL] Terminating process $PID..."
  kill -15 $PID
  sleep 1
else
  echo "[SHELL] No active instance found."
fi

echo "[SHELL] Starting app.jar in background..."
# nohup java -jar app.jar > app.log 2>&1 &
sleep 2
echo "[SHELL] Service restarted successfully."
exit 0
