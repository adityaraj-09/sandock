import { Sandbox } from '../sdk/src/index.js';

async function main() {
  // Simple initialization - only API key needed!
  const sandbox = new Sandbox({
    apiKey: "isk_74476121bd2bca5919454685c702dd37bcd8f5c446691152e4d137200c5e8e47"
  });

  try {
    // Create sandbox
    await sandbox.create();
    console.log('Sandbox created:', sandbox.sandboxId);

    // IMPORTANT: Expose port FIRST before writing files
    // Port exposure recreates the container, so files written before are lost
    console.log('\nExposing port 3000...');
    const portInfo = await sandbox.exposePort(3000);
    console.log(`Port exposed! Server URL: ${portInfo.url}`);
    console.log(`Container port: ${portInfo.containerPort} -> Host port: ${portInfo.hostPort}`);
    
    // Wait for agent to reconnect if needed
    if (!portInfo.agentReconnected) {
      console.log('Waiting for agent to reconnect...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // NOW write files (after port exposure, so they persist)
    console.log('\nWriting files...');
    await sandbox.writeFiles({
      'index.js': `const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello from Insien Sandbox!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server is running on port \${PORT}\`);
});
`,
      'package.json': {
        name: 'insien-sandbox-example',
        version: '1.0.0',
        main: 'index.js',
        scripts: {
          start: 'node index.js'
        },
        dependencies: {
          express: '^4.18.2'
        }
      },
      '.gitignore': 'node_modules/\n.env\n*.log\n'
    });
    console.log('Files written successfully');

    // Install dependencies
    console.log('\nInstalling dependencies...');
    const installResult = await sandbox.runCommand('npm', ['install', 'express']);
    console.log(installResult.stdout);

    // Verify files exist
    console.log('\nVerifying files...');
    try {
      const files = await sandbox.runCommand('ls', ['-la']);
      console.log('Files:', files.stdout);
    } catch (e) {
      console.log('Could not list files');
    }
    
    // Start the server in background
    console.log('\nStarting Express server...');
    // Run node directly on index.js (not npm start which runs the agent)
    const startResult = await sandbox.runCommand('sh', ['-c', 'cd /app && nohup node index.js > /app/server.log 2>&1 & echo "Server started with PID: $!"'], { background: true });
    console.log(startResult.stdout);
    
    // Check if server started by reading the log
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const logCheck = await sandbox.runCommand('cat', ['/app/server.log']);
      console.log('\nServer log:');
      console.log(logCheck.stdout);
    } catch (e) {
      console.log('Could not read server log yet');
    }
    
    // Check if node process is running
    try {
      const psCheck = await sandbox.runCommand('ps', ['aux']);
      const nodeProcesses = psCheck.stdout.split('\n').filter(line => line.includes('node'));
      if (nodeProcesses.length > 0) {
        console.log('\nNode processes running:');
        nodeProcesses.forEach(p => console.log('  ', p.trim()));
      }
    } catch (e) {
      console.log('Could not check processes');
    }
    
    // Wait a bit longer for server to fully start
    console.log('\nWaiting for server to fully start...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get all exposed ports
    const ports = await sandbox.getExposedPorts();
    console.log('\nAll exposed ports:');
    ports.ports.forEach(port => {
      console.log(`  ${port.containerPort} -> ${port.url}`);
    });

    console.log(`\n✅ Your Express server is running at: ${portInfo.url}`);
    console.log(`   Try: curl ${portInfo.url}`);
    console.log(`   Or visit: ${portInfo.url}/health`);

    // Keep sandbox running (in production, you'd want to handle this differently)
    console.log('\nPress Ctrl+C to stop...');
    process.on('SIGINT', async () => {
      console.log('\nCleaning up...');
      await sandbox.destroy();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error('Error:', error.message);
    if (sandbox.sandboxId) {
      try {
        await sandbox.destroy();
      } catch (destroyError) {
        // Ignore cleanup errors
      }
    }
    process.exit(1);
  }
}

main();

