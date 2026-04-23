#!/bin/bash
pkill -f "bridge-service" 2>/dev/null || true
sleep 2
cd /root/bridge-service-v2
node dist/index.js >> service.log 2>&1 &
sleep 3
curl -s http://localhost:3978/health