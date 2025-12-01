#!/bin/bash

# Setup script for enhanced resource management
set -e

echo "🚀 Setting up Enhanced Resource Management for Orchestrator API"
echo "=============================================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the orchestrator-api directory"
    exit 1
fi

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm install

# Copy environment template if .env doesn't exist
if [ ! -f ".env" ]; then
    echo "⚙️ Creating environment configuration..."
    cp env.example .env
    echo "✅ Created .env file - please update with your configuration"
else
    echo "✅ Environment file already exists"
fi

# Run database migrations
echo "🗄️ Running database migrations..."
npm run migrate

# Build optimized Docker image
echo "🐳 Building optimized Docker images..."
if command -v docker &> /dev/null; then
    # Build optimized agent image
    docker build -f ../docker/Dockerfile.agent.optimized -t sandbox-agent:optimized ../
    echo "✅ Built optimized sandbox agent image"
    
    # Build orchestrator image
    docker build -f ../docker/Dockerfile.orchestrator -t orchestrator:latest ../
    echo "✅ Built orchestrator image"
else
    echo "⚠️ Docker not found - skipping image builds"
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs
mkdir -p data/backups

# Set up log rotation (if logrotate is available)
if command -v logrotate &> /dev/null; then
    echo "📋 Setting up log rotation..."
    cat > /tmp/orchestrator-logrotate << EOF
logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $(whoami) $(whoami)
}
EOF
    sudo cp /tmp/orchestrator-logrotate /etc/logrotate.d/orchestrator
    echo "✅ Log rotation configured"
fi

# Display configuration summary
echo ""
echo "📊 Configuration Summary"
echo "========================"
echo "Resource Limits:"
echo "  - Memory per container: 512MB (configurable)"
echo "  - CPU shares per container: 512 (configurable)"
echo "  - Max sandboxes per user: 5 (configurable)"
echo "  - Sandbox lifetime: 24 hours (configurable)"
echo ""
echo "New Features:"
echo "  ✅ Container resource limits and quotas"
echo "  ✅ Memory leak prevention and cleanup"
echo "  ✅ Container size optimization"
echo "  ✅ Real-time resource monitoring"
echo "  ✅ User tier management (free/pro/enterprise)"
echo "  ✅ Automatic expired sandbox cleanup"
echo "  ✅ Enhanced security (non-root containers)"
echo "  ✅ System-wide resource tracking"
echo ""
echo "New API Endpoints:"
echo "  - GET /sandbox/{id}/stats - Resource usage statistics"
echo "  - GET /sandbox/quota/usage - User quota information"
echo "  - GET /sandbox/system/stats - System statistics (admin)"
echo "  - POST /sandbox/system/cleanup - Manual cleanup (admin)"
echo ""

# Check system requirements
echo "🔍 System Requirements Check"
echo "============================"

# Check available memory
TOTAL_MEM=$(free -m | awk 'NR==2{printf "%.0f", $2}' 2>/dev/null || echo "unknown")
if [ "$TOTAL_MEM" != "unknown" ] && [ "$TOTAL_MEM" -lt 2048 ]; then
    echo "⚠️ Warning: System has ${TOTAL_MEM}MB RAM. Recommended: 2GB+ for production"
else
    echo "✅ Memory: ${TOTAL_MEM}MB (sufficient)"
fi

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "✅ Docker: $DOCKER_VERSION"
else
    echo "❌ Docker not found - required for container management"
fi

# Check Node.js version
NODE_VERSION=$(node --version)
echo "✅ Node.js: $NODE_VERSION"

# Check database connection
echo ""
echo "🔗 Testing Database Connection"
echo "=============================="
if npm run migrate > /dev/null 2>&1; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed - please check DATABASE_URL in .env"
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Next Steps:"
echo "1. Update .env file with your configuration"
echo "2. Start the service: npm start"
echo "3. Monitor logs: tail -f logs/orchestrator.log"
echo "4. Check system stats: curl -H 'X-API-Key: your-key' http://localhost:3000/sandbox/system/stats"
echo ""
echo "For detailed documentation, see RESOURCE_MANAGEMENT.md"
echo ""
echo "🚀 Enhanced Orchestrator API is ready!"
