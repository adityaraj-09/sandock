import type Dockerode from 'dockerode';
import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';
import pool from '../db/index.js';

export interface CustomImage {
  id: string;
  userId: string;
  name: string;
  tag: string;
  fullName: string;
  description?: string;
  isPublic: boolean;
  baseImage: string;
  size?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
}

const ALLOWED_BASE_IMAGES = [
  'node:',
  'python:',
  'golang:',
  'rust:',
  'openjdk:',
  'gcc:',
  'ubuntu:',
  'debian:',
  'alpine:'
];

const BLOCKED_IMAGE_PATTERNS = [
  'privileged',
  'dind',
  'docker-in-docker',
  'systemd'
];

export async function validateImage(
  docker: Dockerode,
  imageName: string
): Promise<ImageValidationResult> {
  const warnings: string[] = [];

  for (const blocked of BLOCKED_IMAGE_PATTERNS) {
    if (imageName.toLowerCase().includes(blocked)) {
      return {
        valid: false,
        error: `Image name contains blocked pattern: ${blocked}`,
        warnings
      };
    }
  }

  try {
    const image = docker.getImage(imageName);
    const info = await image.inspect();

    if (info.Size && info.Size > 5 * 1024 * 1024 * 1024) {
      warnings.push('Image size exceeds 5GB, this may cause slow startup times');
    }

    const config = info.Config;
    if (config?.User === 'root' || config?.User === '0') {
      warnings.push('Image runs as root user, consider using a non-root user');
    }

    return { valid: true, warnings };
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode === 404) {
      return {
        valid: false,
        error: 'Image not found. Please ensure the image exists and is accessible.',
        warnings
      };
    }
    return {
      valid: false,
      error: `Failed to validate image: ${err.message}`,
      warnings
    };
  }
}

export async function pullImage(
  docker: Dockerode,
  imageName: string,
  onProgress?: (event: { status: string; progress?: string }) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info(`Pulling image: ${imageName}`);

    const stream = await docker.pull(imageName);

    return new Promise((resolve) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            logger.error(`Failed to pull image ${imageName}:`, err);
            resolve({ success: false, error: err.message });
          } else {
            logger.info(`Successfully pulled image: ${imageName}`);
            resolve({ success: true });
          }
        },
        (event: { status: string; progress?: string }) => {
          if (onProgress) {
            onProgress(event);
          }
        }
      );
    });
  } catch (error) {
    const err = error as Error;
    logger.error(`Error pulling image ${imageName}:`, err);
    return { success: false, error: err.message };
  }
}

export async function registerCustomImage(
  userId: string,
  name: string,
  tag: string,
  options: {
    description?: string;
    isPublic?: boolean;
    baseImage?: string;
  } = {}
): Promise<CustomImage> {
  const id = crypto.randomUUID();
  const fullName = `${name}:${tag}`;
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO custom_images (id, user_id, name, tag, full_name, description, is_public, base_image, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (user_id, full_name) DO UPDATE SET
       description = COALESCE($6, custom_images.description),
       is_public = $7,
       updated_at = $9`,
    [
      id,
      userId,
      name,
      tag,
      fullName,
      options.description || null,
      options.isPublic || false,
      options.baseImage || 'unknown',
      now
    ]
  );

  logger.info(`Registered custom image: ${fullName} for user ${userId}`);

  return {
    id,
    userId,
    name,
    tag,
    fullName,
    description: options.description,
    isPublic: options.isPublic || false,
    baseImage: options.baseImage || 'unknown',
    createdAt: now,
    updatedAt: now
  };
}

export async function getUserImages(userId: string): Promise<CustomImage[]> {
  const result = await pool.query(
    `SELECT id, user_id, name, tag, full_name, description, is_public, base_image, size, created_at, updated_at
     FROM custom_images WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    tag: row.tag as string,
    fullName: row.full_name as string,
    description: row.description as string | undefined,
    isPublic: row.is_public as boolean,
    baseImage: row.base_image as string,
    size: row.size as number | undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString()
  }));
}

export async function getPublicImages(): Promise<CustomImage[]> {
  const result = await pool.query(
    `SELECT id, user_id, name, tag, full_name, description, is_public, base_image, size, created_at, updated_at
     FROM custom_images WHERE is_public = true ORDER BY created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    tag: row.tag as string,
    fullName: row.full_name as string,
    description: row.description as string | undefined,
    isPublic: row.is_public as boolean,
    baseImage: row.base_image as string,
    size: row.size as number | undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString()
  }));
}

export async function canUseImage(userId: string, imageName: string): Promise<boolean> {
  const isBuiltIn = ALLOWED_BASE_IMAGES.some((base) => imageName.startsWith(base));
  if (isBuiltIn) return true;

  if (imageName.startsWith('sandbox-agent:')) return true;

  const result = await pool.query(
    `SELECT id FROM custom_images
     WHERE (user_id = $1 OR is_public = true) AND full_name = $2`,
    [userId, imageName]
  );

  return result.rows.length > 0;
}

export async function deleteCustomImage(userId: string, imageId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM custom_images WHERE id = $1 AND user_id = $2',
    [imageId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function cacheImageInfo(imageName: string, info: object): Promise<void> {
  await redisClient.set(
    `image:info:${imageName}`,
    JSON.stringify(info),
    { EX: 3600 }
  );
}

export async function getCachedImageInfo(imageName: string): Promise<object | null> {
  const cached = await redisClient.get(`image:info:${imageName}`);
  if (!cached) return null;
  return JSON.parse(cached);
}
