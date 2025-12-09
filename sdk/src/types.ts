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

export type PackageManager = 'npm' | 'pip' | 'cargo' | 'go' | 'composer';

export interface GitCloneOptions {
  url: string;
  branch?: string;
  depth?: number;
  directory?: string;
}

export interface GitCloneResult {
  success: boolean;
  directory: string;
  branch: string;
  error?: string;
}

export interface GitPullResult {
  success: boolean;
  error?: string;
}

export interface GitCheckoutResult {
  success: boolean;
  error?: string;
}

export interface PackageInstallOptions {
  packages: string[];
  manager?: PackageManager;
  dev?: boolean;
  global?: boolean;
  directory?: string;
}

export interface PackageInstallResult {
  success: boolean;
  installed: string[];
  failed: string[];
  stdout: string;
  stderr: string;
  error?: string;
}

export interface PackageListResult {
  success: boolean;
  packages: string[];
  error?: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  language: string;
  packages: string[];
  ports: number[];
}

export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template extends TemplateInfo {
  image: string;
  files: TemplateFile[];
  env: Record<string, string>;
}

export interface CreateFromTemplateOptions {
  templateId: string;
  tier?: string;
}

export interface CreateFromTemplateResult {
  success: boolean;
  sandboxId: string;
  template: string;
  agentUrl: string;
  tier: string;
  expiresAt: string;
}

export interface Secret {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretCreateResult {
  success: boolean;
  secret: { id: string; name: string };
}

export interface SecretsListResult {
  success: boolean;
  secrets: Secret[];
}

export interface EnvSetResult {
  success: boolean;
  stored?: boolean;
  applied?: boolean;
  error?: string;
}

export interface EnvGetResult {
  success: boolean;
  env?: Record<string, string>;
  error?: string;
}

export interface NetworkPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  allowOutbound: boolean;
  allowInbound: boolean;
  maxBandwidthMbps?: number;
  allowedPorts?: number[];
  blockedPorts?: number[];
}

export interface NetworkPolicyResult {
  success: boolean;
  policy?: NetworkPolicy;
  error?: string;
}

export interface CustomImage {
  id: string;
  name: string;
  tag: string;
  fullName: string;
  description?: string;
  isPublic: boolean;
  baseImage: string;
  createdAt: string;
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
}

export interface ImagesListResult {
  success: boolean;
  userImages: CustomImage[];
  publicImages: CustomImage[];
}

export interface PersistentVolume {
  id: string;
  name: string;
  volumeName: string;
  sizeMB: number;
  mountPath: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface VolumeAttachment {
  volumeId: string;
  sandboxId: string;
  mountPath: string;
  readOnly: boolean;
  attachedAt: string;
}

export interface VolumesListResult {
  success: boolean;
  volumes: PersistentVolume[];
}

export interface VolumeCreateResult {
  success: boolean;
  volume: PersistentVolume;
}

export interface CreateWithOptionsParams {
  image?: string;
  env?: Record<string, string>;
  volumes?: Array<{ volumeId: string; mountPath?: string; readOnly?: boolean }>;
  networkPolicy?: Partial<NetworkPolicy>;
  secrets?: Record<string, string>;
  tier?: string;
}

export type JudgeLanguage = 'c' | 'cpp' | 'python' | 'java' | 'go' | 'rust' | 'javascript';

export type JudgeStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'OK'
  | 'COMPILATION_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR';

export interface JudgeExecuteOptions {
  source_code: string;
  language: JudgeLanguage;
  stdin?: string;
  time_limit?: number;
  memory_limit?: number;
  wall_time_limit?: number;
  max_processes?: number;
  max_file_size?: number;
}

export interface JudgeSubmitResult {
  id: string;
  status: 'PENDING';
}

export interface JudgeSubmission {
  id: string;
  user_id?: string;
  language: JudgeLanguage;
  source_code: string;
  stdin?: string;
  status: JudgeStatus;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  time_used?: number;
  wall_time_used?: number;
  memory_used?: number;
  time_limit?: number;
  memory_limit?: number;
  signal?: number;
  message?: string;
  created_at: string;
}

export interface JudgeSubmissionsListResult {
  submissions: JudgeSubmission[];
  limit: number;
  offset: number;
}

export interface JudgeStatusResult {
  workers: {
    total: number;
    busy: number;
    idle: number;
    queueSize: number;
  };
  config: {
    workerCount: number;
    maxQueueSize: number;
    maxTimeLimit: number;
    maxMemoryLimit: number;
  };
}

export interface JudgeLanguagesResult {
  languages: JudgeLanguage[];
  limits: {
    max_time_limit: number;
    max_memory_limit: number;
    max_source_size: number;
    max_stdin_size: number;
  };
}
