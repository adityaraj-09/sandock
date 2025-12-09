# @insien/sandock

TypeScript SDK for executing code in isolated sandbox environments with multi-language support, Git integration, and package management.

## Installation

```bash
npm install @insien/sandock
```

## Quick Start

```typescript
import { Sandbox } from '@insien/sandock';

const sandbox = new Sandbox({
  apiKey: 'your-api-key'
});

await sandbox.writeFile('hello.js', "console.log('Hello!');");

const result = await sandbox.runCommand('node', ['hello.js']);
console.log(result.stdout);

await sandbox.destroy();
```

## Features

- Multi-language code execution (JavaScript, Python, Java, C++, Go, Rust, TypeScript)
- Pre-configured templates for quick project setup
- Git repository cloning and management
- Package manager integration (npm, pip, cargo, go, composer)
- Port exposure for running services
- File system operations
- Secrets management with encryption
- Environment variable configuration
- Network policy controls
- Custom Docker image support
- Persistent storage volumes
- **Judge** - Competitive programming code execution with precise resource limits

## Templates

Create sandboxes from pre-configured templates:

```typescript
const templates = await Sandbox.getTemplates();

const sandbox = new Sandbox({ apiKey: 'your-api-key' });
await sandbox.createFromTemplate('node-express');

await sandbox.runCommand('npm', ['start']);
```

Available templates:
| Template | Description |
|----------|-------------|
| `node-express` | Express.js REST API |
| `python-flask` | Flask REST API |
| `python-fastapi` | FastAPI with async support |
| `node-typescript` | TypeScript Node.js starter |
| `go-api` | Go HTTP server |
| `rust-hello` | Rust starter project |
| `python-datascience` | NumPy, Pandas, Matplotlib |
| `empty` | Blank sandbox |

## Git Integration

Clone and manage repositories:

```typescript
await sandbox.create();

await sandbox.gitClone({
  url: 'https://github.com/user/repo',
  branch: 'main',
  depth: 1
});

await sandbox.gitPull();

await sandbox.gitCheckout('feature-branch');
```

## Package Management

Install and manage packages:

```typescript
await sandbox.installPackages(['express', 'lodash']);

await sandbox.installPackages(['jest'], { dev: true });

await sandbox.installPackages(['numpy', 'pandas'], { manager: 'pip' });

const { packages } = await sandbox.listPackages();

await sandbox.uninstallPackages(['lodash']);
```

Supported package managers: `npm`, `pip`, `cargo`, `go`, `composer`

## API Reference

### Constructor

```typescript
new Sandbox(options?: SandboxOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `INSIEN_API_KEY` env | API key for authentication |
| `orchestratorUrl` | `string` | `http://localhost:3000` | Orchestrator API URL |
| `wsUrl` | `string` | `ws://localhost:3001` | WebSocket URL |

### Sandbox Lifecycle

#### `create(): Promise<CreateResponse>`

Creates a new sandbox instance. Called automatically on first use.

```typescript
const { sandboxId, agentUrl } = await sandbox.create();
```

#### `createFromTemplate(templateId, tier?): Promise<CreateFromTemplateResult>`

Creates a sandbox from a template with pre-configured files and packages.

```typescript
const result = await sandbox.createFromTemplate('python-flask');
```

#### `createForLanguage(language, options?): Promise<CreateResponse>`

Creates a sandbox optimized for a specific programming language.

```typescript
const result = await sandbox.createForLanguage('python');

const result = await sandbox.createForLanguage('typescript', {
  env: { NODE_ENV: 'development' },
  tier: 'pro'
});
```

Supported languages: `javascript`, `typescript`, `python`, `java`, `cpp`, `go`, `rust`

#### `destroy(): Promise<{ success: boolean }>`

Destroys the sandbox and cleans up resources.

```typescript
await sandbox.destroy();
```

#### `disconnect(): Promise<void>`

Disconnects WebSocket without destroying the sandbox.

```typescript
await sandbox.disconnect();
```

### Command Execution

#### `runCommand(cmd, args?, options?): Promise<CommandResult>`

Executes a command in the sandbox.

```typescript
const result = await sandbox.runCommand('node', ['--version']);

const result = await sandbox.runCommand('npm', ['install'], {
  timeout: 300000,
  background: false
});
```

