import type { LanguageConfig } from '../types/index.js';

export const LANGUAGE_IMAGES: Record<string, string> = {
  javascript: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',
  js: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',
  typescript: process.env.IMAGE_TYPESCRIPT || 'sandbox-agent:node',
  ts: process.env.IMAGE_TYPESCRIPT || 'sandbox-agent:node',
  node: process.env.IMAGE_JAVASCRIPT || 'sandbox-agent:node',
  python: process.env.IMAGE_PYTHON || 'sandbox-agent:python',
  python3: process.env.IMAGE_PYTHON || 'sandbox-agent:python',
  py: process.env.IMAGE_PYTHON || 'sandbox-agent:python',
  java: process.env.IMAGE_JAVA || 'sandbox-agent:java',
  cpp: process.env.IMAGE_CPP || 'sandbox-agent:cpp',
  'c++': process.env.IMAGE_CPP || 'sandbox-agent:cpp',
  c: process.env.IMAGE_CPP || 'sandbox-agent:cpp',
  go: process.env.IMAGE_GO || 'sandbox-agent:go',
  golang: process.env.IMAGE_GO || 'sandbox-agent:go',
  rust: process.env.IMAGE_RUST || 'sandbox-agent:rust',
  rs: process.env.IMAGE_RUST || 'sandbox-agent:rust',
  multi: process.env.IMAGE_MULTI || 'sandbox-agent:multilang'
};

export const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  javascript: {
    extension: 'js',
    command: 'node',
    args: [],
    compile: false
  },
  typescript: {
    extension: 'ts',
    command: 'npx',
    args: ['ts-node'],
    compile: false
  },
  python: {
    extension: 'py',
    command: 'python3',
    args: [],
    compile: false
  },
  java: {
    extension: 'java',
    command: 'javac',
    args: [],
    compile: true,
    runCommand: 'java',
    runArgs: []
  },
  cpp: {
    extension: 'cpp',
    command: 'g++',
    args: ['-o', 'main', '-std=c++17'],
    compile: true,
    runCommand: './main',
    runArgs: []
  },
  c: {
    extension: 'c',
    command: 'gcc',
    args: ['-o', 'main'],
    compile: true,
    runCommand: './main',
    runArgs: []
  },
  go: {
    extension: 'go',
    command: 'go',
    args: ['run'],
    compile: false
  },
  rust: {
    extension: 'rs',
    command: 'rustc',
    args: ['-o', 'main'],
    compile: true,
    runCommand: './main',
    runArgs: []
  }
};

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_CONFIG);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  py: 'python',
  python3: 'python',
  'c++': 'cpp',
  golang: 'go',
  rs: 'rust'
};

export function normalizeLanguage(language: string): string {
  const lang = language?.toLowerCase()?.trim();
  return LANGUAGE_ALIASES[lang] || lang;
}

export function getImageForLanguage(language: string): string {
  const normalizedLang = language?.toLowerCase()?.trim();
  return LANGUAGE_IMAGES[normalizedLang] || LANGUAGE_IMAGES.multi;
}

export function getLanguageConfig(language: string): LanguageConfig | null {
  const normalizedLang = normalizeLanguage(language);
  return LANGUAGE_CONFIG[normalizedLang] || null;
}

export function isLanguageSupported(language: string): boolean {
  const normalizedLang = normalizeLanguage(language);
  return SUPPORTED_LANGUAGES.includes(normalizedLang);
}

export function getAllImages(): string[] {
  const images = new Set(Object.values(LANGUAGE_IMAGES));
  return Array.from(images);
}
