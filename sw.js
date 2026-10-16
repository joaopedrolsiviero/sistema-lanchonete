// Service worker: guarda os arquivos do sistema para funcionar sem internet.
// Ao alterar qualquer arquivo, aumente a versão abaixo para os navegadores baixarem a atualização.
const VERSAO = 'recanto-v6';
const ARQUIVOS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/ui.js',
  'js/util.js',
  'js/store.js',
  'js/persistencia.js',
  'js/backupAuto.js',
  'js/views/pdv.js',
  'js/views/caixa.js',
  'js/views/cardapio.js',
  'js/views/estoque.js',
  'js/views/relatorios.js',
  'js/views/ajustes.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (pega atualizações), cache se estiver sem internet.
self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(ev.request, copia));
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true })),
  );
});
