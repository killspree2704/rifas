/**
 * Trabajador de servicio: hace que la página aguante una red mala.
 *
 * En un evento con cientos de personas en el mismo lugar la antena se satura
 * y las cargas se cortan. La regla aquí es simple: **si la página ya se abrió
 * una vez en este teléfono, se vuelve a abrir al instante, sin pedirle
 * permiso a la red**. Lo único que necesita conexión es consultar el estado
 * de la rifa, que son unos cuantos bytes.
 */
const CACHE = 'rifa-v5';

// Solo lo mínimo para pintar el boleto. La librería de Supabase NO va aquí a
// propósito: son 215 KB, y pedirlos en una red mala haría fallar la
// instalación. Esa librería se guarda sola cuando se descarga.
const BASICOS = [
  './',
  'index.html',
  'assets/estilos.css',
  'assets/config.js',
  'assets/app.js',
];

/** Página de cortesía para cuando no hay copia guardada ni red. */
const SIN_RED = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:24px;background:#ece7dd;color:#1d1a17;font-family:system-ui,-apple-system,sans-serif;
text-align:center;line-height:1.5}div{max-width:320px}h1{font-size:1.3rem;margin:0 0 8px}
p{color:#6d675e;margin:0 0 20px}button{padding:12px 22px;font:inherit;font-weight:600;
border:0;border-radius:9px;background:#9a6f0a;color:#fff}</style></head>
<body><div><h1>Sin conexión</h1><p>No pudimos cargar tu boleto. Revisa tu señal e inténtalo de nuevo.</p>
<button onclick="location.reload()">Reintentar</button></div></body></html>`;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // Uno por uno, no en bloque: si un archivo falla, los demás se guardan
      // igual. Con `addAll` un solo fallo dejaba al teléfono sin nada.
      .then((cache) => Promise.allSettled(BASICOS.map((ruta) => cache.add(ruta))))
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

/** Una petición a la red que se rinde a tiempo en vez de colgarse. */
function conLimite(peticion, ms) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('tiempo agotado')), ms);
    fetch(peticion).then(
      (r) => { clearTimeout(reloj); resolver(r); },
      (e) => { clearTimeout(reloj); rechazar(e); }
    );
  });
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo se administra lo propio del sitio. Las consultas a Supabase van
  // directo a la red: nunca se sirven de caché.
  if (peticion.method !== 'GET') { return; }
  if (new URL(peticion.url).origin !== self.location.origin) { return; }

  if (peticion.mode === 'navigate') {
    const url = new URL(peticion.url);
    const esBoleto = url.pathname === '/' || url.pathname.endsWith('/index.html');

    // --- La pantalla del boleto ---
    // Copia primero. El folio viaja en la dirección (?f=...), no en el HTML,
    // así que la misma copia sirve para todos los boletos: quien ya la abrió
    // una vez la vuelve a abrir al instante, sin depender de la red.
    if (esBoleto) {
      evento.respondWith(
        caches.match('index.html').then((guardada) => {
          const desdeRed = conLimite(peticion, 8000)
            .then((r) => guardar(new Request('index.html'), r))
            .catch(() => null);
          if (guardada) {
            evento.waitUntil(desdeRed);     // refresco silencioso
            return guardada;
          }
          // Primera visita sin copia: no queda más que la red.
          return desdeRed.then((r) => r || new Response(SIN_RED, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }));
        })
      );
      return;
    }

    // --- Las demás páginas: panel y diagnóstico ---
    // Estas NO pueden servirse desde la copia del boleto (era el error: pedir
    // el panel devolvía la pantalla del participante). Cada una se guarda con
    // su propia dirección, y para ellas manda la red: el panel siempre debe
    // mostrar el estado real, no uno viejo.
    const suPropiaCopia = new Request(url.origin + url.pathname);
    evento.respondWith(
      conLimite(peticion, 8000)
        .then((r) => guardar(suPropiaCopia, r))
        .catch(() => caches.match(suPropiaCopia).then((r) => r || new Response(SIN_RED, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })))
    );
    return;
  }

  // --- Lo demás: copia al instante, actualización por detrás ---
  evento.respondWith(
    caches.match(peticion).then((guardada) => {
      const desdeRed = fetch(peticion).then((r) => guardar(peticion, r)).catch(() => guardada);
      return guardada || desdeRed;
    })
  );
});
