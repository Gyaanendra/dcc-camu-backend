#!/usr/bin/env bash
# ==============================================================================
# DCC CAMU Backend Deployment Script for Ubuntu VPS
# Usage: ./deploy.sh [branch_name]
# ==============================================================================

set -e # Exit immediately if any command fails

BRANCH="${1:-main}"
PM2_APP_NAME="dcc-backend"
PORT="5000"

echo "--------------------------------------------------------"
echo "🚀 Starting DCC Backend deployment on branch: $BRANCH"
echo "--------------------------------------------------------"

# 1. Ensure we are in the project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📂 Current directory: $(pwd)"

# 2. Pull the latest code from git
echo "📥 Fetching latest code from origin/$BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

# 3. Install production & build dependencies
echo "📦 Installing npm dependencies..."
npm install --production=false

# 4. Build TypeScript to JavaScript (/dist)
echo "⚙️ Building TypeScript project..."
npm run build

# 5. Restart or start the PM2 service
echo "🔄 Reloading PM2 process ($PM2_APP_NAME)..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 reload "$PM2_APP_NAME" || pm2 restart "$PM2_APP_NAME"
else
    echo "⚠️ App '$PM2_APP_NAME' not found in PM2, starting new instance..."
    pm2 start dist/server.js --name "$PM2_APP_NAME"
fi

# Save PM2 process list so it survives server reboots
pm2 save

# 6. Verify health
echo "⏳ Waiting 2 seconds for server warmup..."
sleep 2

echo "🩺 Verifying backend response..."
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" || echo "000")

if [ "$HTTP_RESPONSE" = "200" ]; then
    echo "--------------------------------------------------------"
    echo "✅ DEPLOYMENT SUCCESSFUL! Backend is online on port $PORT."
    echo "--------------------------------------------------------"
    curl -s "http://127.0.0.1:$PORT/" | jq . 2>/dev/null || curl -s "http://127.0.0.1:$PORT/"
    echo ""
else
    echo "--------------------------------------------------------"
    echo "⚠️ Backend responded with HTTP status $HTTP_RESPONSE."
    echo "Check PM2 logs with: pm2 logs $PM2_APP_NAME"
    echo "--------------------------------------------------------"
fi
