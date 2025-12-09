/*
 * Low-level isolate sandbox runner.
 * Handles isolate command execution, box management, and meta file parsing.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { IsolateOptions, IsolateResult, IsolateMeta } from '../../types/judge.js';

const ISOLATE_PATH = '/usr/local/bin/isolate';
const BOX_ROOT = '/var/local/lib/isolate';

export async function initBox(boxId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ISOLATE_PATH, ['--box-id=' + boxId, '--init'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`isolate init failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function cleanupBox(boxId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ISOLATE_PATH, ['--box-id=' + boxId, '--cleanup'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.on('close', () => resolve());
    proc.on('error', reject);
  });
}

export function getBoxPath(boxId: number): string {
  return path.join(BOX_ROOT, String(boxId), 'box');
}

export async function runIsolate(
  boxId: number,
  command: string[],
  options: IsolateOptions
): Promise<IsolateResult> {
  const boxPath = getBoxPath(boxId);
  const metaFile = path.join(BOX_ROOT, String(boxId), 'meta.txt');

  const args: string[] = [
    '--box-id=' + boxId,
    '--time=' + options.timeLimit,
    '--wall-time=' + options.wallTimeLimit,
    '--mem=' + options.memoryLimit,
    '--processes=' + options.maxProcesses,
    '--fsize=' + options.maxFileSize,
    '--meta=' + metaFile,
    '--cg',
    '--cg-mem=' + options.memoryLimit
  ];

  if (options.stdinFile) {
    args.push('--stdin=' + options.stdinFile);
  }
  if (options.stdoutFile) {
    args.push('--stdout=' + options.stdoutFile);
  }
  if (options.stderrFile) {
    args.push('--stderr=' + options.stderrFile);
  }

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('--env=' + key + '=' + value);
    }
  }

  args.push('--run', '--');
  args.push(...command);

  return new Promise((resolve, reject) => {
    const proc = spawn(ISOLATE_PATH, args, {
      cwd: boxPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', async (exitCode) => {
      try {
        const meta = await parseMetaFile(metaFile);
        const result = buildResult(exitCode || 0, meta);
        resolve(result);
      } catch (err) {
        resolve({
          exitCode: exitCode || 1,
          time: 0,
          wallTime: 0,
          memory: 0,
          status: 'XX',
          message: stderr || (err as Error).message
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        time: 0,
        wallTime: 0,
        memory: 0,
        status: 'XX',
        message: err.message
      });
    });
  });
}

async function parseMetaFile(metaFile: string): Promise<IsolateMeta> {
  const content = await fs.readFile(metaFile, 'utf-8');
  const meta: IsolateMeta = {};

  for (const line of content.split('\n')) {
    const [key, value] = line.split(':');
    if (!key || value === undefined) continue;

    switch (key) {
      case 'time':
        meta.time = parseFloat(value);
        break;
      case 'time-wall':
        meta['time-wall'] = parseFloat(value);
        break;
      case 'max-rss':
        meta['max-rss'] = parseInt(value, 10);
        break;
      case 'cg-mem':
        meta['cg-mem'] = parseInt(value, 10);
        break;
      case 'status':
        meta.status = value;
        break;
      case 'exitsig':
        meta.exitsig = parseInt(value, 10);
        break;
      case 'exitcode':
        meta.exitcode = parseInt(value, 10);
        break;
      case 'message':
        meta.message = value;
        break;
    }
  }

  return meta;
}

function buildResult(exitCode: number, meta: IsolateMeta): IsolateResult {
  return {
    exitCode: meta.exitcode ?? exitCode,
    signal: meta.exitsig,
    time: meta.time ?? 0,
    wallTime: meta['time-wall'] ?? 0,
    memory: meta['cg-mem'] ?? meta['max-rss'] ?? 0,
    status: meta.status,
    message: meta.message
  };
}
