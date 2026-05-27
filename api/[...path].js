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

module.exports = async function handler(req, res) {
  const experience = readJson('experience.json');
  const scenes = readJson('scenes.json');
  const route = `/${(req.query.path || []).join('/')}`;

  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET' && route === '/health') {
    res.status(200).json({
      ok: true,
      service: 'sakurarin-light-avatar',
      audio: experience.audio.enabled,
      subtitles: true,
      serverRole: experience.modelPlan.serverRole,
      dialogueProvider: process.env.OPENAI_API_KEY ? 'openai-api' : 'scripted-fallback',
      searchProvider: 'google-search-ts',
      searchRouter: 'ai-sdk-structured-output',
      phonebook: true,
      persistenceProvider: storageProvider(),
      feedback: true,
      model: process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || DEFAULT_MODEL) : null,
    });
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && route === '/search') {
    try {
      const query = cleanQueryPart((req.method === 'GET' ? req.query?.q : req.body?.query || req.body?.q) || '');
      const payload = await searchGoogle(query, { limit: 5 });
      res.status(200).json({ ok: true, ...payload });
    } catch (error) {
      res.status(502).json({
        ok: false,
        provider: 'google-search-ts',
        error: error.message || 'Google search failed',
      });
    }
    return;
  }

  if (req.method === 'GET' && route === '/experience') {
    res.status(200).json({ ok: true, experience });
    return;
  }

  if (req.method === 'GET' && route === '/scenes') {
    res.status(200).json({ ok: true, scenes });
    return;
  }

  if (req.method === 'GET' && route === '/contacts') {
    res.status(200).json({
      ok: true,
      source: 'local-demo-vcard-schemaorg',
      formatBasis: ['vCard RFC 6350', 'schema.org Person/ContactPoint'],
      validator: 'libphonenumber-js',
      contacts: normalizeContacts(readJson('contacts.json')),
    });
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && route === '/conversations') {
    try {
      const limit = req.method === 'GET' ? req.query?.limit : req.body?.limit;
      const events = await listConversationEvents(limit || 30);
      res.status(200).json({ ok: true, provider: storageProvider(), count: events.length, events });
    } catch (error) {
      res.status(500).json({ ok: false, provider: storageProvider(), error: error.message || 'failed to read conversation log' });
    }
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && route === '/feedback') {
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
      const feedback = await listFeedbackEvents(req.query?.limit || 30);
      res.status(200).json({ ok: true, provider: feedbackStorageProvider(), count: feedback.length, feedback });
    } catch (error) {
      res.status(500).json({
        ok: false,
        provider: feedbackStorageProvider(),
        error: error.message || 'failed to read feedback',
      });
    }
    return;
  }

  if (req.method === 'POST' && route === '/session') {
    res.status(201).json({ ok: true, sessionId: `sess_${Date.now()}`, scene: scenes[0] });
    return;
  }

  if (req.method === 'POST' && (route === '/chat' || route === '/dialogue')) {
    const message = safeText(req.body && req.body.message, 'こんにちは');
    const scene = pickReply(message, scenes) || scenes[0];
    let subtitle = '';
    let provider = 'openai-api';
    let model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
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
    } catch (persistError) {
      responsePayload.persistence = {
        stored: false,
        provider: storageProvider(),
        error: persistError.message || 'conversation persistence failed',
      };
    }
    res.status(200).json(responsePayload);
    return;
  }

  if (req.method === 'POST' && route === '/reaction') {
    res.status(201).json({ ok: true, id: `rxn_${Date.now()}`, stored: false });
    return;
  }

  res.status(404).json({ ok: false, error: 'api route not found' });
};
