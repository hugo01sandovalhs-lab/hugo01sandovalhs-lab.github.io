// Service worker minimal : app shell offline uniquement.
//
// Portée volontairement très restreinte : il ne fait rien d'autre
// qu'assurer que la page de base (index.html) reste disponible hors
// ligne. Il n'intercepte jamais :
// - les requêtes non-GET (mutations) ;
// - les requêtes vers une autre origine (Supabase Auth/RPC/Edge
//   Functions, API YouTube) — jamais mises en cache ici ;
// - les requêtes qui ne sont ni une navigation de document ni un fichier
//   haché sous /assets/ — elles restent gérées par le cache HTTP standard.
//
// Les fichiers /assets/* ont un nom contenant leur empreinte (immuables) :
// ils sont servis cache-d'abord et mis en cache à la première réponse 200,
// pour que le rechargement hors ligne retrouve aussi les chunks.
//
// Stratégie réseau-d'abord pour la navigation : en ligne, l'utilisateur
// reçoit toujours la dernière version d'index.html (donc les derniers
// chunks hashés) ; hors ligne, la version d'index.html mise en cache lors
// de la dernière visite réussie est servie à la place d'une page d'erreur
// du navigateur.

const SHELL_CACHE = 'crs-atlas-shell-v1'
const SHELL_URL = './index.html'
const ASSET_CACHE = 'crs-atlas-assets-v1'
const ASSET_MAX = 400

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)).catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode !== 'navigate') {
    if (!url.pathname.includes('/assets/')) return
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((response) => {
              if (response.ok) {
                cache.put(request, response.clone())
                // ponytail: FIFO trim, pas de purge par version
                cache.keys().then((keys) => keys.slice(0, Math.max(0, keys.length - ASSET_MAX)).forEach((k) => cache.delete(k)))
              }
              return response
            }),
        ),
      ),
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Seule une réponse 200 remplace le shell hors ligne : une page d'erreur serveur ne doit jamais l'écraser.
        if (response.ok) {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {})
        }
        return response
      })
      .catch(() => caches.match(SHELL_URL).then((cached) => cached || Response.error())),
  )
})
