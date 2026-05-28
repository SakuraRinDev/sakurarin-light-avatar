const { sendMcp, sendMcpManifest } = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  if (req.query?.manifest === '1') {
    sendMcpManifest(req, res);
    return;
  }
  sendMcp(req, res);
};
