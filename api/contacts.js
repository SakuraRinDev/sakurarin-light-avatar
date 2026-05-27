const { sendContacts } = require('./_shared');

module.exports = function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  sendContacts(req, res);
};
