/*
 * Main judge service that orchestrates code execution.
 * Initializes queue and worker pool, provides submit interface.
 */

import { JobQueue } from './queue.js';
import { WorkerPool } from './pool.js';
import { createSubmission } from './repository.js';
import type { ExecuteRequest, SubmitResponse, JudgeConfig } from '../../types/judge.js';
import { MAX_LIMITS, DEFAULT_LIMITS } from '../../config/languages.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_CONFIG: JudgeConfig = {
  workerCount: 4,
  maxQueueSize: 1000,
  queueTimeout: 30000,
  compileTimeout: 30000,
  defaultTimeLimit: DEFAULT_LIMITS.timeLimit,
  defaultMemoryLimit: DEFAULT_LIMITS.memoryLimit / 1024,
  maxTimeLimit: MAX_LIMITS.timeLimit,
  maxMemoryLimit: MAX_LIMITS.memoryLimit / 1024
};

export class JudgeService {
  private queue: JobQueue;
  private pool: WorkerPool;
  private config: JudgeConfig;

  constructor(config: Partial<JudgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue = new JobQueue(this.config.maxQueueSize);
    this.pool = new WorkerPool(this.queue, this.config.workerCount);
  }

  start(): void {
    this.pool.start();
    logger.info('Judge service started');
  }

  stop(): void {
    this.pool.stop();
    this.queue.clear();
    logger.info('Judge service stopped');
  }

  async submit(request: ExecuteRequest, userId?: string): Promise<SubmitResponse> {
    this.validateRequest(request);

    if (this.queue.isFull()) {
      throw new Error('Queue is full');
    }

    const submissionId = await createSubmission(request, userId);

    this.queue.enqueue({
      submissionId,
      request,
      userId
    });

    return {
      id: submissionId,
      status: 'PENDING'
    };
  }

  private validateRequest(request: ExecuteRequest): void {
    if (!request.source_code) {
      throw new Error('source_code is required');
    }
    if (!request.language) {
      throw new Error('language is required');
    }
    if (request.time_limit && request.time_limit > this.config.maxTimeLimit) {
      throw new Error(`time_limit exceeds maximum of ${this.config.maxTimeLimit}s`);
    }
    if (request.memory_limit && request.memory_limit > this.config.maxMemoryLimit) {
      throw new Error(`memory_limit exceeds maximum of ${this.config.maxMemoryLimit}MB`);
    }
  }

  getStats(): {
    workers: { total: number; busy: number; idle: number; queueSize: number };
    config: JudgeConfig;
  } {
    return {
      workers: this.pool.getStats(),
      config: this.config
    };
  }
}

let judgeInstance: JudgeService | null = null;

export function getJudgeService(config?: Partial<JudgeConfig>): JudgeService {
  if (!judgeInstance) {
    judgeInstance = new JudgeService(config);
    judgeInstance.start();
  }
  return judgeInstance;
}

export function shutdownJudgeService(): void {
  if (judgeInstance) {
    judgeInstance.stop();
    judgeInstance = null;
  }
}
