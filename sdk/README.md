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
- Resource isolation and security

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
  Template
} from '@insien/sandock';
```

## License

MIT
