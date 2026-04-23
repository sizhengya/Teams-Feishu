#!/bin/bash
set -e

echo "==> Pulling latest code"
git pull

echo "==> Installing dependencies"
npm install --production

echo "==> Restarting service"
pm2 reload all || pm2 start index.js --name bridge-service

echo "==> Done"
``
