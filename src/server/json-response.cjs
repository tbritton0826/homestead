const { promisify } = require('node:util');
const { gzip } = require('node:zlib');
const compress = promisify(gzip);

// Serialize the already-authorized response only. Never share user-filtered data.
async function sendIndexJson(req, res, data) {
  const body = JSON.stringify(data);
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Accept-Encoding');
  res.type('application/json');
  if (body.length >= 1024 && req.acceptsEncodings('gzip')) {
    const compressed = await compress(body, { level: 1 });
    res.setHeader('Content-Encoding', 'gzip');
    return res.send(compressed);
  }
  return res.send(body);
}

module.exports = { sendIndexJson };
