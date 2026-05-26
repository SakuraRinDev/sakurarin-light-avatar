const { readJson } = require('./_shared');

module.exports = function handler(req, res) {
  const experience = readJson('experience.json');
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'sakurarin-light-avatar',
    audio: experience.audio.enabled,
    subtitles: true,
    serverRole: experience.modelPlan.serverRole,
    dialogueProvider: 'scripted-vercel',
  });
};