Returns:
```typescript
{
  stdout: string;
  stderr: string;
  exitCode: number;
  pid?: number;
  background?: boolean;
}
```

#### `runCode(code, language, options?): Promise<RunCodeResult>`

Executes code in a specific language.

```typescript
const result = await sandbox.runCode(
  'print("Hello, World!")',
  'python'
);
```

Supported languages: `javascript`, `typescript`, `python`, `java`, `cpp`, `go`, `rust`

Options:
```typescript
{
  fileName?: string;
  timeout?: number;
  autoDestroy?: boolean;
  input?: string;
  args?: string[];
}
```

### File Operations

#### `writeFile(path, content): Promise<WriteFileResult>`

Writes a file to the sandbox.

```typescript
await sandbox.writeFile('index.js', 'console.log("hello");');
```

#### `writeFiles(files): Promise<WriteFilesResult>`

Writes multiple files.

```typescript
await sandbox.writeFiles([
  { path: 'file1.js', content: '...' },
  { path: 'file2.js', content: '...' }
]);

await sandbox.writeFiles({
  'index.js': 'console.log("hi")',
  'package.json': { name: 'app', version: '1.0.0' }
});
```

#### `getFile(path): Promise<ReadFileResult>`

Reads a file from the sandbox.

```typescript
const { content } = await sandbox.getFile('output.txt');
```

### Git Operations

#### `gitClone(options): Promise<GitCloneResult>`

Clones a Git repository.

```typescript
const result = await sandbox.gitClone({
  url: 'https://github.com/user/repo',
  branch: 'main',
  depth: 1,
  directory: 'myrepo'
});
```

#### `gitPull(directory?): Promise<GitPullResult>`

Pulls latest changes.

```typescript
await sandbox.gitPull('/app/myrepo');
```

#### `gitCheckout(branch, directory?): Promise<GitCheckoutResult>`

Checks out a branch.

```typescript
await sandbox.gitCheckout('develop');
```

### Package Management

#### `installPackages(packages, options?): Promise<PackageInstallResult>`

Installs packages.

```typescript
await sandbox.installPackages(['express', 'cors']);

await sandbox.installPackages(['pytest'], {
  manager: 'pip',
  dev: true,
  directory: '/app'
});
```

#### `uninstallPackages(packages, manager?, directory?): Promise<PackageInstallResult>`

Uninstalls packages.

```typescript
await sandbox.uninstallPackages(['lodash']);
```

#### `listPackages(manager?, directory?): Promise<PackageListResult>`

Lists installed packages.

```typescript
const { packages } = await sandbox.listPackages('npm');
```

### Port Management

#### `exposePort(containerPort): Promise<ExposePortResult>`

Exposes a container port.

```typescript
const { hostPort, url } = await sandbox.exposePort(3000);
console.log(`App available at: ${url}`);
```

#### `getExposedPorts(): Promise<GetPortsResult>`

Gets all exposed ports.

```typescript
const { ports } = await sandbox.getExposedPorts();
```

### Secrets Management

Store and inject encrypted secrets into sandboxes.

#### `createSecret(name, value): Promise<SecretCreateResult>`

Creates an encrypted secret.

```typescript
await sandbox.createSecret('DATABASE_URL', 'postgres://...');
await sandbox.createSecret('API_KEY', 'sk-...');
```

#### `listSecrets(): Promise<SecretsListResult>`

Lists all secrets (values are not returned).

```typescript
const { secrets } = await sandbox.listSecrets();
```

#### `deleteSecret(name): Promise<{ success: boolean }>`

Deletes a secret.

```typescript
await sandbox.deleteSecret('API_KEY');
```

#### `injectSecrets(secrets): Promise<{ success: boolean; injected: number }>`

Injects secrets as environment variables into the sandbox.

```typescript
await sandbox.injectSecrets({
  DATABASE_URL: 'DATABASE_URL',
  API_KEY: 'API_KEY'
});
```

### Environment Variables

#### `setEnv(env): Promise<EnvSetResult>`

Sets environment variables in the sandbox.

```typescript
await sandbox.setEnv({
  NODE_ENV: 'production',
  PORT: '3000',
  DEBUG: 'true'
});
```

#### `getEnv(fromContainer?): Promise<EnvGetResult>`

Gets environment variables.

```typescript
const { env } = await sandbox.getEnv();

const { env } = await sandbox.getEnv(true);
```

