#!/bin/bash

set -e

echo "Setting up Insien Sandbox..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed."
    echo ""
    echo "Please install Docker:"
    echo "  - macOS: https://docs.docker.com/desktop/install/mac-install/"
    echo "  - Linux: https://docs.docker.com/engine/install/"
    echo "  - Windows: https://docs.docker.com/desktop/install/windows-install/"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running."
    echo "Please start Docker Desktop (macOS/Windows) or Docker daemon (Linux)"
    exit 1
fi

# Install dependencies
echo "Installing orchestrator dependencies..."
cd orchestrator-api && npm install && cd ..

echo "Installing agent dependencies..."
cd sandbox-agent && npm install && cd ..

echo "Installing SDK dependencies..."
cd sdk && npm install && cd ..

# Build Docker images
echo "Building Docker images..."
cd docker
./build.sh
cd ..

echo ""
echo "Setup complete!"
echo ""
echo "To start the orchestrator:"
echo "  cd orchestrator-api && npm start"
echo ""
echo "To run the example:"
echo "  cd example && node index.js"
echo ""

