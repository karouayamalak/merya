#!/usr/bin/env bash
# =============================================================
# MERYA DZ — Full Auto Setup Script
# Usage (on VPS): git pull origin main && bash scripts/update_telegram.sh
# No prompts. All variables are set automatically.
# =============================================================
set -e

PROJECT_DIR="/var/www/merya"
ENV_FILE="${PROJECT_DIR}/backend/.env"

# ── Baked-in defaults (always used unless overridden by CLI args) ──
DEFAULT_BOT_TOKEN="8917578126:AAHNfUH1Ba3Zd-VT3WzMSX8QtpkMNQChTg4"
DEFAULT_CHAT_ID="6363932801"
DEFAULT_RESET_EMAIL="marouataileb3@gmail.com"

# Allow optional CLI overrides: bash update_telegram.sh <token> <chat_id> <email>
BOT_TOKEN="${1:-${TELEGRAM_BOT_TOKEN:-$DEFAULT_BOT_TOKEN}}"
CHAT_ID="${2:-${TELEGRAM_CHAT_ID:-$DEFAULT_CHAT_ID}}"
RESET_EMAIL="${3:-${RESET_NOTIFICATION_EMAIL:-$DEFAULT_RESET_EMAIL}}"

echo "======================================================"
echo "🤖 MERYA DZ — Auto Environment Setup"
echo "======================================================"

# Create .env if it does not exist yet
touch "$ENV_FILE"

# Remove any existing lines for these keys to avoid duplicates
sed -i '/^TELEGRAM_BOT_TOKEN=/d' "$ENV_FILE"
sed -i '/^TELEGRAM_CHAT_ID=/d' "$ENV_FILE"
sed -i '/^RESET_NOTIFICATION_EMAIL=/d' "$ENV_FILE"

# Write the values
echo "TELEGRAM_BOT_TOKEN=${BOT_TOKEN}" >> "$ENV_FILE"
echo "TELEGRAM_CHAT_ID=${CHAT_ID}" >> "$ENV_FILE"
echo "RESET_NOTIFICATION_EMAIL=${RESET_EMAIL}" >> "$ENV_FILE"

echo "✅ Variables written to ${ENV_FILE}:"
echo "   TELEGRAM_BOT_TOKEN=****************${BOT_TOKEN: -4}"
echo "   TELEGRAM_CHAT_ID=${CHAT_ID}"
echo "   RESET_NOTIFICATION_EMAIL=${RESET_EMAIL}"

echo ""
echo "🐳 Rebuilding and restarting backend container..."
cd "$PROJECT_DIR"
docker compose up -d --build backend

echo ""
echo "🧹 Cleaning old Docker images..."
docker image prune -f

echo ""
echo "======================================================"
echo "🎉 Done! Telegram notifications are now live."
echo "   Test by clicking 'Mot de passe oublié' in admin."
echo "======================================================"
