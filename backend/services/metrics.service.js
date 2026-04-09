import client from 'prom-client';

const GLOBAL_METRICS_KEY = '__shakti_metrics_state__';

const buildMetricsState = () => {
  const register = new client.Registry();
  client.collectDefaultMetrics({
    register,
    prefix: 'shakti_backend_',
  });

  const httpRequestsTotal = new client.Counter({
    name: 'shakti_http_requests_total',
    help: 'Total HTTP requests handled by the SHAKTI backend',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const httpRequestDurationSeconds = new client.Histogram({
    name: 'shakti_http_request_duration_seconds',
    help: 'HTTP request duration for the SHAKTI backend',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });

  const activeRequests = new client.Gauge({
    name: 'shakti_http_requests_active',
    help: 'Currently active in-flight HTTP requests',
    registers: [register],
  });

  return {
    register,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    activeRequests,
  };
};

const metricsState = globalThis[GLOBAL_METRICS_KEY] || buildMetricsState();
globalThis[GLOBAL_METRICS_KEY] = metricsState;

const parseBool = (value, fallback = true) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const metricsEnabled = () => parseBool(process.env.METRICS_ENABLED, true);
const metricsToken = () => String(process.env.METRICS_BEARER_TOKEN || '').trim();

const normalizeRoute = (req) => {
  const routePath = req.route?.path;
  if (routePath) {
    return `${req.baseUrl || ''}${routePath}`;
  }
  return req.path || req.originalUrl?.split('?')[0] || 'unmatched';
};

export const metricsMiddleware = (req, res, next) => {
  if (!metricsEnabled() || req.path === '/metrics') {
    next();
    return;
  }

  const start = process.hrtime.bigint();
  metricsState.activeRequests.inc();

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const labels = {
      method: req.method,
      route: normalizeRoute(req),
      status_code: String(res.statusCode),
    };

    metricsState.httpRequestsTotal.inc(labels);
    metricsState.httpRequestDurationSeconds.observe(labels, durationSeconds);
    metricsState.activeRequests.dec();
  });

  next();
};

export const metricsHandler = async (req, res) => {
  if (!metricsEnabled()) {
    return res.status(404).json({ error: 'Metrics are disabled' });
  }

  const requiredToken = metricsToken();
  if (requiredToken) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader !== `Bearer ${requiredToken}`) {
      return res.status(401).json({ error: 'Metrics token required' });
    }
  }

  res.set('Content-Type', metricsState.register.contentType);
  res.end(await metricsState.register.metrics());
};
