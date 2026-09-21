#!/usr/bin/env bash
set -e

echo "🌐 Configuring Nginx reverse proxy for api.meryadz.com..."
cat << 'EOF' > /etc/nginx/sites-available/api.meryadz.com
server {
    listen 80;
    server_name api.meryadz.com;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSockets
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/api.meryadz.com /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "🔒 Obtaining free SSL certificate via Certbot for api.meryadz.com..."
certbot --nginx -d api.meryadz.com --non-interactive --agree-tos --email admin@meryadz.com

# Update backend/.env CLIENT_ORIGIN if it had typo
sed -i 's/mernadz\.com/meryadz\.com/g' /var/www/merya/backend/.env || true

echo "======================================================"
echo "🎉 SUCCESS! Your backend is live at https://api.meryadz.com"
echo "======================================================"
