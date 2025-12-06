import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { getSandboxMetadata } from './redis.js';
import pool from '../db/index.js';
import type { AgentAuthResult, ClientAuthResult, JWTPayload } from '../types/index.js';

export async function verifyAgentConnection(
  sandboxId: string,
  token: string | null,
  jwtSecret: string
): Promise<AgentAuthResult> {
  try {
    if (!token) {
      return { valid: false, error: 'Missing authentication token' };
    }

    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

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
    if ((error as Error).name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    if ((error as Error).name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token' };
    }
    logger.error('Agent auth error:', error);
    return { valid: false, error: 'Authentication failed' };
  }
}

export async function verifyClientConnection(
  sandboxId: string,
  apiKey: string | null,
  token: string | null,
  jwtSecret: string
): Promise<ClientAuthResult> {
  try {
    const metadata = await getSandboxMetadata(sandboxId);
    if (!metadata) {
      return { valid: false, error: 'Sandbox not found' };
    }

    if (apiKey) {
      const authResult = await verifyApiKeyForSandbox(sandboxId, apiKey);
      if (authResult.valid) {
        return authResult;
      }
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret) as { userId: string };

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
        if ((error as Error).name !== 'JsonWebTokenError' && (error as Error).name !== 'TokenExpiredError') {
          logger.error('Client JWT auth error:', error);
        }
      }
    }

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

async function verifyApiKeyForSandbox(sandboxId: string, apiKey: string): Promise<ClientAuthResult> {
  try {
    if (!apiKey.startsWith('isk_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const keyPrefix = apiKey.substring(0, 12);

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

    const sandboxResult = await pool.query(
      'SELECT user_id FROM sandboxes WHERE id = $1 AND status = $2',
      [sandboxId, 'active']
    );

    if (sandboxResult.rows.length === 0) {
      return { valid: false, error: 'Sandbox not found or inactive' };
    }

    const keyUserId = keyResult.rows[0].user_id;
    const sandboxUserId = sandboxResult.rows[0].user_id;

    if (keyUserId !== sandboxUserId) {
      return { valid: false, error: 'Not authorized to access this sandbox' };
    }

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

export function generateClientToken(
  sandboxId: string,
  userId: string,
  jwtSecret: string,
  expiresIn = 3600
): string {
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
} as const;
