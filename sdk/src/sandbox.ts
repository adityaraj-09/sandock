import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageConfig, getFileName, SUPPORTED_LANGUAGES } from './languages.js';
import type {
  SandboxOptions,
  CreateResponse,
  CommandResult,
  CommandOptions,
  WriteFileResult,
  WriteFilesResult,
  ReadFileResult,
  FileInput,
  ExposePortResult,
  GetPortsResult,
  RunCodeOptions,
  RunCodeResult,
  SupportedLanguage,
  RPCMessage,
  RPCResponse,
  PendingRequest,
  GitCloneOptions,
  GitCloneResult,
  GitPullResult,
  GitCheckoutResult,
  PackageInstallOptions,
  PackageInstallResult,
  PackageListResult,
  PackageManager,
  TemplateInfo,
  Template,
  CreateFromTemplateResult
} from './types.js';

export class Sandbox {
  private apiKey: string | undefined;
  private orchestratorUrl: string;
  private wsUrl: string;
  private sandboxId: string | null = null;
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private connected = false;
  private creating = false;

  constructor(options: SandboxOptions = {}) {
    this.apiKey = options.apiKey || process.env.INSIEN_API_KEY;
    this.orchestratorUrl =
      options.orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';
    this.wsUrl = options.wsUrl || process.env.INSIEN_WS_URL || 'ws://localhost:3001';
  }

  async create(): Promise<CreateResponse | void> {
    if (this.creating) {
      while (this.creating) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    if (this.connected) {
      return;
    }

    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.'
      );
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
        throw new Error(
          (error as { error?: string }).error || `Failed to create sandbox: ${response.statusText}`
        );
      }

