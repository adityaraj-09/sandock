/*
 * Type definitions for the competitive programming judge service.
 * Defines request/response schemas, execution status, and language configuration types.
 */

export type Language = 'c' | 'cpp' | 'python' | 'java' | 'go' | 'rust' | 'javascript';

export type ExecutionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'OK'
  | 'COMPILATION_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR';

export interface ExecuteRequest {
  source_code: string;
  language: Language;
  stdin?: string;
  time_limit?: number;
  memory_limit?: number;
  wall_time_limit?: number;
  max_processes?: number;
  max_file_size?: number;
}

export interface SubmitResponse {
  id: string;
  status: 'PENDING';
}

export interface Submission {
  id: string;
  user_id?: string;
  language: Language;
  source_code: string;
  stdin?: string;
  status: ExecutionStatus;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  time_used?: number;
  wall_time_used?: number;
  memory_used?: number;
  time_limit?: number;
  memory_limit?: number;
  signal?: number;
  message?: string;
  created_at: Date;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exit_code: number;
  time_used: number;
  wall_time_used: number;
  memory_used: number;
  signal?: number;
  message?: string;
}

export interface LanguageConfig {
  extension: string;
  compiled: boolean;
  compileCmd?: string[];
  runCmd: string[];
  sourceFile: string;
  binaryFile?: string;
}

export interface IsolateOptions {
  boxId: number;
  timeLimit: number;
  wallTimeLimit: number;
  memoryLimit: number;
  maxProcesses: number;
  maxFileSize: number;
  stdinFile?: string;
  stdoutFile?: string;
  stderrFile?: string;
  metaFile?: string;
  env?: Record<string, string>;
}

export interface IsolateResult {
  exitCode: number;
  signal?: number;
  time: number;
  wallTime: number;
  memory: number;
  status?: string;
  message?: string;
}

export interface IsolateMeta {
  time?: number;
  'time-wall'?: number;
  'max-rss'?: number;
  'cg-mem'?: number;
  status?: string;
  exitsig?: number;
  exitcode?: number;
  message?: string;
}

export interface Job {
  submissionId: string;
  request: ExecuteRequest;
  userId?: string;
}

export interface WorkerState {
  id: number;
  boxId: number;
  busy: boolean;
  currentJobId?: string;
}

export interface JudgeConfig {
  workerCount: number;
  maxQueueSize: number;
  queueTimeout: number;
  compileTimeout: number;
  defaultTimeLimit: number;
  defaultMemoryLimit: number;
  maxTimeLimit: number;
  maxMemoryLimit: number;
}
