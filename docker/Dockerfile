FROM node:20-slim

# Install basic utilities
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy agent code
COPY sandbox-agent/package.json ./
COPY sandbox-agent/src ./src

# Install dependencies
RUN npm install

# Expose any ports if needed (not required for WebSocket)
# EXPOSE 3000

# Start the agent
CMD ["node", "src/index.js"]

