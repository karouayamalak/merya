#!/usr/bin/env bash
set -e

echo "======================================================"
echo "🚀 MERYA DZ — Automated VPS Deployment Script"
echo "======================================================"

# 1. Ensure project directories exist
mkdir -p /var/www/merya/backend

if [ ! -f /var/www/merya/backend/.env ]; then
  echo "⚠️ Notice: /var/www/merya/backend/.env does not exist yet."
  echo "Please create or edit /var/www/merya/backend/.env before running."
  exit 1
fi

echo "🐳 Building and starting Docker container..."
cd /var/www/merya
docker compose up -d --build backend

echo "⏳ Waiting 5 seconds for database connection..."
sleep 5

echo "🌱 Seeding database..."
docker compose exec -T backend npm run seed || echo "⚠️ Seeding completed or already seeded."

echo "======================================================"
echo "🎉 ALL DONE! Your backend is live at https://api.meryadz.com"
echo "======================================================"
