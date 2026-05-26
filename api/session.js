const { readJson } = require('./_shared');

module.exports = function handler(req, res) {
  const scenes = readJson('scenes.json');
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  res.status(201).json({ ok: true, sessionId: `sess_${Date.now()}`, scene: scenes[0] });
};
