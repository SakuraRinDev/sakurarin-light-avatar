const fs = require('fs');
const path = require('path');

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

function sendDialogue(req, res) {
  const scenes = readJson('scenes.json');
  const message = safeText(req.body && req.body.message, 'こんにちは');
  const scene = pickReply(message, scenes) || scenes[0];
  res.status(200).json({
    ok: true,
    provider: 'scripted-vercel',
    sessionId: safeText(req.body && req.body.sessionId, `sess_${Date.now()}`),
    reply: {
      ...scene,
      subtitle:
        message.length > 0
          ? `${scene.subtitle} 「${message}」って言われたので、今ちょっと張り切っています。`
          : scene.subtitle,
    },
  });
}

module.exports = {
  pickReply,
  readJson,
  safeText,
  sendDialogue,
};
