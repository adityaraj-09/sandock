#!/bin/bash

set -e

echo "Starting Insien Sandbox..."

# Check if .env exists
if [ ! -f "orchestrator-api/.env" ]; then
    echo "Creating .env file from example..."
    cp orchestrator-api/.env.example orchestrator-api/.env 2>/dev/null || true
    echo "Please edit orchestrator-api/.env with your settings"
fi

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

# Check if agent image exists
if ! docker images | grep -q "sandbox-agent"; then
    echo "Building Docker images..."
    cd docker
    ./build.sh
    cd ..
fi

# Start orchestrator
echo "Starting orchestrator..."
cd orchestrator-api
npm start

