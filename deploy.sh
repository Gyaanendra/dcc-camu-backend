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
# Discard local uncommitted changes on server (like deploy.sh chmod) to prevent merge conflicts
git checkout -- .
git pull origin "$BRANCH"

# 3. Install production & build dependencies
echo "📦 Installing npm dependencies..."
npm install --omit=dev

# 4. Build TypeScript to JavaScript (/dist)
echo "⚙️ Building TypeScript project..."
npm run build

# 5. Clean up port conflicts & handle rogue/orphaned processes
echo "🔍 Checking port $PORT for conflicting or orphaned processes..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 stop "$PM2_APP_NAME" 2>/dev/null || true
fi

# Find any remaining process holding port 5000 (outside PM2)
PORT_PIDS=$(lsof -ti :"$PORT" 2>/dev/null || fuser "$PORT"/tcp 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
    echo "⚠️ Found orphaned process(es) on port $PORT ($PORT_PIDS). Terminating..."
    kill -9 $PORT_PIDS 2>/dev/null || true
    sleep 1
fi

# Ensure SQLite database files have proper read/write permissions
if [ -f "dcc.db" ]; then
    chmod 664 dcc.db* 2>/dev/null || true
fi

# 6. Restart or start the PM2 service with updated environment
echo "🔄 Starting PM2 process ($PM2_APP_NAME) with updated environment..."
if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 restart "$PM2_APP_NAME" --update-env
else
    echo "⚠️ App '$PM2_APP_NAME' not found in PM2, starting new instance..."
    pm2 start dist/server.js --name "$PM2_APP_NAME"
fi

# Save PM2 process list so it survives server reboots
pm2 save

# 7. Verify health
echo "⏳ Waiting 3 seconds for server warmup..."
sleep 3

echo "🩺 Verifying backend response..."
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" || echo "000")

if [ "$HTTP_RESPONSE" = "200" ]; then
    echo "--------------------------------------------------------"
    echo "✅ DEPLOYMENT SUCCESSFUL! Backend is online on port $PORT."
    echo "--------------------------------------------------------"
    curl -s "http://127.0.0.1:$PORT/" | jq . 2>/dev/null || curl -s "http://127.0.0.1:$PORT/"
    echo ""
    echo "📊 Testing /api/list endpoint..."
    curl -s "http://127.0.0.1:$PORT/api/list" | jq -r '"Total members returned: " + (.total|tostring)' 2>/dev/null || echo "Endpoint verified."
    echo ""
else
    echo "--------------------------------------------------------"
    echo "⚠️ Backend responded with HTTP status $HTTP_RESPONSE."
    echo "📋 Recent error logs:"
    pm2 logs "$PM2_APP_NAME" --lines 15 --nostream
    echo "--------------------------------------------------------"
    exit 1
fi
