export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  image: string;
  files: TemplateFile[];
  packages: string[];
  env: Record<string, string>;
  ports: number[];
  memory?: number;
  cpu?: number;
}

export interface TemplateFile {
  path: string;
  content: string;
}

export const templates: Record<string, SandboxTemplate> = {
  'node-express': {
    id: 'node-express',
    name: 'Node.js Express API',
    description: 'Express.js REST API starter',
    language: 'javascript',
    image: 'sandbox-agent:node',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'express-api',
          version: '1.0.0',
          main: 'index.js',
          scripts: { start: 'node index.js' },
          dependencies: { express: '^4.18.2' }
        }, null, 2)
      },
      {
        path: 'index.js',
        content: `const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`
      }
    ],
    packages: ['express'],
    env: { PORT: '3000' },
    ports: [3000]
  },

  'python-flask': {
    id: 'python-flask',
    name: 'Python Flask API',
    description: 'Flask REST API starter',
    language: 'python',
    image: 'sandbox-agent:python',
    files: [
      {
        path: 'requirements.txt',
        content: 'flask==3.0.0\ngunicorn==21.2.0'
      },
      {
        path: 'app.py',
        content: `from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/')
def index():
    return jsonify({'message': 'Hello from Flask!'})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
`
      }
    ],
    packages: ['flask', 'gunicorn'],
    env: { FLASK_APP: 'app.py' },
    ports: [5000]
  },

  'python-fastapi': {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    description: 'FastAPI with async support',
    language: 'python',
    image: 'sandbox-agent:python',
    files: [
      {
        path: 'requirements.txt',
        content: 'fastapi==0.109.0\nuvicorn==0.27.0'
      },
      {
        path: 'main.py',
        content: `from fastapi import FastAPI

app = FastAPI()

@app.get('/')
async def root():
    return {'message': 'Hello from FastAPI!'}

@app.get('/health')
async def health():
    return {'status': 'ok'}
`
      }
    ],
    packages: ['fastapi', 'uvicorn'],
    env: {},
    ports: [8000]
  },

  'node-typescript': {
    id: 'node-typescript',
    name: 'Node.js TypeScript',
    description: 'TypeScript Node.js starter',
    language: 'typescript',
    image: 'sandbox-agent:node',
    files: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'typescript-app',
          version: '1.0.0',
          main: 'dist/index.js',
          scripts: {
            build: 'tsc',
            start: 'node dist/index.js',
            dev: 'ts-node src/index.ts'
          },
          devDependencies: {
            typescript: '^5.3.0',
            'ts-node': '^10.9.0',
            '@types/node': '^20.0.0'
          }
        }, null, 2)
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'commonjs',
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true
          },
          include: ['src/**/*']
        }, null, 2)
      },
      {
        path: 'src/index.ts',
        content: `const greeting: string = 'Hello from TypeScript!';
console.log(greeting);
`
      }
    ],
    packages: ['typescript', 'ts-node', '@types/node'],
    env: {},
    ports: []
  },

  'go-api': {
    id: 'go-api',
    name: 'Go HTTP Server',
    description: 'Go net/http API starter',
    language: 'go',
    image: 'sandbox-agent:go',
    files: [
      {
        path: 'go.mod',
        content: `module myapp

go 1.21
`
      },
      {
        path: 'main.go',
        content: `package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"message": "Hello from Go!"})
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
`
      }
    ],
    packages: [],
    env: {},
    ports: [8080]
  },

  'rust-hello': {
    id: 'rust-hello',
    name: 'Rust Hello World',
    description: 'Basic Rust project',
    language: 'rust',
    image: 'sandbox-agent:rust',
    files: [
      {
        path: 'Cargo.toml',
        content: `[package]
name = "hello"
version = "0.1.0"
edition = "2021"

[dependencies]
`
      },
      {
        path: 'src/main.rs',
        content: `fn main() {
    println!("Hello from Rust!");
}
`
      }
    ],
    packages: [],
    env: {},
    ports: []
  },

  'python-datascience': {
    id: 'python-datascience',
    name: 'Python Data Science',
    description: 'Jupyter-ready data science environment',
    language: 'python',
    image: 'sandbox-agent:python',
    files: [
      {
        path: 'requirements.txt',
        content: 'numpy==1.26.0\npandas==2.1.0\nmatplotlib==3.8.0\nscikit-learn==1.3.0\njupyter==1.0.0'
      },
      {
        path: 'analysis.py',
        content: `import numpy as np
import pandas as pd

data = pd.DataFrame({
    'x': np.random.randn(100),
    'y': np.random.randn(100)
})

print(data.describe())
`
      }
    ],
    packages: ['numpy', 'pandas', 'matplotlib', 'scikit-learn'],
    env: {},
    ports: [8888]
  },

  'empty': {
    id: 'empty',
    name: 'Empty Sandbox',
    description: 'Blank sandbox with no files',
    language: 'javascript',
    image: 'sandbox-agent:node',
    files: [],
    packages: [],
    env: {},
    ports: []
  }
};

export function getTemplate(templateId: string): SandboxTemplate | null {
  return templates[templateId] || null;
}

export function listTemplates(): SandboxTemplate[] {
  return Object.values(templates);
}

export function getTemplatesByLanguage(language: string): SandboxTemplate[] {
  return Object.values(templates).filter(t => t.language === language);
}
