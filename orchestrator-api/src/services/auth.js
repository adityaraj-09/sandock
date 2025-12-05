import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../db/index.js';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SALT_ROUNDS = 12;

// Validation schemas
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

// Register a new user
export async function registerUser(userData) {
  const validated = registerSchema.parse(userData);
  
  const client = await pool.connect();
  try {
    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [validated.email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validated.password, SALT_ROUNDS);

    // Create user
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
    
    // Generate JWT token
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

// Login user
export async function loginUser(email, password) {
  const validated = loginSchema.parse({ email, password });
  
  const client = await pool.connect();
  try {
    // Find user by email
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [validated.email]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(validated.password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Generate JWT token
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

// Verify JWT token and get user
export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');
  
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database
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
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw new Error('Invalid or expired token');
    }
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

// Middleware for protected routes
export function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await verifyAuth(req);
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  };
}
