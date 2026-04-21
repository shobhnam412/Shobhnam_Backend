#!/bin/bash
# Exit on any error
set -e

echo "Starting universal deployment setup..."

# Detect Package Manager
if command -v apt &> /dev/null; then
    echo "Ubuntu/Debian detected. Using APT..."
    sudo apt update && sudo apt upgrade -y
    
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    
    echo "Installing Nginx..."
    sudo apt install -y nginx
    
    echo "Installing Certbot..."
    sudo apt install -y certbot python3-certbot-nginx
    
    echo "Installing PM2..."
    sudo npm install -g pm2
    
    echo "Configuring UFW Firewall..."
    sudo ufw allow OpenSSH || true
    sudo ufw allow 'Nginx Full' || true
    sudo ufw --force enable || true

elif command -v dnf &> /dev/null || command -v yum &> /dev/null; then
    echo "Amazon Linux/RHEL detected. Using DNF/YUM..."
    PM="dnf"
    if ! command -v dnf &> /dev/null; then
        PM="yum"
    fi

    sudo $PM update -y
    
    echo "Installing Node.js and NPM..."
    sudo $PM install -y nodejs npm
    
    echo "Installing Nginx..."
    sudo $PM install -y nginx
    sudo systemctl enable nginx
    sudo systemctl start nginx
    
    echo "Installing Certbot via Python venv..."
    sudo $PM install -y augeas-libs python3 python3-pip
    sudo python3 -m venv /opt/certbot/
    sudo /opt/certbot/bin/pip install --upgrade pip
    sudo /opt/certbot/bin/pip install certbot certbot-nginx
    sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
    
    echo "Installing PM2..."
    sudo npm install -g pm2

else
    echo "Unsupported OS. Could not find apt, dnf, or yum."
    exit 1
fi

echo "--------------------------------------------------------"
echo "✅ Environment Setup Complete!"
echo "Node Version: $(node -v)"
echo "NPM Version: $(npm -v)"
echo "PM2 Version: $(pm2 -v)"
echo "--------------------------------------------------------"
echo "Next Steps:"
echo "1. Clone your repo: git clone <your-repo-url> (if not done)"
echo "2. cd Shobhnam_Backend && npm install"
echo "3. Copy your .env file: nano .env"
echo "4. Start the app: pm2 start ecosystem.config.cjs"
echo "5. Setup Nginx:"
echo "   sudo rm -f /etc/nginx/sites-enabled/default || true"
if command -v dnf &> /dev/null || command -v yum &> /dev/null; then
    echo "   sudo cp deploy/nginx.conf /etc/nginx/conf.d/shobhnam-api.conf"
else
    echo "   sudo cp deploy/nginx.conf /etc/nginx/sites-available/shobhnam-api"
    echo "   sudo ln -s /etc/nginx/sites-available/shobhnam-api /etc/nginx/sites-enabled/"
fi
echo "   sudo systemctl restart nginx"
echo "6. Run certbot: sudo certbot --nginx -d api.shobhnamofficial.com"
