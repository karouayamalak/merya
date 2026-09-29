#!/usr/bin/env bash
set -e

ENV_FILE="/var/www/merya/backend/.env"

echo "======================================================"
echo "Updating Telegram Environment Variables..."
echo "======================================================"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found!"
  exit 1
fi

# Allow token and chat ID via CLI arguments, environment variables, or interactive prompt
BOT_TOKEN="${1:-${TELEGRAM_BOT_TOKEN}}"
CHAT_ID="${2:-${TELEGRAM_CHAT_ID}}"

if [ -z "$BOT_TOKEN" ]; then
  read -r -p "Enter Telegram Bot Token: " BOT_TOKEN
fi

if [ -z "$CHAT_ID" ]; then
  read -r -p "Enter Telegram Chat ID: " CHAT_ID
fi

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "Error: Both Telegram Bot Token and Chat ID are required."
  exit 1
fi

# Remove any existing Telegram lines to prevent duplicates
sed -i '/TELEGRAM_BOT_TOKEN=/d' "$ENV_FILE"
sed -i '/TELEGRAM_CHAT_ID=/d' "$ENV_FILE"

# Append securely passed token and chat ID
echo "TELEGRAM_BOT_TOKEN=${BOT_TOKEN}" >> "$ENV_FILE"
echo "TELEGRAM_CHAT_ID=${CHAT_ID}" >> "$ENV_FILE"

echo "Telegram variables updated successfully in $ENV_FILE (secrets masked):"
echo "TELEGRAM_BOT_TOKEN=****************${BOT_TOKEN: -4}"
echo "TELEGRAM_CHAT_ID=${CHAT_ID}"

echo ""
echo "Rebuilding and restarting backend container..."
cd /var/www/merya
docker compose up -d --build backend

echo "======================================================"
echo "All done! Backend is restarted and Telegram bot is live!"
echo "======================================================"
