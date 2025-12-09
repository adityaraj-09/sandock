import type {
  SandboxOptions,
  JudgeExecuteOptions,
  JudgeSubmitResult,
  JudgeSubmission,
  JudgeSubmissionsListResult,
  JudgeStatusResult,
  JudgeLanguagesResult,
  JudgeStatus
} from './types.js';

export class Judge {
  private apiKey: string | undefined;
  private orchestratorUrl: string;

  constructor(options: SandboxOptions = {}) {
    this.apiKey = options.apiKey || process.env.INSIEN_API_KEY;
    this.orchestratorUrl =
      options.orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';
  }

  async execute(options: JudgeExecuteOptions): Promise<JudgeSubmitResult> {
    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.'
      );
    }

    const response = await fetch(`${this.orchestratorUrl}/api/judge/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `Failed to execute: ${response.statusText}`);
    }

    return response.json() as Promise<JudgeSubmitResult>;
  }

  async getSubmission(id: string): Promise<JudgeSubmission> {
    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.'
      );
    }

    const response = await fetch(`${this.orchestratorUrl}/api/judge/submissions/${id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `Failed to get submission: ${response.statusText}`);
    }

    return response.json() as Promise<JudgeSubmission>;
  }

  async getSubmissions(limit = 50, offset = 0): Promise<JudgeSubmissionsListResult> {
    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.'
      );
    }

    const response = await fetch(
      `${this.orchestratorUrl}/api/judge/submissions?limit=${limit}&offset=${offset}`,
      {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey
        }
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `Failed to get submissions: ${response.statusText}`);
    }

    return response.json() as Promise<JudgeSubmissionsListResult>;
  }

  async waitForResult(
    id: string,
    options: { pollInterval?: number; timeout?: number } = {}
  ): Promise<JudgeSubmission> {
    const pollInterval = options.pollInterval || 500;
    const timeout = options.timeout || 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const submission = await this.getSubmission(id);

      if (submission.status !== 'PENDING' && submission.status !== 'PROCESSING') {
        return submission;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Timeout waiting for submission result');
  }

  async executeAndWait(
    options: JudgeExecuteOptions,
    waitOptions: { pollInterval?: number; timeout?: number } = {}
  ): Promise<JudgeSubmission> {
    const { id } = await this.execute(options);
    return this.waitForResult(id, waitOptions);
  }

  async getStatus(): Promise<JudgeStatusResult> {
    if (!this.apiKey) {
      throw new Error(
        'API key is required. Set apiKey in options or INSIEN_API_KEY environment variable.'
      );
    }

    const response = await fetch(`${this.orchestratorUrl}/api/judge/status`, {
      method: 'GET',
      headers: {
        'X-API-Key': this.apiKey
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `Failed to get status: ${response.statusText}`);
    }

    return response.json() as Promise<JudgeStatusResult>;
  }

  static async getLanguages(orchestratorUrl?: string): Promise<JudgeLanguagesResult> {
    const url = orchestratorUrl || process.env.INSIEN_API_URL || 'http://localhost:3000';

    const response = await fetch(`${url}/api/judge/languages`, {
      method: 'GET'
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `Failed to get languages: ${response.statusText}`);
    }

    return response.json() as Promise<JudgeLanguagesResult>;
  }

  static isTerminalStatus(status: JudgeStatus): boolean {
    return status !== 'PENDING' && status !== 'PROCESSING';
  }

  static isSuccessStatus(status: JudgeStatus): boolean {
    return status === 'OK';
  }
}
