/**
 * Trabajador de servicio: hace que la página aguante una red mala.
 *
 * En un evento con cientos de personas en el mismo lugar la antena se satura
 * y las cargas se cortan. La regla aquí es simple: **si la página ya se abrió
 * una vez en este teléfono, se vuelve a abrir al instante, sin pedirle
 * permiso a la red**. Lo único que necesita conexión es consultar el estado
 * de la rifa, que son unos cuantos bytes.
 */
const CACHE = 'rifa-v46';

// Solo lo mínimo para pintar el boleto. La librería de Supabase NO va aquí a
// propósito: son 215 KB, y pedirlos en una red mala haría fallar la
// instalación. Esa librería se guarda sola cuando se descarga.
// `index.html` va aparte y NO en esta lista: es la única que decide si la
// pantalla del boleto se puede abrir sin red, y se guarda con reintento.
// Antes la lista traía además './', que es OTRA petición a la misma página:
// se guardaban dos llaves y aquí abajo solo se leía una, así que un fallo en
// la de 'index.html' dejaba la copia «guardada» e inservible.
const PAGINA = 'index.html';

const BASICOS = [
  'assets/estilos.css',
  'assets/config.js',
  'assets/app.js',
];

/**
 * Página de cortesía para cuando no hay copia guardada ni red.
 *
 * Lleva el texto como parámetro porque la misma pantalla sale en el boleto y
 * en el panel, y decirle «no pudimos cargar tu boleto» al organizador que
 * está abriendo el panel lo manda a buscar el problema donde no está.
 */
