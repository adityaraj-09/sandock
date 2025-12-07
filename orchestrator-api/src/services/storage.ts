import type Dockerode from 'dockerode';
import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';
import pool from '../db/index.js';

export interface PersistentVolume {
  id: string;
  userId: string;
  name: string;
  volumeName: string;
  sizeMB: number;
  mountPath: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface VolumeAttachment {
  volumeId: string;
  sandboxId: string;
  mountPath: string;
  readOnly: boolean;
  attachedAt: string;
}

const MAX_VOLUMES_PER_USER = 10;
const MAX_VOLUME_SIZE_MB = 5120;
const DEFAULT_VOLUME_SIZE_MB = 1024;

export async function createPersistentVolume(
  docker: Dockerode,
  userId: string,
  name: string,
  sizeMB: number = DEFAULT_VOLUME_SIZE_MB,
  mountPath: string = '/data'
): Promise<PersistentVolume> {
  const existingVolumes = await getUserVolumes(userId);
  if (existingVolumes.length >= MAX_VOLUMES_PER_USER) {
    throw new Error(`Maximum volumes per user (${MAX_VOLUMES_PER_USER}) reached`);
  }

  if (sizeMB > MAX_VOLUME_SIZE_MB) {
    throw new Error(`Volume size cannot exceed ${MAX_VOLUME_SIZE_MB}MB`);
  }

  const id = crypto.randomUUID();
  const volumeName = `pv-${userId.slice(0, 8)}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const now = new Date().toISOString();

  try {
    await docker.createVolume({
      Name: volumeName,
      Labels: {
        'insien.volume.id': id,
        'insien.volume.userId': userId,
        'insien.volume.name': name,
        'insien.volume.createdAt': now
      }
    });

    await pool.query(
      `INSERT INTO persistent_volumes (id, user_id, name, volume_name, size_mb, mount_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, name, volumeName, sizeMB, mountPath, now]
    );

    logger.info(`Created persistent volume: ${volumeName} for user ${userId}`);

    return {
      id,
      userId,
      name,
      volumeName,
      sizeMB,
      mountPath,
      createdAt: now
    };
  } catch (error) {
    const err = error as Error;
    logger.error('Error creating persistent volume:', err);
    throw new Error(`Failed to create volume: ${err.message}`);
  }
}

