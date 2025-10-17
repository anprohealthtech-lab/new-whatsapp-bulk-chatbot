#!/bin/bash

# DigitalOcean deployment script for WhatsApp LIMS
echo "🚀 Deploying WhatsApp LIMS to DigitalOcean..."

# Check if required environment variables are set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable is required"
    exit 1
fi

if [ -z "$SESSION_SECRET" ]; then
    echo "❌ SESSION_SECRET environment variable is required"
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p NodeBackend/server/sessions
mkdir -p NodeBackend/uploads
mkdir -p migrations

# Set proper permissions
chmod -R 755 NodeBackend/server/sessions
chmod -R 755 NodeBackend/uploads

# Build and push database changes
echo "📦 Syncing database schema..."
cd NodeBackend
if [ -f "package.json" ]; then
    npm install
    npm run db:push
    echo "✅ Database schema synchronized"
else
    echo "⚠️  No package.json found in NodeBackend directory"
fi
cd ..

# Build Docker image
echo "🔨 Building Docker image..."
docker build -t whatsapp-lims:latest .

# Start the application
echo "🚀 Starting application..."
docker-compose up -d --build

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 30

# Health check
echo "🏥 Performing health check..."
if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ Application is healthy and running"
else
    echo "❌ Health check failed. Check logs:"
    docker-compose logs whatsapp-lims
fi

# Show running services
echo "📊 Service Status:"
docker-compose ps

echo ""
echo "✅ Deployment completed!"
echo "🌐 Application should be available at: http://your-domain:3001"
echo "📱 WhatsApp QR code available at: http://your-domain:3001/api/qr-code"
echo ""
echo "Next steps:"
echo "1. Configure your domain and SSL certificate"
echo "2. Set up DigitalOcean Managed PostgreSQL database"
echo "3. Update DNS records to point to your droplet"
echo "4. Scan WhatsApp QR code to link your phone number"