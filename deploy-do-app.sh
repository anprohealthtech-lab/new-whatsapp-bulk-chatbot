#!/bin/bash

# DigitalOcean App Platform deployment script
# This script configures and deploys the WhatsApp LIMS application

echo "🚀 Configuring DigitalOcean App Platform deployment..."

# Check if doctl is installed
if ! command -v doctl &> /dev/null; then
    echo "❌ doctl CLI tool is required. Install it from: https://docs.digitalocean.com/reference/doctl/how-to/install/"
    exit 1
fi

# Check authentication
if ! doctl auth list &> /dev/null; then
    echo "❌ Please authenticate with DigitalOcean first:"
    echo "   doctl auth init"
    exit 1
fi

# Set variables
APP_NAME="whatsapp-lims-$(date +%s)"
REGION="nyc1"  # Change to your preferred region

echo "📋 App Configuration:"
echo "   Name: $APP_NAME"
echo "   Region: $REGION"

# Deploy the app
echo "🚀 Deploying to DigitalOcean App Platform..."
doctl apps create .do/app.yaml --format json > app-deployment.json

# Get app ID
APP_ID=$(cat app-deployment.json | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$APP_ID" ]; then
    echo "❌ Failed to create app. Check the output above."
    exit 1
fi

echo "✅ App created successfully!"
echo "   App ID: $APP_ID"
echo "   You can monitor deployment at: https://cloud.digitalocean.com/apps/$APP_ID"

# Wait for deployment
echo "⏳ Waiting for deployment to complete..."
doctl apps get "$APP_ID" --format json --wait

# Get app URL
APP_URL=$(doctl apps get "$APP_ID" --format json | grep -o '"live_url":"[^"]*' | cut -d'"' -f4)

echo ""
echo "🎉 Deployment completed!"
echo "🌐 Application URL: $APP_URL"
echo "📱 WhatsApp QR Code: $APP_URL/api/qr-code"
echo "💾 Admin Dashboard: $APP_URL"

echo ""
echo "Next steps:"
echo "1. Set up your database environment variables in the DigitalOcean dashboard"
echo "2. Configure your custom domain (if desired)"
echo "3. Scan the WhatsApp QR code to link your phone number"
echo "4. Test the LIMS integration endpoints"

# Clean up
rm -f app-deployment.json

echo "✅ Setup complete!"