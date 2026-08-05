// sw.js — Service worker: deixa o app abrir offline (casca/shell em cache).
// Os DADOS sincronizam pela fila do store.js; aqui só cuidamos dos estáticos.
//
// DISCIPLINA: bump no CACHE (v1 → v2 → …) A CADA deploy, senão os aparelhos
// ficam presos na versão antiga.
const CACHE = 'brief-shell-v48';
const SHELL = [
  './', 'index.html', 'config.js', 'store.js', 'auth.js', 'app.js', 'pdf.js', 'prancha.js', 'styles.css', 'sw.js',
  'manifest.webmanifest', 'logo-impresilk.png', 'logo-impresilk-branco.png',
  'libs/jspdf.umd.min.js', 'libs/pdf-assets.js', 'libs/zip.js',
  'fonts/Poppins-500.woff2', 'fonts/Poppins-600.woff2', 'fonts/Poppins-700.woff2',
  'fonts/Spectral-400.woff2', 'fonts/Spectral-600.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Assets locais (core): addAll — se algum falhar, o install aborta e o
    // cache da versão anterior (íntegro) continua valendo.
    // CDN: allSettled — falha de rede externa não bloqueia a instalação.
    const core = SHELL.filter(u => !u.startsWith('http'));
    const cdn  = SHELL.filter(u => u.startsWith('http'));
    // cache:'reload' por arquivo: sem isto o SW guarda o que estava no cache
    // HTTP do navegador (o Pages manda max-age=600) e passa a SERVIR a versão
    // velha até o próximo bump — a equipe não recebe a correção recém-publicada.
    await c.addAll(core.map(u => new Request(u, { cache: 'reload' })));
    await Promise.allSettled(cdn.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Nunca cachear a API: o dado tem que ser o do momento (offline é a fila do
  // store.js que resolve). O backend é o Supabase.
  //
  // A regra do Netlify saiu em 04/08/2026: os sites do Netlify foram apagados
  // e este app passou a morar no GitHub Pages, então o caminho
  // /.netlify/functions/ não existe mais em lugar nenhum. Linha morta em
  // arquivo de cache confunde: dá a impressão de que ainda há um backend lá.
  if (url.hostname.endsWith('supabase.co')) return;

  // Network-first: online pega a versão nova e atualiza o cache; offline cai no cache.
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && url.origin === location.origin) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        return (await caches.match('index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
