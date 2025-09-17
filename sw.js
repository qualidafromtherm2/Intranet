const SW_VERSION = 'pe-004';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.navigate(client.url); // recarrega aba com os arquivos novos
  })());
});


