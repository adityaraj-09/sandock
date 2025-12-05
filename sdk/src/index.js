import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

export class Sandbox {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.INSIEN_API_KEY;
    this.orchestratorUrl = options.orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';
    this.wsUrl = options.wsUrl || process.env.INSIEN_WS_URL || 'ws://localhost:3001';
    this.sandboxId = null;
    this.ws = null;
    this.pendingRequests = new Map();
    this.connected = false;
    this.creating = false;
  }

  async create() {
    if (this.creating) {
      while (this.creating) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    if (this.connected) {
      return;
    }

    if (!this.apiKey) {
      throw new Error('API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.');
    }

    this.creating = true;
    try {
      const response = await fetch(`${this.orchestratorUrl}/sandbox/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({ tier: 'free' })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to create sandbox: ${response.statusText}`);
      }

      const data = await response.json();
      this.sandboxId = data.sandboxId;
      
      await this.waitForAgent(30000);
      await this.connectWebSocket();
      
      this.creating = false;
      return {
        sandboxId: this.sandboxId,
        agentUrl: data.agentUrl
      };
    } catch (error) {
      this.creating = false;
      throw new Error(`Failed to create sandbox: ${error.message}`);
    }
  }

  async waitForAgent(timeout = 30000) {
    const startTime = Date.now();
    const checkInterval = 500;
    let attempts = 0;

    while (Date.now() - startTime < timeout) {
      attempts++;
      try {
        const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/status`, {
          headers: {
            'X-API-Key': this.apiKey
          }
        });

        if (response.ok) {
          const status = await response.json();
          if (status.connected) {
            return true;
          }
        }
      } catch (error) {
        // Continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Timeout waiting for agent to connect after ${attempts} attempts (${timeout}ms)`);
  }

  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.wsUrl}/client/${this.sandboxId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleResponse(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  handleResponse(data) {
    const { id, type, error } = data;
    
    if (this.pendingRequests.has(id)) {
      const { resolve, reject } = this.pendingRequests.get(id);
      this.pendingRequests.delete(id);

      if (error) {
        reject(new Error(error));
      } else {
        resolve(data);
      }
    }
  }

  async ensureConnected() {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.sandboxId) {
        await this.create();
      } else {
        // Try to reconnect WebSocket
        try {
          await this.connectWebSocket();
        } catch (error) {
          throw new Error('Not connected to sandbox. Agent may be reconnecting. Please try again in a moment.');
        }
      }
    }
  }

  async sendRPC(type, payload, timeout = 30000) {
    await this.ensureConnected();

    const id = uuidv4();
    const message = {
      id,
      type,
      ...payload
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }

      // Configurable timeout (default 30 seconds, longer for commands like npm install)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC request timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  async runCommand(cmd, args = [], options = {}) {
    // Support both: runCommand('node', ['--version']) and runCommand({ cmd: 'node', args: ['--version'] })
    if (typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd)) {
      options = cmd.options || {};
      args = cmd.args || [];
      cmd = cmd.cmd;
    }
    
    if (!cmd) {
      throw new Error('cmd is required');
    }

    const background = options.background || false;
    const timeout = options.timeout || (cmd === 'npm' && args[0] === 'install' ? 300000 : 30000);
    
    const response = await this.sendRPC('exec', { cmd, args, background }, timeout);
    
    if (response.type === 'execResponse') {
      return {
        stdout: response.stdout,
        stderr: response.stderr,
        exitCode: response.exitCode,
        pid: response.pid,
        background: response.background
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async writeFile(path, content) {
    // Support both: writeFile('file.js', 'content') and writeFile({ path: 'file.js', content: 'content' })
    if (typeof path === 'object' && path !== null) {
      content = path.content;
      path = path.path;
    }
    
    if (!path) {
      throw new Error('path is required');
    }
    if (content === undefined) {
      throw new Error('content is required');
    }

    const response = await this.sendRPC('write', { path, content });
    
    if (response.type === 'writeResponse') {
      return {
        success: response.success,
        path: response.path
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async writeFiles(files) {
    // Support multiple formats:
    // writeFiles([{ path: 'file1.js', content: '...' }, { path: 'file2.js', content: '...' }])
    // writeFiles({ 'file1.js': 'content1', 'file2.js': 'content2' })
    
    let fileArray = [];
    
    if (Array.isArray(files)) {
      fileArray = files;
    } else if (typeof files === 'object' && files !== null) {
      // Convert object to array format
      fileArray = Object.entries(files).map(([path, content]) => ({
        path,
        content: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
      }));
    } else {
      throw new Error('files must be an array or object');
    }

    if (fileArray.length === 0) {
      throw new Error('At least one file is required');
    }

    // Write all files in parallel
    const results = await Promise.all(
      fileArray.map(file => {
        const { path, content } = file;
        if (!path) {
          throw new Error('path is required for each file');
        }
        if (content === undefined) {
          throw new Error('content is required for each file');
        }
        return this.writeFile(path, content);
      })
    );

    return {
      success: true,
      files: results,
      count: results.length
    };
  }

  async getFile(path) {
    if (!path) {
      throw new Error('path is required');
    }

    const response = await this.sendRPC('read', { path });
    
    if (response.type === 'readResponse') {
      return {
        content: response.content,
        path: response.path
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async exposePort(containerPort) {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    if (!containerPort) {
      throw new Error('containerPort is required');
    }

    try {
      const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/expose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({ containerPort: parseInt(containerPort) })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to expose port: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to expose port: ${error.message}`);
    }
  }

  async getExposedPorts() {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    try {
      const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/ports`, {
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to get ports: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to get ports: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  async destroy() {
    if (!this.sandboxId) {
      return;
    }

    try {
      await this.disconnect();

      const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/destroy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to destroy sandbox: ${response.statusText}`);
      }

      this.sandboxId = null;
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to destroy sandbox: ${error.message}`);
    }
  }
}

