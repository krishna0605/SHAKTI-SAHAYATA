import expressRateLimit from 'express-rate-limit';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'); // 15 minutes
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');

export const rateLimit = expressRateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(WINDOW_MS / 1000),
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  },
});

// Stricter rate limit for auth endpoints
export const authRateLimit = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes.',
    code: 'AUTH_RATE_LIMIT',
  },
});
