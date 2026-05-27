const fs = require('fs');
const path = require('path');
const { askOpenAI, DEFAULT_MODEL } = require('../openai-dialogue');
const { cleanQueryPart, searchGoogle } = require('../google-search');

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
    try {
      const reply = await askOpenAI(message, { cwd: rootDir });
      subtitle = reply.subtitle;
      model = reply.model;
      search = reply.search || null;
    } catch (error) {
      provider = 'scripted-fallback';
    }
    if (!subtitle) {
      subtitle =
        message.length > 0
          ? `${scene.subtitle} 「${message}」って言われたので、今ちょっと張り切っています。`
          : scene.subtitle;
    }
    res.status(200).json({
      ok: true,
      provider,
      model,
      sessionId: safeText(req.body && req.body.sessionId, `sess_${Date.now()}`),
      reply: {
        ...scene,
        status: provider === 'openai-api' ? 'OpenAIから返事中' : scene.status,
        subtitle,
      },
      search,
    });
    return;
  }

  if (req.method === 'POST' && route === '/reaction') {
    res.status(201).json({ ok: true, id: `rxn_${Date.now()}`, stored: false });
    return;
  }

  res.status(404).json({ ok: false, error: 'api route not found' });
};
