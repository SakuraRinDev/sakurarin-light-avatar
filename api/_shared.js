const fs = require('fs');
const path = require('path');
const { askOpenAI, DEFAULT_MODEL } = require('../openai-dialogue');
const { cleanQueryPart, createSearchSubtitle, searchGoogle } = require('../google-search');
const { createMcpManifest, listMcpTools, loadMcpServers, matchMcpTools } = require('../mcp-registry');
const { normalizeContacts } = require('../phonebook');
const { sanitizeLocation } = require('../location-context');
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
const { loadSkills } = require('../skill-router');
const { decideSearchAfterReply } = require('../search-router');
const { getUsageSummary } = require('../usage-monitor');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function safeText(value, fallback = '') {
  return String(value || fallback).trim().slice(0, 240);
}

function safeCharacter(value) {
  return value === 'moko' ? 'moko' : 'poka';
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

function wantsDebug(req) {
  return Boolean(req.body?.debug || req.query?.debug === '1' || process.env.SEARCH_DEBUG === '1');
}

function createSearchDebug({ message, provider, search, searchDecision, skill, error }) {
  const decision = searchDecision || search?.decision || null;
  return {
    message,
    draftReply: decision?.draftReply || '',
    provider,
    skillId: skill?.id || '',
    hasSearch: Boolean(search),
    resultCount: Array.isArray(search?.results) ? search.results.length : 0,
    decision,
    error: error?.message || '',
  };
}

async function sendDialogue(req, res) {
  const scenes = readJson('scenes.json');
  const message = safeText(req.body && req.body.message, 'こんにちは');
  const character = safeCharacter(req.body && req.body.character);
  const scene = pickReply(message, scenes) || scenes[0];
  let subtitle = '';
  let provider = 'openai-api';
  let model = DEFAULT_MODEL;
  let search = null;
  let searchDecision = null;
  let dialogueError = null;
  let skill = routeSkill(message);
  let mcp = matchMcpTools(message);
  const location = sanitizeLocation(req.body && req.body.location);
  try {
    const reply = await askOpenAI(message, { cwd: rootDir, location, character });
    subtitle = reply.subtitle;
    provider = reply.provider || provider;
    model = reply.model;
    search = reply.search || null;
    searchDecision = reply.searchDecision || search?.decision || null;
    skill = reply.skill || skill;
    mcp = reply.mcp || mcp;
  } catch (error) {
    dialogueError = error;
    provider = 'scripted-fallback';
    const draftSubtitle =
      message.length > 0
        ? `${scene.subtitle} 「${message}」って言われたので、今ちょっと張り切っています。`
        : scene.subtitle;
    const fallbackDecision = await decideSearchAfterReply(message, draftSubtitle);
    searchDecision = fallbackDecision;
    if (fallbackDecision.needsSearch) {
      try {
        search = await searchGoogle(fallbackDecision.query, { limit: 4 });
      } catch (searchError) {
        search = {
          provider: 'google-search-ts',
          query: fallbackDecision.query,
          searchUrl: `https://www.google.com/search?q=${encodeURIComponent(fallbackDecision.query)}`,
          results: [],
          error: searchError.message || 'Google search failed',
        };
      }
      search.decision = fallbackDecision;
      subtitle = createSearchSubtitle(search);
      provider = 'google-search';
    }
  }
  if (!subtitle) {
    subtitle =
      message.length > 0
        ? `${scene.subtitle} 「${message}」って言われたので、今ちょっと張り切っています。`
        : scene.subtitle;
  }
  const searchDebug = createSearchDebug({ message, provider, search, searchDecision, skill, error: dialogueError });
  const responsePayload = {
    ok: true,
    provider,
    model: provider === 'openai-api' ? model : null,
    sessionId: safeText(req.body && req.body.sessionId, `sess_${Date.now()}`),
    character,
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
    mcp,
    location,
  };
  if (wantsDebug(req)) responsePayload.debug = { searchRouting: searchDebug };

  const event = createConversationEvent({
    sessionId: responsePayload.sessionId,
    userMessage: message,
    assistantMessage: subtitle,
    character,
    provider,
    model: responsePayload.model,
    status: responsePayload.reply.status,
    search,
    searchDebug,
    skill,
    mcp,
    location,
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

async function sendSearchDebug(req, res) {
  try {
    const limit = req.method === 'GET' ? req.query?.limit : req.body?.limit;
    const events = await listConversationEvents(limit || 30);
    const debug = events
      .filter((event) => event.searchDebug || event.search)
      .map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        sessionId: event.sessionId,
        provider: event.provider,
        searchDebug: event.searchDebug || null,
        search: event.search || null,
      }));
    res.status(200).json({ ok: true, provider: storageProvider(), count: debug.length, debug });
  } catch (error) {
    res.status(500).json({
      ok: false,
      provider: storageProvider(),
      error: error.message || 'failed to read search debug log',
    });
  }
}

async function sendUsage(req, res) {
  try {
    const limit = req.method === 'GET' ? req.query?.limit : req.body?.limit;
    const usage = await getUsageSummary(limit || 200);
    res.status(200).json(usage);
  } catch (error) {
    res.status(500).json({
      ok: false,
      provider: storageProvider(),
      error: error.message || 'failed to read usage summary',
    });
  }
}

function sendSkills(req, res) {
  const message = req.method === 'GET' ? req.query?.q : req.body?.message;
  res.status(200).json({
    ok: true,
    count: loadSkills().length,
    skills: loadSkills(),
    route: message ? routeSkill(message) : null,
  });
}

function sendMcp(req, res) {
  const message = req.method === 'GET' ? req.query?.q : req.body?.message;
  res.status(200).json({
    ok: true,
    protocol: 'mcp-compatible-registry',
    servers: loadMcpServers(),
    tools: listMcpTools(),
    matches: message ? matchMcpTools(message) : [],
  });
}

function sendMcpManifest(req, res) {
  res.status(200).json({ ok: true, manifest: createMcpManifest() });
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
  sendMcp,
  sendMcpManifest,
  sendSearch,
  sendSearchDebug,
  sendSkills,
  sendUsage,
};
