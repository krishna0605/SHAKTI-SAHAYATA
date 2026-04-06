import { randomUUID } from 'crypto';
import {
  CHATBOT_SESSION_MAX_MESSAGES,
  CHATBOT_SESSION_TTL_MS,
  CHATBOT_SESSION_STATE_TTL_MS
} from './config.js';

const sessions = new Map();
let lastCleanupAt = 0;

const maybeCleanupExpiredSessions = () => {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 1000) return;
  lastCleanupAt = now;

  for (const [id, session] of sessions.entries()) {
    if (now - session.updatedAt > CHATBOT_SESSION_TTL_MS) sessions.delete(id);
  }
};

const maybeClearStaleState = (session) => {
  const ttl = Number(CHATBOT_SESSION_STATE_TTL_MS || 0);
  if (!ttl || !session?.stateUpdatedAt) return;
  if (Date.now() - session.stateUpdatedAt > ttl) {
    session.state = {};
    session.stateUpdatedAt = Date.now();
  }
};

const touchSession = (id) => {
  const session = sessions.get(id);
  if (!session) return;
  session.updatedAt = Date.now();
  if (session.history.length > CHATBOT_SESSION_MAX_MESSAGES) {
    session.history = session.history.slice(-CHATBOT_SESSION_MAX_MESSAGES);
  }
  maybeClearStaleState(session);
  sessions.set(id, session);
};

export const getSession = (sessionId) => {
  maybeCleanupExpiredSessions();

  if (sessionId && sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (Date.now() - existing.updatedAt <= CHATBOT_SESSION_TTL_MS) {
      maybeClearStaleState(existing);
      touchSession(sessionId);
      return { id: sessionId, history: existing.history, state: existing.state || {} };
    }
    sessions.delete(sessionId);
  }

  const id = randomUUID();
  const now = Date.now();
  sessions.set(id, { history: [], state: {}, updatedAt: now, createdAt: now, stateUpdatedAt: now });
  return { id, history: sessions.get(id).history, state: sessions.get(id).state };
};

export const touchSessionById = (sessionId) => {
  if (!sessionId || !sessions.has(sessionId)) return;
  touchSession(sessionId);
};

export const clearSession = (sessionId) => {
  if (!sessionId) return false;
  return sessions.delete(sessionId);
};

export const getSessionMeta = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.history.length,
    state: session.state || {}
  };
};

export const updateSessionState = (sessionId, patch = {}) => {
  if (!sessionId || !sessions.has(sessionId) || typeof patch !== 'object' || !patch) return;
  const session = sessions.get(sessionId);
  session.state = { ...(session.state || {}), ...patch };
  session.stateUpdatedAt = Date.now();
  sessions.set(sessionId, session);
  touchSession(sessionId);
};
