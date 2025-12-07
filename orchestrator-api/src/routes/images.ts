import { Router, Response } from 'express';
import type Dockerode from 'dockerode';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { logger } from '../utils/logger.js';
import {
  validateImage,
  pullImage,
  registerCustomImage,
  getUserImages,
  getPublicImages,
  deleteCustomImage,
  canUseImage
} from '../services/customImages.js';
import type { AuthenticatedRequest } from '../types/index.js';

interface ImagesRouterDependencies {
  docker: Dockerode;
}

export default function createImagesRouter(dependencies: ImagesRouterDependencies) {
  const { docker } = dependencies;
  const router = Router();

  router.get('/', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const userImages = await getUserImages(userId);
      const publicImages = await getPublicImages();

      const uniquePublic = publicImages.filter(
        (pi) => !userImages.some((ui) => ui.id === pi.id)
      );

      res.json({
        success: true,
        userImages,
        publicImages: uniquePublic
      });
    } catch (error) {
      logger.error('Error listing images:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/validate', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { image } = req.body;

      if (!image) {
        res.status(400).json({ error: 'image is required' });
        return;
      }

      const result = await validateImage(docker, image);
      res.json(result);
    } catch (error) {
      logger.error('Error validating image:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/pull', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const { image } = req.body;

      if (!image) {
        res.status(400).json({ error: 'image is required' });
        return;
      }

      const validation = await validateImage(docker, image);
      if (!validation.valid) {
        const pullResult = await pullImage(docker, image);
        if (!pullResult.success) {
          res.status(400).json({ error: pullResult.error });
          return;
        }
      }

      res.json({ success: true, image, warnings: validation.warnings });
    } catch (error) {
      logger.error('Error pulling image:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/register', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { name, tag, description, isPublic, baseImage } = req.body;

      if (!name || !tag) {
        res.status(400).json({ error: 'name and tag are required' });
        return;
      }

      const fullName = `${name}:${tag}`;
      const validation = await validateImage(docker, fullName);

      if (!validation.valid) {
        res.status(400).json({
          error: 'Image validation failed',
          details: validation.error,
          warnings: validation.warnings
        });
        return;
      }

      const image = await registerCustomImage(userId, name, tag, {
        description,
        isPublic,
        baseImage
      });

      res.status(201).json({ success: true, image, warnings: validation.warnings });
    } catch (error) {
      logger.error('Error registering image:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/:id', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const { id } = req.params;

      const deleted = await deleteCustomImage(userId, id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Image not found' });
      }
    } catch (error) {
      logger.error('Error deleting image:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/can-use/:image', authenticateApiKey(), async (req, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.userId;
      const image = decodeURIComponent(req.params.image);

      const canUse = await canUseImage(userId, image);
      res.json({ success: true, canUse, image });
    } catch (error) {
      logger.error('Error checking image access:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/builtin', (_req, res: Response): void => {
    res.json({
      success: true,
      images: [
        { name: 'sandbox-agent:node', language: 'javascript', description: 'Node.js 20' },
        { name: 'sandbox-agent:python', language: 'python', description: 'Python 3.11' },
        { name: 'sandbox-agent:java', language: 'java', description: 'OpenJDK 17' },
        { name: 'sandbox-agent:cpp', language: 'cpp', description: 'GCC with C++17' },
        { name: 'sandbox-agent:go', language: 'go', description: 'Go 1.21' },
        { name: 'sandbox-agent:rust', language: 'rust', description: 'Rust 1.75' }
      ]
    });
  });

  return router;
}
