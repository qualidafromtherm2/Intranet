#!/usr/bin/env node
/**
 * Proxy local 3001 → 5001
 * Mantém o bookmark localhost:3001 funcionando enquanto a API roda na 5001.
 */
const http = require('http');

const LISTEN_PORT = Number(process.env.PROXY_PORT || 3001);
const TARGET_HOST = process.env.PROXY_TARGET_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.PROXY_TARGET_PORT || 5001);

const server = http.createServer((req, res) => {
  const opts = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` }
  };
  const proxy = http.request(opts, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `Proxy ${LISTEN_PORT}→${TARGET_PORT}: intranet_api offline.\n` +
      `Rode: pm2 restart intranet_api\n` +
      String(err.message || err)
    );
  });
  req.pipe(proxy);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[proxy] http://0.0.0.0:${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
});
