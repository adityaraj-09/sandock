/*
 * REST API routes for the competitive programming judge service.
 * Provides endpoints for code execution and service status.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getJudgeService } from '../services/judge/index.js';
import { getSubmission, getSubmissionsByUser } from '../services/judge/repository.js';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import type { Language } from '../types/judge.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

const ExecuteSchema = z.object({
  source_code: z.string().min(1).max(100000),
  language: z.enum(['c', 'cpp', 'python', 'java', 'go', 'rust', 'javascript']),
  stdin: z.string().max(10000000).optional().default(''),
  time_limit: z.number().min(0.1).max(30).optional(),
  memory_limit: z.number().min(16).max(1024).optional(),
  wall_time_limit: z.number().min(0.1).max(60).optional(),
  max_processes: z.number().min(1).max(64).optional(),
  max_file_size: z.number().min(1).max(65536).optional()
});

router.post('/execute', authenticateApiKey(), async (req: Request, res: Response) => {
  try {
    const parsed = ExecuteSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation error',
        details: parsed.error.errors
      });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;

    const judge = getJudgeService();
    const result = await judge.submit({
      source_code: parsed.data.source_code,
      language: parsed.data.language as Language,
      stdin: parsed.data.stdin,
      time_limit: parsed.data.time_limit,
      memory_limit: parsed.data.memory_limit,
      wall_time_limit: parsed.data.wall_time_limit,
      max_processes: parsed.data.max_processes,
      max_file_size: parsed.data.max_file_size
    }, userId);

    res.status(202).json(result);
  } catch (err) {
    const error = err as Error;
    if (error.message === 'Queue is full') {
      res.status(503).json({ error: 'Service busy, try again later' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/submissions/:id', authenticateApiKey(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const submission = await getSubmission(id);

    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    res.json(submission);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/submissions', authenticateApiKey(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const submissions = await getSubmissionsByUser(userId, limit, offset);
    res.json({ submissions, limit, offset });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/status', authenticateApiKey(), async (_req: Request, res: Response) => {
  try {
    const judge = getJudgeService();
    const stats = judge.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/languages', async (_req: Request, res: Response) => {
  res.json({
    languages: ['c', 'cpp', 'python', 'java', 'go', 'rust', 'javascript'],
    limits: {
      max_time_limit: 30,
      max_memory_limit: 1024,
      max_source_size: 100000,
      max_stdin_size: 10000000
    }
  });
});

export default router;
