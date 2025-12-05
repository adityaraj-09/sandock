import WebSocket from 'ws';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'ws://host.docker.internal:3001';
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const SANDBOX_ID = process.env.SANDBOX_ID;

if (!AGENT_TOKEN || !SANDBOX_ID) {
  console.error('Missing required environment variables: AGENT_TOKEN, SANDBOX_ID');
  process.exit(1);
}

// Ensure /app directory exists and is writable
async function ensureAppDirectory() {
  try {
    await fs.access('/app');
    console.log('/app directory exists');
  } catch {
    console.log('Creating /app directory...');
    await fs.mkdir('/app', { recursive: true, mode: 0o755 });
    console.log('/app directory created');
  }
  
  // Verify write permissions
  try {
    const testFile = '/app/.write-test';
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    console.log('/app directory is writable');
  } catch (error) {
    console.error(`/app directory is not writable: ${error.message}`);
    // Try to fix permissions (if running as root)
    try {
      const { execSync } = await import('child_process');
      execSync('chmod -R 755 /app', { stdio: 'ignore' });
      console.log('Fixed /app permissions');
    } catch (chmodError) {
      console.error(`Could not fix permissions: ${chmodError.message}`);
    }
  }
}

// Initialize app directory on startup
ensureAppDirectory().catch(err => {
  console.error('Error initializing /app directory:', err);
});

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTRIES = 10;
const RECONNECT_DELAY = 2000;

function connect() {
  const agentUrl = `${ORCHESTRATOR_URL}/agent/${SANDBOX_ID}?token=${AGENT_TOKEN}`;
  console.log(`Connecting to orchestrator: ${agentUrl}`);

  ws = new WebSocket(agentUrl);

  ws.on('open', () => {
    console.log('Connected to orchestrator');
    reconnectAttempts = 0;
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      await handleRPCRequest(data);
    } catch (error) {
      console.error('Error handling message:', error);
      sendError(data?.id, error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('Connection closed, attempting reconnect...');
    ws = null;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTRIES) {
      reconnectAttempts++;
      setTimeout(connect, RECONNECT_DELAY * reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
      process.exit(1);
    }
  });
}

async function handleRPCRequest(data) {
  const { id, type, cmd, args, path, content, background } = data;

  try {
    switch (type) {
      case 'exec':
        await handleExec(id, cmd, args, background);
        break;
      case 'write':
        await handleWriteFile(id, path, content);
        break;
      case 'read':
        await handleReadFile(id, path);
        break;
      default:
        sendError(id, `Unknown RPC type: ${type}`);
    }
  } catch (error) {
    sendError(id, error.message);
  }
}

async function handleExec(id, cmd, args = [], background = false) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: background ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: background,
      cwd: '/app' // Set working directory to /app
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (background) {
      // For background processes, unref so parent can exit
      child.unref();
      // Send response immediately with PID
      sendResponse(id, {
        type: 'execResponse',
        stdout: stdout || `Process started in background (PID: ${child.pid})`,
        stderr,
        exitCode: null,
        pid: child.pid,
        background: true
      });
      resolve();
    } else {
      child.on('close', (code) => {
        sendResponse(id, {
          type: 'execResponse',
          stdout,
          stderr,
          exitCode: code
        });
        resolve();
      });

      child.on('error', (error) => {
        sendError(id, `Failed to execute command: ${error.message}`);
        resolve();
      });
    }
  });
}

async function handleWriteFile(id, path, content) {
  try {
    // Resolve path relative to /app if it's a relative path
    // Remove leading ./ if present
    const cleanPath = path.replace(/^\.\//, '');
    const resolvedPath = cleanPath.startsWith('/') ? cleanPath : `/app/${cleanPath}`;
    
    // Ensure /app directory exists with proper permissions
    try {
      await fs.access('/app');
    } catch {
      // /app doesn't exist, create it
      await fs.mkdir('/app', { recursive: true, mode: 0o755 });
      console.log('Created /app directory');
    }
    
    // Ensure parent directory exists
    const dir = dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o755 });

    // Write file
    await fs.writeFile(resolvedPath, content, 'utf8');
    

    sendResponse(id, {
      type: 'writeResponse',
      success: true,
      path: resolvedPath
    });
  } catch (error) {
    console.error(`Error writing file ${path}:`, error);
    console.error(`Error details:`, {
      code: error.code,
      errno: error.errno,
      path: error.path,
      syscall: error.syscall
    });
    sendError(id, `Failed to write file: ${error.message}`);
  }
}

async function handleReadFile(id, path) {
  try {
    // Resolve path relative to /app if it's a relative path
    const cleanPath = path.replace(/^\.\//, '');
    const resolvedPath = cleanPath.startsWith('/') ? cleanPath : `/app/${cleanPath}`;
    
    const content = await fs.readFile(resolvedPath, 'utf8');
    
    sendResponse(id, {
      type: 'readResponse',
      content,
      path: resolvedPath
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendError(id, `File not found: ${path}`);
    } else {
      sendError(id, `Failed to read file: ${error.message}`);
    }
  }
}

function sendResponse(id, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      id,
      ...data
    }));
  }
}

function sendError(id, error) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      id,
      type: 'error',
      error
    }));
  }
}

// Start connection
connect();

// Keep process alive
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, closing connection...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, closing connection...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

