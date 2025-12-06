import { Router, Response } from 'express';
import { requireAuth } from '../services/auth.js';
import pool from '../db/index.js';
import type { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(requireAuth());

router.get('/me', async (req, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user.userId;

    const result = await pool.query(
      `SELECT
        id,
        email,
        first_name,
        last_name,
        username,
        image_url,
        phone_number,
        metadata,
        created_at,
        updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        imageUrl: user.image_url,
        phoneNumber: user.phone_number,
        metadata: user.metadata,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

router.patch('/me', async (req, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user.userId;
    const { firstName, lastName, username, phoneNumber, metadata } = req.body;

    const updateFields: string[] = [];
    const updateValues: unknown[] = [userId];
    let paramCount = 1;

    if (firstName !== undefined) {
      updateFields.push(`first_name = $${++paramCount}`);
      updateValues.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push(`last_name = $${++paramCount}`);
      updateValues.push(lastName);
    }
    if (username !== undefined) {
      updateFields.push(`username = $${++paramCount}`);
      updateValues.push(username);
    }
    if (phoneNumber !== undefined) {
      updateFields.push(`phone_number = $${++paramCount}`);
      updateValues.push(phoneNumber);
    }
    if (metadata !== undefined) {
      updateFields.push(`metadata = $${++paramCount}`);
      updateValues.push(JSON.stringify(metadata));
    }

    if (updateFields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET ${updateFields.join(', ')}
       WHERE id = $1
       RETURNING id, email, first_name, last_name, username, image_url, phone_number, metadata, updated_at`,
      updateValues
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        imageUrl: user.image_url,
        phoneNumber: user.phone_number,
        metadata: user.metadata,
        updatedAt: user.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

router.get('/me/sandboxes', async (req, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user.userId;
    const { status, limit = '50', offset = '0' } = req.query;

    let query = `
      SELECT
        id,
        status,
        created_at,
        destroyed_at,
        metadata
      FROM sandboxes
      WHERE user_id = $1
    `;
    const params: unknown[] = [userId];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${++paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      sandboxes: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        destroyedAt: row.destroyed_at,
        metadata: row.metadata
      })),
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching user sandboxes:', error);
    res.status(500).json({ error: 'Failed to fetch sandboxes' });
  }
});

export default router;
