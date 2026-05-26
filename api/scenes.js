const { readJson } = require('./_shared');

module.exports = function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true, scenes: readJson('scenes.json') });
};
