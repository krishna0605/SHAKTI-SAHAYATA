/**
 * RAG (Retrieval-Augmented Generation) Service — TF-IDF Only
 *
 * This implementation uses in-memory TF-IDF cosine similarity for document retrieval.
 * pgvector and embedding-based retrieval have been removed per migration requirements.
 * Falls back to simple keyword matching if TF-IDF yields no results.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const RAG_ENABLED = String(process.env.CHATBOT_RAG_ENABLED || '').trim().toLowerCase() !== 'false';
const RAG_TOP_K = Math.max(1, Math.min(10, Number(process.env.CHATBOT_RAG_TOP_K || 3)));
const RAG_MAX_CHARS = Math.max(500, Math.min(12000, Number(process.env.CHATBOT_RAG_MAX_CHARS || 3500)));
const RAG_CACHE_TTL_MS = Math.max(5_000, Math.min(60 * 60 * 1000, Number(process.env.CHATBOT_RAG_TTL_MS || 60_000)));

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','has','have','he','her','his','i','if','in','into','is','it','its',
  'me','my','no','not','of','on','or','our','she','so','than','that','the','their','them','then','there','these','they','this','to',
  'was','we','were','what','when','where','which','who','will','with','you','your'
]);

let indexCache = {
  at: 0,
  docs: [],
  idf: new Map(),
  norms: [],
};

const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[`"'()[\]{}<>]/g, ' ')
    .replace(/[^a-z0-9_:+./\s-]/g, ' ')
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS.has(t));

const chunkMarkdown = (markdown, sourceName) => {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const chunks = [];
  let currentTitle = '';
  let buf = [];
  let cursor = 0;

  const flush = () => {
    const raw = buf.join('\n').trim();
    buf = [];
    if (!raw) return;

    const maxLen = 500;
    if (raw.length <= maxLen) {
      chunks.push({
        source: sourceName,
        title: currentTitle,
        content: raw,
        meta: { start: cursor, end: cursor + raw.length, length: raw.length }
      });
      cursor += raw.length;
      return;
    }

    let start = 0;
    while (start < raw.length) {
      const part = raw.slice(start, start + maxLen);
      const trimmed = part.trim();
      if (trimmed) {
        chunks.push({
          source: sourceName,
          title: currentTitle,
          content: trimmed,
          meta: { start: cursor + start, end: cursor + start + trimmed.length, length: trimmed.length }
        });
      }
      start += maxLen;
    }
    cursor += raw.length;
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flush();
      currentTitle = heading[2].trim();
      continue;
    }
    buf.push(line);
    if (buf.join('\n').length > 800) flush();
  }
  flush();

  return chunks
    .filter((c) => c.content && c.content.length >= 40)
    .map((c, idx) => ({ ...c, meta: { ...(c.meta || {}), chunkId: idx } }));
};

const buildTf = (tokens) => {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
};

const computeCosine = (tfA, tfB, idf, normA, normB) => {
  if (!normA || !normB) return 0;
  let dot = 0;
  for (const [term, countA] of tfA.entries()) {
    const countB = tfB.get(term);
    if (!countB) continue;
    const w = idf.get(term) || 0;
    dot += (countA * w) * (countB * w);
  }
  return dot / (normA * normB);
};

const computeNorm = (tf, idf) => {
  let sum = 0;
  for (const [term, count] of tf.entries()) {
    const w = idf.get(term) || 0;
    sum += (count * w) * (count * w);
  }
  return Math.sqrt(sum);
};

const loadProjectDocs = async () => {
  // Load from two locations:
  // 1. Adjacent markdown files (projectMemory.md, staticSchema.md)
  // 2. project_docs directory (if it exists)

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const allChunks = [];

  // Load adjacent markdown docs
  const adjacentDir = path.resolve(__dirname, '..');
  const adjacentFiles = ['projectMemory.md', 'staticSchema.md'];
  for (const name of adjacentFiles) {
    const filePath = path.join(adjacentDir, name);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (content) {
      for (const chunk of chunkMarkdown(content, name)) {
        allChunks.push(chunk);
      }
    }
  }

  // Also try loading from project_docs directory (legacy location)
  const docsDir = path.resolve(__dirname, '../../../project_docs');
  try {
    const names = await fs.readdir(docsDir);
    const mdNames = names.filter((n) => n.toLowerCase().endsWith('.md')).sort();
    for (const name of mdNames) {
      const full = path.join(docsDir, name);
      const content = await fs.readFile(full, 'utf8').catch(() => '');
      for (const chunk of chunkMarkdown(content, name)) {
        allChunks.push(chunk);
      }
    }
  } catch {
    // project_docs directory may not exist — that's fine
  }

  return allChunks;
};

const buildIndex = async () => {
  const docs = await loadProjectDocs();
  const tfs = docs.map((d) => buildTf(tokenize(`${d.title}\n${d.content}`)));

  const df = new Map();
  for (const tf of tfs) {
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }

  const idf = new Map();
  const N = Math.max(1, docs.length);
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log(1 + N / (1 + freq)));
  }

  const norms = tfs.map((tf) => computeNorm(tf, idf));
  return { docs: docs.map((d, i) => ({ ...d, tf: tfs[i] })), idf, norms };
};

const ensureIndex = async () => {
  const now = Date.now();
  if (indexCache.docs.length > 0 && now - indexCache.at < RAG_CACHE_TTL_MS) return indexCache;

  const { docs, idf, norms } = await buildIndex();
  indexCache = { at: now, docs, idf, norms };
  return indexCache;
};

/* ── Keyword fallback: simple substring matching ── */
const keywordFallback = (queryText, docs, topK) => {
  const terms = tokenize(queryText);
  if (terms.length === 0) return [];

  return docs
    .map((doc, idx) => {
      const content = `${doc.title || ''} ${doc.content}`.toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (content.includes(term)) hits++;
      }
      const score = terms.length > 0 ? hits / terms.length : 0;
      return { idx, score, doc };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, topK);
};

