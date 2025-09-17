self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
// Sem cache agressivo por enquanto para evitar tela desatualizada
