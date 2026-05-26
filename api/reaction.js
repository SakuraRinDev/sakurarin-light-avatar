module.exports = function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  res.status(201).json({ ok: true, id: `rxn_${Date.now()}`, stored: false });
};
