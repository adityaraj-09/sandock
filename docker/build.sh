#!/bin/bash

# Build the sandbox agent image
echo "Building sandbox-agent image..."
docker build -t sandbox-agent:latest -f Dockerfile ..

# Build the multi-language sandbox agent image
echo "Building sandbox-agent multilang image..."
docker build -t sandbox-agent:multilang -f Dockerfile.multilang ..

# Build the orchestrator image (optional, for containerized orchestrator)
echo "Building orchestrator image..."
docker build -t sandbox-orchestrator:latest -f Dockerfile.orchestrator ..

echo "Build complete!"
echo ""
echo "Available images:"
echo "  - sandbox-agent:latest (Node.js only)"
echo "  - sandbox-agent:multilang (All languages: JS, Python, Java, C++, Go, Rust)"
echo "  - sandbox-orchestrator:latest"

