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

# Remove any existing Telegram lines to prevent duplicates
sed -i '/TELEGRAM_BOT_TOKEN=/d' "$ENV_FILE"
sed -i '/TELEGRAM_CHAT_ID=/d' "$ENV_FILE"

# Append exact new token and chat ID
echo "TELEGRAM_BOT_TOKEN=8919995952:AAHj83TjuHvvqNulZPWdm-y7B0QDEN5yQms" >> "$ENV_FILE"
echo "TELEGRAM_CHAT_ID=6363932801" >> "$ENV_FILE"

echo "Variables updated successfully in $ENV_FILE:"
grep "TELEGRAM_" "$ENV_FILE"

echo ""
echo "Rebuilding and restarting backend container..."
cd /var/www/merya
docker compose up -d --build backend

echo "======================================================"
echo "All done! Backend is restarted and Telegram bot is live!"
echo "======================================================"
