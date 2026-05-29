const fs = require('fs');
const path = require('path');

const STORAGE_KEY = 'poka:conversation-events';
const LOCAL_LOG = path.join(__dirname, 'data', 'conversation-events.jsonl');

function hasRedisEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function storageProvider() {
  if (hasRedisEnv()) return 'vercel-kv-rest';
  return 'local-jsonl';
}

function createConversationEvent(input) {
  const now = new Date().toISOString();
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    sessionId: safeText(input.sessionId, `sess_${Date.now()}`, 80),
    userMessage: safeText(input.userMessage, '', 1000),
    assistantMessage: safeText(input.assistantMessage, '', 1000),
    provider: safeText(input.provider, 'unknown', 80),
    model: safeText(input.model, '', 120),
    status: safeText(input.status, '', 120),
    search: input.search
      ? {
          provider: safeText(input.search.provider, '', 80),
          mode: safeText(input.search.mode, '', 80),
          query: safeText(input.search.query, '', 240),
          resultCount: Array.isArray(input.search.results) ? input.search.results.length : 0,
          decision: input.search.decision || null,
      }
      : null,
    searchDebug: input.searchDebug
      ? {
          message: safeText(input.searchDebug.message, '', 500),
          draftReply: safeText(input.searchDebug.draftReply, '', 500),
          provider: safeText(input.searchDebug.provider, '', 80),
          skillId: safeText(input.searchDebug.skillId, '', 80),
          hasSearch: Boolean(input.searchDebug.hasSearch),
          resultCount: Number(input.searchDebug.resultCount || 0),
          decision: input.searchDebug.decision || null,
          error: safeText(input.searchDebug.error, '', 240),
        }
      : null,
    skill: input.skill
      ? {
          id: safeText(input.skill.id, '', 80),
          title: safeText(input.skill.title, '', 120),
          score: Number(input.skill.score || 0),
        }
      : null,
    location: input.location
      ? {
          latitude: Number(input.location.latitude),
          longitude: Number(input.location.longitude),
          accuracy: input.location.accuracy === null ? null : Number(input.location.accuracy),
        }
      : null,
  };
}

function safeText(value, fallback = '', max = 240) {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function persistConversationEvent(event) {
  if (hasRedisEnv()) {
    await redisCommand(['LPUSH', STORAGE_KEY, JSON.stringify(event)]);
    await redisCommand(['LTRIM', STORAGE_KEY, '0', String(Number(process.env.CONVERSATION_LOG_LIMIT || 200) - 1)]);
    return { stored: true, provider: 'vercel-kv-rest', id: event.id };
  }

  fs.mkdirSync(path.dirname(LOCAL_LOG), { recursive: true });
  fs.appendFileSync(LOCAL_LOG, `${JSON.stringify(event)}\n`);
  return { stored: true, provider: 'local-jsonl', id: event.id };
}

async function listConversationEvents(limit = 30) {
  const capped = Math.max(1, Math.min(Number(limit || 30), 100));
  if (hasRedisEnv()) {
    const data = await redisCommand(['LRANGE', STORAGE_KEY, '0', String(capped - 1)]);
    return (data.result || []).map((line) => JSON.parse(line));
  }

  if (!fs.existsSync(LOCAL_LOG)) return [];
  const lines = fs.readFileSync(LOCAL_LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-capped).reverse().map((line) => JSON.parse(line));
}

async function redisCommand(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `KV REST error ${response.status}`);
  }
  return data;
}

module.exports = {
  createConversationEvent,
  listConversationEvents,
  persistConversationEvent,
  storageProvider,
};
