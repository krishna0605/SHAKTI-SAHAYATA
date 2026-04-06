import dns from 'node:dns/promises';
import { URL } from 'node:url';
import pool from '../config/database.js';

const MAX_URLS = 5;
const REQUEST_TIMEOUT_MS = 10000;
const RATE_LIMIT_MS = 1000;
const ROBOTS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_CHARS = 20000;

const robotsCache = new Map();
const lastRequestAt = new Map();

const isPrivateIpv4 = (ip) => {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
};

const isPrivateIpv6 = (ip) => {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.replace('::ffff:', '');
    return isPrivateIpv4(v4);
  }
  return false;
};

const isPrivateAddress = (ip) => (ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip));

const resolveHost = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('DNS lookup failed');
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new Error('Blocked private network address');
    }
  }
};

const normalizeUrl = (input) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.hostname.toLowerCase() === 'localhost') return null;
    return url;
  } catch {
    return null;
  }
};

const getRobotsRules = async (origin) => {
  const cached = robotsCache.get(origin);
  const now = Date.now();
  if (cached && now - cached.at < ROBOTS_CACHE_TTL_MS) return cached.rules;

  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': 'SHAKTI-OSINT/1.0' } });
    if (!res.ok) {
      robotsCache.set(origin, { at: now, rules: [] });
      return [];
    }
    const text = await res.text();
    const rules = parseRobots(text);
    robotsCache.set(origin, { at: now, rules });
    return rules;
  } catch {
    robotsCache.set(origin, { at: now, rules: [] });
    return [];
  }
};

const parseRobots = (text) => {
  const lines = String(text || '').split('\n').map((line) => line.trim());
  const rules = [];
  let applies = false;

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' || value.toLowerCase().includes('shakti');
      continue;
    }
    if (applies && key === 'disallow') {
      if (value) rules.push(value);
    }
  }
  return rules;
};

const isAllowedByRobots = (path, rules) => {
  if (!rules.length) return true;
  return !rules.some((rule) => rule === '/' || (rule && path.startsWith(rule)));
};

const rateLimitHost = async (host) => {
  const last = lastRequestAt.get(host) || 0;
  const wait = RATE_LIMIT_MS - (Date.now() - last);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt.set(host, Date.now());
};

const extractTitle = (text, fallback) => {
  const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match?.[1]) return match[1].trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[0] || fallback;
};

const buildSnippet = (text) => {
  const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 240);
};

const crawlUrl = async (url) => {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { url, title: url, snippet: 'Invalid or blocked URL', status: 'failed', source: 'crawler', error: 'invalid_url' };
  }

  try {
    await resolveHost(normalized.hostname);
  } catch (err) {
    return { url: normalized.toString(), title: normalized.hostname, snippet: err?.message || 'DNS failed', status: 'failed', source: 'crawler', error: err?.message };
  }

  await rateLimitHost(normalized.hostname);

  const robotsRules = await getRobotsRules(normalized.origin);
  if (!isAllowedByRobots(normalized.pathname, robotsRules)) {
    return { url: normalized.toString(), title: normalized.hostname, snippet: 'Blocked by robots.txt', status: 'failed', source: 'crawler', error: 'robots_block' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(normalized.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'SHAKTI-OSINT/1.0' },
      signal: controller.signal
    });
    const text = await response.text();
    const truncated = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;

    if (!response.ok) {
      return {
        url: normalized.toString(),
        title: normalized.hostname,
        snippet: `HTTP ${response.status}`,
        status: 'failed',
        source: 'crawler',
        error: `HTTP ${response.status}`
      };
    }

    return {
      url: normalized.toString(),
      title: extractTitle(truncated, normalized.hostname),
      snippet: buildSnippet(truncated),
      status: 'ok',
      source: 'crawler'
    };
  } catch (error) {
    return {
      url: normalized.toString(),
      title: normalized.hostname,
      snippet: error?.message || 'Crawl failed',
      status: 'failed',
      source: 'crawler',
      error: error?.message || 'Crawl failed'
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const crawlUrls = async (urls = []) => {
  const uniqueUrls = Array.from(new Set(urls.map((u) => String(u || '').trim()))).filter(Boolean);
  const limited = uniqueUrls.slice(0, MAX_URLS);
  const results = [];

  for (const url of limited) {
    const result = await crawlUrl(url);
    results.push(result);
  }

  // Log results to DB (non-blocking, non-fatal)
  await Promise.all(
    results.map((result) =>
      pool.query(
        `INSERT INTO osint_crawls (url, status, title, snippet, source, error)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          result.url,
          result.status,
          result.title || null,
          result.snippet || null,
          result.source || null,
          result.error || null
        ]
      ).catch(() => {})
    )
  );

  return results;
};
