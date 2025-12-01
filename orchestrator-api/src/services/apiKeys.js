import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import pool from '../db/index.js';

const SALT_ROUNDS = 12;

// Generate a new API key
export function generateApiKey() {
  const key = `isk_${randomBytes(32).toString('hex')}`;
  const prefix = key.substring(0, 12); // isk_xxxxxxxx
  return { key, prefix };
}

// Hash API key for storage
export async function hashApiKey(key) {
  return await bcrypt.hash(key, SALT_ROUNDS);
}

// Verify API key
export async function verifyApiKey(key, hash) {
  return await bcrypt.compare(key, hash);
}

// Create API key for user
export async function createApiKey(userId, name, expiresInDays = null) {
  const { key, prefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  
  const expiresAt = expiresInDays 
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, key_prefix, name, created_at, expires_at`,
      [userId, keyHash, prefix, name, expiresAt]
    );

    return {
      id: result.rows[0].id,
      key, // Return full key only once
      prefix: result.rows[0].key_prefix,
      name: result.rows[0].name,
      createdAt: result.rows[0].created_at,
      expiresAt: result.rows[0].expires_at
    };
  } finally {
    client.release();
  }
}

// Get API keys for user
export async function getUserApiKeys(userId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, key_prefix, name, last_used_at, expires_at, revoked_at, created_at
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      prefix: row.key_prefix,
      name: row.name,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      isActive: !row.revoked_at && (!row.expires_at || row.expires_at > new Date())
    }));
  } finally {
    client.release();
  }
}

// Revoke API key
export async function revokeApiKey(userId, apiKeyId) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE api_keys
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING *`,
      [apiKeyId, userId]
    );

    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

// Validate API key and get user
export async function validateApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith('isk_')) {
    return null;
  }

  const client = await pool.connect();
  try {
    // Get all active API keys (not revoked, not expired)
    const result = await client.query(
      `SELECT ak.id, ak.user_id, ak.key_hash, ak.key_prefix, u.clerk_user_id, u.email
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       WHERE ak.revoked_at IS NULL
       AND (ak.expires_at IS NULL OR ak.expires_at > CURRENT_TIMESTAMP)
       AND ak.key_prefix = $1`,
      [apiKey.substring(0, 12)]
    );

    // Verify the key against all matching prefixes
    for (const row of result.rows) {
      const isValid = await verifyApiKey(apiKey, row.key_hash);
      if (isValid) {
        // Update last_used_at
        await client.query(
          'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
          [row.id]
        );

        return {
          userId: row.user_id,
          apiKeyId: row.id,
          clerkUserId: row.clerk_user_id,
          email: row.email
        };
      }
    }

    return null;
  } finally {
    client.release();
  }
}