export async function getUserVolumes(userId: string): Promise<PersistentVolume[]> {
  const result = await pool.query(
    `SELECT id, user_id, name, volume_name, size_mb, mount_path, created_at, last_used_at
     FROM persistent_volumes WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    volumeName: row.volume_name as string,
    sizeMB: row.size_mb as number,
    mountPath: row.mount_path as string,
    createdAt: (row.created_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : undefined
  }));
}

export async function getVolumeById(
  userId: string,
  volumeId: string
): Promise<PersistentVolume | null> {
  const result = await pool.query(
    `SELECT id, user_id, name, volume_name, size_mb, mount_path, created_at, last_used_at
     FROM persistent_volumes WHERE id = $1 AND user_id = $2`,
    [volumeId, userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    volumeName: row.volume_name as string,
    sizeMB: row.size_mb as number,
    mountPath: row.mount_path as string,
    createdAt: (row.created_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : undefined
  };
}

export async function deletePersistentVolume(
  docker: Dockerode,
  userId: string,
  volumeId: string
): Promise<boolean> {
  const volume = await getVolumeById(userId, volumeId);
  if (!volume) return false;

  const attachments = await getVolumeAttachments(volumeId);
  if (attachments.length > 0) {
    throw new Error('Cannot delete volume while it is attached to sandboxes');
  }

  try {
    const dockerVolume = docker.getVolume(volume.volumeName);
    await dockerVolume.remove();

    await pool.query('DELETE FROM persistent_volumes WHERE id = $1', [volumeId]);

    logger.info(`Deleted persistent volume: ${volume.volumeName}`);
    return true;
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode === 404) {
      await pool.query('DELETE FROM persistent_volumes WHERE id = $1', [volumeId]);
      return true;
    }
    throw new Error(`Failed to delete volume: ${err.message}`);
  }
}

export async function attachVolumeToSandbox(
  sandboxId: string,
  volumeId: string,
  mountPath: string,
  readOnly: boolean = false
): Promise<VolumeAttachment> {
  const now = new Date().toISOString();

  await redisClient.hSet(`sandbox:${sandboxId}:volumes`, volumeId, JSON.stringify({
    volumeId,
    mountPath,
    readOnly,
    attachedAt: now
  }));

  await pool.query(
    'UPDATE persistent_volumes SET last_used_at = $1 WHERE id = $2',
    [now, volumeId]
  );

  logger.debug(`Attached volume ${volumeId} to sandbox ${sandboxId} at ${mountPath}`);

  return {
    volumeId,
    sandboxId,
    mountPath,
    readOnly,
    attachedAt: now
  };
}

export async function detachVolumeFromSandbox(
  sandboxId: string,
  volumeId: string
): Promise<void> {
  await redisClient.hDel(`sandbox:${sandboxId}:volumes`, volumeId);
  logger.debug(`Detached volume ${volumeId} from sandbox ${sandboxId}`);
}

export async function getSandboxVolumes(sandboxId: string): Promise<VolumeAttachment[]> {
  const volumesData = await redisClient.hGetAll(`sandbox:${sandboxId}:volumes`);
  const attachments: VolumeAttachment[] = [];

  for (const [, value] of Object.entries(volumesData)) {
    const data = JSON.parse(value) as {
      volumeId: string;
      mountPath: string;
      readOnly: boolean;
      attachedAt: string;
    };
    attachments.push({
      ...data,
      sandboxId
    });
  }

  return attachments;
}

export async function getVolumeAttachments(volumeId: string): Promise<VolumeAttachment[]> {
  const result = await pool.query(
    `SELECT s.id as sandbox_id FROM sandboxes s WHERE s.status = 'active'`
  );

  const attachments: VolumeAttachment[] = [];

  for (const row of result.rows) {
    const sandboxId = row.sandbox_id as string;
    const volumeData = await redisClient.hGet(`sandbox:${sandboxId}:volumes`, volumeId);
    if (volumeData) {
      const data = JSON.parse(volumeData) as {
        volumeId: string;
        mountPath: string;
        readOnly: boolean;
        attachedAt: string;
      };
      attachments.push({
        ...data,
        sandboxId
      });
    }
  }

  return attachments;
}

export function buildVolumeBinds(
  volumes: Array<{ volumeName: string; mountPath: string; readOnly: boolean }>
): string[] {
  return volumes.map((v) => {
    const mode = v.readOnly ? 'ro' : 'rw';
    return `${v.volumeName}:${v.mountPath}:${mode}`;
  });
}

export async function getVolumeUsage(
  docker: Dockerode,
  volumeName: string
): Promise<{ usedBytes: number; totalBytes: number } | null> {
  try {
    const volume = docker.getVolume(volumeName);
    const info = await volume.inspect();

    return {
      usedBytes: (info as { UsageData?: { Size?: number } }).UsageData?.Size || 0,
      totalBytes: 0
    };
  } catch {
    return null;
  }
}

export async function cleanupOrphanedVolumes(docker: Dockerode): Promise<number> {
  let cleaned = 0;

  try {
    const volumes = await docker.listVolumes();
    const insienVolumes = (volumes.Volumes || []).filter(
      (v) => v.Name.startsWith('pv-') || v.Name.startsWith('sandbox-data-')
    );

    for (const volume of insienVolumes) {
      const labels = volume.Labels || {};
      const volumeId = labels['insien.volume.id'];

      if (volumeId) {
        const result = await pool.query(
          'SELECT id FROM persistent_volumes WHERE id = $1',
          [volumeId]
        );

        if (result.rows.length === 0) {
          try {
            const dockerVolume = docker.getVolume(volume.Name);
            await dockerVolume.remove();
            cleaned++;
            logger.info(`Cleaned up orphaned volume: ${volume.Name}`);
          } catch {
            logger.warn(`Failed to remove orphaned volume: ${volume.Name}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error cleaning up orphaned volumes:', error);
  }

  return cleaned;
}
