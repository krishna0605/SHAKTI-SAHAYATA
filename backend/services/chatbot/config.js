const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

export const OLLAMA_BASE_URL = normalizeUrl(
  process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://localhost:11434'
);
export const OLLAMA_URL = OLLAMA_BASE_URL;
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3.5';
export const OLLAMA_CHAT_NUM_PREDICT = Number(process.env.OLLAMA_CHAT_NUM_PREDICT || 160);
export const OLLAMA_SQL_NUM_PREDICT = Number(process.env.OLLAMA_SQL_NUM_PREDICT || 128);
export const OLLAMA_ANALYSIS_NUM_PREDICT = Number(process.env.OLLAMA_ANALYSIS_NUM_PREDICT || 224);
export const MODEL_HISTORY_LIMIT = Number(process.env.CHATBOT_HISTORY_LIMIT || 4);
export const SCHEMA_CACHE_TTL_MS = Number(process.env.CHATBOT_SCHEMA_CACHE_TTL_MS || 5 * 60 * 1000);
export const CHATBOT_MAX_MESSAGE_LENGTH = Number(process.env.CHATBOT_MAX_MESSAGE_LENGTH || 4000);
export const CHATBOT_SESSION_MAX_MESSAGES = Number(process.env.CHATBOT_SESSION_MAX_MESSAGES || 5);
export const CHATBOT_SESSION_TTL_MS = Number(process.env.CHATBOT_SESSION_TTL_MS || 30 * 60 * 1000);
export const CHATBOT_SESSION_STATE_TTL_MS = Number(process.env.CHATBOT_SESSION_STATE_TTL_MS || 30 * 60 * 1000);
export const CHATBOT_DB_QUERY_TIMEOUT_MS = Number(process.env.CHATBOT_DB_QUERY_TIMEOUT_MS || 5000);
export const CHATBOT_DB_MAX_ROWS = Number(process.env.CHATBOT_DB_MAX_ROWS || 100);
export const CHATBOT_STREAMING_ENABLED = String(process.env.CHATBOT_STREAMING_ENABLED || '').trim().toLowerCase() !== 'false';
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT || 120000);
export const CHATBOT_RAG_MAX_CHARS = Number(process.env.CHATBOT_RAG_MAX_CHARS || 1800);
export const CHATBOT_CASE_PROMPT_MAX_CHARS = Number(process.env.CHATBOT_CASE_PROMPT_MAX_CHARS || 4200);

export const getOllamaRuntimeConfig = () => ({
  baseUrl: OLLAMA_BASE_URL,
  model: OLLAMA_MODEL,
  chatNumPredict: OLLAMA_CHAT_NUM_PREDICT,
  source: process.env.OLLAMA_BASE_URL ? 'OLLAMA_BASE_URL' : (process.env.OLLAMA_URL ? 'OLLAMA_URL' : 'default'),
});
