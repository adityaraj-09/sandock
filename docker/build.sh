#!/bin/bash

# Build the sandbox agent image
echo "Building sandbox-agent image..."
docker build -t sandbox-agent:latest -f Dockerfile ..

# Build the orchestrator image (optional, for containerized orchestrator)
echo "Building orchestrator image..."
docker build -t sandbox-orchestrator:latest -f Dockerfile.orchestrator ..

echo "Build complete!"

