#!/bin/bash

# ============================================
# My Control Center - Quick Setup Script
# ============================================
# This script helps you set up MCC quickly
# Usage: ./quickstart.sh

set -e  # Exit on error

echo "🎛️  My Control Center - Quick Setup"
echo "===================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "   Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher (you have $NODE_VERSION)"
    echo "   Please upgrade Node.js from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Navigate to web directory
cd "$(dirname "$0")"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    echo "   Make sure you're running this script from the web/ directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo ""
echo "✅ Dependencies installed"
echo ""

# Create .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo "🔧 Creating .env.local file..."
    
    if [ -f ".env.example" ]; then
        cp .env.example .env.local
        echo "✅ Created .env.local from .env.example"
    else
        cat > .env.local << 'EOF'
# My Control Center Environment Variables
MCC_PASSWORD=change-me-to-a-strong-password
NEXT_PUBLIC_API_BASE=/api
EOF
        echo "✅ Created .env.local"
    fi
    
    echo ""
    echo "⚠️  IMPORTANT: Edit .env.local and change the password!"
    echo "   Open .env.local in a text editor and set MCC_PASSWORD to something secure"
    echo ""
    read -p "Press Enter after you've updated the password in .env.local..."
else
    echo "ℹ️  .env.local already exists, skipping creation"
    echo ""
fi

# Build check
echo "🏗️  Checking if the build works..."
if npm run build > /tmp/mcc-build.log 2>&1; then
    echo "✅ Build successful"
else
    echo "❌ Build failed. Check /tmp/mcc-build.log for details"
    exit 1
fi

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "=================="
echo "Next Steps:"
echo "=================="
echo ""
echo "1. Start the development server:"
echo "   npm run dev"
echo ""
echo "2. Open http://localhost:3000 in your browser"
echo ""
echo "3. Login with the password you set in .env.local"
echo ""
echo "4. To deploy to Cloudflare Pages:"
echo "   - See GETTING_STARTED.md for detailed instructions"
echo "   - Or run: npx wrangler pages deploy .next"
echo ""
echo "5. To connect AI agents:"
echo "   - See GETTING_STARTED.md Phase 3"
echo "   - Options: OpenAI, Cloudflare Workers AI, or self-hosted"
echo ""
echo "📚 Documentation:"
echo "   - GETTING_STARTED.md - Step-by-step guide"
echo "   - README.md - Project overview"
echo "   - cloudflare/DEPLOY.md - Deployment details"
echo ""
echo "Ready to go! 🚀"
