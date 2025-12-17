/*
 * Single worker that processes jobs from the queue using isolate.
 * Handles compilation, execution, and result persistence.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Job, ExecutionResult, ExecutionStatus, IsolateOptions } from '../../types/judge.js';
import { LANGUAGES, COMPILE_LIMITS, DEFAULT_LIMITS } from '../../config/languages.js';
import { initBox, cleanupBox, getBoxPath, runIsolate } from './isolate.js';
import { updateSubmissionStatus, updateSubmissionResult } from './repository.js';
import { logger } from '../../utils/logger.js';

export class Worker {
  private id: number;
  private boxId: number;
  private running = false;

  constructor(id: number, boxId: number) {
    this.id = id;
    this.boxId = boxId;
  }

  async processJob(job: Job): Promise<void> {
    this.running = true;

    try {
      await updateSubmissionStatus(job.submissionId, 'PROCESSING');
      await initBox(this.boxId);
      const result = await this.execute(job);
      await updateSubmissionResult(job.submissionId, result);
    } catch (err) {
      const errorResult: ExecutionResult = {
        status: 'INTERNAL_ERROR',
        stdout: '',
        stderr: (err as Error).message,
        exit_code: 1,
        time_used: 0,
        wall_time_used: 0,
        memory_used: 0,
        message: (err as Error).message
      };
      await updateSubmissionResult(job.submissionId, errorResult).catch(() => {});
    } finally {
      await cleanupBox(this.boxId).catch(() => {});
      this.running = false;
    }
  }

  private async execute(job: Job): Promise<ExecutionResult> {
    const { request } = job;
    const langConfig = LANGUAGES[request.language];

    if (!langConfig) {
      return this.errorResult('INTERNAL_ERROR', 'Unsupported language');
    }

    const boxPath = getBoxPath(this.boxId);
    const sourceFile = path.join(boxPath, langConfig.sourceFile);
    const inputFile = path.join(boxPath, 'input.txt');
    const outputFile = path.join(boxPath, 'output.txt');
    const errorFile = path.join(boxPath, 'error.txt');

    await fs.writeFile(sourceFile, request.source_code);
    await fs.writeFile(inputFile, request.stdin || '');

    if (langConfig.compiled && langConfig.compileCmd) {
      const compileResult = await this.compile(langConfig.compileCmd);
      if (compileResult) {
        return compileResult;
      }
    }

    const timeLimit = request.time_limit ?? DEFAULT_LIMITS.timeLimit;
    const memoryLimit = (request.memory_limit ?? DEFAULT_LIMITS.memoryLimit / 1024) * 1024;
    const wallTimeLimit = request.wall_time_limit ?? timeLimit * 5;
    const maxProcesses = request.max_processes ?? DEFAULT_LIMITS.maxProcesses;
    const maxFileSize = request.max_file_size ?? DEFAULT_LIMITS.maxFileSize;

    const options: IsolateOptions = {
      boxId: this.boxId,
      timeLimit,
      wallTimeLimit,
      memoryLimit,
      maxProcesses,
      maxFileSize,
      stdinFile: 'input.txt',
      stdoutFile: 'output.txt',
      stderrFile: 'error.txt'
    };

    const result = await runIsolate(this.boxId, langConfig.runCmd, options);

    let stdout = '';
    let stderr = '';

    try {
      stdout = await fs.readFile(outputFile, 'utf-8');
    } catch {}

    try {
      stderr = await fs.readFile(errorFile, 'utf-8');
    } catch {}

    const status = this.determineStatus(result.status, result.exitCode, result.signal);

    return {
      status,
      stdout,
      stderr,
      exit_code: result.exitCode,
      time_used: result.time,
      wall_time_used: result.wallTime,
      memory_used: result.memory,
      signal: result.signal,
      message: result.message
    };
  }

  private async compile(compileCmd: string[]): Promise<ExecutionResult | null> {
    const boxPath = getBoxPath(this.boxId);
    const errorFile = path.join(boxPath, 'compile_error.txt');

    const options: IsolateOptions = {
      boxId: this.boxId,
      timeLimit: COMPILE_LIMITS.timeLimit,
      wallTimeLimit: COMPILE_LIMITS.wallTimeLimit,
      memoryLimit: COMPILE_LIMITS.memoryLimit,
      maxProcesses: COMPILE_LIMITS.maxProcesses,
      maxFileSize: COMPILE_LIMITS.maxFileSize,
      stderrFile: 'compile_error.txt'
    };

    const result = await runIsolate(this.boxId, compileCmd, options);

    if (result.exitCode !== 0 || result.status) {
      let stderr = '';
      try {
        stderr = await fs.readFile(errorFile, 'utf-8');
      } catch {}

      // Include isolate message in stderr if no compile error was captured
      if (!stderr && result.message) {
        stderr = result.message;
      }

      return {
        status: 'COMPILATION_ERROR',
        stdout: '',
        stderr,
        exit_code: result.exitCode,
        time_used: result.time,
        wall_time_used: result.wallTime,
        memory_used: result.memory,
        message: result.message || stderr || 'Compilation failed'
      };
    }

    return null;
  }

  private determineStatus(
    isolateStatus: string | undefined,
    exitCode: number,
    signal?: number
  ): ExecutionStatus {
    if (isolateStatus === 'TO') {
      return 'TIME_LIMIT_EXCEEDED';
    }
    if (isolateStatus === 'SG' && signal === 9) {
      return 'MEMORY_LIMIT_EXCEEDED';
    }
    if (isolateStatus === 'SG' || isolateStatus === 'RE') {
      return 'RUNTIME_ERROR';
    }
    if (isolateStatus === 'XX') {
      return 'INTERNAL_ERROR';
    }
    if (exitCode !== 0) {
      return 'RUNTIME_ERROR';
    }
    return 'OK';
  }

  private errorResult(status: ExecutionStatus, message: string): ExecutionResult {
    return {
      status,
      stdout: '',
      stderr: message,
      exit_code: 1,
      time_used: 0,
      wall_time_used: 0,
      memory_used: 0,
      message
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  getId(): number {
    return this.id;
  }

  getBoxId(): number {
    return this.boxId;
  }
}
