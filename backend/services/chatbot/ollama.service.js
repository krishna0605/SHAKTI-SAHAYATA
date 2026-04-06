import {
  CHATBOT_CASE_PROMPT_MAX_CHARS,
  CHATBOT_RAG_MAX_CHARS,
  CHATBOT_STREAMING_ENABLED,
  MODEL_HISTORY_LIMIT,
  OLLAMA_ANALYSIS_NUM_PREDICT,
  OLLAMA_CHAT_NUM_PREDICT,
  OLLAMA_MODEL,
  OLLAMA_SQL_NUM_PREDICT,
  OLLAMA_TIMEOUT_MS,
  OLLAMA_URL
} from './config.js';
import { buildLanguageInstruction } from './language.service.js';
import { buildSystemPrompt } from './schemaContext.service.js';
import { retrieveRagContext } from './rag/rag.service.js';
import { guardAgainstDbHallucinations, guardAgainstMutatingSuggestions } from './llmGuard.service.js';
import { guardAgainstHallucination } from './hullcinationCheakService.js';

/* ── Graceful degradation: detect Ollama availability ── */
let ollamaAvailable = null; // null = unknown, true/false after first check
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 10_000; // 10 seconds — fast recovery when Ollama starts after backend

const checkOllamaHealth = async () => {
  const now = Date.now();
  // When Ollama was previously unavailable, always re-check (don't cache failures)
  if (ollamaAvailable === true && now - lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) {
    return ollamaAvailable;
  }
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const wasOffline = ollamaAvailable === false;
    ollamaAvailable = resp.ok;
    if (wasOffline && ollamaAvailable) {
      console.log('[ollama] ✅ Ollama is back online');
    }
  } catch {
    if (ollamaAvailable !== false) {
      console.log('[ollama] ⚠️ Ollama health check failed — marking offline');
    }
    ollamaAvailable = false;
  }
  lastHealthCheck = now;
  return ollamaAvailable;
};

export const isOllamaAvailable = async () => checkOllamaHealth();

const OLLAMA_OFFLINE_RESPONSE = [
  '### SHAKTI SAHAYATA AI',
  '',
  '⚠️ **AI Model Offline**',
  '',
  'The Ollama AI service is not currently running. The chatbot cannot generate AI responses at this time.',
  '',
  '**What still works:**',
  '- `/sql SELECT ...` — Direct read-only database queries',
  '- FIR summary requests (database-driven)',
  '- Crime prediction (rule-based analytics)',
  '- Deterministic CDR/IPDR/ILD/SDR/Tower insights',
  '',
  '**To restore AI chat:**',
  '1. Start Ollama: `ollama serve`',
  '2. Pull model: `ollama pull phi3.5`',
  '3. Retry your question',
].join('\n');

const resolveSampling = (mode) => {
  const m = String(mode || '').toLowerCase();
  if (m === 'db_summary' || m === 'prediction') {
    return { temperature: 0.2, top_p: 0.7 };
  }
  return { top_p: 0.7 };
};

const getLastUserMessage = (history = []) => {
  const items = Array.isArray(history) ? history : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const msg = items[i];
    if (msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return '';
};

const trimPromptSection = (value, maxChars) => {
  const text = String(value || '').trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...<truncated>`;
};

const buildChatRequestPayload = async (history, options = {}, { stream = false } = {}) => {
  const boundedHistory = Array.isArray(history) ? history.slice(-MODEL_HISTORY_LIMIT) : [];
  const systemPromptBase = await buildSystemPrompt();
  const ragContextRaw = await retrieveRagContext(getLastUserMessage(boundedHistory));
  const ragContext = trimPromptSection(ragContextRaw, CHATBOT_RAG_MAX_CHARS);
  const languageHint = buildLanguageInstruction(options.language || 'en');
  const caseContextPrompt = trimPromptSection(options.caseContextPrompt, CHATBOT_CASE_PROMPT_MAX_CHARS);
  const systemPrompt = [
    systemPromptBase,
    ragContext ? `PROJECT DOCS (RAG):\n${ragContext}` : '',
    caseContextPrompt || '',
    `LANGUAGE RULE:\n- ${languageHint}`,
    `CRITICAL REMINDER:\n- DO NOT fabricate database results.\n- DO NOT provide sample tables or "example" data.\n- If you need to show data, suggest a SQL query in a \`\`\`sql block.\n- The system will automatically detect and run the SQL if the user says "yes" or "execute".`
  ].filter(Boolean).join('\n\n');

  return {
    model: OLLAMA_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, ...boundedHistory],
    stream,
    options: {
      num_predict: OLLAMA_CHAT_NUM_PREDICT,
      ...(resolveSampling(options.mode) || {})
    }
  };
};

