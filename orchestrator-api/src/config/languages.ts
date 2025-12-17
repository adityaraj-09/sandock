/*
 * Language configurations for the competitive programming judge.
 * Defines compile and run commands for each supported language.
 */

import type { LanguageConfig, Language } from '../types/judge.js';

export const LANGUAGES: Record<Language, LanguageConfig> = {
  c: {
    extension: '.c',
    compiled: true,
    compileCmd: ['/usr/bin/gcc', '-O2', '-std=c17', '-o', 'main', 'source.c', '-lm'],
    runCmd: ['./main'],
    sourceFile: 'source.c',
    binaryFile: 'main'
  },
  cpp: {
    extension: '.cpp',
    compiled: true,
    compileCmd: ['/usr/bin/g++', '-O2', '-std=c++17', '-o', 'main', 'source.cpp'],
    runCmd: ['./main'],
    sourceFile: 'source.cpp',
    binaryFile: 'main'
  },
  python: {
    extension: '.py',
    compiled: false,
    runCmd: ['/usr/bin/python3', 'source.py'],
    sourceFile: 'source.py'
  },
  java: {
    extension: '.java',
    compiled: true,
    compileCmd: ['/usr/bin/javac', 'Main.java'],
    runCmd: ['/usr/bin/java', 'Main'],
    sourceFile: 'Main.java',
    binaryFile: 'Main.class'
  },
  go: {
    extension: '.go',
    compiled: true,
    compileCmd: ['/usr/bin/go', 'build', '-o', 'main', 'source.go'],
    runCmd: ['./main'],
    sourceFile: 'source.go',
    binaryFile: 'main'
  },
  rust: {
    extension: '.rs',
    compiled: true,
    compileCmd: ['/usr/bin/rustc', '-O', '-o', 'main', 'source.rs'],
    runCmd: ['./main'],
    sourceFile: 'source.rs',
    binaryFile: 'main'
  },
  javascript: {
    extension: '.js',
    compiled: false,
    runCmd: ['/usr/bin/node', 'source.js'],
    sourceFile: 'source.js'
  }
};

export const COMPILE_LIMITS = {
  timeLimit: 30,
  wallTimeLimit: 60,
  memoryLimit: 512 * 1024,
  maxProcesses: 10,
  maxFileSize: 64 * 1024
};

export const DEFAULT_LIMITS = {
  timeLimit: 2,
  wallTimeLimit: 10,
  memoryLimit: 256 * 1024,
  maxProcesses: 1,
  maxFileSize: 64 * 1024
};

export const MAX_LIMITS = {
  timeLimit: 30,
  memoryLimit: 1024 * 1024
};
