# Insien Sandbox SDK

JavaScript SDK for interacting with Insien Sandbox instances.

## Installation

```bash
npm install
```

## Usage

Simple and clean API - just provide your API key!

```javascript
import { Sandbox } from '@insien/sandbox';

// Initialize with just your API key
const sandbox = new Sandbox({
  apiKey: 'your-api-key'
});

// Write a file
await sandbox.writeFile('hello.js', "console.log('Hello!');");

// Run a command
const result = await sandbox.runCommand('node', ['--version']);
console.log(result.stdout);

// Read a file
const file = await sandbox.getFile('hello.js');
console.log(file.content);

// Cleanup when done
await sandbox.destroy();
```

**Note:** The sandbox is automatically created on first use. No need to call `create()` manually!

## API Reference

### Constructor

```javascript
new Sandbox(options)
```

**Options:**
- `apiKey` (string, required) - API key for authentication
- `orchestratorUrl` (string, optional) - Orchestrator API URL (defaults to `http://localhost:3000` or `INSIEN_API_URL` env var)
- `wsUrl` (string, optional) - WebSocket URL (defaults to `ws://localhost:3001` or `INSIEN_WS_URL` env var)

**Note:** For local development, you only need to provide `apiKey`. The SDK handles all connection details automatically.

### Methods

#### create()
Creates a new sandbox instance. Called automatically on first use - you typically don't need to call this manually.

**Returns:** `Promise<{ sandboxId, agentUrl }>`

#### runCommand(cmd, args)
Executes a command in the sandbox.

**Parameters:**
- `cmd` (string, required) - Command to execute
- `args` (string[], optional) - Command arguments

**Alternative syntax:** `runCommand({ cmd, args })`

**Returns:** `Promise<{ stdout, stderr, exitCode }>`

#### writeFile(path, content)
Writes a file to the sandbox filesystem.

**Parameters:**
- `path` (string, required) - File path
- `content` (string, required) - File content

**Alternative syntax:** `writeFile({ path, content })`

**Returns:** `Promise<{ success, path }>`

#### writeFiles(files)
Writes multiple files to the sandbox filesystem at once.

**Parameters:**
- `files` (array or object, required) - Files to write

**Array format:**
```javascript
await sandbox.writeFiles([
  { path: 'file1.js', content: '...' },
  { path: 'file2.js', content: '...' }
]);
```

**Object format:**
```javascript
await sandbox.writeFiles({
  'file1.js': 'content1',
  'file2.js': 'content2',
  'package.json': { name: 'app', version: '1.0.0' } // Objects are JSON stringified
});
```

**Returns:** `Promise<{ success, files, count }>`

#### getFile(path)
Reads a file from the sandbox filesystem.

**Parameters:**
- `path` (string, required) - File path

**Returns:** `Promise<{ content, path }>`

#### disconnect()
Disconnects the WebSocket connection.

**Returns:** `Promise<void>`

#### destroy()
Destroys the sandbox instance.

**Returns:** `Promise<{ success }>`

## Error Handling

All methods throw errors on failure. Wrap calls in try-catch:

```javascript
try {
  await sandbox.create();
} catch (error) {
  console.error('Failed to create sandbox:', error.message);
}
```

## Environment Variables

You can set these environment variables instead of passing options:

- `INSIEN_API_KEY` - API key (required)
- `INSIEN_API_URL` - Orchestrator API URL (optional, defaults to `http://localhost:3000`)
- `INSIEN_WS_URL` - WebSocket URL (optional, defaults to `ws://localhost:3001`)