export const generateChatbotResponse = async (history, options = {}) => {
  // Graceful degradation: check if Ollama is available
  if (!(await checkOllamaHealth())) {
    return OLLAMA_OFFLINE_RESPONSE;
  }

  let response;
  try {
    const payload = await buildChatRequestPayload(history, options, { stream: false });
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (error) {
    console.error('[ollama] Network error calling /api/chat', {
      url: `${OLLAMA_URL}/api/chat`,
      model: OLLAMA_MODEL,
      message: error?.message || error
    });
    // Don't mark offline on timeout — model may be loading (cold start).
    // Health check controls availability, not individual chat failures.
    return OLLAMA_OFFLINE_RESPONSE;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[ollama] /api/chat non-OK response', {
      status: response.status,
      body: text?.slice(0, 800)
    });
    throw new Error(`Ollama API Error: ${response.status} ${response.statusText} ${text}`.trim());
  }

  const data = await response.json().catch(() => ({}));
  const raw = String(data?.message?.content || '').trim();
  const guarded = guardAgainstDbHallucinations(raw, options.language || 'en');
  const content = guardAgainstMutatingSuggestions(guarded, options.language || 'en');
  const antiHallucination = guardAgainstHallucination(content, options.language || 'en');
  if (!antiHallucination) return 'System Error: Empty response from model.';
  return antiHallucination.startsWith('### SHAKTI SAHAYATA AI')
    ? antiHallucination
    : `### SHAKTI SAHAYATA AI\n\n${antiHallucination}`;
};

export const generateChatbotResponseStream = async (history, options = {}, handlers = {}) => {
  if (!(await checkOllamaHealth())) {
    return OLLAMA_OFFLINE_RESPONSE;
  }
  if (!CHATBOT_STREAMING_ENABLED) {
    return generateChatbotResponse(history, options);
  }

  let response;
  try {
    const payload = await buildChatRequestPayload(history, options, { stream: true });
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (error) {
    console.error('[ollama] Network error calling /api/chat (stream)', {
      url: `${OLLAMA_URL}/api/chat`,
      model: OLLAMA_MODEL,
      message: error?.message || error
    });
    return OLLAMA_OFFLINE_RESPONSE;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    console.error('[ollama] /api/chat stream non-OK response', {
      status: response.status,
      body: text?.slice(0, 800)
    });
    throw new Error(`Ollama API Error: ${response.status} ${response.statusText} ${text}`.trim());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const delta = String(payload?.message?.content || '');
      if (delta) {
        raw += delta;
        if (typeof handlers?.onToken === 'function') handlers.onToken(delta);
      }
      if (payload?.done) {
        buffer = '';
      }
    }
  }

  if (buffer.trim()) {
    try {
      const payload = JSON.parse(buffer.trim());
      const delta = String(payload?.message?.content || '');
      if (delta) {
        raw += delta;
        if (typeof handlers?.onToken === 'function') handlers.onToken(delta);
      }
    } catch {
      // ignore trailing malformed fragment
    }
  }

  const trimmed = String(raw || '').trim();
  return trimmed || 'System Error: Empty response from model.';
};

export const generateSqlFromText = async (text, options = {}) => {
  if (!(await checkOllamaHealth())) {
    throw new Error('Ollama AI service is offline. Cannot generate SQL.');
  }

  const systemPromptBase = await buildSystemPrompt();
  const ragContext = await retrieveRagContext(text);

  const sqlSystemPrompt = `
${systemPromptBase}

${ragContext ? `PROJECT DOCS (RAG):\n${ragContext}\n` : ''}

TASK:
- Convert the user's natural language request into a single valid, read-only PostgreSQL SELECT query.
- Use the provided schema snapshot. Do not guess table or column names.
- Always include a LIMIT clause (default 50, max 100).
- If the user specifies a mobile number, search in both calling_number and called_number for CDR, and msisdn for IPDR/SDR.
- If the user specifies an IMEI, search in the imei_a column for CDR records.
- If the user mentions a FIR or Case, use the provided context values if available.

CONTEXT:
- Case ID: ${options.caseId || 'Not provided'}
- FIR: ${options.fir || 'Not provided'}

STRICT RULES:
- Output ONLY the SQL query. No explanation, no markdown blocks, no triple backticks.
- If you cannot generate a valid query, output "ERROR: <reason>".
- Ensure the query is read-only (SELECT only).
- Do not use functions like NOW() or CURRENT_DATE unless explicitly asked for relative time.
- For mobile numbers, use simple string matching (e.g., number = '1234567890').
`.trim();

  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: sqlSystemPrompt },
          { role: 'user', content: text }
        ],
        stream: false,
        options: {
          num_predict: OLLAMA_SQL_NUM_PREDICT,
          ...(resolveSampling('sql') || {})
        }
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (error) {
    console.error('[ollama] Network error calling /api/chat (sql)', error?.message);
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Ollama SQL Generation Error: ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  let sql = String(data?.message?.content || '').trim();
  sql = sql.replace(/^```sql\s*/i, '').replace(/\s*```$/i, '');
  sql = sql.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  if (sql.startsWith('ERROR:')) throw new Error(sql);
  if (!sql.toLowerCase().startsWith('select')) throw new Error('Generated query is not a SELECT statement.');
  return sql;
};

