#!/bin/bash
# Add temporary debug logging to running service by rebuilding with console.log

cd /root/bridge-service-v2

# Check current service pid
PID=$(ps aux | grep "bridge-service-v2/dist/index.js" | grep -v grep | awk '{print $2}')
echo "Current service PID: $PID"
echo "Service started at: $(ps -p $PID -o lstart=)"
echo ""
echo "=== Last 50 lines of service.log ==="
tail -50 /root/bridge-service-v2/service.log
echo ""
echo "=== Last 50 lines of syslog (kernel messages) ==="
dmesg | tail -30