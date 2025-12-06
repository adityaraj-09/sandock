import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import pool from '../db/index.js';
import { z } from 'zod';
import type { AuthUser, AuthenticatedRequest, User } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SALT_ROUNDS = 12;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

interface AuthResult {
  user: Omit<User, 'updatedAt'>;
  token: string;
}

export async function registerUser(userData: RegisterData): Promise<AuthResult> {
  const validated = registerSchema.parse(userData);

  const client = await pool.connect();
  try {
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [validated.email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(validated.password, SALT_ROUNDS);

    const result = await client.query(
      `INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        username,
        metadata
      )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, first_name, last_name, username, image_url, phone_number, metadata, created_at`,
      [
        validated.email,
        passwordHash,
        validated.firstName || null,
        validated.lastName || null,
        validated.username || null,
        JSON.stringify({})
      ]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        imageUrl: user.image_url,
        phoneNumber: user.phone_number,
        metadata: user.metadata,
        createdAt: user.created_at
      },
      token
    };
  } finally {
    client.release();
  }
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const validated = loginSchema.parse({ email, password });

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [validated.email]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(validated.password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        imageUrl: user.image_url,
        phoneNumber: user.phone_number,
        metadata: user.metadata,
        createdAt: user.created_at
      },
      token
    };
  } finally {
    client.release();
  }
}

export async function verifyAuth(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };

    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = result.rows[0];

      return {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        imageUrl: user.image_url
      };
    } finally {
      client.release();
    }
  } catch (error) {
    if ((error as Error).name === 'JsonWebTokenError' || (error as Error).name === 'TokenExpiredError') {
      throw new Error('Invalid or expired token');
    }
    throw new Error(`Authentication failed: ${(error as Error).message}`);
  }
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await verifyAuth(req);
      (req as AuthenticatedRequest).user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: (error as Error).message });
    }
  };
}
