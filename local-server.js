const http = require('http');
const fs = require('fs');
const path = require('path');
const { CodexAppServerBridge } = require('./codex-bridge');
const { askOpenAI, DEFAULT_MODEL, loadLocalEnv } = require('./openai-dialogue');
const { cleanQueryPart, searchGoogle } = require('./google-search');
const { createMcpManifest, listMcpTools, loadMcpServers, matchMcpTools } = require('./mcp-registry');
const { normalizeContacts } = require('./phonebook');
const { sanitizeLocation } = require('./location-context');
const {
  createConversationEvent,
  listConversationEvents,
  persistConversationEvent,
  storageProvider,
} = require('./conversation-store');
const {
  createFeedbackEvent,
  listFeedbackEvents,
  persistFeedbackEvent,
  storageProvider: feedbackStorageProvider,
} = require('./feedback-store');
const { routeSkill } = require('./skill-router');
const { loadSkills } = require('./skill-router');

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const reactionsFile = path.join(dataDir, 'reactions.jsonl');
const port = Number(process.env.PORT || 5182);
const codexBridge = new CodexAppServerBridge({ cwd: rootDir });
loadLocalEnv(rootDir);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
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

function sceneForCodexReply(message, scenes) {
  const scene = pickReply(message, scenes) || scenes[0];
  return {
    ...scene,
    status: 'Codexから返事中',
    motion: scene.motion || 'wobble-small',
  };
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(rootDir, requested));
  if (!filePath.startsWith(rootDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(filePath) });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  const experience = readJson('experience.json');
  const scenes = readJson('scenes.json');

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'sakurarin-light-avatar',
      audio: experience.audio.enabled,
      subtitles: true,
      serverRole: experience.modelPlan.serverRole,
      dialogueProvider: process.env.OPENAI_API_KEY ? 'openai-api' : 'codex-app-server',
      searchProvider: 'google-search-ts',
      searchRouter: 'ai-sdk-structured-output',
      phonebook: true,
      persistenceProvider: storageProvider(),
      feedback: true,
      location: true,
      skills: true,
      mcp: true,
      model: process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || DEFAULT_MODEL) : null,
    });
    return true;
  }

  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/search') {
    try {
      let query = '';
      if (req.method === 'GET') {
        query = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '';
      } else {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        query = parsed.query || parsed.q || '';
      }
      const payload = await searchGoogle(cleanQueryPart(query), { limit: 5 });
      sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        provider: 'google-search-ts',
        error: error.message || 'Google search failed',
      });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/experience') {
    sendJson(res, 200, { ok: true, experience });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/scenes') {
    sendJson(res, 200, { ok: true, scenes });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/contacts') {
    const contacts = normalizeContacts(readJson('contacts.json'));
    sendJson(res, 200, {
      ok: true,
      source: 'local-demo-vcard-schemaorg',
      formatBasis: ['vCard RFC 6350', 'schema.org Person/ContactPoint'],
      validator: 'libphonenumber-js',
      contacts,
    });
    return true;
  }

  if ((req.method === 'GET' || req.method === 'POST') && (pathname === '/api/skills' || pathname === '/api/skills/route')) {
    let message = '';
    if (req.method === 'GET') {
      message = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '';
    } else {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      message = parsed.message || '';
    }
    sendJson(res, 200, {
      ok: true,
      count: loadSkills().length,
      skills: loadSkills(),
      route: message ? routeSkill(message) : null,
    });
    return true;
  }

  if ((req.method === 'GET' || req.method === 'POST') && (pathname === '/api/mcp' || pathname === '/api/mcp/route')) {
    if (req.method === 'GET' && new URL(req.url, `http://${req.headers.host}`).searchParams.get('manifest') === '1') {
      sendJson(res, 200, { ok: true, manifest: createMcpManifest() });
      return true;
    }
    let message = '';
    if (req.method === 'GET') {
      message = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '';
    } else {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      message = parsed.message || '';
    }
    sendJson(res, 200, {
      ok: true,
      protocol: 'mcp-compatible-registry',
      servers: loadMcpServers(),
      tools: listMcpTools(),
      matches: message ? matchMcpTools(message) : [],
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mcp/manifest') {
    sendJson(res, 200, { ok: true, manifest: createMcpManifest() });
    return true;
  }

  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/conversations') {
    try {
      let limit = 30;
      if (req.method === 'GET') {
        limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit') || 30;
      } else {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        limit = parsed.limit || 30;
      }
      const events = await listConversationEvents(limit);
      sendJson(res, 200, { ok: true, provider: storageProvider(), count: events.length, events });
    } catch (error) {
      sendJson(res, 500, { ok: false, provider: storageProvider(), error: error.message || 'failed to read conversation log' });
    }
    return true;
  }

  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/feedback') {
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        const event = createFeedbackEvent({
          sessionId: parsed.sessionId,
          category: parsed.category,
          message: parsed.message,
          page: parsed.page,
          userAgent: req.headers['user-agent'],
        });
        const persistence = await persistFeedbackEvent(event);
        sendJson(res, 201, { ok: true, feedback: event, persistence });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          provider: feedbackStorageProvider(),
          error: error.message || 'failed to store feedback',
        });
      }
      return true;
    }

    try {
      const limit = new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit') || 30;
      const feedback = await listFeedbackEvents(limit);
      sendJson(res, 200, { ok: true, provider: feedbackStorageProvider(), count: feedback.length, feedback });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        provider: feedbackStorageProvider(),
        error: error.message || 'failed to read feedback',
      });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/session') {
    sendJson(res, 201, {
      ok: true,
      sessionId: `sess_${Date.now()}`,
      scene: scenes[0],
    });
    return true;
  }

  if (req.method === 'POST' && (pathname === '/api/chat' || pathname === '/api/dialogue')) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      const message = safeText(parsed.message, 'こんにちは');
      const scene = sceneForCodexReply(message, scenes);
      let subtitle = '';
      let provider = 'openai-api';
      let model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
      let search = null;
      let skill = routeSkill(message);
      let mcp = matchMcpTools(message);
      const location = sanitizeLocation(parsed.location);
      try {
        const reply = await askOpenAI(message, { cwd: rootDir, location });
        subtitle = reply.subtitle;
        provider = reply.provider || provider;
        model = reply.model;
        search = reply.search || null;
        skill = reply.skill || skill;
        mcp = reply.mcp || mcp;
      } catch (error) {
        provider = 'codex-app-server';
        try {
          subtitle = await codexBridge.ask(message);
        } catch (codexError) {
          provider = 'scripted-fallback';
        }
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
        sessionId: safeText(parsed.sessionId, `sess_${Date.now()}`),
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
      const event = createConversationEvent({
        sessionId: responsePayload.sessionId,
        userMessage: message,
        assistantMessage: subtitle,
        provider,
        model: responsePayload.model,
        status: responsePayload.reply.status,
        search,
        skill,
        mcp,
        location,
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
      sendJson(res, 200, responsePayload);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'invalid request' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/reaction') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      const record = {
        id: `rxn_${Date.now()}`,
        createdAt: new Date().toISOString(),
        type: safeText(parsed.type, 'unknown'),
        value: safeText(parsed.value),
      };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(reactionsFile, `${JSON.stringify(record)}\n`);
      sendJson(res, 201, { ok: true, id: record.id, stored: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'invalid request' });
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url.pathname);
    if (!handled) sendJson(res, 404, { ok: false, error: 'api route not found' });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`SakuraRin Light Avatar running at http://127.0.0.1:${port}`);
});
