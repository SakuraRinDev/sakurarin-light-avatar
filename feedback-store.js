const fs = require('fs');
const path = require('path');

const STORAGE_KEY = 'poka:feedback-events';
const LOCAL_LOG = path.join(__dirname, 'data', 'feedback-events.jsonl');

function hasRedisEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function storageProvider() {
  return hasRedisEnv() ? 'vercel-kv-rest' : 'local-jsonl';
}

function createFeedbackEvent(input) {
  return {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    sessionId: safeText(input.sessionId, `sess_${Date.now()}`, 80),
    category: normalizeCategory(input.category),
    message: safeText(input.message, '', 1200),
    page: safeText(input.page, '', 300),
    userAgent: safeText(input.userAgent, '', 300),
    status: 'new',
  };
}

function validateFeedbackEvent(event) {
  if (!event.message || event.message.length < 2) {
    throw new Error('feedback message is too short');
  }
}

async function persistFeedbackEvent(event) {
  validateFeedbackEvent(event);
  if (hasRedisEnv()) {
    await redisCommand(['LPUSH', STORAGE_KEY, JSON.stringify(event)]);
    await redisCommand(['LTRIM', STORAGE_KEY, '0', String(Number(process.env.FEEDBACK_LOG_LIMIT || 200) - 1)]);
    return { stored: true, provider: 'vercel-kv-rest', id: event.id };
  }

  fs.mkdirSync(path.dirname(LOCAL_LOG), { recursive: true });
  fs.appendFileSync(LOCAL_LOG, `${JSON.stringify(event)}\n`);
  return { stored: true, provider: 'local-jsonl', id: event.id };
}

async function listFeedbackEvents(limit = 30) {
  const capped = Math.max(1, Math.min(Number(limit || 30), 100));
  if (hasRedisEnv()) {
    const data = await redisCommand(['LRANGE', STORAGE_KEY, '0', String(capped - 1)]);
    return (data.result || []).map((line) => JSON.parse(line));
  }

  if (!fs.existsSync(LOCAL_LOG)) return [];
  const lines = fs.readFileSync(LOCAL_LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-capped).reverse().map((line) => JSON.parse(line));
}

function normalizeCategory(value) {
  const category = safeText(value, 'idea', 40);
  if (['bug', 'idea', 'request', 'call', 'other'].includes(category)) return category;
  return 'idea';
}

function safeText(value, fallback = '', max = 240) {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, max);
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
  createFeedbackEvent,
  listFeedbackEvents,
  persistFeedbackEvent,
  storageProvider,
};
