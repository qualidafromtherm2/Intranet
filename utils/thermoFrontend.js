const fs = require('fs');
const path = require('path');
const express = require('express');

function mountThermoFrontend(app, options = {}) {
  const enabled = options.enabled === true;
  const distRoot = options.distRoot;
  const requireSession = options.requireSession || ((_req, _res, next) => next());

  if (!enabled) return { enabled: false, mounted: false };

  const indexPath = path.join(distRoot, 'index.html');
  if (!fs.existsSync(indexPath)) {
    app.get(['/thermo', '/thermo/*'], requireSession, (_req, res) => {
      res.status(503).send('Thermo frontend indisponível: build não encontrado.');
    });
    return { enabled: true, mounted: false };
  }

  app.use('/thermo', requireSession, express.static(distRoot, {
    dotfiles: 'deny',
    etag: true,
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  app.get(['/thermo', '/thermo/*'], requireSession, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexPath);
  });

  return { enabled: true, mounted: true };
}

module.exports = { mountThermoFrontend };
