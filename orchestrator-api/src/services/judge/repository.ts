/*
 * Database repository for judge submissions.
 * Handles saving and retrieving submission records.
 */

import pool from '../../db/index.js';
import type { ExecuteRequest, ExecutionResult, Submission } from '../../types/judge.js';

export async function createSubmission(
  request: ExecuteRequest,
  userId?: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO judge_submissions (
      user_id, language, source_code, stdin, status, time_limit, memory_limit
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      userId || null,
      request.language,
      request.source_code,
      request.stdin || '',
      'PENDING',
      request.time_limit || null,
      request.memory_limit || null
    ]
  );

  return result.rows[0].id as string;
}

export async function updateSubmissionStatus(
  id: string,
  status: string
): Promise<void> {
  await pool.query(
    `UPDATE judge_submissions SET status = $1 WHERE id = $2`,
    [status, id]
  );
}

export async function updateSubmissionResult(
  id: string,
  result: ExecutionResult
): Promise<void> {
  await pool.query(
    `UPDATE judge_submissions SET
      status = $1,
      stdout = $2,
      stderr = $3,
      exit_code = $4,
      time_used = $5,
      wall_time_used = $6,
      memory_used = $7,
      signal = $8,
      message = $9
    WHERE id = $10`,
    [
      result.status,
      result.stdout,
      result.stderr,
      result.exit_code,
      result.time_used,
      result.wall_time_used,
      result.memory_used,
      result.signal || null,
      result.message || null,
      id
    ]
  );
}

export async function getSubmission(id: string): Promise<Submission | null> {
  const result = await pool.query(
    `SELECT * FROM judge_submissions WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return mapRowToSubmission(row);
}

export async function getSubmissionsByUser(
  userId: string,
  limit = 50,
  offset = 0
): Promise<Submission[]> {
  const result = await pool.query(
    `SELECT * FROM judge_submissions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return result.rows.map(mapRowToSubmission);
}

function mapRowToSubmission(row: Record<string, unknown>): Submission {
  return {
    id: row.id as string,
    user_id: row.user_id as string | undefined,
    language: row.language as Submission['language'],
    source_code: row.source_code as string,
    stdin: row.stdin as string | undefined,
    status: row.status as Submission['status'],
    stdout: row.stdout as string | undefined,
    stderr: row.stderr as string | undefined,
    exit_code: row.exit_code as number | undefined,
    time_used: row.time_used ? parseFloat(row.time_used as string) : undefined,
    wall_time_used: row.wall_time_used ? parseFloat(row.wall_time_used as string) : undefined,
    memory_used: row.memory_used as number | undefined,
    time_limit: row.time_limit ? parseFloat(row.time_limit as string) : undefined,
    memory_limit: row.memory_limit as number | undefined,
    signal: row.signal as number | undefined,
    message: row.message as string | undefined,
    created_at: row.created_at as Date
  };
}
