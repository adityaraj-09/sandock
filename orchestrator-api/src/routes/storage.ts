import { Router, Response } from 'express';
import type Dockerode from 'dockerode';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { logger } from '../utils/logger.js';
import {
  createPersistentVolume,
  getUserVolumes,
  getVolumeById,
  deletePersistentVolume,
  attachVolumeToSandbox,
  detachVolumeFromSandbox,
  getSandboxVolumes,
  getVolumeUsage
} from '../services/storage.js';
import type { AuthenticatedRequest } from '../types/index.js';

interface StorageRouterDependencies {
  docker: Dockerode;
}

export default function createStorageRouter(dependencies: StorageRouterDependencies) {
  const { docker } = dependencies;
  const router = Router();

  router.post('/volumes', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { name, sizeMB, mountPath } = req.body;

      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const volume = await createPersistentVolume(docker, userId, name, sizeMB, mountPath);
      res.status(201).json({ success: true, volume });
    } catch (error) {
      logger.error('Error creating volume:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/volumes', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const volumes = await getUserVolumes(userId);
      res.json({ success: true, volumes });
    } catch (error) {
      logger.error('Error listing volumes:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/volumes/:id', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { id } = req.params;

      const volume = await getVolumeById(userId, id);
      if (!volume) {
        res.status(404).json({ error: 'Volume not found' });
        return;
      }

      const usage = await getVolumeUsage(docker, volume.volumeName);
      res.json({ success: true, volume, usage });
    } catch (error) {
      logger.error('Error getting volume:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/volumes/:id', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { id } = req.params;

      const deleted = await deletePersistentVolume(docker, userId, id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Volume not found' });
      }
    } catch (error) {
      logger.error('Error deleting volume:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/:sandboxId/volumes/:volumeId/attach', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { sandboxId, volumeId } = req.params;
      const { mountPath, readOnly } = req.body;

      const volume = await getVolumeById(userId, volumeId);
      if (!volume) {
        res.status(404).json({ error: 'Volume not found' });
        return;
      }

      const attachment = await attachVolumeToSandbox(
        sandboxId,
        volumeId,
        mountPath || volume.mountPath,
        readOnly || false
      );

      res.json({ success: true, attachment });
    } catch (error) {
      logger.error('Error attaching volume:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/:sandboxId/volumes/:volumeId/detach', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { sandboxId, volumeId } = req.params;

      await detachVolumeFromSandbox(sandboxId, volumeId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Error detaching volume:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/sandbox/:sandboxId/volumes', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { sandboxId } = req.params;
      const volumes = await getSandboxVolumes(sandboxId);
      res.json({ success: true, volumes });
    } catch (error) {
      logger.error('Error getting sandbox volumes:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
