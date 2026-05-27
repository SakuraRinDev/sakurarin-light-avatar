const fs = require('fs');
const path = require('path');
const { askOpenAI, DEFAULT_MODEL } = require('../openai-dialogue');
const { cleanQueryPart, searchGoogle } = require('../google-search');
const { normalizeContacts } = require('../phonebook');
const {
  createConversationEvent,
  listConversationEvents,
  persistConversationEvent,
  storageProvider,
} = require('../conversation-store');
const {
  createFeedbackEvent,
  listFeedbackEvents,
  persistFeedbackEvent,
  storageProvider: feedbackStorageProvider,
} = require('../feedback-store');
const { routeSkill } = require('../skill-router');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function safeText(value, fallback = '') {
  return String(value || fallback).trim().slice(0, 240);
}

function pickReply(message, scenes) {
  const text = message.toLowerCase();
  if (text.includes('かわいい') || text.includes('いいね')) return scenes.find((scene) => scene.id === 'spark');
  if (text.includes('まぶ') || text.includes('明る')) return scenes.find((scene) => scene.id === 'slip');
  if (text.includes('なに') || text.includes('何') || text.includes('?') || text.includes('？')) {
    return scenes.find((scene) => scene.id === 'thinking');
  }
  return scenes[Math.floor(Math.random() * scenes.length)];
}

async function sendDialogue(req, res) {
  const scenes = readJson('scenes.json');
  const message = safeText(req.body && req.body.message, 'こんにちは');
  const scene = pickReply(message, scenes) || scenes[0];
  let subtitle = '';
  let provider = 'openai-api';
  let model = DEFAULT_MODEL;
  let search = null;
  let skill = routeSkill(message);
  try {
    const reply = await askOpenAI(message, { cwd: rootDir });
    subtitle = reply.subtitle;
    provider = reply.provider || provider;
    model = reply.model;
    search = reply.search || null;
    skill = reply.skill || skill;
  } catch (error) {
    provider = 'scripted-fallback';
  }
  if (!subtitle) {
    subtitle =
      message.length > 0
        ? `${scene.subtitle} 「${message}」って言われたので、今ちょっと張り切っています。`
        : scene.subtitle;
  }
  const responsePayload = {
    ok: true,
    provider,
    model: provider === 'openai-api' ? model : null,
    sessionId: safeText(req.body && req.body.sessionId, `sess_${Date.now()}`),
    reply: {
      ...scene,
      status:
        provider === 'google-search'
          ? 'Google検索から返事中'
          : provider === 'openai-api'
          ? 'OpenAIから返事中'
          : scene.status,
      subtitle,
    },
    search,
    skill,
  };

  const event = createConversationEvent({
    sessionId: responsePayload.sessionId,
    userMessage: message,
    assistantMessage: subtitle,
    provider,
    model: responsePayload.model,
    status: responsePayload.reply.status,
    search,
    skill,
  });
  try {
    responsePayload.persistence = await persistConversationEvent(event);
  } catch (error) {
    responsePayload.persistence = {
      stored: false,
      provider: storageProvider(),
      error: error.message || 'conversation persistence failed',
    };
  }

  res.status(200).json(responsePayload);
}

async function sendSearch(req, res) {
  const query = cleanQueryPart((req.method === 'GET' ? req.query?.q : req.body?.query || req.body?.q) || '');
  try {
    const payload = await searchGoogle(query, { limit: 5 });
    res.status(200).json({ ok: true, ...payload });
  } catch (error) {
    res.status(502).json({
      ok: false,
      provider: 'google-search-ts',
      error: error.message || 'Google search failed',
    });
  }
}

function sendContacts(req, res) {
  const contacts = normalizeContacts(readJson('contacts.json'));
  res.status(200).json({
    ok: true,
    source: 'local-demo-vcard-schemaorg',
    formatBasis: ['vCard RFC 6350', 'schema.org Person/ContactPoint'],
    validator: 'libphonenumber-js',
    contacts,
  });
}

async function sendConversationLog(req, res) {
  try {
    const limit = req.method === 'GET' ? req.query?.limit : req.body?.limit;
    const events = await listConversationEvents(limit || 30);
    res.status(200).json({
      ok: true,
      provider: storageProvider(),
      count: events.length,
      events,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      provider: storageProvider(),
      error: error.message || 'failed to read conversation log',
    });
  }
}

async function sendFeedback(req, res) {
  if (req.method === 'POST') {
    try {
      const event = createFeedbackEvent({
        sessionId: req.body?.sessionId,
        category: req.body?.category,
        message: req.body?.message,
        page: req.body?.page,
        userAgent: req.headers['user-agent'],
      });
      const persistence = await persistFeedbackEvent(event);
      res.status(201).json({ ok: true, feedback: event, persistence });
    } catch (error) {
      res.status(400).json({
        ok: false,
        provider: feedbackStorageProvider(),
        error: error.message || 'failed to store feedback',
      });
    }
    return;
  }

  try {
    const limit = req.query?.limit;
    const feedback = await listFeedbackEvents(limit || 30);
    res.status(200).json({
      ok: true,
      provider: feedbackStorageProvider(),
      count: feedback.length,
      feedback,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      provider: feedbackStorageProvider(),
      error: error.message || 'failed to read feedback',
    });
  }
}

module.exports = {
  pickReply,
  readJson,
  safeText,
  sendContacts,
  sendConversationLog,
  sendDialogue,
  sendFeedback,
  sendSearch,
};
