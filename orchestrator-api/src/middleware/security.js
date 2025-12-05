import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';

// Rate limiting - using in-memory store (no Redis dependency)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: undefined, // Use default in-memory store
  handler: (req, res) => {
    console.log(`[RATE_LIMITER] Request blocked: ${req.method} ${req.path} from ${req.ip}`);
    res.status(429).json({ error: 'Too many requests from this IP, please try again later.' });
  },
  onLimitReached: (req, res, options) => {
    console.log(`[RATE_LIMITER] Limit reached for ${req.method} ${req.path} from ${req.ip}`);
  },
  skip: (req) => {
    console.log(`[RATE_LIMITER] Checking rate limit for ${req.method} ${req.path} from ${req.ip}`);
    return false; // Don't skip
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Stricter limit for sensitive operations
  message: 'Too many requests, please try again later.',
  store: undefined, // Use default in-memory store
  handler: (req, res) => {
    console.log(`[STRICT_LIMITER] Request blocked: ${req.method} ${req.path} from ${req.ip}`);
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
  skip: (req) => {
    console.log(`[STRICT_LIMITER] Checking strict rate limit for ${req.method} ${req.path} from ${req.ip}`);
    return false;
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

// Security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// CORS configuration
export const corsOptions = cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
  optionsSuccessStatus: 200
});

// Request validation helper
export function validateRequest(schema) {
  return (req, res, next) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      next();
    } catch (error) {
      res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }
  };
}

