const { readJson } = require('./_shared');
const { DEFAULT_MODEL } = require('../openai-dialogue');
const { storageProvider } = require('../conversation-store');

module.exports = function handler(req, res) {
  const experience = readJson('experience.json');
  res.setHeader('cache-control', 'no-store');
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
};
