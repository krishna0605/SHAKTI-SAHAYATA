process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase2-test-jwt-secret-that-is-long-enough';
process.env.JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
process.env.JWT_REFRESH_EXPIRY_DAYS = process.env.JWT_REFRESH_EXPIRY_DAYS || '7';
process.env.REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'shakti_refresh';
process.env.REFRESH_COOKIE_SAMESITE = process.env.REFRESH_COOKIE_SAMESITE || 'lax';
process.env.REFRESH_COOKIE_SECURE = process.env.REFRESH_COOKIE_SECURE || 'false';
process.env.CHATBOT_DIAGNOSTICS_ENABLED = 'true';

