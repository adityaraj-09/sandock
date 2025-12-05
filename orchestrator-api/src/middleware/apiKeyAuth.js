import { validateApiKey } from '../services/apiKeys.js';
import { logger } from '../utils/logger.js';

// Middleware to authenticate via API key
export function authenticateApiKey() {
  return async (req, res, next) => {
    try {
      logger.debug(`[AUTH] API key authentication for ${req.method} ${req.path}`);
      
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      const apiKeyPrefix = apiKey ? apiKey.substring(0, 12) + '...' : 'none';

      logger.debug(`[AUTH] API key prefix: ${apiKeyPrefix}`);

      if (!apiKey) {
        logger.warn(`[AUTH] No API key provided for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'API key required' });
      }

      logger.debug(`[AUTH] Validating API key...`);
      const keyData = await validateApiKey(apiKey);

      if (!keyData) {
        logger.warn(`[AUTH] Invalid or expired API key (${apiKeyPrefix})`);
        return res.status(401).json({ error: 'Invalid or expired API key' });
      }

      logger.debug(`[AUTH] API key validated successfully for user ${keyData.userId}`);

      req.user = {
        userId: keyData.userId,
        apiKeyId: keyData.apiKeyId,
        email: keyData.email
      };

      logger.debug(`[AUTH] Authentication successful, proceeding to route handler`);
      next();
    } catch (error) {
      logger.error(`[AUTH] API key authentication error:`, error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}