      const data = (await response.json()) as { sandboxId: string; agentUrl: string };
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
      throw new Error(`Failed to create sandbox: ${(error as Error).message}`);
    }
  }

  private async waitForAgent(timeout = 30000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;
    let attempts = 0;

    while (Date.now() - startTime < timeout) {
      attempts++;
      try {
        const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/status`, {
          headers: {
            'X-API-Key': this.apiKey!
          }
        });

        if (response.ok) {
          const status = (await response.json()) as { connected: boolean };
          if (status.connected) {
            return true;
          }
        }
      } catch {
        // Continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Timeout waiting for agent to connect after ${attempts} attempts (${timeout}ms)`);
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.wsUrl}/client/${this.sandboxId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (message: WebSocket.Data) => {
        try {
          const data = JSON.parse(message.toString()) as RPCResponse;
          this.handleResponse(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  private handleResponse(data: RPCResponse): void {
    const { id, error } = data;

    if (this.pendingRequests.has(id)) {
      const { resolve, reject } = this.pendingRequests.get(id)!;
      this.pendingRequests.delete(id);

      if (error) {
        reject(new Error(error));
      } else {
        resolve(data);
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.sandboxId) {
        await this.create();
      } else {
        try {
          await this.connectWebSocket();
        } catch {
          throw new Error(
            'Not connected to sandbox. Agent may be reconnecting. Please try again in a moment.'
          );
        }
      }
    }
  }

  private async sendRPC(
    type: string,
    payload: Record<string, unknown>,
    timeout = 30000
  ): Promise<RPCResponse> {
    await this.ensureConnected();

    const id = uuidv4();
    const message: RPCMessage = {
      id,
      type,
      ...payload
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC request timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  async runCommand(cmd: string, args?: string[], options?: CommandOptions): Promise<CommandResult>;
  async runCommand(options: { cmd: string; args?: string[]; options?: CommandOptions }): Promise<CommandResult>;
  async runCommand(
    cmdOrOptions: string | { cmd: string; args?: string[]; options?: CommandOptions },
    argsParam?: string[],
    optionsParam?: CommandOptions
  ): Promise<CommandResult> {
    let cmd: string;
    let args: string[];
    let options: CommandOptions;

    if (typeof cmdOrOptions === 'object' && cmdOrOptions !== null) {
      cmd = cmdOrOptions.cmd;
      args = cmdOrOptions.args || [];
      options = cmdOrOptions.options || {};
    } else {
      cmd = cmdOrOptions;
      args = argsParam || [];
      options = optionsParam || {};
    }

    if (!cmd) {
      throw new Error('cmd is required');
    }

    const background = options.background || false;
    const timeout = options.timeout || (cmd === 'npm' && args[0] === 'install' ? 300000 : 30000);

    const response = await this.sendRPC('exec', { cmd, args, background }, timeout);

    if (response.type === 'execResponse') {
      return {
        stdout: response.stdout as string,
        stderr: response.stderr as string,
        exitCode: response.exitCode as number,
        pid: response.pid as number | undefined,
        background: response.background as boolean | undefined
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async writeFile(path: string, content: string): Promise<WriteFileResult>;
  async writeFile(options: { path: string; content: string }): Promise<WriteFileResult>;
  async writeFile(
    pathOrOptions: string | { path: string; content: string },
    contentParam?: string
  ): Promise<WriteFileResult> {
    let path: string;
    let content: string;

    if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
      path = pathOrOptions.path;
      content = pathOrOptions.content;
    } else {
      path = pathOrOptions;
      content = contentParam!;
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
        success: response.success as boolean,
        path: response.path as string
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async writeFiles(files: FileInput[]): Promise<WriteFilesResult>;
  async writeFiles(files: Record<string, string | object>): Promise<WriteFilesResult>;
  async writeFiles(
    files: FileInput[] | Record<string, string | object>
  ): Promise<WriteFilesResult> {
    let fileArray: FileInput[];

    if (Array.isArray(files)) {
      fileArray = files;
    } else if (typeof files === 'object' && files !== null) {
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

    const results = await Promise.all(
      fileArray.map((file) => {
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

  async getFile(path: string): Promise<ReadFileResult> {
    if (!path) {
      throw new Error('path is required');
    }

    const response = await this.sendRPC('read', { path });

    if (response.type === 'readResponse') {
      return {
        content: response.content as string,
        path: response.path as string
      };
    }

    throw new Error(`Unexpected response type: ${response.type}`);
  }

  async exposePort(containerPort: number): Promise<ExposePortResult> {
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
          'X-API-Key': this.apiKey!
        },
        body: JSON.stringify({ containerPort: parseInt(String(containerPort)) })
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || `Failed to expose port: ${response.statusText}`);
      }

      return (await response.json()) as ExposePortResult;
    } catch (error) {
      throw new Error(`Failed to expose port: ${(error as Error).message}`);
    }
  }

  async getExposedPorts(): Promise<GetPortsResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    try {
      const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/ports`, {
        headers: {
          'X-API-Key': this.apiKey!
        }
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || `Failed to get ports: ${response.statusText}`);
      }

      return (await response.json()) as GetPortsResult;
    } catch (error) {
      throw new Error(`Failed to get ports: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  async destroy(): Promise<{ success: boolean } | void> {
    if (!this.sandboxId) {
      return;
    }

    try {
      await this.disconnect();

      const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/destroy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey!
        }
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || `Failed to destroy sandbox: ${response.statusText}`);
      }

      this.sandboxId = null;
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to destroy sandbox: ${(error as Error).message}`);
    }
  }

  async runCode(
    code: string,
    language: string,
    options: RunCodeOptions = {}
  ): Promise<RunCodeResult> {
    const { fileName, timeout, autoDestroy = true, input = '', args = [] } = options;

    const langConfig = getLanguageConfig(language);
    const file = fileName || getFileName(language);
    const execTimeout = timeout || langConfig.timeout;

    if (!this.connected) {
      await this.create();
    }

    await this.writeFile(file, code);

    let result: CommandResult;
    let compileResult: CommandResult | null = null;

    try {
      if (langConfig.runCommand) {
        if (langConfig.command === 'javac') {
          compileResult = await this.runCommand(langConfig.command, [file], {
            timeout: execTimeout
          });
          if (compileResult.exitCode !== 0) {
            const response: RunCodeResult = {
              success: false,
              error: 'Compilation failed',
              stdout: compileResult.stdout,
              stderr: compileResult.stderr,
              exitCode: compileResult.exitCode,
              language,
              fileName: file
            };
            if (autoDestroy) await this.destroy();
            return response;
          }
          const className = file.replace('.java', '');
          result = await this.runCommand(langConfig.runCommand, [className, ...args], {
            timeout: execTimeout
          });
        } else {
          compileResult = await this.runCommand(langConfig.command, [...langConfig.args, file], {
            timeout: execTimeout
          });
          if (compileResult.exitCode !== 0) {
            const response: RunCodeResult = {
              success: false,
              error: 'Compilation failed',
              stdout: compileResult.stdout,
              stderr: compileResult.stderr,
              exitCode: compileResult.exitCode,
              language,
              fileName: file
            };
            if (autoDestroy) await this.destroy();
            return response;
          }
          result = await this.runCommand('sh', ['-c', langConfig.runCommand], {
            timeout: execTimeout
          });
        }
      } else {
        const cmdArgs = [...langConfig.args, file, ...args];
        result = await this.runCommand(langConfig.command, cmdArgs, { timeout: execTimeout });
      }

      if (input) {
        const inputCmd = langConfig.runCommand
          ? `echo "${input}" | ${langConfig.runCommand}`
          : `echo "${input}" | ${langConfig.command} ${file}`;
        const inputResult = await this.runCommand('sh', ['-c', inputCmd], { timeout: execTimeout });
        result = inputResult;
      }

      const response: RunCodeResult = {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        language,
        fileName: file,
        executionTime: execTimeout
      };

      if (compileResult) {
        response.compileResult = {
          stdout: compileResult.stdout,
          stderr: compileResult.stderr,
          exitCode: compileResult.exitCode
        };
      }

      if (autoDestroy) {
        await this.destroy();
      }

      return response;
    } catch (error) {
      const response: RunCodeResult = {
        success: false,
        error: (error as Error).message,
        language,
        fileName: file
      };
      if (autoDestroy) {
        try {
          await this.destroy();
        } catch {
          // Ignore destroy errors
        }
      }
      return response;
    }
  }

  async createFromTemplate(templateId: string, tier?: string): Promise<CreateFromTemplateResult> {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/create-from-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify({ templateId, tier: tier || 'free' })
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to create sandbox from template: ${response.statusText}`);
    }

    const data = (await response.json()) as CreateFromTemplateResult;
    this.sandboxId = data.sandboxId;
    await this.connectWebSocket();

    return data;
  }

  async gitClone(options: GitCloneOptions): Promise<GitCloneResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/git/clone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to clone repository: ${response.statusText}`);
    }

    return (await response.json()) as GitCloneResult;
  }

  async gitPull(directory?: string): Promise<GitPullResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/git/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!
      },
      body: JSON.stringify({ directory: directory || '/app' })
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to pull repository: ${response.statusText}`);
    }

    return (await response.json()) as GitPullResult;
  }

  async gitCheckout(branch: string, directory?: string): Promise<GitCheckoutResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/git/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!
      },
      body: JSON.stringify({ branch, directory: directory || '/app' })
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to checkout branch: ${response.statusText}`);
    }

    return (await response.json()) as GitCheckoutResult;
  }

  async installPackages(packages: string[], options?: Partial<PackageInstallOptions>): Promise<PackageInstallResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/packages/install`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!
      },
      body: JSON.stringify({ packages, ...options })
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to install packages: ${response.statusText}`);
    }

    return (await response.json()) as PackageInstallResult;
  }

  async uninstallPackages(packages: string[], manager?: PackageManager, directory?: string): Promise<PackageInstallResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const response = await fetch(`${this.orchestratorUrl}/sandbox/${this.sandboxId}/packages/uninstall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!
      },
      body: JSON.stringify({ packages, manager, directory })
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to uninstall packages: ${response.statusText}`);
    }

    return (await response.json()) as PackageInstallResult;
  }

  async listPackages(manager?: PackageManager, directory?: string): Promise<PackageListResult> {
    if (!this.sandboxId) {
      throw new Error('Sandbox not created. Call create() first.');
    }

    const params = new URLSearchParams();
    if (manager) params.set('manager', manager);
    if (directory) params.set('directory', directory);

    const response = await fetch(
      `${this.orchestratorUrl}/sandbox/${this.sandboxId}/packages?${params.toString()}`,
      {
        headers: { 'X-API-Key': this.apiKey! }
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to list packages: ${response.statusText}`);
    }

    return (await response.json()) as PackageListResult;
  }

  static async getTemplates(orchestratorUrl?: string): Promise<{ templates: TemplateInfo[] }> {
    const url = orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';

    const response = await fetch(`${url}/api/templates`);

    if (!response.ok) {
      throw new Error(`Failed to fetch templates: ${response.statusText}`);
    }

    return (await response.json()) as { templates: TemplateInfo[] };
  }

  static async getTemplate(templateId: string, orchestratorUrl?: string): Promise<Template> {
    const url = orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';

    const response = await fetch(`${url}/api/templates/${templateId}`);

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || `Failed to fetch template: ${response.statusText}`);
    }

    const data = (await response.json()) as { template: Template };
    return data.template;
  }

  static getSupportedLanguages(): SupportedLanguage[] {
    return Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
  }

  getSandboxId(): string | null {
    return this.sandboxId;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
