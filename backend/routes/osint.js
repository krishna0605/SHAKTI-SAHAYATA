import express from 'express';
import { crawlUrls } from '../services/osintCrawler.service.js';

const router = express.Router();

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
