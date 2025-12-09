/*
 * In-memory FIFO job queue for the judge service.
 * Provides backpressure and event-based job dispatch.
 */

import { EventEmitter } from 'events';
import type { Job } from '../../types/judge.js';

const DEFAULT_MAX_SIZE = 1000;

export class JobQueue extends EventEmitter {
  private queue: Job[] = [];
  private maxSize: number;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    super();
    this.maxSize = maxSize;
  }

  enqueue(job: Job): void {
    if (this.queue.length >= this.maxSize) {
      throw new Error('Queue is full');
    }
    this.queue.push(job);
    this.emit('job');
  }

  dequeue(): Job | null {
    return this.queue.shift() || null;
  }

  size(): number {
    return this.queue.length;
  }

  isFull(): boolean {
    return this.queue.length >= this.maxSize;
  }

  clear(): void {
    this.queue = [];
  }
}
