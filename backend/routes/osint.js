import express from 'express';
import { crawlUrls } from '../services/osintCrawler.service.js';

const router = express.Router();

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const getProviderConfig = (prefix, label) => {
  const url = String(process.env[`${prefix}_URL`] || '').trim();
  const explicitlyEnabled = parseBool(process.env[`${prefix}_ENABLED`], false);
  const enabled = explicitlyEnabled && Boolean(url);

  return {
    label,
    enabled,
    url,
    method: String(process.env[`${prefix}_METHOD`] || 'POST').trim().toUpperCase() === 'GET' ? 'GET' : 'POST',
    queryParam: String(process.env[`${prefix}_QUERY_PARAM`] || 'query').trim() || 'query',
    token: String(process.env[`${prefix}_TOKEN`] || '').trim(),
    tokenHeader: String(process.env[`${prefix}_TOKEN_HEADER`] || 'Authorization').trim() || 'Authorization',
    tokenPrefix: process.env[`${prefix}_TOKEN_PREFIX`] ?? 'Bearer',
  };
};

const phoneProvider = () => getProviderConfig('OSINT_PHONE_PROVIDER', 'Phone lookup provider');
const breachProvider = () => getProviderConfig('OSINT_BREACH_PROVIDER', 'Breach lookup provider');

const buildProviderHeaders = (provider) => {
  const headers = {};
  if (provider.token) {
    headers[provider.tokenHeader] =
      provider.tokenHeader.toLowerCase() === 'authorization' && provider.tokenPrefix !== ''
        ? `${provider.tokenPrefix} ${provider.token}`.trim()
        : provider.token;
  }
  return headers;
};

const parseProviderBody = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
};

const proxyLookup = async ({ provider, query }) => {
  const headers = buildProviderHeaders(provider);
  let requestUrl = provider.url;
  let body;

  if (provider.method === 'GET') {
    const url = new URL(provider.url);
    url.searchParams.set(provider.queryParam, query);
    requestUrl = url.toString();
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      [provider.queryParam]: query,
      query,
    });
  }

  const response = await fetch(requestUrl, {
    method: provider.method,
    headers,
    body,
  });

  const payload = await parseProviderBody(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : `${provider.label} request failed with status ${response.status}`);
    throw new Error(message);
  }

  return payload;
};

const ensureProviderEnabled = (provider, res) => {
  if (provider.enabled) return true;
  res.status(503).json({
    error: `${provider.label} is not configured in this environment.`,
    code: 'OSINT_PROVIDER_DISABLED',
    source: provider.label,
  });
  return false;
};

router.get('/capabilities', (req, res) => {
  const phone = phoneProvider();
  const breach = breachProvider();

  res.json({
    crawl: true,
    phoneLookup: phone.enabled,
    breachLookup: breach.enabled,
    providers: {
      phone: {
        enabled: phone.enabled,
        method: phone.method,
      },
      breach: {
        enabled: breach.enabled,
        method: breach.method,
      },
    },
  });
});

router.post('/phone', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const provider = phoneProvider();
  if (!ensureProviderEnabled(provider, res)) {
    return undefined;
  }

  try {
    const data = await proxyLookup({ provider, query });
    return res.json({
      success: true,
      data,
      source: provider.label,
      live: true,
    });
  } catch (error) {
    console.error('[OSINT] Phone lookup error:', error?.message || error);
    return res.status(502).json({
      error: error?.message || 'Phone lookup failed',
      source: provider.label,
    });
  }
});

router.post('/breach', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const provider = breachProvider();
  if (!ensureProviderEnabled(provider, res)) {
    return undefined;
  }

  try {
    const data = await proxyLookup({ provider, query });
    return res.json({
      success: true,
      data,
      source: provider.label,
      live: true,
    });
  } catch (error) {
    console.error('[OSINT] Breach lookup error:', error?.message || error);
    return res.status(502).json({
      error: error?.message || 'Breach lookup failed',
      source: provider.label,
    });
  }
});

/**
 * POST /api/osint/crawl
 * Crawl a list of URLs for OSINT investigation.
 * Body: { urls: string[] }
 */
router.post('/crawl', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (!urls.length) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  try {
    const results = await crawlUrls(urls);
    return res.json({ results });
  } catch (error) {
    console.error('[OSINT] Crawl error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'OSINT crawl failed' });
  }
});

export default router;
