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

function injectLegacyThermoSwitch(html, enabled) {
  if (!enabled || html.includes('id="thermo-ui-switch"')) return html;

  const switchMarkup = `
  <a id="thermo-ui-switch"
     href="/thermo/"
     title="Experimentar a nova interface Thermo"
     aria-label="Usar interface Thermo"
     style="display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border:1px solid rgba(255,255,255,.28);border-radius:9px;color:inherit;text-decoration:none;font-size:13px;font-weight:700;white-space:nowrap;">
    Usar Thermo
  </a>
`;

  if (html.includes('  <!-- Ícones da direita -->')) {
    return html.replace('  <!-- Ícones da direita -->', `${switchMarkup}\n  <!-- Ícones da direita -->`);
  }
  // Fallback se o comentário sumir no HTML
  if (html.includes('<div class="header-profile">')) {
    return html.replace('<div class="header-profile">', `${switchMarkup}\n  <div class="header-profile">`);
  }
  return html;
}

module.exports = { injectLegacyThermoSwitch, mountThermoFrontend };