function sinRed(explicacion) {
  return new Response(PLANTILLA_SIN_RED.replace('{{EXPLICACION}}', explicacion), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const SIN_RED_BOLETO = 'No pudimos cargar tu boleto. Revisa tu señal e inténtalo de nuevo.';
const SIN_RED_PANEL = 'No pudimos cargar el panel. Revisa tu señal e inténtalo de nuevo.';

const PLANTILLA_SIN_RED = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:24px;background:#ece7dd;color:#1d1a17;font-family:system-ui,-apple-system,sans-serif;
text-align:center;line-height:1.5}div{max-width:320px}h1{font-size:1.3rem;margin:0 0 8px}
p{color:#6d675e;margin:0 0 20px}button{padding:12px 22px;font:inherit;font-weight:600;
border:0;border-radius:9px;background:#9a6f0a;color:#fff}</style></head>
<body><div><h1>Sin conexión</h1><p>{{EXPLICACION}}</p>
<button onclick="location.reload()">Reintentar</button></div></body></html>`;

/**
 * Guarda la página, con tres intentos espaciados.
 *
 * Esto es lo más importante del archivo. La instalación ocurre justo cuando
 * la persona escanea el QR —en el evento, con la antena saturada—, que es el
 * peor momento posible para una descarga. Si se rinde al primer intento, el
 * teléfono se queda con un trabajador de servicio ACTIVO y SIN copia, que es
 * peor que no tener ninguno: a partir de ahí toda apertura depende de la red
 * y encima con el plazo que este archivo le impone.
 */
function guardarPagina(cache, intentos) {
  return cache.add(PAGINA).catch((e) => {
    if (intentos <= 1) { throw e; }
    return new Promise((r) => setTimeout(r, 800))
      .then(() => guardarPagina(cache, intentos - 1));
  });
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // Uno por uno, no en bloque: si un archivo falla, los demás se guardan
      // igual. Con `addAll` un solo fallo dejaba al teléfono sin nada.
      .then((cache) => Promise.allSettled(BASICOS.map((ruta) => cache.add(ruta)))
        .then(() => guardarPagina(cache, 3))
        // Que la página no se haya podido guardar NO impide instalar: la
        // pantalla de abajo ya no depende de que esté. Pero se intenta de
        // verdad antes de darse por vencido.
        .catch(() => {}))
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

/**
 * Como `conLimite`, pero con UN reintento rápido y silencioso si la red SÍ
 * contestó y contestó mal (404, 502…) —un bache de un instante en el borde
 * de Cloudflare, un despliegue a medio propagar, un nodo que recién
 * despierta—, que casi siempre se cura solo en menos de medio segundo.
 *
 * A propósito NO reintenta cuando la red de plano no contestó —tronó o se
 * agotó el tiempo—: ahí sí hay una red mala de verdad, y sumarle otro plazo
 * de espera sería traicionar la regla de este archivo entero («abrir al
 * instante vale más que abrir lo último»). Ese caso lo resuelve el
 * `.catch()` de quien llama, sin demora extra.
 */
function conReintento(peticion, ms) {
  // Clonada ANTES del primer intento: una vez que `fetch` toca la petición
  // original, ya no se puede clonar para el segundo intento.
  const copia = peticion.clone();
  return conLimite(peticion, ms).then((r) => {
    if (r && r.ok) { return r; }
    return new Promise((resolver) => setTimeout(resolver, 400))
      .then(() => conLimite(copia, Math.min(ms, 4000)));
  });
}

/**
 * Pide a la red sin plazo propio, pero con UN reintento si el servidor
 * contesta mal (404, 502, 503…).
 *
 * Las dos mitades importan y son por motivos distintos:
 *
 *   - Sin plazo: cortarle la descarga a quien no tiene copia que ofrecer a
 *     cambio es dejarlo sin boleto. El navegador espera mejor que nosotros.
 *   - Con reintento: un estado HTTP malo de un instante —un despliegue a
 *     medio propagar en el borde, un nodo frío— lo resuelve `fetch` igual
 *     que a un 200, así que NO lo atrapa ningún `.catch()`. Sin reintentar,
 *     esa página de error cruda es lo que ve quien acaba de escanear el QR.
 *     Ya pasó una vez y ya se había arreglado; no vuelve a pasar.
 */
function sinPrisa(peticion) {
  // Clonada ANTES del primer intento: después de que `fetch` la toca, ya no
  // se puede clonar para el segundo.
  const copia = peticion.clone();
  return fetch(peticion).then((r) => {
    if (r && r.ok) { return r; }
    return new Promise((res) => setTimeout(res, 400)).then(() => fetch(copia));
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
    // Copia primero. El boleto viaja en la dirección (?b=...), no en el HTML,
    // así que la misma copia sirve para todos los boletos: quien ya la abrió
    // una vez la vuelve a abrir al instante, sin depender de la red.
    if (esBoleto) {
      evento.respondWith(
        caches.match(PAGINA).then((guardada) => {
          // Un 404/500/502 pasajero de la red —un despliegue a medio
          // propagar en el borde, un nodo frío— NO es un «no hay copia que
          // ofrecer»: `fetch` lo resuelve igual que a un 200, no lo rechaza.
          // Sin este `r && r.ok`, ese error de un instante se le enseñaba
          // al que acababa de escanear el QR tal cual, en vez de la página
          // de «Sin conexión» de aquí abajo —que es justo para esto—. Una
          // recarga, momentos después, volvía a pedir la red y ya salía
          // bien: el síntoma exacto que reportó el dueño.
          if (guardada) {
            // Hay copia: se enseña al instante y se refresca por detrás. Aquí
            // sí cabe un plazo corto, porque rendirse no le cuesta nada a
            // nadie: la persona ya está viendo su boleto.
            evento.waitUntil(
              conReintento(peticion, 8000)
                .then((r) => (r && r.ok) ? guardar(new Request(PAGINA), r) : null)
                .catch(() => null)
            );
            return guardada;
          }

          // SIN copia: aquí es donde se perdía la gente.
          //
          // Antes esto llevaba el mismo tope de 8 segundos, y en una antena
          // saturada —que es el escenario para el que existe este archivo—
          // ocho segundos no alcanzan para la primera carga. El trabajador de
          // servicio cortaba la descarga y enseñaba «Sin conexión» a alguien
          // que SÍ tenía red, solo que lenta: el navegador, por su cuenta,
          // habría seguido esperando y habría abierto el boleto.
          //
          // La regla es que este archivo nunca deje al teléfono peor de como
          // estaría sin él. Sin copia que ofrecer no hay nada que ganar
          // cortando, así que no se corta: se espera lo que la red tarde y
          // solo se enseña la pantalla de cortesía si de verdad falla.
          return sinPrisa(peticion)
            .then((r) => (r && r.ok)
              ? guardar(new Request(PAGINA), r)
              : sinRed(SIN_RED_BOLETO))
            .catch(() => sinRed(SIN_RED_BOLETO));
        })
      );
      return;
    }

    // --- Las demás páginas: panel y diagnóstico ---
    // Estas NO pueden servirse desde la copia del boleto (era el error: pedir
    // el panel devolvía la pantalla del participante). Cada una se guarda con
    // su propia dirección, y para ellas manda la red: el panel siempre debe
    // mostrar el estado real, no uno viejo. Mismo cuidado que arriba: un
    // estado HTTP malo no es un 200 y no se enseña tal cual.
    const suPropiaCopia = new Request(url.origin + url.pathname);
    // El plazo corto solo vale si hay copia vieja que ofrecer a cambio. Si no
    // la hay, cortar la descarga no salva a nadie: deja al operador mirando
    // un error cuando su red solo era lenta. Mismo criterio que arriba.
    evento.respondWith(
      caches.match(suPropiaCopia).then((copia) => {
        if (!copia) {
          return sinPrisa(peticion)
            .then((r) => (r && r.ok)
              ? guardar(suPropiaCopia, r)
              : sinRed(SIN_RED_PANEL))
            .catch(() => sinRed(SIN_RED_PANEL));
        }
        return conReintento(peticion, 8000)
          .then((r) => (r && r.ok) ? guardar(suPropiaCopia, r) : copia)
          .catch(() => copia);
      })
    );
    return;
  }

  // --- Los archivos del panel: siempre de la red, nunca de la copia ---
  //
  // La página del panel ya se pide a la red, pero sus archivos se servían de
  // la copia guardada. Así quedaba el HTML nuevo ejecutando JavaScript viejo,
  // que es exactamente lo que pasó al estrenar los cuatro folios por boleto:
  // el panel pedía un campo que el servidor ya no mandaba y la hoja salía con
  // «undefined». Servirle al operador una versión vieja es peor que hacerlo
  // esperar unos segundos; si no hay red, la copia sigue ahí de respaldo.
  if (/\/panel\.(js|css)$/.test(new URL(peticion.url).pathname)) {
    evento.respondWith(
      conReintento(peticion, 8000)
        .then((r) => (r && r.ok)
          ? guardar(peticion, r)
          : caches.match(peticion).then((c) => c || Response.error()))
        .catch(() => caches.match(peticion).then((r) => r || Response.error()))
    );
    return;
  }

  // --- Lo demás: copia al instante, actualización por detrás ---
  //
  // Esto es para el boleto, y es deliberado: en una antena saturada, abrir al
  // instante vale más que abrir lo último. La versión nueva entra al subir
  // CACHE arriba, que borra la copia vieja al activarse.
  evento.respondWith(
    caches.match(peticion).then((guardada) => {
      const desdeRed = fetch(peticion).then((r) => guardar(peticion, r)).catch(() => guardada);
      return guardada || desdeRed;
    })
  );
});
