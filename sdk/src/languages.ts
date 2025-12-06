import type { LanguageConfig, SupportedLanguage } from './types.js';

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    name: 'JavaScript',
    extension: 'js',
    command: 'node',
    args: [],
    timeout: 5000,
    image: 'node:20-slim'
  },
  python: {
    name: 'Python',
    extension: 'py',
    command: 'python3',
    args: [],
    timeout: 5000,
    image: 'python:3.11-slim'
  },
  java: {
    name: 'Java',
    extension: 'java',
    command: 'javac',
    args: [],
    runCommand: 'java',
    timeout: 10000,
    image: 'openjdk:17-jdk-slim'
  },
  cpp: {
    name: 'C++',
    extension: 'cpp',
    command: 'g++',
    args: ['-o', 'main', '-std=c++17'],
    runCommand: './main',
    timeout: 10000,
    image: 'gcc:latest'
  },
  go: {
    name: 'Go',
    extension: 'go',
    command: 'go',
    args: ['run'],
    timeout: 5000,
    image: 'golang:1.21-alpine'
  },
  rust: {
    name: 'Rust',
    extension: 'rs',
    command: 'rustc',
    args: ['-o', 'main'],
    runCommand: './main',
    timeout: 15000,
    image: 'rust:1.75-slim'
  },
  typescript: {
    name: 'TypeScript',
    extension: 'ts',
    command: 'ts-node',
    args: [],
    timeout: 5000,
    image: 'node:20-slim'
  }
};

export function getLanguageConfig(language: string): LanguageConfig {
  const lang = language.toLowerCase() as SupportedLanguage;
  if (!SUPPORTED_LANGUAGES[lang]) {
    throw new Error(
      `Unsupported language: ${language}. Supported: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`
    );
  }
  return SUPPORTED_LANGUAGES[lang];
}

export function getFileName(language: string, defaultName = 'main'): string {
  const config = getLanguageConfig(language);
  return `${defaultName}.${config.extension}`;
}

export function getSupportedLanguages(): SupportedLanguage[] {
  return Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];
}
