import express from 'express';
import { crawlUrls } from '../services/osintCrawler.service.js';
import { optionalAuth } from '../middleware/auth.js';
import {
  executeProviderLookup,
  getBuiltinBreachProvider,
  getBuiltinPhoneProvider,
  getCustomProviderById,
  getOsintCapabilities,
} from '../services/osint/osintProviderRegistry.service.js';
import { logOsintLookup } from '../services/osint/osintAudit.service.js';

const router = express.Router();
router.use(optionalAuth);

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
  getOsintCapabilities()
    .then((payload) => res.json(payload))
    .catch((error) => {
      console.error('[OSINT] Capabilities error:', error?.message || error);
      res.status(500).json({ error: 'Failed to load OSINT capabilities' });
    });
});

router.post('/phone', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const provider = getBuiltinPhoneProvider();
  if (!ensureProviderEnabled(provider, res)) {
    return undefined;
  }

  try {
    const data = await executeProviderLookup({ provider, query });
    await logOsintLookup({ req, action: 'OSINT_PHONE_LOOKUP', query, provider });
    return res.json({
      success: true,
      data,
      source: provider.label,
      live: true,
    });
  } catch (error) {
    console.error('[OSINT] Phone lookup error:', error?.message || error);
    await logOsintLookup({ req, action: 'OSINT_PHONE_LOOKUP', query, provider, result: 'failed', error: error?.message || 'Phone lookup failed' });
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

  const provider = getBuiltinBreachProvider();
  if (!ensureProviderEnabled(provider, res)) {
    return undefined;
  }

  try {
    const data = await executeProviderLookup({ provider, query });
    await logOsintLookup({ req, action: 'OSINT_BREACH_LOOKUP', query, provider });
    return res.json({
      success: true,
      data,
      source: provider.label,
      live: true,
    });
  } catch (error) {
    console.error('[OSINT] Breach lookup error:', error?.message || error);
    await logOsintLookup({ req, action: 'OSINT_BREACH_LOOKUP', query, provider, result: 'failed', error: error?.message || 'Breach lookup failed' });
    return res.status(502).json({
      error: error?.message || 'Breach lookup failed',
      source: provider.label,
    });
  }
});

router.post('/custom/:providerId', async (req, res) => {
  const providerId = String(req.params.providerId || '').trim();
  const query = String(req.body?.query || '').trim();

  if (!providerId) {
    return res.status(400).json({ error: 'providerId is required' });
  }

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const provider = await getCustomProviderById(providerId);
  if (!provider) {
    return res.status(404).json({
      error: 'Custom OSINT provider is unavailable.',
      code: 'OSINT_PROVIDER_DISABLED',
      source: providerId,
    });
  }

  try {
    const data = await executeProviderLookup({ provider, query });
    await logOsintLookup({ req, action: 'OSINT_CUSTOM_LOOKUP', query, provider });
    return res.json({
      success: true,
      data,
      source: provider.label,
      live: true,
    });
  } catch (error) {
    console.error('[OSINT] Custom lookup error:', error?.message || error);
    await logOsintLookup({ req, action: 'OSINT_CUSTOM_LOOKUP', query, provider, result: 'failed', error: error?.message || 'Custom lookup failed' });
    return res.status(502).json({
      error: error?.message || 'Custom lookup failed',
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