export const retrieveRagMatches = async (queryText) => {
  if (!RAG_ENABLED) return { context: '', matches: [] };

  const q = String(queryText || '').trim();
  if (!q) return { context: '', matches: [] };

  const { docs, idf, norms } = await ensureIndex();
  if (!docs.length) return { context: '', matches: [] };

  // Step 1: Try TF-IDF cosine similarity
  const qTf = buildTf(tokenize(q));
  const qNorm = computeNorm(qTf, idf);

  let scored = [];
  if (qNorm > 0) {
    scored = docs
      .map((d, idx) => ({
        idx,
        score: computeCosine(qTf, d.tf, idf, qNorm, norms[idx]),
        doc: d
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .slice(0, RAG_TOP_K);
  }

  // Step 2: Fallback to keyword matching if TF-IDF yielded nothing
  if (scored.length === 0) {
    scored = keywordFallback(q, docs, RAG_TOP_K);
  }

  if (scored.length === 0) return { context: '', matches: [] };

  const parts = [];
  for (const item of scored) {
    const title = item.doc.title ? ` — ${item.doc.title}` : '';
    parts.push(`[${item.doc.source}${title}]\n${item.doc.content}`.trim());
  }

  const joined = parts.join('\n\n---\n\n').trim();
  const context = joined.length > RAG_MAX_CHARS ? joined.slice(0, RAG_MAX_CHARS) : joined;
  return {
    context,
    matches: scored.map((item) => ({
      score: Math.round(item.score * 10000) / 10000,
      source: item.doc.source,
      title: item.doc.title || '',
      excerpt: item.doc.content.slice(0, 500),
      meta: item.doc.meta || null,
      provider: 'tfidf'
    }))
  };
};

export const retrieveRagContext = async (queryText) => {
  const out = await retrieveRagMatches(queryText);
  return out.context || '';
};
