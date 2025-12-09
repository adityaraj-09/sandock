/*
 * Worker pool manager for the judge service.
 * Manages a fixed set of workers that process jobs from the queue.
 */

import os from 'os';
import { Worker } from './worker.js';
import { JobQueue } from './queue.js';
import type { Job } from '../../types/judge.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_WORKER_COUNT = Math.max(1, os.cpus().length - 1);

export class WorkerPool {
  private workers: Worker[] = [];
  private queue: JobQueue;
  private running = false;

  constructor(queue: JobQueue, workerCount = DEFAULT_WORKER_COUNT) {
    this.queue = queue;

    for (let i = 0; i < workerCount; i++) {
      this.workers.push(new Worker(i, i));
    }

    this.queue.on('job', () => this.dispatch());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`Worker pool started with ${this.workers.length} workers`);
    this.dispatch();
  }

  stop(): void {
    this.running = false;
    logger.info('Worker pool stopped');
  }

  private dispatch(): void {
    if (!this.running) return;

    for (const worker of this.workers) {
      if (worker.isRunning()) continue;

      const job = this.queue.dequeue();
      if (!job) break;

      this.runWorker(worker, job);
    }
  }

  private async runWorker(worker: Worker, job: Job): Promise<void> {
    try {
      await worker.processJob(job);
    } catch (err) {
      logger.error(`Worker ${worker.getId()} error:`, err);
    }

    if (this.running) {
      this.dispatch();
    }
  }

  getStats(): { total: number; busy: number; idle: number; queueSize: number } {
    const busy = this.workers.filter(w => w.isRunning()).length;
    return {
      total: this.workers.length,
      busy,
      idle: this.workers.length - busy,
      queueSize: this.queue.size()
    };
  }
}
