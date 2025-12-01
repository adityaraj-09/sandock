import { validateApiKey } from '../services/apiKeys.js';

// Middleware to authenticate via API key
export function authenticateApiKey() {
  return async (req, res, next) => {
    try {
      // Get API key from header or query
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;

      if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
      }

      // Validate API key
      const keyData = await validateApiKey(apiKey);

      if (!keyData) {
        return res.status(401).json({ error: 'Invalid or expired API key' });
      }

      // Attach user info to request
      req.user = {
        userId: keyData.userId,
        apiKeyId: keyData.apiKeyId,
        clerkUserId: keyData.clerkUserId,
        email: keyData.email
      };

      next();
    } catch (error) {
      console.error('API key authentication error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}

