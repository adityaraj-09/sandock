export interface SandboxOptions {
  apiKey?: string;
  orchestratorUrl?: string;
  wsUrl?: string;
}

export interface CreateResponse {
  sandboxId: string;
  agentUrl: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid?: number;
  background?: boolean;
}

export interface CommandOptions {
  background?: boolean;
  timeout?: number;
}

export interface WriteFileResult {
  success: boolean;
  path: string;
}

export interface WriteFilesResult {
  success: boolean;
  files: WriteFileResult[];
  count: number;
}

export interface ReadFileResult {
  content: string;
  path: string;
}

export interface FileInput {
  path: string;
  content: string;
}

export interface ExposePortResult {
  success: boolean;
  containerPort: number;
  hostPort: number;
  url: string;
}

export interface PortInfo {
  containerPort: number;
  hostPort: number;
  url: string;
}

export interface GetPortsResult {
  ports: PortInfo[];
}

export interface LanguageConfig {
  name: string;
  extension: string;
  command: string;
  args: string[];
  runCommand?: string;
  timeout: number;
  image: string;
}

export interface RunCodeOptions {
  fileName?: string;
  timeout?: number;
  autoDestroy?: boolean;
  input?: string;
  args?: string[];
}

export interface CompileResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCodeResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  language: string;
  fileName: string;
  executionTime?: number;
  compileResult?: CompileResult;
}

export type SupportedLanguage =
  | 'javascript'
  | 'python'
  | 'java'
  | 'cpp'
  | 'go'
  | 'rust'
  | 'typescript';

export interface RPCMessage {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface RPCResponse {
  id: string;
  type: string;
  error?: string;
  [key: string]: unknown;
}

export interface PendingRequest {
  resolve: (value: RPCResponse) => void;
  reject: (error: Error) => void;
}
