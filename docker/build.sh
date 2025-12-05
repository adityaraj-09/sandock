#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="${REGISTRY:-}"
VERSION="${VERSION:-latest}"
PUSH="${PUSH:-false}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Sandbox Container Build Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to build an image
build_image() {
    local name=$1
    local dockerfile=$2
    local tag="${REGISTRY}${name}:${VERSION}"

    echo -e "${YELLOW}Building ${name}...${NC}"
    if docker build -t "${tag}" -f "${dockerfile}" ..; then
        echo -e "${GREEN}✓ ${name} built successfully${NC}"
        if [ "$PUSH" = "true" ] && [ -n "$REGISTRY" ]; then
            echo -e "${YELLOW}  Pushing ${tag}...${NC}"
            docker push "${tag}"
            echo -e "${GREEN}  ✓ Pushed${NC}"
        fi
    else
        echo -e "${RED}✗ Failed to build ${name}${NC}"
        exit 1
    fi
    echo ""
}

# Parse arguments
BUILD_ALL=true
BUILD_TARGETS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --node|--javascript)
            BUILD_ALL=false
            BUILD_TARGETS+=("node")
            shift
            ;;
        --python)
            BUILD_ALL=false
            BUILD_TARGETS+=("python")
            shift
            ;;
        --java)
            BUILD_ALL=false
            BUILD_TARGETS+=("java")
            shift
            ;;
        --cpp|--c++)
            BUILD_ALL=false
            BUILD_TARGETS+=("cpp")
            shift
            ;;
        --go|--golang)
            BUILD_ALL=false
            BUILD_TARGETS+=("go")
            shift
            ;;
        --rust)
            BUILD_ALL=false
            BUILD_TARGETS+=("rust")
            shift
            ;;
        --multilang)
            BUILD_ALL=false
            BUILD_TARGETS+=("multilang")
            shift
            ;;
        --orchestrator)
            BUILD_ALL=false
            BUILD_TARGETS+=("orchestrator")
            shift
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --registry)
            REGISTRY="$2/"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --help)
            echo "Usage: ./build.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --node, --javascript  Build Node.js image only"
            echo "  --python              Build Python image only"
            echo "  --java                Build Java image only"
            echo "  --cpp, --c++          Build C++ image only"
            echo "  --go, --golang        Build Go image only"
            echo "  --rust                Build Rust image only"
            echo "  --multilang           Build multi-language image only"
            echo "  --orchestrator        Build orchestrator image only"
            echo "  --push                Push images after building"
            echo "  --registry REGISTRY   Registry prefix (e.g., gcr.io/myproject)"
            echo "  --version VERSION     Image version tag (default: latest)"
            echo "  --help                Show this help message"
            echo ""
            echo "If no target is specified, all images will be built."
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Build function for specific targets
build_target() {
    local target=$1
    case $target in
        node)
            build_image "sandbox-agent:node" "Dockerfile.node"
            ;;
        python)
            build_image "sandbox-agent:python" "Dockerfile.python"
            ;;
        java)
            build_image "sandbox-agent:java" "Dockerfile.java"
            ;;
        cpp)
            build_image "sandbox-agent:cpp" "Dockerfile.cpp"
            ;;
        go)
            build_image "sandbox-agent:go" "Dockerfile.go"
            ;;
        rust)
            build_image "sandbox-agent:rust" "Dockerfile.rust"
            ;;
        multilang)
            build_image "sandbox-agent:multilang" "Dockerfile.multilang"
            ;;
        orchestrator)
            build_image "sandbox-orchestrator" "Dockerfile.orchestrator"
            ;;
    esac
}

# Build images
if [ "$BUILD_ALL" = true ]; then
    echo -e "${BLUE}Building all images...${NC}"
    echo ""

    # Language-specific images
    build_image "sandbox-agent:node" "Dockerfile.node"
    build_image "sandbox-agent:python" "Dockerfile.python"
    build_image "sandbox-agent:java" "Dockerfile.java"
    build_image "sandbox-agent:cpp" "Dockerfile.cpp"
    build_image "sandbox-agent:go" "Dockerfile.go"
    build_image "sandbox-agent:rust" "Dockerfile.rust"

    # Multi-language fallback
    build_image "sandbox-agent:multilang" "Dockerfile.multilang"

    # Legacy default image (points to node)
    echo -e "${YELLOW}Tagging sandbox-agent:latest -> sandbox-agent:node${NC}"
    docker tag sandbox-agent:node sandbox-agent:latest
    echo -e "${GREEN}✓ Tagged${NC}"
    echo ""

    # Orchestrator
    build_image "sandbox-orchestrator" "Dockerfile.orchestrator"
else
    echo -e "${BLUE}Building selected images...${NC}"
    echo ""
    for target in "${BUILD_TARGETS[@]}"; do
        build_target "$target"
    done
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Available images:${NC}"
echo ""
echo -e "  ${GREEN}Language-specific (lightweight):${NC}"
echo "    - sandbox-agent:node      (JavaScript/TypeScript)"
echo "    - sandbox-agent:python    (Python 3.11)"
echo "    - sandbox-agent:java      (Java 17)"
echo "    - sandbox-agent:cpp       (C/C++)"
echo "    - sandbox-agent:go        (Go 1.22)"
echo "    - sandbox-agent:rust      (Rust 1.75)"
echo ""
echo -e "  ${GREEN}Multi-language (all-in-one):${NC}"
echo "    - sandbox-agent:multilang (All languages)"
echo ""
echo -e "  ${GREEN}Infrastructure:${NC}"
echo "    - sandbox-orchestrator:latest"
echo ""
echo -e "${BLUE}Usage examples:${NC}"
echo "  docker run sandbox-agent:python"
echo "  AGENT_IMAGE=sandbox-agent:java docker-compose up"
echo ""
