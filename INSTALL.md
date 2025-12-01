# Installation Guide

This guide will help you install all prerequisites and set up Insien Sandbox.

## Prerequisites

### 1. Node.js (v20 or higher)

**macOS:**
```bash
# Using Homebrew
brew install node@20

# Or download from https://nodejs.org/
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:**
Download and install from https://nodejs.org/

**Verify installation:**
```bash
node --version  # Should be v20.x.x or higher
npm --version
```

### 2. Docker

**macOS:**
1. Download Docker Desktop from https://docs.docker.com/desktop/install/mac-install/
2. Install and start Docker Desktop
3. Verify:
   ```bash
   docker --version
   docker info
   ```

**Linux (Ubuntu/Debian):**
```bash
# Remove old versions
sudo apt-get remove docker docker-engine docker.io containerd runc

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker info
```

**Windows:**
1. Download Docker Desktop from https://docs.docker.com/desktop/install/windows-install/
2. Install and start Docker Desktop
3. Verify:
   ```bash
   docker --version
   docker info
   ```

### 3. Git (Optional)

For cloning the repository:
```bash
# macOS
brew install git

# Linux
sudo apt-get install git

# Windows
Download from https://git-scm.com/download/win
```

## Installation Steps

### Step 1: Clone Repository

```bash
git clone <your-repo-url>
cd sandbox
```

Or if you already have the code:
```bash
cd sandbox
```

### Step 2: Run Setup Script

```bash
./setup.sh
```

This will:
- Check for Docker installation
- Install all npm dependencies
- Build Docker images

### Step 3: Configure Environment

```bash
cd orchestrator-api
cp .env.example .env
```

Edit `.env` with your preferred settings (or use defaults for local development).

### Step 4: Start the System

```bash
# Option 1: Use start script
./start.sh

# Option 2: Manual start
cd orchestrator-api
npm start
```

### Step 5: Test It

In another terminal:
```bash
cd example
export INSIEN_API_KEY=test-api-key
node index.js
```

## Troubleshooting

### Docker Not Found

**Error:** `zsh: command not found: docker`

**Solution:**
1. Install Docker (see Prerequisites above)
2. Make sure Docker Desktop is running (macOS/Windows)
3. For Linux, make sure Docker daemon is running:
   ```bash
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

### Docker Permission Denied (Linux)

**Error:** `permission denied while trying to connect to the Docker daemon socket`

**Solution:**
```bash
# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and log back in, or run:
newgrp docker

# Verify
docker ps
```

### Node.js Version Too Old

**Error:** `The engine "node" is incompatible with this module`

**Solution:**
- Update Node.js to v20 or higher
- Use nvm (Node Version Manager) to manage versions:
  ```bash
  # Install nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
  
  # Install Node.js 20
  nvm install 20
  nvm use 20
  ```

### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Find process using port
lsof -i :3000
lsof -i :3001

# Kill process (replace <PID> with actual process ID)
kill -9 <PID>

# Or change ports in orchestrator-api/.env
PORT=3002
WS_PORT=3003
```

### Docker Build Fails

**Error:** `Cannot connect to the Docker daemon`

**Solution:**
1. Make sure Docker is running
2. Check Docker daemon status:
   ```bash
   docker info
   ```
3. Restart Docker Desktop (macOS/Windows) or Docker daemon (Linux):
   ```bash
   sudo systemctl restart docker
   ```

## Next Steps

Once installed, see:
- [RUNNING.md](./RUNNING.md) - How to run the system
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Production deployment
- [README.md](./README.md) - API documentation

## Quick Verification

Run these commands to verify everything is installed:

```bash
# Check Node.js
node --version  # Should be v20.x.x or higher

# Check npm
npm --version

# Check Docker
docker --version
docker info  # Should show Docker info without errors

# Check Docker can run containers
docker run hello-world  # Should print "Hello from Docker!"
```

If all checks pass, you're ready to go! 🚀

