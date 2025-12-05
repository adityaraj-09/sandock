/**
 * WebSocket Authentication Service
 * Handles authentication for both agent and client WebSocket connections
 */

import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { getSandboxMetadata } from './redis.js';
import pool from '../db/index.js';

/**
 * Verify agent WebSocket connection
 * @param {string} sandboxId - Sandbox ID
 * @param {string} token - JWT token
 * @param {string} jwtSecret - JWT secret
 * @returns {Promise<Object>} Verification result
 */
export async function verifyAgentConnection(sandboxId, token, jwtSecret) {
  try {
    if (!token) {
      return { valid: false, error: 'Missing authentication token' };
    }

    const decoded = jwt.verify(token, jwtSecret);

    // Verify token claims
    if (decoded.sandboxId !== sandboxId) {
      return { valid: false, error: 'Token sandbox ID mismatch' };
    }

    if (decoded.type !== 'agent' && decoded.type !== 'warm') {
      return { valid: false, error: 'Invalid token type' };
    }

    return {
      valid: true,
      decoded,
      userId: decoded.userId,
      tier: decoded.tier
    };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    if (error.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token' };
    }
    logger.error('Agent auth error:', error);
    return { valid: false, error: 'Authentication failed' };
  }
}

/**
 * Verify client WebSocket connection
 * @param {string} sandboxId - Sandbox ID
 * @param {string} apiKey - API key (from query param or header)
 * @param {string} token - Optional JWT token for user verification
 * @param {string} jwtSecret - JWT secret
 * @returns {Promise<Object>} Verification result
 */
export async function verifyClientConnection(sandboxId, apiKey, token, jwtSecret) {
  try {
    // First, verify the sandbox exists
    const metadata = await getSandboxMetadata(sandboxId);
    if (!metadata) {
      return { valid: false, error: 'Sandbox not found' };
    }

    // Method 1: API Key authentication
    if (apiKey) {
      const authResult = await verifyApiKeyForSandbox(sandboxId, apiKey);
      if (authResult.valid) {
        return authResult;
      }
    }

    // Method 2: JWT token authentication (for SDK clients)
    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret);

        // Verify user owns this sandbox
        const sandboxResult = await pool.query(
          'SELECT user_id FROM sandboxes WHERE id = $1 AND status = $2',
          [sandboxId, 'active']
        );

        if (sandboxResult.rows.length === 0) {
          return { valid: false, error: 'Sandbox not found or inactive' };
        }

        if (sandboxResult.rows[0].user_id !== decoded.userId) {
          return { valid: false, error: 'Not authorized to access this sandbox' };
        }

        return {
          valid: true,
          userId: decoded.userId,
          method: 'jwt'
        };
      } catch (error) {
        if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') {
          logger.error('Client JWT auth error:', error);
        }
      }
    }

    // Method 3: Check if sandbox allows unauthenticated access (internal use)
    if (metadata.allowUnauthenticated === true) {
      return {
        valid: true,
        method: 'internal',
        warning: 'Unauthenticated access'
      };
    }

    return { valid: false, error: 'Authentication required' };
  } catch (error) {
    logger.error('Client auth error:', error);
    return { valid: false, error: 'Authentication failed' };
  }
}

/**
 * Verify API key has access to sandbox
 * @param {string} sandboxId - Sandbox ID
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} Verification result
 */
async function verifyApiKeyForSandbox(sandboxId, apiKey) {
  try {
    // Extract prefix for lookup
    if (!apiKey.startsWith('isk_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const keyPrefix = apiKey.substring(0, 12);

    // Find the API key
    const keyResult = await pool.query(
      `SELECT ak.id, ak.user_id, ak.key_hash
       FROM api_keys ak
       WHERE ak.key_prefix = $1
       AND ak.revoked_at IS NULL
       AND (ak.expires_at IS NULL OR ak.expires_at > CURRENT_TIMESTAMP)`,
      [keyPrefix]
    );

    if (keyResult.rows.length === 0) {
      return { valid: false, error: 'Invalid or expired API key' };
    }

    // Verify the sandbox belongs to this user
    const sandboxResult = await pool.query(
      'SELECT user_id FROM sandboxes WHERE id = $1 AND status = $2',
      [sandboxId, 'active']
    );

    if (sandboxResult.rows.length === 0) {
      return { valid: false, error: 'Sandbox not found or inactive' };
    }

    // Check if API key's user owns the sandbox
    const keyUserId = keyResult.rows[0].user_id;
    const sandboxUserId = sandboxResult.rows[0].user_id;

    if (keyUserId !== sandboxUserId) {
      return { valid: false, error: 'Not authorized to access this sandbox' };
    }

    // Update last used timestamp
    await pool.query(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [keyResult.rows[0].id]
    );

    return {
      valid: true,
      userId: keyUserId,
      apiKeyId: keyResult.rows[0].id,
      method: 'api_key'
    };
  } catch (error) {
    logger.error('API key verification error:', error);
    return { valid: false, error: 'API key verification failed' };
  }
}

/**
 * Generate a client access token for a sandbox
 * @param {string} sandboxId - Sandbox ID
 * @param {string} userId - User ID
 * @param {string} jwtSecret - JWT secret
 * @param {number} expiresIn - Token expiry in seconds (default 1 hour)
 * @returns {string} JWT token
 */
export function generateClientToken(sandboxId, userId, jwtSecret, expiresIn = 3600) {
  return jwt.sign(
    {
      sandboxId,
      userId,
      type: 'client',
      iat: Math.floor(Date.now() / 1000)
    },
    jwtSecret,
    { expiresIn }
  );
}

/**
 * WebSocket close codes
 */
export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED: 1003,
  NO_STATUS: 1005,
  ABNORMAL: 1006,
  INVALID_DATA: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  MISSING_EXTENSION: 1010,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012,
  TRY_AGAIN_LATER: 1013,
  BAD_GATEWAY: 1014,
  TLS_HANDSHAKE: 1015
};