#### `deleteEnvKeys(keys): Promise<{ success: boolean; deleted: number }>`

Deletes specific environment variables.

```typescript
await sandbox.deleteEnvKeys(['DEBUG', 'TEMP_VAR']);
```

### Network Policies

Control network access for sandboxes.

#### `setNetworkPolicy(policy): Promise<NetworkPolicyResult>`

Sets a custom network policy.

```typescript
await sandbox.setNetworkPolicy({
  allowOutbound: true,
  allowInbound: false,
  allowedDomains: ['api.github.com', 'registry.npmjs.org'],
  blockedDomains: ['malware.com'],
  allowedPorts: [80, 443],
  maxBandwidthMbps: 10
});
```

#### `setNetworkPolicyPreset(preset): Promise<NetworkPolicyResult>`

Applies a preset network policy.

```typescript
await sandbox.setNetworkPolicyPreset('restricted');
```

Presets: `default`, `restricted`

#### `getNetworkPolicy(): Promise<NetworkPolicyResult>`

Gets the current network policy.

```typescript
const { policy } = await sandbox.getNetworkPolicy();
```

### Custom Images

Use custom Docker images for sandboxes.

#### `listImages(): Promise<ImagesListResult>`

Lists available custom images.

```typescript
const { userImages, publicImages } = await sandbox.listImages();
```

#### `validateImage(image): Promise<ImageValidationResult>`

Validates a Docker image.

```typescript
const result = await sandbox.validateImage('node:18-alpine');
if (result.valid) {
  console.log('Image is valid');
}
```

#### `registerImage(name, tag, options?): Promise<{ success: boolean; image: CustomImage }>`

Registers a custom image.

```typescript
await sandbox.registerImage('my-python', '3.11', {
  description: 'Python with ML libraries',
  isPublic: false,
  baseImage: 'python:3.11-slim'
});
```

#### `Sandbox.getBuiltinImages(orchestratorUrl?): Promise<{ images: Array<...> }>`

Gets available built-in images.

```typescript
const { images } = await Sandbox.getBuiltinImages();
```

### Persistent Storage

Attach persistent volumes to sandboxes.

#### `createVolume(name, options?): Promise<VolumeCreateResult>`

Creates a persistent volume.

```typescript
const { volume } = await sandbox.createVolume('my-data', {
  sizeMB: 500,
  mountPath: '/data'
});
```

#### `listVolumes(): Promise<VolumesListResult>`

Lists all volumes.

```typescript
const { volumes } = await sandbox.listVolumes();
```

#### `deleteVolume(volumeId): Promise<{ success: boolean }>`

Deletes a volume.

```typescript
await sandbox.deleteVolume('vol-123');
```

#### `attachVolume(volumeId, options?): Promise<{ success: boolean; attachment: VolumeAttachment }>`

Attaches a volume to the sandbox.

```typescript
await sandbox.attachVolume('vol-123', {
  mountPath: '/data',
  readOnly: false
});
```

#### `detachVolume(volumeId): Promise<{ success: boolean }>`

Detaches a volume from the sandbox.

```typescript
await sandbox.detachVolume('vol-123');
```

#### `getSandboxVolumes(): Promise<{ success: boolean; volumes: VolumeAttachment[] }>`

Gets volumes attached to the sandbox.

```typescript
const { volumes } = await sandbox.getSandboxVolumes();
```

### Static Methods

#### `Sandbox.getTemplates(orchestratorUrl?): Promise<{ templates: TemplateInfo[] }>`

Fetches available templates.

```typescript
const { templates } = await Sandbox.getTemplates();
```

#### `Sandbox.getTemplate(templateId, orchestratorUrl?): Promise<Template>`

Gets a specific template.

```typescript
const template = await Sandbox.getTemplate('node-express');
```

#### `Sandbox.getSupportedLanguages(): SupportedLanguage[]`

Returns supported language identifiers.

```typescript
const languages = Sandbox.getSupportedLanguages();
```

### Utility Methods

#### `getSandboxId(): string | null`

Returns the current sandbox ID.

#### `isConnected(): boolean`

Returns connection status.

## Error Handling

```typescript
try {
  await sandbox.runCommand('invalid-command');
} catch (error) {
  console.error('Command failed:', error.message);
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INSIEN_API_KEY` | API key (required if not in options) |
| `INSIEN_API_URL` | Orchestrator URL |
| `INSIEN_WS_URL` | WebSocket URL |

