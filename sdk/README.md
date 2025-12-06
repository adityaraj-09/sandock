# @insien/sandock

TypeScript SDK for executing code in isolated sandbox environments.

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

// Write a file
await sandbox.writeFile('hello.js', "console.log('Hello!');");

// Run a command
const result = await sandbox.runCommand('node', ['hello.js']);
console.log(result.stdout); // Hello!

// Cleanup when done
await sandbox.destroy();
```

> **Note:** The sandbox is automatically created on first use. No need to call `create()` manually!

## API Reference

### Constructor

```typescript
new Sandbox(options?: SandboxOptions)
```

**Options:**
| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | `string` | Yes* | `INSIEN_API_KEY` env | API key for authentication |
| `orchestratorUrl` | `string` | No | `http://localhost:3000` | Orchestrator API URL |
| `wsUrl` | `string` | No | `ws://localhost:3001` | WebSocket URL |

*Required either as option or environment variable

### Methods

#### `create(): Promise<CreateResponse>`

Creates a new sandbox instance. Called automatically on first use.

```typescript
const { sandboxId, agentUrl } = await sandbox.create();
```

#### `runCommand(cmd, args?, options?): Promise<CommandResult>`

Executes a command in the sandbox.

```typescript
// Simple usage
const result = await sandbox.runCommand('node', ['--version']);

// With options
const result = await sandbox.runCommand('npm', ['install'], {
  timeout: 300000,  // 5 minutes
  background: false
});

// Object syntax
const result = await sandbox.runCommand({
  cmd: 'node',
  args: ['script.js'],
  options: { timeout: 60000 }
});
```

**Returns:**
```typescript
{
  stdout: string;
  stderr: string;
  exitCode: number;
  pid?: number;
  background?: boolean;
}
```

#### `writeFile(path, content): Promise<WriteFileResult>`

Writes a file to the sandbox filesystem.

```typescript
await sandbox.writeFile('index.js', 'console.log("hello");');

// Object syntax
await sandbox.writeFile({ path: 'index.js', content: '...' });
```

#### `writeFiles(files): Promise<WriteFilesResult>`

Writes multiple files at once.

```typescript
// Array format
await sandbox.writeFiles([
  { path: 'file1.js', content: '...' },
  { path: 'file2.js', content: '...' }
]);

// Object format (objects are JSON stringified)
await sandbox.writeFiles({
  'file1.js': 'content1',
  'package.json': { name: 'app', version: '1.0.0' }
});
```

#### `getFile(path): Promise<ReadFileResult>`

Reads a file from the sandbox filesystem.

```typescript
const { content } = await sandbox.getFile('output.txt');
```

#### `runCode(code, language, options?): Promise<RunCodeResult>`

Convenience method to run code in a specific language.

```typescript
const result = await sandbox.runCode(
  'print("Hello, World!")',
  'python'
);
console.log(result.stdout); // Hello, World!
```

**Supported Languages:**
- `javascript` - Node.js
- `typescript` - ts-node
- `python` - Python 3.11
- `java` - OpenJDK 17
- `cpp` - g++ with C++17
- `go` - Go 1.21
- `rust` - Rust 1.75

**Options:**
```typescript
{
  fileName?: string;    // Custom filename
  timeout?: number;     // Execution timeout (ms)
  autoDestroy?: boolean; // Destroy sandbox after (default: true)
  input?: string;       // Stdin input
  args?: string[];      // Command line arguments
}
```

#### `exposePort(containerPort): Promise<ExposePortResult>`

Exposes a container port to the host.

```typescript
const { hostPort, url } = await sandbox.exposePort(3000);
console.log(`App available at: ${url}`);
```

#### `getExposedPorts(): Promise<GetPortsResult>`

Gets all exposed ports for the sandbox.

```typescript
const { ports } = await sandbox.getExposedPorts();
```

#### `disconnect(): Promise<void>`

Disconnects the WebSocket connection without destroying the sandbox.

```typescript
await sandbox.disconnect();
```

#### `destroy(): Promise<{ success: boolean }>`

Destroys the sandbox instance and cleans up resources.

```typescript
await sandbox.destroy();
```

### Static Methods

#### `Sandbox.getSupportedLanguages(): SupportedLanguage[]`

Returns an array of supported language identifiers.

```typescript
const languages = Sandbox.getSupportedLanguages();
// ['javascript', 'python', 'java', 'cpp', 'go', 'rust', 'typescript']
```

### Utility Methods

#### `getSandboxId(): string | null`

Returns the current sandbox ID.

#### `isConnected(): boolean`

Returns whether the sandbox is currently connected.

## Error Handling

All methods throw errors on failure. Wrap calls in try-catch:

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
| `INSIEN_API_URL` | Orchestrator URL (default: `http://localhost:3000`) |
| `INSIEN_WS_URL` | WebSocket URL (default: `ws://localhost:3001`) |

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  SandboxOptions,
  CommandResult,
  RunCodeResult,
  SupportedLanguage
} from '@insien/sandock';
```

## License

MIT