export const generateDbResultAnalysis = async ({ question, sql, columns, rows } = {}) => {
  if (!(await checkOllamaHealth())) {
    return '### SHAKTI SAHAYATA AI\n\n⚠️ AI analysis unavailable — Ollama is offline. Database rows are shown above.';
  }

  const systemPromptBase = await buildSystemPrompt();
  const ragContext = await retrieveRagContext(question);
  const previewRows = Array.isArray(rows) ? rows.slice(0, 20) : [];
  const preview = JSON.stringify({ columns: columns || [], rows: previewRows }, null, 2);

  const analysisSystemPrompt = `
${systemPromptBase}

${ragContext ? `PROJECT DOCS (RAG):\n${ragContext}\n` : ''}

TASK:
- The user asked for analysis/insights on a database query result.
- Provide observations, anomalies, and 2-4 next investigative queries (read-only) the user can run.
- Do not invent facts not present in the result preview.
- If the preview is empty, explain what to check next.

OUTPUT FORMAT:
- Start with "### SHAKTI SAHAYATA AI"
- Section: "**Analysis**" (short paragraphs)
- Section: "**Suggested Next Queries (Read-only)**" (2-4 SQL snippets, each with LIMIT)

USER QUESTION:
${String(question || '').trim()}

SQL EXECUTED (Read-only):
${String(sql || '').trim()}

RESULT PREVIEW (first 20 rows):
${preview}
  `.trim();

  let response;
  try {
    const sampling = resolveSampling('db_summary');
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: analysisSystemPrompt },
          { role: 'user', content: 'Analyze the result preview and provide next steps.' }
        ],
        stream: false,
        options: {
          num_predict: OLLAMA_ANALYSIS_NUM_PREDICT,
          ...(sampling || {})
        }
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (error) {
    console.error('[ollama] Network error (analysis)', error?.message);
    return '### SHAKTI SAHAYATA AI\n\n⚠️ AI analysis unavailable — Ollama is offline.';
  }

  if (!response.ok) {
    throw new Error(`Ollama DB Analysis Error: ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  const content = String(data?.message?.content || '').trim();
  return content.startsWith('### SHAKTI SAHAYATA AI') ? content : `### SHAKTI SAHAYATA AI\n\n${content}`;
};

export const generateCrimeAnalysis = async (caseInfo, metrics, signals) => {
  if (!(await checkOllamaHealth())) {
    return '### SHAKTI SAHAYATA AI\n\n⚠️ AI-powered crime analysis unavailable — Ollama is offline. Rule-based prediction data is shown above.';
  }

  const systemPrompt = `
You are SHAKTI SAHAYATA AI, an expert criminal data analyst.

TASK:
- Provide a professional criminal activity risk analysis based on the provided case data and metrics.
- Analyze the risk level, identify likely criminal patterns, and recommend investigative steps.

METRICS PROVIDED:
- CDR Records: ${metrics.cdrCount}
- Unique Contacts: ${metrics.uniqueContacts}
- Unique IMEI: ${metrics.uniqueImei}
- IPDR Records: ${metrics.ipdrCount}
- ILD Records: ${metrics.ildCount}
- SDR Records: ${metrics.sdrCount}
- Peak Daily Calls: ${metrics.peakDailyCalls}
- Dominant Contact Share: ${metrics.dominantContactShare}%

SIGNALS DETECTED BY SYSTEM:
${signals.map(s => `- ${s}`).join('\n')}

CASE INFO:
- Name: ${caseInfo.case_name}
- Type: ${caseInfo.case_type}
- Description: ${caseInfo.description || 'N/A'}

RESPONSE FORMAT:
- Start with "### SHAKTI SAHAYATA AI"
- Section: "**Risk Analysis Overview**" (2-3 sentences)
- Section: "**Identified Patterns**" (Bullet points)
- Section: "**Investigative Recommendations**" (Bullet points)
- Final Note: "This is an AI-generated analysis based on available metrics."
`.trim();

  let response;
  try {
    const sampling = resolveSampling('prediction');
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: "Please provide a detailed risk analysis for this case." }
        ],
        stream: false,
        options: {
          num_predict: OLLAMA_ANALYSIS_NUM_PREDICT,
          ...(sampling || {})
        }
      }),
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT || 180000))
    });
  } catch (error) {
    console.error('[ollama] Network error (crime-analysis)', error?.message);
    return '### SHAKTI SAHAYATA AI\n\n⚠️ AI crime analysis unavailable — Ollama is offline.';
  }

  if (!response.ok) {
    throw new Error(`Ollama Analysis Error: ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  const content = String(data?.message?.content || '').trim();
  return content.startsWith('### SHAKTI SAHAYATA AI') ? content : `### SHAKTI SAHAYATA AI\n\n${content}`;
};