## Judge (Competitive Programming)

Execute code with precise resource limits using isolate sandbox. Ideal for competitive programming, online judges, and code evaluation systems.

```typescript
import { Judge } from '@insien/sandock';

const judge = new Judge({
  apiKey: 'your-api-key',
  orchestratorUrl: 'http://localhost:3000'
});

// Submit code for execution (returns immediately)
const { id, status } = await judge.execute({
  source_code: '#include <iostream>\nint main() { std::cout << "Hello"; }',
  language: 'cpp',
  stdin: '',
  time_limit: 2,
  memory_limit: 256
});

// Poll for result
const result = await judge.waitForResult(id);
console.log(result.stdout);    // "Hello"
console.log(result.time_used); // 0.015

// Or use executeAndWait for convenience
const result = await judge.executeAndWait({
  source_code: 'print(input())',
  language: 'python',
  stdin: 'Hello World',
  time_limit: 2
});
```

### Judge Methods

#### `judge.execute(options): Promise<JudgeSubmitResult>`

Submit code for execution. Returns immediately with submission ID.

```typescript
interface JudgeExecuteOptions {
  source_code: string;
  language: 'c' | 'cpp' | 'python' | 'java' | 'go' | 'rust' | 'javascript';
  stdin?: string;
  time_limit?: number;      // seconds (default: 2, max: 30)
  memory_limit?: number;    // MB (default: 256, max: 1024)
  wall_time_limit?: number; // seconds
  max_processes?: number;   // (default: 1)
}

const { id, status } = await judge.execute(options);
// { id: 'uuid', status: 'PENDING' }
```

#### `judge.getSubmission(id): Promise<JudgeSubmission>`

Get submission result by ID.

```typescript
interface JudgeSubmission {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'OK' | 'COMPILATION_ERROR' |
          'RUNTIME_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'MEMORY_LIMIT_EXCEEDED' |
          'INTERNAL_ERROR';
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  time_used?: number;      // seconds
  wall_time_used?: number; // seconds
  memory_used?: number;    // KB
  signal?: number;
  message?: string;
}

const submission = await judge.getSubmission('uuid');
```

#### `judge.waitForResult(id, options?): Promise<JudgeSubmission>`

Poll until submission completes.

```typescript
const result = await judge.waitForResult('uuid', {
  pollInterval: 500,  // ms (default: 500)
  timeout: 60000      // ms (default: 60000)
});
```

#### `judge.executeAndWait(options, waitOptions?): Promise<JudgeSubmission>`

Submit and wait for result in one call.

```typescript
const result = await judge.executeAndWait({
  source_code: 'console.log("Hello")',
  language: 'javascript',
  time_limit: 2
});
```

#### `judge.getSubmissions(limit?, offset?): Promise<JudgeSubmissionsListResult>`

List your submissions.

```typescript
const { submissions, limit, offset } = await judge.getSubmissions(50, 0);
```

#### `Judge.getLanguages(): Promise<JudgeLanguagesResult>`

Get supported languages and limits (static method).

```typescript
const { languages, limits } = await Judge.getLanguages();
// languages: ['c', 'cpp', 'python', 'java', 'go', 'rust', 'javascript']
// limits: { max_time_limit: 30, max_memory_limit: 1024, ... }
```

## TypeScript Support

```typescript
import type {
  SandboxOptions,
  CommandResult,
  RunCodeResult,
  SupportedLanguage,
  GitCloneOptions,
  GitCloneResult,
  PackageInstallOptions,
  PackageInstallResult,
  TemplateInfo,
  Template,
  Secret,
  SecretCreateResult,
  SecretsListResult,
  EnvSetResult,
  EnvGetResult,
  NetworkPolicy,
  NetworkPolicyResult,
  CustomImage,
  ImageValidationResult,
  ImagesListResult,
  PersistentVolume,
  VolumeAttachment,
  VolumesListResult,
  VolumeCreateResult,
  // Judge types
  JudgeLanguage,
  JudgeStatus,
  JudgeExecuteOptions,
  JudgeSubmitResult,
  JudgeSubmission,
  JudgeSubmissionsListResult,
  JudgeStatusResult,
  JudgeLanguagesResult
} from '@insien/sandock';
```

## License

MIT
