/**
 * Trabajador de servicio: hace que la página aguante una red mala.
 *
 * En un evento con cientos de personas en el mismo lugar, la antena se satura
 * y las cargas se cortan. Con esto, quien ya abrió la página una vez la vuelve
 * a abrir aunque la red esté intermitente: lo único que necesita red es la
 * consulta del estado de la rifa, que son unos cuantos bytes.
 */
const CACHE = 'rifa-v3';
// Solo lo mínimo para pintar el boleto. La librería de Supabase NO va aquí a
// propósito: `addAll` falla entero si un archivo falla, y pedir 215 KB en una
// red mala haría que la instalación se cayera y el teléfono se quedara sin
// copia de nada. Esa librería se guarda sola cuando se descarga.
const BASICOS = [
  './',
  'index.html',
  'assets/estilos.css',
  'assets/config.js',
  'assets/app.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(BASICOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

/** Guarda una copia sin romper nada si el navegador se queda sin espacio. */
function guardar(peticion, respuesta) {
  if (!respuesta || !respuesta.ok) { return respuesta; }
  const copia = respuesta.clone();
  caches.open(CACHE).then((cache) => cache.put(peticion, copia)).catch(() => {});
  return respuesta;
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo se administra lo propio del sitio. Las consultas a Supabase y las
  // tipografías van directo a la red: nunca se sirven de caché.
  if (peticion.method !== 'GET') { return; }
  if (new URL(peticion.url).origin !== self.location.origin) { return; }

  // La página: primero la red (para que un arreglo llegue enseguida), y si la
  // red falla o tarda, la copia guardada.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(peticion)
        .then((r) => guardar(peticion, r))
        .catch(() => caches.match(peticion).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Lo demás: se sirve la copia al instante y se actualiza por detrás.
  evento.respondWith(
    caches.match(peticion).then((guardada) => {
      const desdeRed = fetch(peticion).then((r) => guardar(peticion, r)).catch(() => guardada);
      return guardada || desdeRed;
    })
  );
});
