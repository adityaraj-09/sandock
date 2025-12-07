import crypto from 'crypto';
import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';
import pool from '../db/index.js';

const ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface Secret {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretValue {
  name: string;
  value: string;
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export async function createSecret(userId: string, name: string, value: string): Promise<Secret> {
  const id = crypto.randomUUID();
  const encryptedValue = encrypt(value);
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO secrets (id, user_id, name, encrypted_value, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (user_id, name) DO UPDATE SET encrypted_value = $4, updated_at = $5`,
    [id, userId, name, encryptedValue, now]
  );

  logger.info(`Secret created/updated: ${name} for user ${userId}`);

  return { id, name, userId, createdAt: now, updatedAt: now };
}

export async function getSecret(userId: string, name: string): Promise<string | null> {
  const result = await pool.query(
    'SELECT encrypted_value FROM secrets WHERE user_id = $1 AND name = $2',
    [userId, name]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return decrypt(result.rows[0].encrypted_value as string);
}

export async function listSecrets(userId: string): Promise<Secret[]> {
  const result = await pool.query(
    'SELECT id, name, user_id, created_at, updated_at FROM secrets WHERE user_id = $1 ORDER BY name',
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    userId: row.user_id as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString()
  }));
}

export async function deleteSecret(userId: string, name: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM secrets WHERE user_id = $1 AND name = $2',
    [userId, name]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function resolveSecrets(
  userId: string,
  secretRefs: Record<string, string>
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const [envName, secretRef] of Object.entries(secretRefs)) {
    if (secretRef.startsWith('secret:')) {
      const secretName = secretRef.slice(7);
      const value = await getSecret(userId, secretName);
      if (value) {
        resolved[envName] = value;
      } else {
        logger.warn(`Secret not found: ${secretName}`);
      }
    } else {
      resolved[envName] = secretRef;
    }
  }

  return resolved;
}

export async function injectSecretsToSandbox(
  sandboxId: string,
  userId: string,
  secrets: Record<string, string>
): Promise<void> {
  const resolved = await resolveSecrets(userId, secrets);

  await redisClient.hSet(`sandbox:${sandboxId}:secrets`, resolved);
  await redisClient.expire(`sandbox:${sandboxId}:secrets`, 86400);

  logger.info(`Injected ${Object.keys(resolved).length} secrets to sandbox ${sandboxId}`);
}

export async function getSandboxSecrets(sandboxId: string): Promise<Record<string, string>> {
  const secrets = await redisClient.hGetAll(`sandbox:${sandboxId}:secrets`);
  return secrets;
}

export async function clearSandboxSecrets(sandboxId: string): Promise<void> {
  await redisClient.del(`sandbox:${sandboxId}:secrets`);
}
