/**
 * Prueba de punta a punta del panel y de la pantalla del boleto.
 *
 * Levanta un servidor que finge ser Supabase (`servidor-de-prueba.mjs`) y
 * conduce un navegador de verdad: entrar con la clave, crear una rifa, sacar
 * la hoja de boletos —y leer el QR impreso para comprobar que apunta al
 * boleto correcto—, cambiar de rifa, verificar un boleto de papel, y correr
 * el sorteo entero mirando cómo la pantalla del participante cambia sola.
 *
 * No toca la base de datos real.
 *
 *   npm install playwright jsqr pngjs && npx playwright install chromium
 *   node pruebas/panel.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:8891';

// El servidor de prueba se levanta aquí para que cada corrida empiece limpia.
// `fileURLToPath` y no `.pathname`: en Windows el pathname trae la unidad con
// una barra delante («/C:/Users/…») y pasarlo tal cual a `spawn` la duplica.
const servidor = spawn(process.execPath, [fileURLToPath(new URL('./servidor-de-prueba.mjs', import.meta.url))],
  { stdio: 'inherit' });
process.on('exit', () => servidor.kill());
// Se espera a que conteste, en vez de confiar en un plazo fijo: si el puerto
// está ocupado por otra corrida, más vale enterarse aquí que ver fallar
// pruebas sueltas contra un servidor viejo.
for (let i = 0; ; i++) {
  try { await fetch(BASE + '/assets/config.js'); break; } catch (e) {
    if (i > 40) { throw new Error('el servidor de prueba no levantó en ' + BASE); }
    await new Promise((r) => setTimeout(r, 100));
  }
}
const fallos = [];
function ok(nombre, cond, extra) {
  console.log((cond ? '  ok   ' : '  FALLA') + '  ' + nombre + (extra ? '  — ' + extra : ''));
  if (!cond) fallos.push(nombre);
}

/**
 * Qué piezas del boleto se enciman con cuáles, medido en el navegador.
 *
 * Leer el HTML no alcanza: en el boleto vertical todo va colocado a
 * porcentajes, y un número tapado por el QR o por un trébol se imprime igual
 * de ilegible aunque el HTML esté perfecto. Con un solo selector compara
 * todas esas piezas entre sí; con dos, las del primero contra las del segundo.
 */
async function encimadas(hoja, selA, selB) {
  return hoja.$eval('.boleto', (art, sels) => {
    const lista = (sel) => [...art.querySelectorAll(sel)].map((e, i) => ({
      que: (e.getAttribute('class') || e.tagName).split(' ')[0] + '#' + i,
      r: e.getBoundingClientRect(),
    }));
    const unos = lista(sels[0]);
    const otros = sels[1] ? lista(sels[1]) : unos;
    const malos = [];
    unos.forEach((a, i) => otros.forEach((b, j) => {
      if (!sels[1] && j <= i) return;
      const ancho = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const alto = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ancho > 0.5 && alto > 0.5) malos.push(a.que + '×' + b.que);
    }));
    return malos;
  }, [selA, selB || null]);
}

/** Qué piezas se salen de su boleto, que es donde `overflow` las recorta. */
async function fuera(hoja, sel) {
  return hoja.$eval('.boleto', (art, s) => {
    const caja = art.getBoundingClientRect();
    return [...art.querySelectorAll(s)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.left < caja.left - 0.5 || r.right > caja.right + 0.5 ||
             r.top < caja.top - 0.5 || r.bottom > caja.bottom + 0.5;
    }).map((e) => (e.getAttribute('class') || e.tagName) + ' «' +
                  (e.textContent || '').trim().slice(0, 20) + '»');
  }, sel);
}

// Lo que hay que poder leer en el boleto impreso, y lo que solo adorna.
const LEIBLE = '.caja, .qr, .precio, .pie, .aviso, .fechas, .sello, .titulo';
const ADORNO = '.trebol, .moneda, .rana';

// El navegador. En un entorno donde Chromium ya viene instalado —como el de
// integración continua— se le pasa su ruta en CHROMIUM_BIN en vez de que
// Playwright se descargue el suyo.
const navegador = await chromium.launch(
  process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});
const ctx = await navegador.newContext({ serviceWorkers: 'block' });
const pagina = await ctx.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
let cuerpoCreacion = null;
pagina.on('request', (r) => {
  if (r.url().endsWith('/functions/v1/sorteo') && r.postData() &&
      r.postData().includes('crear_rifa')) { cuerpoCreacion = JSON.parse(r.postData()); }
});

// ------------------------------------------------- PANEL SIN RIFAS ---------
// Una base recién estrenada, o borrada para volver a empezar. Antes el panel
// no dejaba ni entrar: pedía el estado de una rifa que no existía.
{
  console.log('\n== Panel con cero rifas ==');
  const ctx0 = await navegador.newContext({ serviceWorkers: 'block' });
  const p0 = await ctx0.newPage();
  const err0 = [];
  p0.on('pageerror', (e) => err0.push(String(e)));
  // Se le hace creer al panel que no hay nada.
  await p0.route('**/functions/v1/sorteo', async (ruta) => {
    const cuerpo = JSON.parse(ruta.request().postData() || '{}');
    if (cuerpo.accion === 'rifas') {
      return ruta.fulfill({ status: 200, contentType: 'application/json',
                            body: JSON.stringify({ rifas: [] }) });
    }
    return ruta.continue();
  });
  await p0.goto(BASE + '/panel.html');
  await p0.fill('#clave', 'secreta');
  await p0.click('#btnEntrar');
  await p0.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });
  ok('se puede entrar aunque no haya ninguna rifa', true);
  ok('y aterriza en Rifas, no en Sorteo', await p0.isVisible('#paneRifas'));
  ok('con el formulario de nueva rifa ya abierto',
     await p0.isVisible('#nvNombre'));
  ok('y lo dice en el encabezado',
     (await p0.textContent('#tituloRifa')).includes('Todavía no hay ninguna rifa'),
     await p0.textContent('#tituloRifa'));
  await p0.click('.pestana[data-panel="paneSorteo"]');
  ok('la pestaña Sorteo avisa que no hay nada que manejar',
     (await p0.textContent('#mensaje')).includes('Crea una'),
     await p0.textContent('#mensaje'));
  // Diseñar SIN ninguna rifa. Es el caso real de una base recién vaciada, y
  // era un callejón sin salida: el botón de guardar nacía deshabilitado.
  await p0.click('.pestana[data-panel="paneDiseno"]');
  await p0.waitForSelector('#vistaBoleto .boleto');
  ok('la pestaña Diseño sirve aunque no haya ninguna rifa',
     !(await p0.isDisabled('#btnGuardarDiseno')));
  ok('y el botón dice para qué va a servir lo que se guarde',
     (await p0.textContent('#btnGuardarDiseno')) === 'Guardar para la próxima rifa',
     await p0.textContent('#btnGuardarDiseno'));
  ok('y lo explica arriba, sin dejar a nadie adivinando',
     (await p0.textContent('#disenoDeQuien')).includes('próxima que crees'),
     await p0.textContent('#disenoDeQuien'));
  await p0.click('#temas .tema[data-tema="menta"]');
  await p0.click('#btnGuardarDiseno');
  await p0.waitForFunction(() =>
    document.getElementById('mensajeDiseno').textContent.includes('va a nacer'),
    null, { timeout: 10000 });
  ok('se guarda para la próxima rifa', true);

  ok('sin errores de JavaScript con la base vacía', err0.length === 0, err0.join(' | '));
  await ctx0.close();
}

// ---------------------------------------------------------------- PANEL ----
console.log('\n== Panel ==');
await pagina.goto(BASE + '/panel.html');
await pagina.waitForSelector('#clave');

// Ver lo que uno teclea: la clave es larga y se escribe en un celular.
ok('la clave nace oculta', await pagina.getAttribute('#clave', 'type') === 'password');
ok('la casilla nace apagada', !(await pagina.isChecked('#verClave')));
await pagina.check('#verClave');
ok('marcándola, la clave se ve', await pagina.getAttribute('#clave', 'type') === 'text');
await pagina.uncheck('#verClave');
ok('y desmarcándola vuelve a ocultarse',
   await pagina.getAttribute('#clave', 'type') === 'password');

// clave mala
await pagina.fill('#clave', 'nopes');
await pagina.click('#btnEntrar');
await pagina.waitForFunction(() => document.getElementById('mensajeClave').textContent.includes('incorrecta'));
ok('clave incorrecta se rechaza', true);
ok('el panel sigue oculto con clave mala', await pagina.isHidden('#pestanas'));

// clave buena
await pagina.fill('#clave', 'secreta');
await pagina.click('#btnEntrar');
await pagina.waitForSelector('#pestanas:not([hidden])');
ok('entra con la clave buena', true);
ok('abre en la pestaña Sorteo', await pagina.isVisible('#paneSorteo'));
ok('toma la rifa activa', (await pagina.textContent('#tituloRifa')) === 'Rifa El Muerde Manos',
   await pagina.textContent('#tituloRifa'));
ok('el subtítulo separa boletos de números, que ya no son lo mismo',
   /^Serie A · 2 boletos · 8 números · \d{1,2} \w+\.? \d{4},/.test(await pagina.textContent('#subtitulo')),
   await pagina.textContent('#subtitulo'));

// --- pestaña Rifas ---
console.log('\n== Rifas ==');
await pagina.click('.pestana[data-panel="paneRifas"]');
await pagina.waitForSelector('#listaRifas .rifa');
const tarjetas = await pagina.$$('#listaRifas .rifa');
ok('lista todo el historial', tarjetas.length === 5, tarjetas.length + ' tarjetas');
ok('marca cuál se está manejando', await pagina.isVisible('#listaRifas .rifa.manejando'));
const textoVieja = await pagina.locator('.rifa', { hasText: 'Rifa de estreno' }).textContent();
ok('la rifa vieja conserva su ganador', textoVieja.includes('Ganador: Z-90001'), textoVieja.trim().replace(/\s+/g,' '));
const textoNueva = await pagina.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).textContent();
ok('calcula el ingreso por BOLETO, no por número',
   textoNueva.includes('$50 c/u') && textoNueva.includes('$100.00 en total'),
   textoNueva.trim().replace(/\s+/g,' '));

// --- hoja de boletos de una rifa vieja ---
console.log('\n== Hoja para imprimir ==');
const [hoja] = await Promise.all([
  ctx.waitForEvent('page'),
  pagina.locator('.rifa', { hasText: 'Rifa de estreno' }).getByText('Hoja de boletos').click(),
]);
await hoja.waitForLoadState('domcontentloaded');
await hoja.waitForSelector('.boleto');
const boletosHoja = await hoja.$$('.boleto');
ok('la hoja trae un boleto de papel por cada boleto, no por folio',
   boletosHoja.length === 1, boletosHoja.length + ' boletos');
const numerosHoja = await hoja.$$eval('.boleto .num', (n) => n.map((e) => e.textContent));
ok('y cada boleto imprime TODOS sus números',
   numerosHoja.join(' ') === '90001 90002', numerosHoja.join(' '));
ok('imprime un solo código para todo el boleto',
   (await hoja.textContent('.boleto .codigo')) === 'Código ZZZZ');
ok('y su número de boleto, el que va en el QR',
   (await hoja.textContent('.boleto .serial')) === '9000009001',
   await hoja.textContent('.boleto .serial'));
ok('trae botón de imprimir/PDF', await hoja.isVisible('button'));

// el QR tiene que decodificarse de verdad
const caja = await hoja.$('.boleto .qr');
const foto = await caja.screenshot({ scale: 'css' });
const png = PNG.sync.read(foto);
const leido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
ok('el QR se lee y apunta al boleto correcto',
   !!leido && leido.data === BASE + '/?b=9000009001&c=ZZZZ', leido ? leido.data : 'no se pudo leer');
await hoja.close();

// --- crear una rifa nueva ---
console.log('\n== Nueva rifa ==');
await pagina.click('#cajaNueva > summary');
ok('la casilla de boletos arranca vacía: el número lo elige quien crea la rifa',
   (await pagina.inputValue('#nvCantidad')) === '',
   JSON.stringify(await pagina.inputValue('#nvCantidad')));
// El tope ya no se cuenta en boletos sino en números: con 4 por boleto,
// en 5 dígitos caben 27,000 números, o sea 6,750 boletos.
ok('el tope que anuncia descuenta los números por boleto',
   (await pagina.textContent('#cuentaNueva')).includes('6,750 boletos'),
   await pagina.textContent('#cuentaNueva'));

await pagina.click('#atajosCantidad button[data-cantidad="25"]');
ok('los atajos llenan la casilla', (await pagina.inputValue('#nvCantidad')) === '25');
ok('y el resumen dice boletos y números por separado',
   (await pagina.textContent('#cuentaNueva'))
     .includes('25 boletos con 4 números cada uno: 100 folios de 5 dígitos'),
   await pagina.textContent('#cuentaNueva'));

// avisa antes de apretar el botón, no después
await pagina.fill('#nvDigitos', '4');
await pagina.fill('#nvCantidad', '4000');
ok('avisa cuando los folios no alcanzan para tantos boletos',
   (await pagina.textContent('#cuentaNueva')).includes('no caben en 4 dígitos'),
   await pagina.textContent('#cuentaNueva'));
await pagina.fill('#nvDigitos', '5');

await pagina.fill('#nvNombre', 'Rifa de prueba');
await pagina.fill('#nvSerie', 'B');
await pagina.fill('#nvFecha', '2026-12-24T20:00');
await pagina.fill('#nvFechaEmision', '2026-12-20');
await pagina.fill('#nvCantidad', '4');
await pagina.fill('#nvPrecio', '100');
ok('el resumen calcula lo que suma el lote',
   (await pagina.textContent('#cuentaNueva')).includes('$400.00'),
   await pagina.textContent('#cuentaNueva'));
await pagina.click('#btnCrear');
await pagina.waitForFunction(() => document.getElementById('mensajeNueva').textContent.includes('confirmar'));
ok('pide confirmar antes de generar folios', true);
const [hoja2] = await Promise.all([
  ctx.waitForEvent('page'),
  pagina.click('#btnCrear'),
]);
await hoja2.waitForSelector('.boleto');
ok('genera los boletos pedidos', (await hoja2.$$('.boleto')).length === 4);
const numerosNueva = await hoja2.$$eval('.boleto .num', (n) => n.map((e) => e.textContent));
ok('y cada uno con sus cuatro números', numerosNueva.length === 16, numerosNueva.length + ' números');
await hoja2.close();

// Crear una rifa deja el panel manejándola: si no, se quedaba con la
// anterior —normalmente ya cerrada— y parecía trabado.
await pagina.waitForSelector('#paneSorteo:not([hidden])', { timeout: 15000 });
ok('tras crearla, el panel salta solo a la pestaña Sorteo', true);
ok('y ya está manejando la rifa nueva, no la anterior',
   (await pagina.textContent('#tituloRifa')) === 'Rifa de prueba',
   await pagina.textContent('#tituloRifa'));
ok('lo dice en voz alta',
   (await pagina.textContent('#mensaje')).includes('El panel ya la está manejando'),
   await pagina.textContent('#mensaje'));

await pagina.click('.pestana[data-panel="paneRifas"]');
await pagina.waitForSelector('#listaRifas .rifa:nth-child(6)');
ok('la rifa nueva entra al historial', (await pagina.$$('#listaRifas .rifa')).length === 6);
ok('y queda marcada como la que se maneja',
   (await pagina.locator('.rifa.manejando').textContent()).includes('Rifa de prueba'),
   (await pagina.locator('.rifa.manejando').textContent()).replace(/\s+/g, ' ').slice(0, 60));
await pagina.click('#cajaNueva > summary');
ok('el formulario queda limpio para la siguiente',
   (await pagina.inputValue('#nvNombre')) === '' &&
   (await pagina.inputValue('#nvCantidad')) === '');

// la hora tecleada se guarda como hora del evento, no del navegador que la
// escribió: 20:00 en Ciudad de México son las 02:00 UTC del día siguiente.
ok('manda la hora en la zona del evento, no la del navegador',
   cuerpoCreacion && cuerpoCreacion.fecha_sorteo === '2026-12-25T02:00:00.000Z',
   cuerpoCreacion && cuerpoCreacion.fecha_sorteo);
// Mediodía y no medianoche: a medianoche, en una zona de desfase negativo
// como esta, convertir a UTC puede caer en el día anterior.
ok('la fecha de emisión también viaja en la zona del evento',
   cuerpoCreacion && cuerpoCreacion.fecha_emision === '2026-12-20T18:00:00.000Z',
   cuerpoCreacion && cuerpoCreacion.fecha_emision);

// --- pasar el mando a otra rifa ---
console.log('\n== Cambiar de rifa ==');
await pagina.locator('.rifa', { hasText: 'Rifa de estreno' })
  .getByText('Manejar esta').click();
await pagina.waitForFunction(() => document.getElementById('mensajeRifas').textContent.includes('Ahora manejas'));
ok('el panel cambia de rifa', (await pagina.textContent('#tituloRifa')) === 'Rifa de estreno',
   await pagina.textContent('#tituloRifa'));

// --- verificador ---
console.log('\n== Verificar boleto ==');
await pagina.click('.pestana[data-panel="paneVerificar"]');
await pagina.fill('#vfFolio', 'A-11052');      // con prefijo de serie, como viene impreso
await pagina.fill('#vfCodigo', 'r5vr');        // en minúsculas, como lo teclea cualquiera
await pagina.click('#btnVerificar');
await pagina.waitForSelector('#resultadoVerificar:not([hidden])');
ok('acepta el boleto original', (await pagina.getAttribute('#resultadoVerificar', 'class')).includes('valido'));
ok('dice de qué rifa es', (await pagina.textContent('#resultadoVerificar')).includes('Rifa El Muerde Manos'),
   (await pagina.textContent('#resultadoVerificar')).replace(/\s+/g,' '));

await pagina.fill('#vfCodigo', 'XXXX');
await pagina.click('#btnVerificar');
await pagina.waitForFunction(() =>
  document.getElementById('resultadoVerificar').className.includes('falso'));
ok('rechaza un código inventado', true);

await pagina.fill('#vfFolio', '90001');
await pagina.fill('#vfCodigo', 'ZZZZ');
await pagina.click('#btnVerificar');
await pagina.waitForFunction(() =>
  document.getElementById('resultadoVerificar').textContent.includes('GANADOR'));
ok('reconoce el boleto ganador de una rifa vieja', true);

// ------------------------------------------------------------- BOLETO ------
console.log('\n== Pantalla del participante ==');
const p2 = await ctx.newPage();
const err2 = [];
p2.on('pageerror', (e) => err2.push(String(e)));

// boleto de la rifa vieja: tiene que enseñar SU rifa, no la activa
await p2.goto(BASE + '/?b=9000009001&c=ZZZZ');
await p2.waitForSelector('#vistaResultado:not([hidden])', { timeout: 15000 });
ok('un boleto viejo abre en su propio resultado', true);
ok('lo pone a nombre de su rifa, no de la activa',
   (await p2.textContent('#tituloRifa')) === 'Rifa de estreno', await p2.textContent('#tituloRifa'));

// Un boleto lleva varios números: se enseñan TODOS, con su serie.
const numerosViejo = await p2.$$eval('#folios .folio', (n) => n.map((e) => e.textContent));
ok('enseña los dos números del boleto, no uno solo',
   numerosViejo.join(' ') === 'Z-90001 Z-90002', numerosViejo.join(' '));
ok('y le dice que ganó', (await p2.textContent('#veredicto')).includes('Ganaste'),
   await p2.textContent('#veredicto'));
const marcado = await p2.$$eval('#folios .folioGanador', (n) => n.map((e) => e.textContent));
ok('marca cuál de sus números fue el ganador, y solo ese',
   marcado.length === 1 && marcado[0] === 'Z-90001', marcado.join(' ') || 'ninguno marcado');

// boleto de la rifa en espera
await p2.goto(BASE + '/?b=9000001052&c=R5VR');
await p2.waitForSelector('#vistaEspera:not([hidden])', { timeout: 15000 });
ok('un boleto de la rifa pendiente ve la cuenta regresiva', true);
ok('con el nombre de su rifa', (await p2.textContent('#tituloRifa')) === 'Rifa El Muerde Manos');
const numerosEspera = await p2.$$eval('#folios .folio', (n) => n.map((e) => e.textContent));
ok('con sus cuatro números y su serie',
   numerosEspera.join(' ') === 'A-11052 A-11053 A-11054 A-11055', numerosEspera.join(' '));
ok('y ninguno marcado como ganador antes del sorteo',
   (await p2.$$('#folios .folioGanador')).length === 0);

// boleto falso
await p2.goto(BASE + '/?b=9000001052&c=0000');
await p2.waitForSelector('#vistaInvalido:not([hidden])', { timeout: 15000 });
ok('un código que no cuadra sale como boleto no válido', true);

// ------------------------------------------------ TRANSMISIÓN --------------
console.log('\n== El enlace de la transmisión ==');
await pagina.click('.pestana[data-panel="paneSorteo"]');
await pagina.fill('#transmisionUrl', 'https://vimeo.com/12345');
await pagina.click('#btnGuardarTransmision');
await pagina.waitForFunction(() =>
  document.getElementById('mensaje').textContent.includes('no es un enlace de YouTube'));
ok('rechaza un enlace que no es de YouTube', true);

await pagina.fill('#transmisionUrl', 'https://www.youtube.com/@ElMuerdeManos/live');
ok('avisa que el enlace permanente no se puede incrustar',
   (await pagina.textContent('#avisoIncrustar')).includes('no se puede incrustar'),
   await pagina.textContent('#avisoIncrustar'));

await pagina.fill('#transmisionUrl', 'youtu.be/dQw4w9WgXcQ?si=abc');
ok('y que el del directo sí se ve dentro de la página',
   (await pagina.textContent('#avisoIncrustar')).includes('dentro de la página'),
   await pagina.textContent('#avisoIncrustar'));

await pagina.click('#btnGuardarTransmision');
await pagina.waitForFunction(() =>
  document.getElementById('mensaje').textContent.includes('Enlace guardado'));
ok('acepta y limpia un enlace copiado de la app',
   (await pagina.inputValue('#transmisionUrl')) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   await pagina.inputValue('#transmisionUrl'));

// Una rifa se puede cerrar sin revelar a nadie. Ahí no hay perdedores.
await p2.goto(BASE + '/?b=9000000301&c=SSSS');
await p2.waitForSelector('#vistaResultado:not([hidden])', { timeout: 15000 });
ok('una rifa cerrada sin ganador no le dice «no ganaste» a nadie',
   (await p2.textContent('#veredicto')) === 'Rifa cerrada',
   await p2.textContent('#veredicto'));
ok('ni le enseña un hueco donde iría el folio',
   !(await p2.textContent('#notaResultado')).includes('null') &&
   (await p2.textContent('#notaResultado')).includes('Conserva tu boleto'),
   await p2.textContent('#notaResultado'));

// ------------------------------------------- COTEJO DEL FOLIO -------------
console.log('\n== Cotejo del folio ganador ==');
await pagina.click('.pestana[data-panel="paneRifas"]');
await pagina.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Manejar esta').click();
await pagina.waitForFunction(() =>
  document.getElementById('mensajeRifas').textContent.includes('Ahora manejas'));
await pagina.click('.pestana[data-panel="paneSorteo"]');

ok('revelar arranca apagado, sin folio que cotejar',
   await pagina.isDisabled('#btnRevelarFolio'));

await pagina.fill('#folioGanador', '99999');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoFolio').className.includes('ajeno'), null, { timeout: 10000 });
ok('un folio ajeno se marca antes de revelar, no después',
   (await pagina.textContent('#cotejoRotulo')).includes('no es de esta rifa'),
   await pagina.textContent('#cotejoRotulo'));
ok('y el botón sigue apagado', await pagina.isDisabled('#btnRevelarFolio'));

await pagina.fill('#folioGanador', '11052');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoFolio').className.includes('bien'), null, { timeout: 10000 });
// La bolita trae un número, pero lo que hay que pedir es el PAPEL. El cotejo
// enseña de qué boleto salió, con su código y sus otros números.
const cotejo = await pagina.textContent('#cotejoCodigo');
ok('el cotejo dice de qué boleto salió la bolita',
   cotejo.includes('boleto 9000001052'), cotejo);
ok('con el código del papel para comparar', cotejo.includes('código R5VR'), cotejo);
ok('y los otros números del mismo boleto, para no confundirlo',
   cotejo.includes('A-11053') && cotejo.includes('A-11054') && cotejo.includes('A-11055'), cotejo);
ok('sin repetir el número que salió', !cotejo.includes('sus otros números: A-11052'), cotejo);
ok('con su serie delante',
   (await pagina.textContent('#cotejoNumero')) === 'A-11052',
   await pagina.textContent('#cotejoNumero'));
ok('y ahora sí se puede revelar', !(await pagina.isDisabled('#btnRevelarFolio')));

// acepta el folio tal como viene impreso, con la serie pegada
await pagina.fill('#folioGanador', 'A-11053');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoNumero').textContent === 'A-11053', null, { timeout: 10000 });
ok('acepta el folio tecleado con la serie, como viene en el boleto', true);

// cambiar el folio tiene que tumbar una confirmación a medias
await pagina.click('#btnRevelarFolio');
await pagina.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
await pagina.fill('#folioGanador', '11060');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoCodigo').textContent.includes('código EFGH'), null, { timeout: 10000 });
await pagina.click('#btnRevelarFolio');
await pagina.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
ok('cambiar el folio anula la confirmación anterior: vuelve a pedirla', true);
await pagina.fill('#folioGanador', '');

// ------------------------------------------------- SORTEO EN VIVO ---------
console.log('\n== El sorteo, de punta a punta ==');
// En su propio contexto: así el teléfono del participante no queda «en
// segundo plano» cuando el panel toma el foco, que es lo que pasa de verdad.
const ctx3 = await navegador.newContext({ serviceWorkers: 'block' });
const p3 = await ctx3.newPage();
const err3 = [];
p3.on('pageerror', (e) => err3.push(String(e)));
await p3.goto(BASE + '/?b=9000000501&c=PPPP');
await p3.waitForSelector('#vistaEspera:not([hidden])', { timeout: 15000 });
ok('el boleto arranca en la cuenta regresiva', true);

// el panel toma esa rifa y la pone en vivo
await pagina.click('.pestana[data-panel="paneRifas"]');
await pagina.locator('.rifa', { hasText: 'Rifa que va a empezar' })
  .getByText('Manejar esta').click();
await pagina.waitForFunction(() =>
  document.getElementById('mensajeRifas').textContent.includes('Ahora manejas'));
await pagina.click('.pestana[data-panel="paneSorteo"]');
ok('el boleto no enseña el botón antes de que haya transmisión',
   await p3.isHidden('#enlaceTransmision'));

await pagina.fill('#transmisionUrl', 'https://youtu.be/dQw4w9WgXcQ');
await pagina.click('#btnEnVivo');
await pagina.waitForFunction(() => document.getElementById('estadoTexto').textContent === 'En vivo');
ok('el panel transmite', true);
ok('avisa que las pantallas traen el botón',
   (await pagina.textContent('#mensaje')).includes('botón a tu transmisión'),
   await pagina.textContent('#mensaje'));
ok('marca que estás transmitiendo desde este aparato',
   (await pagina.textContent('#candadoTransmision')).includes('desde este aparato'),
   await pagina.textContent('#candadoTransmision'));

await p3.waitForSelector('#vistaEnVivo:not([hidden])', { timeout: 20000 });
ok('el teléfono cambia solo a «en vivo»', true);
ok('con el letrero nuevo',
   (await p3.textContent('#vistaEnVivo .destacada')) === 'La rifa se está llevando a cabo',
   await p3.textContent('#vistaEnVivo .destacada'));
await p3.waitForSelector('#verAqui:not([hidden])', { timeout: 15000 });
ok('con el botón para ver la transmisión ahí mismo', true);
ok('y la salida a YouTube por si acaso',
   (await p3.getAttribute('#enlaceTransmision', 'href')) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' &&
   (await p3.getAttribute('#enlaceTransmision', 'target')) === '_blank' &&
   (await p3.getAttribute('#enlaceTransmision', 'rel')).includes('noopener'),
   await p3.getAttribute('#enlaceTransmision', 'href'));

// El reproductor no debe existir hasta que alguien lo pida: es lo que deja
// que el boleto abra rápido en una red mala.
ok('el reproductor NO está puesto antes de tocarlo',
   (await p3.locator('#marcoVideo iframe').count()) === 0 &&
   await p3.isHidden('#marcoVideo'));

await p3.click('#verAqui');
await p3.waitForSelector('#marcoVideo iframe', { timeout: 10000 });
ok('al tocarlo, el reproductor aparece dentro de la página',
   (await p3.getAttribute('#marcoVideo iframe', 'src'))
     === 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0',
   await p3.getAttribute('#marcoVideo iframe', 'src'));
ok('el tambor se quita y el botón también',
   await p3.isHidden('#tambor') && await p3.isHidden('#verAqui'));

// --- el candado de un solo aparato ---
console.log('\n== Un solo aparato transmitiendo ==');
const ctx4 = await navegador.newContext({ serviceWorkers: 'block' });
const otro = await ctx4.newPage();
await otro.goto(BASE + '/panel.html');
await otro.fill('#clave', 'secreta');
await otro.click('#btnEntrar');
await otro.waitForSelector('#pestanas:not([hidden])');
await otro.waitForFunction(() =>
  !document.getElementById('candadoTransmision').hidden);
ok('el segundo aparato ve de dónde sale la transmisión',
   (await otro.textContent('#candadoTransmision')).includes('Transmitiendo desde'),
   await otro.textContent('#candadoTransmision'));
ok('y le ofrece tomar el control', await otro.isVisible('#btnTomarControl'));

await otro.click('#btnTomarControl');
await otro.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
ok('tomar el control pide confirmación', true);
await otro.click('#btnTomarControl');
await otro.waitForFunction(() =>
  document.getElementById('candadoTransmision').textContent.includes('desde este aparato'));
ok('el segundo aparato toma el control', true);
await ctx4.close();

// Revelar un número del OTRO boleto: así el teléfono que está abierto tiene
// que perder con sus dos números, que es lo que se quiere comprobar. Con uno
// del suyo ganaría, y la prueba de la derrota no probaría nada.
await pagina.fill('#folioGanador', '55503');
await pagina.click('#btnRevelarFolio');
await pagina.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
ok('revelar pide confirmación', true);
await pagina.click('#btnRevelarFolio');
// El refresco de cortesía puede reescribir el aviso con la otra redacción
// («Folio ganador: … registrado y bloqueado»). Las dos dicen lo mismo, así
// que lo que se comprueba es que el folio quede a la vista.
await pagina.waitForFunction(() =>
  document.getElementById('mensaje').textContent.includes('55503'));
ok('queda registrado el ganador', true);
ok('y ya no deja volver a revelar', await pagina.isDisabled('#btnRevelarFolio'));
ok('ni regresar a espera', await pagina.isDisabled('#btnEspera'));

await p3.waitForSelector('#vistaResultado:not([hidden])', { timeout: 25000 });
ok('el teléfono se entera del resultado solo', true);
ok('a un boleto cuyos DOS números fallaron le toca perder',
   (await p3.textContent('#veredicto')).includes('No ganaste'), await p3.textContent('#veredicto'));
ok('pero le dice cuál ganó',
   (await p3.textContent('#notaResultado')).includes('55503'), await p3.textContent('#notaResultado'));
ok('y no le marca ninguno de los suyos como ganador',
   (await p3.$$('#folios .folioGanador')).length === 0);
ok('el reproductor se apaga al llegar el resultado, para que no siga sonando',
   (await p3.locator('#marcoVideo iframe').count()) === 0);
ok('y queda la puerta para seguir viendo la transmisión',
   await p3.isVisible('#seguirViendo') &&
   (await p3.getAttribute('#enlaceSeguir', 'href')) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   await p3.getAttribute('#enlaceSeguir', 'href'));
ok('sin errores de JavaScript en el sorteo', err3.length === 0, err3.join(' | '));

// ------------------------------------------------- DIAGNÓSTICO ------------
// Esta página existe para no mentir: si dice «Todo en orden» el domingo, más
// vale que sea verdad.
console.log('\n== Diagnóstico de red ==');
const ctxD = await navegador.newContext({ serviceWorkers: 'block' });
const diag = await ctxD.newPage();
const errD = [];
diag.on('pageerror', (e) => errD.push(String(e)));

await diag.goto(BASE + '/diagnostico.html');
await diag.waitForFunction(() =>
  !document.getElementById('veredicto').textContent.includes('Midiendo'), null, { timeout: 20000 });

ok('prueba el sitio', (await diag.getAttribute('#p-sitio', 'class')).includes('bien'),
   await diag.textContent('#d-sitio'));
ok('prueba la base de datos', (await diag.getAttribute('#p-base', 'class')).includes('bien'),
   await diag.textContent('#d-base'));
ok('y ahora también el motor del panel',
   (await diag.getAttribute('#p-panel', 'class')).includes('bien'),
   await diag.textContent('#d-panel'));
ok('que se comprueba sin mandar ninguna clave',
   (await diag.textContent('#d-panel')).includes('pide clave'),
   await diag.textContent('#d-panel'));
ok('con todo arriba, el veredicto es que sí sirve',
   (await diag.textContent('#veredicto')) === 'Todo en orden',
   await diag.textContent('#veredicto'));

// Y el caso que antes salía en verde engañando: base viva, panel caído.
const diag2 = await ctxD.newPage();
diag2.on('pageerror', (e) => errD.push(String(e)));
await diag2.route('**/functions/v1/sorteo', (ruta) => ruta.abort());
await diag2.goto(BASE + '/diagnostico.html');
await diag2.waitForFunction(() =>
  !document.getElementById('veredicto').textContent.includes('Midiendo'), null, { timeout: 25000 });
ok('con el panel caído, la base sigue en verde',
   (await diag2.getAttribute('#p-base', 'class')).includes('bien'));
ok('pero el motor del panel sale en rojo',
   (await diag2.getAttribute('#p-panel', 'class')).includes('mal'),
   await diag2.textContent('#d-panel'));
ok('y el veredicto YA NO dice que todo está en orden',
   (await diag2.textContent('#veredicto')) === 'El panel no va a poder revelar',
   await diag2.textContent('#veredicto'));
ok('sin errores de JavaScript en el diagnóstico', errD.length === 0, errD.join(' | '));
await ctxD.close();

// ------------------------------------------------------- PAPELITOS --------
// El eslabón entre la app y la tómbola. Lo que se comprueba aquí no es que la
// hoja se vea bonita: es que los papelitos y los boletos digan EXACTAMENTE los
// mismos números. Un papelito de más es un boleto con doble suerte; uno de
// menos es un boleto que nunca podría ganar.
{
  console.log('\n== Papelitos para la tómbola ==');
  const ctxT = await navegador.newContext({ serviceWorkers: 'block' });
  const pt = await ctxT.newPage();
  const errT = [];
  pt.on('pageerror', (e) => errT.push(String(e)));
  await pt.goto(BASE + '/panel.html');
  await pt.fill('#clave', 'secreta');
  await pt.click('#btnEntrar');
  await pt.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });
  await pt.click('.pestana[data-panel="paneRifas"]');
  await pt.waitForSelector('#listaRifas .rifa');

  const fila = pt.locator('.rifa', { hasText: 'Rifa El Muerde Manos' });
  ok('cada rifa ofrece sus papelitos de tómbola',
     await fila.getByText('Papelitos de tómbola').isVisible());

  // Los números impresos en los BOLETOS, que son la verdad contra la que hay
  // que comparar.
  const [hojaB] = await Promise.all([
    ctxT.waitForEvent('page'),
    fila.getByText('Hoja de boletos').click(),
  ]);
  await hojaB.waitForSelector('.boleto .num');
  const enBoletos = await hojaB.$$eval('.boleto .num', (n) => n.map((e) => e.textContent.trim()));
  await hojaB.close();

  const [hojaP] = await Promise.all([
    ctxT.waitForEvent('page'),
    fila.getByText('Papelitos de tómbola').click(),
  ]);
  await hojaP.waitForSelector('.papelito');
  const enPapelitos = await hojaP.$$eval('.papelito .numero',
    (n) => n.map((e) => e.textContent.trim().replace(/^[A-Z]+-/, '')));

  ok('hay un papelito por cada número impreso, ni uno más ni uno menos',
     enPapelitos.length === enBoletos.length,
     enPapelitos.length + ' papelitos contra ' + enBoletos.length + ' números');
  ok('y son exactamente los mismos números',
     enPapelitos.slice().sort().join(',') === enBoletos.slice().sort().join(','),
     enPapelitos.slice().sort().join(' '));
  ok('sin repetidos: un número repetido sería un boleto con doble suerte',
     new Set(enPapelitos).size === enPapelitos.length,
     enPapelitos.length - new Set(enPapelitos).size + ' repetidos');

  // Quien mete la mano en la tómbola no debe poder ver a quién le toca.
  const textoPapelitos = await hojaP.$eval('body', (e) => e.textContent);
  ok('el papelito no dice de qué boleto salió',
     !textoPapelitos.includes('9000001052') && !/[Cc]ódigo/.test(textoPapelitos),
     textoPapelitos.slice(0, 80).replace(/\s+/g, ' '));

  ok('y avisa cuántos deben quedar, para poder contarlos',
     (await hojaP.textContent('.guia')).includes(enBoletos.length + ' en total'),
     (await hojaP.textContent('.guia')).replace(/\s+/g, ' ').slice(0, 90));
  await hojaP.close();

  // Un lote grande, para que la paginación entre en juego: una hoja que no se
  // imprimió es un boleto que jamás podría ganar, así que cada hoja tiene que
  // decir cuál es y cuántas son.
  await pt.click('#cajaNueva > summary');
  await pt.fill('#nvNombre', 'Rifa con tombola');
  await pt.fill('#nvSerie', 'T');
  await pt.fill('#nvFecha', '2026-12-31T20:00');
  await pt.fill('#nvCantidad', '25');
  await pt.fill('#nvFoliosPorBoleto', '4');
  await pt.click('#btnCrear');
  await pt.waitForFunction(() =>
    document.getElementById('mensajeNueva').textContent.includes('confirmar'));
  const [hojaNueva] = await Promise.all([
    ctxT.waitForEvent('page'),
    pt.click('#btnCrear'),
  ]);
  await hojaNueva.waitForSelector('.boleto');
  await hojaNueva.close();

  await pt.click('.pestana[data-panel="paneRifas"]');
  await pt.waitForSelector('#listaRifas .rifa');
  const filaT = pt.locator('.rifa', { hasText: 'Rifa con tombola' });
  const [hojaT] = await Promise.all([
    ctxT.waitForEvent('page'),
    filaT.getByText('Papelitos de tómbola').click(),
  ]);
  await hojaT.waitForSelector('.papelito');
  ok('un lote de 25 boletos de 4 números da 100 papelitos',
     (await hojaT.locator('.papelito').count()) === 100,
     String(await hojaT.locator('.papelito').count()));
  ok('repartidos en dos hojas, porque en una no caben',
     (await hojaT.locator('.hoja').count()) === 2,
     String(await hojaT.locator('.hoja').count()));
  const pies = await hojaT.$$eval('.pieHoja', (n) => n.map((e) => e.textContent.trim()));
  ok('y cada hoja dice cuál es y cuántas son, para cachar una que falte',
     pies[0].startsWith('Hoja 1 de 2') && pies[1].startsWith('Hoja 2 de 2') &&
     pies.every((t) => t.includes('100 papelitos en total')),
     pies.join(' | '));

  // Y que ese «de 2» sea verdad AL IMPRIMIR, no solo en la pantalla: el corte
  // de página lo decide el motor de impresión, no el DOM. Si un día se rompe,
  // la hoja seguiría anunciando dos páginas y saldrían tres, que es
  // exactamente la clase de mentira que hace que falten papelitos.
  const pdf = await hojaT.pdf({ format: 'Letter' });
  const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('y al imprimirlo de verdad salen esas dos páginas, ni una más',
     paginas === 2, paginas + ' páginas en el PDF');
  await hojaT.close();

  ok('sin errores de JavaScript en los papelitos', errT.length === 0, errT.join(' | '));
  await ctxT.close();
}

// --------------------------------------------------------------- DISEÑO ----
// Aparte y con su propio navegador: guarda un diseño en el servidor de prueba
// y eso cambiaría la hoja que revisan las demás.
{
  console.log('\n== Diseño del boleto ==');
  const ctxG = await navegador.newContext({ serviceWorkers: 'block' });
  const pg = await ctxG.newPage();
  const errG = [];
  pg.on('pageerror', (e) => errG.push(String(e)));
  await pg.goto(BASE + '/panel.html');
  await pg.fill('#clave', 'secreta');
  await pg.click('#btnEntrar');
  await pg.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });

  // Cuál rifa se maneja se deja dicho aquí y no se hereda: las pruebas de más
  // arriba mueven la rifa activa, y el diseño es de la rifa que se maneja.
  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.waitForSelector('#listaRifas .rifa');
  await pg.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Manejar esta').click();
  await pg.waitForFunction(() =>
    document.getElementById('tituloRifa').textContent === 'Rifa El Muerde Manos',
    null, { timeout: 10000 });

  await pg.click('.pestana[data-panel="paneDiseno"]');
  ok('hay una pestaña Diseño y se abre', await pg.isVisible('#paneDiseno'));
  ok('y dice de cuál rifa es el boleto que se está diseñando',
     (await pg.textContent('#disenoDeQuien')).includes('Rifa El Muerde Manos'),
     await pg.textContent('#disenoDeQuien'));

  ok('ofrece los siete temas', (await pg.locator('#temas .tema').count()) === 7,
     String(await pg.locator('#temas .tema').count()));
  ok('ofrece las dos disposiciones',
     (await pg.locator('#disposiciones .tema').count()) === 2,
     String(await pg.locator('#disposiciones .tema').count()));
  ok('y los doce fondos: seis de línea y seis de figura',
     (await pg.locator('#tramas .tema').count()) === 12,
     String(await pg.locator('#tramas .tema').count()));

  // La vista previa dibuja un boleto de verdad, con tantos números como lleve
  // esta rifa: cuatro.
  await pg.waitForSelector('#vistaBoleto .boleto');
  ok('la vista previa dibuja un boleto con sus cuatro números',
     (await pg.locator('#vistaBoleto .boleto .num').count()) === 4,
     String(await pg.locator('#vistaBoleto .boleto .num').count()));
  ok('y trae su QR', await pg.isVisible('#vistaBoleto .boleto .qr svg'));

  // El QR va sobre blanco pase lo que pase: es lo que lo hace legible.
  const fondoQr = () => pg.$eval('#vistaBoleto .boleto .qr',
    (e) => getComputedStyle(e).backgroundColor);
  ok('el QR nace sobre blanco', (await fondoQr()) === 'rgb(255, 255, 255)', await fondoQr());

  // Elegir un tema cambia los cuatro colores de golpe.
  await pg.click('.tema[data-tema="noche"]');
  ok('elegir «Noche» marca ese tema',
     (await pg.getAttribute('.tema[data-tema="noche"]', 'class')).includes('elegido'));
  ok('y le cambia el fondo al control de color',
     (await pg.inputValue('#dsFondo')) === '#1b2432', await pg.inputValue('#dsFondo'));
  const fondoBoleto = await pg.$eval('#vistaBoleto .boleto',
    (e) => getComputedStyle(e).backgroundColor);
  ok('la vista previa se pinta con el tema elegido',
     fondoBoleto === 'rgb(27, 36, 50)', fondoBoleto);
  ok('y AUN ASÍ el QR sigue sobre blanco, que es lo que no se negocia',
     (await fondoQr()) === 'rgb(255, 255, 255)', await fondoQr());

  // Los colores del boleto no se desparraman por el panel.
  const fondoPanel = await pg.$eval('.tablero', (e) => getComputedStyle(e).backgroundColor);
  ok('el tema oscuro no le pinta el fondo al panel', fondoPanel !== 'rgb(27, 36, 50)', fondoPanel);

  // El aviso de contraste: letra casi del color del fondo.
  await pg.fill('#dsTinta', '#1c2433');
  await pg.waitForFunction(() => !document.getElementById('avisoContraste').hidden,
                           null, { timeout: 5000 });
  ok('avisa cuando la letra se pierde contra el fondo',
     (await pg.textContent('#avisoContraste')).includes('letra chica'),
     await pg.textContent('#avisoContraste'));
  await pg.click('.tema[data-tema="feria"]');
  await pg.waitForFunction(() => document.getElementById('avisoContraste').hidden,
                           null, { timeout: 5000 });
  ok('y se calla cuando el contraste vuelve a estar bien', true);

  // La trama de fondo.
  ok('sin trama, el mando de intensidad está escondido',
     await pg.isHidden('#campoIntensidad'));
  const fondoImagen = () => pg.$eval('#vistaBoleto .boleto',
    (e) => getComputedStyle(e).backgroundImage);
  ok('y el boleto no trae ninguna imagen de fondo', (await fondoImagen()) === 'none',
     await fondoImagen());
  await pg.click('#tramas .tema[data-trama="lineas"]');
  ok('al elegir una trama aparece el mando de intensidad',
     await pg.isVisible('#campoIntensidad'));
  ok('y el boleto ya trae la trama dibujada',
     (await fondoImagen()).includes('gradient'), await fondoImagen());

  // Las de figura son otra cosa: un SVG diminuto que se repite, con sus
  // propios colores. Es lo que hace que el boleto se vea de rifa.
  await pg.click('#tramas .tema[data-trama="estrellas"]');
  const conEstrellas = await fondoImagen();
  ok('las estrellas se dibujan con un SVG, no con degradados',
     conEstrellas.includes('data:image/svg+xml') && conEstrellas.includes('path'),
     conEstrellas.slice(0, 90));
  ok('y traen sus colores de fiesta, no el del marco',
     conEstrellas.includes(encodeURIComponent('#ef9ebc')),
     'busca %23ef9ebc');
  ok('el SVG va escapado: no quedan < ni > sueltos dentro del estilo',
     conEstrellas.indexOf('<svg') === -1 && conEstrellas.includes('%3Csvg'));

  // Subir la intensidad cambia la opacidad de las figuras, no otra cosa.
  await pg.selectOption('#dsIntensidad', 'marcada');
  ok('subir la intensidad marca más las figuras',
     (await fondoImagen()).includes('fill-opacity%3D%220.9%22'),
     (await fondoImagen()).slice(0, 90));
  await pg.selectOption('#dsIntensidad', 'suave');
  await pg.click('#tramas .tema[data-trama="lineas"]');
  /*
   * Y ahora la que de verdad importa: MIRAR el resultado, no leer el CSS.
   * Las estrellas salieron en blanco una vez con todas las comprobaciones en
   * verde, porque todas leían el texto del estilo y el texto estaba perfecto.
   *
   * Tampoco basta con contar píxeles de color: el primer intento de esta
   * prueba daba 84 % con el fondo ROTO A PROPÓSITO, porque el papel color
   * crema del tema ya contaba como color. Lo que se compara son dos fotos del
   * mismo boleto, con y sin figuras: si el fondo no dibuja nada, salen
   * idénticas, y eso es exactamente lo que hay que cachar.
   */
  const fotoDelBoleto = () => pg.locator('#vistaBoleto .boleto').screenshot();
  await pg.click('#tramas .tema[data-trama="ninguna"]');
  const sinFiguras = PNG.sync.read(await fotoDelBoleto());
  await pg.click('#tramas .tema[data-trama="estrellas"]');
  await pg.selectOption('#dsIntensidad', 'marcada');
  const conFiguras = PNG.sync.read(await fotoDelBoleto());

  let distintos = 0;
  const hasta = Math.min(sinFiguras.data.length, conFiguras.data.length);
  for (let i = 0; i < hasta; i += 4) {
    if (Math.abs(sinFiguras.data[i] - conFiguras.data[i]) > 12 ||
        Math.abs(sinFiguras.data[i + 1] - conFiguras.data[i + 1]) > 12 ||
        Math.abs(sinFiguras.data[i + 2] - conFiguras.data[i + 2]) > 12) { distintos++; }
  }
  const totalPix = hasta / 4;
  ok('las estrellas SE DIBUJAN de verdad, no solo en el texto del estilo',
     distintos > totalPix * 0.05,
     (distintos * 100 / totalPix).toFixed(1) + '% del boleto cambió al ponerlas');
  await pg.selectOption('#dsIntensidad', 'suave');
  await pg.click('#tramas .tema[data-trama="lineas"]');

  ok('los números llevan su propio fondo, para que la trama no se los coma',
     (await pg.$eval('#vistaBoleto .boleto .num',
        (e) => getComputedStyle(e).backgroundColor)) !== 'rgba(0, 0, 0, 0)',
     await pg.$eval('#vistaBoleto .boleto .num', (e) => getComputedStyle(e).backgroundColor));

  // El aviso al pie y las columnas.
  await pg.fill('#dsAviso', 'No se aceptan cambios ni devoluciones.');
  await pg.waitForFunction(() => {
    const a = document.querySelector('#vistaBoleto .boleto .aviso');
    return a && a.textContent.includes('devoluciones');
  }, null, { timeout: 5000 });
  ok('el aviso al pie se ve en la vista previa al escribirlo', true);

  // Guardar, y que se quede guardado.
  await pg.click('#btnGuardarDiseno');
  await pg.waitForFunction(() =>
    document.getElementById('mensajeDiseno').textContent.includes('va a salir así'),
    null, { timeout: 10000 });
  ok('el diseño se guarda', true);

  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.click('.pestana[data-panel="paneDiseno"]');
  await pg.waitForSelector('#vistaBoleto .boleto');
  ok('y al volver a la pestaña sigue puesto',
     (await pg.inputValue('#dsFondo')) === '#fff8ec' &&
     (await pg.inputValue('#dsAviso')).includes('devoluciones'),
     await pg.inputValue('#dsFondo'));

  // Lo que de verdad importa: que la HOJA salga como la vista previa.
  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.waitForSelector('#listaRifas .rifa');
  const [hojaD] = await Promise.all([
    ctxG.waitForEvent('page'),
    pg.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Hoja de boletos').click(),
  ]);
  await hojaD.waitForLoadState('domcontentloaded');
  await hojaD.waitForSelector('.boleto');
  const fondoHoja = await hojaD.$eval('.boleto', (e) => getComputedStyle(e).backgroundColor);
  ok('la hoja impresa sale con el mismo fondo que la vista previa',
     fondoHoja === 'rgb(255, 248, 236)', fondoHoja);
  ok('y con el aviso que se escribió',
     (await hojaD.textContent('.boleto .aviso')).includes('devoluciones'),
     await hojaD.textContent('.boleto .aviso'));
  ok('el QR de la hoja también va sobre blanco',
     (await hojaD.$eval('.boleto .qr', (e) => getComputedStyle(e).backgroundColor))
       === 'rgb(255, 255, 255)');
  ok('y la trama también llegó al papel',
     (await hojaD.$eval('.boleto', (e) => getComputedStyle(e).backgroundImage)).includes('gradient'),
     await hojaD.$eval('.boleto', (e) => getComputedStyle(e).backgroundImage));
  await hojaD.close();

  // --- La disposición vertical «Suertudito» -------------------------
  // Es una plantilla entera, no un color: lo que hay que comprobar es que los
  // cuatro números caigan en sus recuadros y que lo que se ve en la vista
  // previa sea lo que sale impreso.
  await pg.click('.pestana[data-panel="paneDiseno"]');
  await pg.waitForSelector('#vistaBoleto .boleto');
  ok('la caducidad está escondida mientras la disposición es la clásica',
     await pg.isHidden('#campoCaducidad'));

  await pg.click('#disposiciones .tema[data-disposicion="suertudito"]');
  await pg.waitForSelector('#vistaBoleto .boleto .titulo');
  ok('el boleto vertical trae su marco doble, su rana y su título',
     (await pg.locator('#vistaBoleto .marco').count()) === 1 &&
     (await pg.locator('#vistaBoleto .rana').count()) === 1 &&
     (await pg.locator('#vistaBoleto .titulo').count()) === 1);
  ok('con los cuatro números en sus cuatro recuadros',
     (await pg.$$eval('#vistaBoleto .caja', (n) => n.map((e) => e.textContent.trim())))
       .join(',') === '1018,4307,2850,3267',
     (await pg.$$eval('#vistaBoleto .caja', (n) => n.map((e) => e.textContent.trim()))).join(','));
  ok('el QR sigue sobre blanco también en el boleto vertical',
     (await pg.$eval('#vistaBoleto .qr', (e) => getComputedStyle(e).backgroundColor))
       === 'rgb(255, 255, 255)');
  ok('y el papel queda vertical, no horizontal',
     await pg.$eval('#vistaBoleto .boleto', (e) => e.offsetHeight > e.offsetWidth * 1.3),
     await pg.$eval('#vistaBoleto .boleto', (e) => e.offsetWidth + '×' + e.offsetHeight));
  ok('ahora sí aparece la caducidad, que solo existe en esta disposición',
     await pg.isVisible('#campoCaducidad'));
  ok('y los boletos por renglón saltan a 3, que es el tamaño del original',
     (await pg.inputValue('#dsColumnas')) === '3', await pg.inputValue('#dsColumnas'));
  // La disposición no es una forma: es el boleto del cliente entero, y ese
  // boleto es verde sobre papel verde pálido.
  ok('y trae los colores del boleto del cliente, sin tener que acertarles',
     (await pg.inputValue('#dsFondo')) === '#e4e9e3' &&
     (await pg.inputValue('#dsTinta')) === '#2a5a30' &&
     (await pg.inputValue('#dsAcento')) === '#1b4d1b' &&
     (await pg.inputValue('#dsBorde')) === '#2e7d32',
     [await pg.inputValue('#dsFondo'), await pg.inputValue('#dsTinta'),
      await pg.inputValue('#dsAcento'), await pg.inputValue('#dsBorde')].join(' '));
  // El título del original es una romana cursiva. La primera versión pedía
  // letra manuscrita y en la máquina del cliente salía escrito a mano.
  const letraTitulo = await pg.$eval('#vistaBoleto .titulo',
    (e) => getComputedStyle(e).fontFamily + ' | ' + getComputedStyle(e).fontStyle);
  ok('y el título va en romana cursiva, no en manuscrita',
     /Times|serif/i.test(letraTitulo) && /italic/.test(letraTitulo) &&
     !/script|cursive|handwriting|chancery/i.test(letraTitulo), letraTitulo);

  await pg.fill('#dsCaducidad', '2 días');
  await pg.waitForFunction(() => {
    const f = document.querySelector('#vistaBoleto .fechas');
    return f && f.textContent.includes('2 días');
  }, null, { timeout: 5000 });
  ok('la caducidad escrita se ve en el boleto', true);

  // El aviso del boleto vertical tiene su renglón medido: lo que sobra se
  // recorta sin decir nada, y un aviso legal a medias no sirve de aviso.
  await pg.fill('#dsAviso', 'A'.repeat(150));
  await pg.waitForFunction(() => {
    const c = document.getElementById('avisoContraste');
    return !c.hidden && c.textContent.includes('no cabe completo');
  }, null, { timeout: 5000 });
  ok('avisa cuando el aviso no cabe en el boleto vertical', true);
  await pg.fill('#dsAviso',
    'El boleto se anulará si se encuentra roto, con tachones, borrones o enmendaduras.');
  await pg.waitForFunction(() =>
    document.getElementById('avisoContraste').hidden, null, { timeout: 5000 });
  ok('y deja de avisar cuando el aviso vuelve a caber', true);

  // Lo que importa: que la hoja impresa salga vertical igual que la vista.
  await pg.click('#btnGuardarDiseno');
  await pg.waitForFunction(() =>
    document.getElementById('mensajeDiseno').textContent.includes('va a salir así'),
    null, { timeout: 10000 });
  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.waitForSelector('#listaRifas .rifa');
  const [hojaV] = await Promise.all([
    ctxG.waitForEvent('page'),
    pg.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Hoja de boletos').click(),
  ]);
  await hojaV.waitForLoadState('domcontentloaded');
  await hojaV.waitForSelector('.boleto .titulo');
  ok('la hoja impresa sale con el boleto vertical, no con el clásico',
     (await hojaV.locator('.boleto .rana').count()) > 0 &&
     (await hojaV.locator('.boleto .caja').count()) === 8,
     (await hojaV.locator('.boleto .caja').count()) + ' recuadros en 2 boletos');
  ok('y con la caducidad que se escribió',
     (await hojaV.textContent('.boleto .fechas')).includes('2 días'),
     (await hojaV.textContent('.boleto .fechas')).replace(/\s+/g, ' '));
  ok('la fecha de emisión sale con guiones, igual en cualquier navegador',
     /\d{2}-[a-z]{3}-\d{4}/.test(await hojaV.textContent('.boleto .fechas')),
     (await hojaV.textContent('.boleto .fechas')).replace(/\s+/g, ' '));
  // El día del sorteo hay que cotejar el código del panel contra el talón del
  // ganador. Si el boleto solo lo lleva dentro del QR, un QR que no se lee
  // deja el cotejo sin hacer y el sorteo sin cerrar.
  ok('el boleto vertical imprime su identificador y su código, como el clásico',
     (await hojaV.textContent('.boleto .serial')) === '9000001052' &&
     (await hojaV.textContent('.boleto .codigo')) === 'Código R5VR',
     (await hojaV.textContent('.boleto .pie')).replace(/\s+/g, ' '));
  // Con cuatro números los recuadros tienen que caer donde el boleto del
  // cliente, no «más o menos ahí».
  const esquinas = await hojaV.$eval('.boleto', (art) => {
    const caja = art.getBoundingClientRect();
    return [...art.querySelectorAll('.caja')].map((e) => {
      const r = e.getBoundingClientRect();
      return Math.round((r.left - caja.left) / caja.width * 1000) / 10 + ',' +
             Math.round((r.top - caja.top) / caja.height * 1000) / 10;
    }).join(' ');
  });
  ok('y los cuatro caen en las cuatro esquinas del original',
     esquinas === '7.2,39.4 66.3,39.4 7.2,76.5 66.3,76.5', esquinas);
  const choca4 = (await encimadas(hojaV, LEIBLE))
    .concat(await encimadas(hojaV, ADORNO, '.caja, .pie, .precio, .aviso, .qr'));
  ok('y en el boleto de cuatro tampoco se encima nada', choca4.length === 0,
     choca4.join(' | '));
  const sale4 = await fuera(hojaV, LEIBLE + ', .pie span');
  ok('ni se sale nada del boleto de cuatro', sale4.length === 0, sale4.join(' | '));
  // Todo el boleto se mide contra su propio ancho. Antes las letras iban en
  // milímetros fijos: en papel salían bien y en la pantalla —donde la hoja
  // enseña el boleto al doble— se veían diminutas, así que lo que el cliente
  // revisaba no era lo que iba a imprimir.
  const proporcion = await hojaV.$eval('.boleto', (art) => {
    const aviso = art.querySelector('.aviso');
    return parseFloat(getComputedStyle(aviso).fontSize) / art.getBoundingClientRect().width;
  });
  ok('y la letra crece con el boleto, no se queda en milímetros fijos',
     Math.abs(proporcion - 1.85 / 60) < 0.0004,
     'el aviso mide ' + (proporcion * 60).toFixed(2) + ' mm en un boleto de 60 mm');
  await hojaV.close();

  // Fecha de emisión: corrige la de esta rifa. Es de LA RIFA, no del diseño,
  // así que se guarda aparte y solo aparece editando una rifa que ya existe.
  await pg.click('.pestana[data-panel="paneDiseno"]');
  await pg.waitForSelector('#vistaBoleto .boleto');
  ok('el campo de emisión aparece porque se está editando una rifa que existe',
     await pg.isVisible('#campoEmision') && await pg.isVisible('#btnGuardarEmision'));
  ok('y nace vacío: sin nada guardado, el boleto usa la fecha de creación',
     (await pg.inputValue('#dsEmision')) === '');
  await pg.fill('#dsEmision', '2026-09-20');
  await pg.click('#btnGuardarEmision');
  await pg.waitForFunction(() =>
    document.getElementById('mensajeEmision').textContent.includes('va a imprimir esa fecha'),
    null, { timeout: 10000 });
  ok('guarda la fecha de emisión', true);

  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.waitForSelector('#listaRifas .rifa');
  const [hojaE] = await Promise.all([
    ctxG.waitForEvent('page'),
    pg.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Hoja de boletos').click(),
  ]);
  await hojaE.waitForLoadState('domcontentloaded');
  await hojaE.waitForSelector('.boleto .fechas');
  ok('la hoja imprime la emisión recién fijada, no la fecha de creación',
     (await hojaE.textContent('.boleto .fechas')).includes('20-sep-2026'),
     (await hojaE.textContent('.boleto .fechas')).replace(/\s+/g, ' '));
  await hojaE.close();

  // Vacía otra vez: vuelve a usar la fecha de creación, sin que haga falta
  // acordarse de cuál era.
  await pg.click('.pestana[data-panel="paneDiseno"]');
  await pg.waitForSelector('#vistaBoleto .boleto');
  await pg.fill('#dsEmision', '');
  await pg.click('#btnGuardarEmision');
  await pg.waitForFunction(() =>
    document.getElementById('mensajeEmision').textContent.includes('va a imprimir esa fecha'),
    null, { timeout: 10000 });
  await pg.click('.pestana[data-panel="paneRifas"]');
  await pg.waitForSelector('#listaRifas .rifa');
  const [hojaE2] = await Promise.all([
    ctxG.waitForEvent('page'),
    pg.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).getByText('Hoja de boletos').click(),
  ]);
  await hojaE2.waitForLoadState('domcontentloaded');
  await hojaE2.waitForSelector('.boleto .fechas');
  ok('vaciarla vuelve a usar la fecha en que se creó la rifa',
     (await hojaE2.textContent('.boleto .fechas')).includes('01-sep-2026'),
     (await hojaE2.textContent('.boleto .fechas')).replace(/\s+/g, ' '));
  await hojaE2.close();

  // Volver al de siempre, con su confirmación.
  await pg.click('.pestana[data-panel="paneDiseno"]');
  await pg.waitForSelector('#vistaBoleto .boleto');
  await pg.click('#btnDisenoDeSiempre');
  ok('volver al diseño de siempre pide confirmación',
     (await pg.textContent('#btnDisenoDeSiempre')) === 'Confirmar',
     await pg.textContent('#btnDisenoDeSiempre'));
  await pg.click('#btnDisenoDeSiempre');
  await pg.waitForFunction(() =>
    document.getElementById('mensajeDiseno').textContent.includes('de siempre'),
    null, { timeout: 10000 });
  ok('y al confirmar vuelve al clásico',
     (await pg.inputValue('#dsFondo')) === '#ffffff' &&
     (await pg.inputValue('#dsAviso')).includes('anulará'),
     await pg.inputValue('#dsFondo'));

  ok('sin errores de JavaScript en Diseño', errG.length === 0, errG.join(' | '));
  await ctxG.close();
}

// ------------------------------------------- BOLETO VERTICAL APRETADO ----
// El boleto del cliente trae cuatro números, pero el formulario acepta hasta
// diez por boleto. Un folio que no se imprime sigue valiendo y puede salir
// ganador sin que el papel del comprador lo muestre, así que lo que se prueba
// aquí es que los nueve salgan impresos y que nada se encime con nada.
{
  console.log('\n== Boleto vertical con nueve números ==');
  const ctxN = await navegador.newContext({ serviceWorkers: 'block' });
  const pn = await ctxN.newPage();
  const errN = [];
  pn.on('pageerror', (e) => errN.push(String(e)));
  await pn.goto(BASE + '/panel.html');
  await pn.fill('#clave', 'secreta');
  await pn.click('#btnEntrar');
  await pn.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });
  await pn.click('.pestana[data-panel="paneRifas"]');
  await pn.waitForSelector('#listaRifas .rifa');

  const [hojaN] = await Promise.all([
    ctxN.waitForEvent('page'),
    pn.locator('.rifa', { hasText: 'Rifa de nueve números' }).getByText('Hoja de boletos').click(),
  ]);
  await hojaN.waitForLoadState('domcontentloaded');
  await hojaN.waitForSelector('.boleto .titulo');

  const impresos = await hojaN.$$eval('.boleto .caja', (n) => n.map((e) => e.textContent.trim()));
  ok('imprime los nueve números del boleto, no los primeros cuatro',
     impresos.join(',') === '70001,70002,70003,70004,70005,70006,70007,70008,70009',
     impresos.join(','));
  ok('y también aquí van el identificador y el código impresos',
     (await hojaN.textContent('.boleto .serial')) === '9000007001' &&
     (await hojaN.textContent('.boleto .codigo')) === 'Código NUE9',
     (await hojaN.textContent('.boleto .pie')).replace(/\s+/g, ' '));

  // Con cinco renglones de números los costados quedan ocupados, así que las
  // fechas se bajan al pie en vez de quedarse verticales encima de un número.
  ok('las fechas se mudan al pie cuando el boleto va apretado',
     (await hojaN.locator('.boleto .fechas').count()) === 0 &&
     (await hojaN.textContent('.boleto .fechas-pie')).includes('3 días') &&
     /\d{2}-[a-z]{3}-\d{4}/.test(await hojaN.textContent('.boleto .fechas-pie')),
     (await hojaN.textContent('.boleto .pie')).replace(/\s+/g, ' '));
  // Esta rifa tiene `emision` distinta de `creada_en` a propósito: lo que
  // tiene que imprimirse es la fecha de EMISIÓN del lote, no la del registro.
  ok('la emisión impresa es la del lote, no la de cuando se creó la rifa',
     (await hojaN.textContent('.boleto .fechas-pie')).includes('15-jul-2025') &&
     !(await hojaN.textContent('.boleto .fechas-pie')).includes('01-jul-2025'),
     await hojaN.textContent('.boleto .fechas-pie'));
  ok('y el sello del logo sigue en el boleto, en su otro lugar',
     (await hojaN.locator('.boleto .sello').count()) === 1);

  // La prueba de verdad: medir. Un número tapado por el QR o por el precio se
  // imprime igual y no se puede leer, y de eso uno se entera con los boletos
  // ya repartidos.
  const encimados = await encimadas(hojaN, LEIBLE);
  ok('nada de lo que hay que leer se encima con nada', encimados.length === 0,
     encimados.join(' | '));
  const adornos = await encimadas(hojaN, ADORNO, '.caja, .pie, .precio, .aviso, .qr');
  ok('ni los adornos se le montan encima a un número o al código',
     adornos.length === 0, adornos.join(' | '));

  // Y todo adentro del marco: lo que se sale lo recorta `overflow: hidden` y
  // desaparece sin avisar.
  const desbordes = await fuera(hojaN, LEIBLE + ', .pie span');
  ok('y nada se sale del boleto', desbordes.length === 0, desbordes.join(' | '));

  await hojaN.close();
  ok('sin errores de JavaScript con el boleto apretado', errN.length === 0, errN.join(' | '));
  await ctxN.close();
}

// ------------------------------------------------------------ VENDEDORES ---
// Aparte y con su propio navegador: pasa a manejar «Rifa El Muerde Manos»
// (dos boletos, números 1 y 2) para tener un lote chico y predecible.
{
  console.log('\n== Vendedores ==');
  const ctxV = await navegador.newContext({ serviceWorkers: 'block' });
  const pv = await ctxV.newPage();
  const errV = [];
  pv.on('pageerror', (e) => errV.push(String(e)));
  await pv.goto(BASE + '/panel.html');
  await pv.fill('#clave', 'secreta');
  await pv.click('#btnEntrar');
  await pv.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });

  await pv.click('.pestana[data-panel="paneRifas"]');
  await pv.waitForSelector('#listaRifas .rifa');
  // La sección de Diseño, que corre antes, puede haber dejado esta misma
  // rifa activa: solo se toca el botón si hace falta.
  const filaMM = pv.locator('.rifa', { hasText: 'Rifa El Muerde Manos' });
  if (!(await filaMM.getAttribute('class')).includes('manejando')) {
    await filaMM.getByText('Manejar esta').click();
    await pv.waitForFunction(() =>
      document.getElementById('tituloRifa').textContent === 'Rifa El Muerde Manos', null, { timeout: 10000 });
  }

  await pv.click('.pestana[data-panel="paneVendedores"]');
  ok('hay una pestaña Vendedores y se abre', await pv.isVisible('#paneVendedores'));
  ok('dice de cuál rifa es el reparto',
     (await pv.textContent('#vendedoresDeQuien')).includes('Rifa El Muerde Manos'),
     await pv.textContent('#vendedoresDeQuien'));
  await pv.waitForFunction(() =>
    document.getElementById('listaVendedores').textContent.includes('Todavía no hay ningún vendedor'));
  ok('sin vendedores, lo dice en vez de enseñar una lista vacía', true);

  // Alta de dos vendedores.
  await pv.click('#cajaNuevoVendedor > summary');
  await pv.fill('#vdNombre', 'Juan Pérez');
  await pv.fill('#vdNota', 'Turno de la tarde');
  await pv.click('#btnCrearVendedor');
  await pv.waitForSelector('#listaVendedores .vendedor');
  ok('el vendedor nuevo aparece en la lista',
     (await pv.textContent('#listaVendedores')).includes('Juan Pérez'));
  ok('y en el selector de asignar', (await pv.locator('#vdSelector option')).count() &&
     (await pv.textContent('#vdSelector')).includes('Juan Pérez'));
  ok('nace sin boletos', (await pv.locator('.vendedor', { hasText: 'Juan Pérez' }).textContent())
     .includes('Sin boletos asignados todavía'));

  // Crear uno cierra el desplegable de alta: hay que volver a abrirlo.
  await pv.click('#cajaNuevoVendedor > summary');
  await pv.fill('#vdNombre', 'Ana López');
  await pv.fill('#vdNota', '');
  await pv.click('#btnCrearVendedor');
  await pv.waitForFunction(() =>
    document.getElementById('listaVendedores').textContent.includes('Ana López'));
  ok('se pueden agregar varios vendedores', true);

  // Lote consecutivo: el boleto Nº 1 para Juan.
  await pv.selectOption('#vdSelector', { label: 'Juan Pérez' });
  await pv.fill('#vdDesde', '1');
  await pv.fill('#vdHasta', '1');
  await pv.click('#btnAsignar');
  await pv.waitForFunction(() =>
    document.getElementById('mensajeAsignar').textContent.includes('Asignados: 1'));
  ok('asigna un lote consecutivo', true);
  ok('el resumen cuenta cuántos boletos tienen ya vendedor',
     (await pv.textContent('#resumenAsignacion')) === '1 de 2 boletos ya tienen vendedor; 1 sin asignar.',
     await pv.textContent('#resumenAsignacion'));
  ok('la tarjeta de Juan ya muestra su número',
     (await pv.locator('.vendedor', { hasText: 'Juan Pérez' }).textContent()).includes('Nº 1'));

  // Números sueltos: el boleto Nº 2 para Ana.
  await pv.selectOption('#vdSelector', { label: 'Ana López' });
  await pv.fill('#vdSueltos', '2');
  await pv.click('#btnAsignar');
  await pv.waitForFunction(() =>
    document.getElementById('resumenAsignacion').textContent.includes('0 sin asignar'));
  ok('asigna por números sueltos, y ya no queda ninguno libre', true);

  // Reasignar: Ana se queda también con el Nº 1, que era de Juan. No se
  // bloquea —es bitácora de reparto—, pero avisa a quién se lo quitó.
  await pv.fill('#vdSueltos', '1');
  await pv.click('#btnAsignar');
  await pv.waitForFunction(() =>
    document.getElementById('mensajeAsignar').textContent.includes('Se los quitaron'));
  ok('reasignar un boleto no se bloquea',
     (await pv.textContent('#mensajeAsignar')).includes('Nº 1') &&
     (await pv.textContent('#mensajeAsignar')).includes('Juan Pérez'),
     await pv.textContent('#mensajeAsignar'));
  ok('y a Juan ya no le queda ese número',
     (await pv.locator('.vendedor', { hasText: 'Juan Pérez' }).textContent())
       .includes('Sin boletos asignados todavía'));

  // Un número que no existe en esta rifa de dos boletos.
  await pv.fill('#vdSueltos', '1, 99');
  await pv.click('#btnAsignar');
  await pv.waitForFunction(() =>
    document.getElementById('mensajeAsignar').textContent.includes('No existen en esta rifa'));
  ok('avisa de los números que no existen en la rifa, sin tronar con los demás',
     (await pv.textContent('#mensajeAsignar')).includes('99'), await pv.textContent('#mensajeAsignar'));

  // Quitarle a Ana sus boletos: doble toque, como el resto del panel.
  await pv.locator('.vendedor', { hasText: 'Ana López' }).getByText('Quitarle todos los boletos').click();
  await pv.waitForFunction(() =>
    document.getElementById('mensajeVendedores').textContent.includes('Toca otra vez'));
  ok('pide confirmar antes de quitar boletos', true);
  await pv.locator('.vendedor', { hasText: 'Ana López' }).getByText('Quitarle todos los boletos').click();
  await pv.waitForFunction(() =>
    document.getElementById('resumenAsignacion').textContent.includes('0 de 2'));
  ok('quita los boletos y el resumen vuelve a cero', true);

  // Archivar: deja de salir en el selector, sin tocar su historial.
  await pv.locator('.vendedor', { hasText: 'Juan Pérez' }).getByText('Archivar').click();
  await pv.locator('.vendedor', { hasText: 'Juan Pérez' }).getByText('Archivar').click();
  await pv.waitForFunction(() =>
    !document.getElementById('listaVendedores').textContent.includes('Juan Pérez'));
  ok('archivar lo saca de la lista y del selector',
     !(await pv.textContent('#vdSelector')).includes('Juan Pérez'));

  ok('sin errores de JavaScript en Vendedores', errV.length === 0, errV.join(' | '));
  await ctxV.close();
}

// ---------------------------------------------------------------- PERFIL ---
// Aparte y con su propio navegador: esta prueba cambia la clave del servidor
// de verdad, y si se colara en medio de las otras las dejaría fuera.
{
  console.log('\n== Perfil: cambiar la clave ==');
  const ctxP = await navegador.newContext({ serviceWorkers: 'block' });
  const pp = await ctxP.newPage();
  const errP = [];
  pp.on('pageerror', (e) => errP.push(String(e)));
  await pp.goto(BASE + '/panel.html');
  await pp.fill('#clave', 'secreta');
  await pp.click('#btnEntrar');
  await pp.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });
  await pp.click('.pestana[data-panel="panePerfil"]');
  ok('hay una pestaña Perfil y se abre', await pp.isVisible('#panePerfil'));

  const mensajeP = () => pp.textContent('#mensajePerfil');

  // Las tres negativas, antes de dejar cambiar nada.
  await pp.fill('#clActual', 'secreta');
  await pp.fill('#clNueva', 'corta');
  await pp.fill('#clRepetir', 'corta');
  await pp.click('#btnCambiarClave');
  ok('una clave de menos de ocho caracteres se rechaza',
     (await mensajeP()).includes('ocho caracteres'), await mensajeP());

  await pp.fill('#clNueva', 'clavenueva1');
  await pp.fill('#clRepetir', 'clavenueva2');
  await pp.click('#btnCambiarClave');
  ok('dos claves nuevas distintas se rechazan',
     (await mensajeP()).includes('no son iguales'), await mensajeP());

  // Y la actual mal tecleada: es lo que impide que un panel abierto y sin
  // dueño sirva para dejar al dueño fuera.
  await pp.fill('#clActual', 'noesesta');
  await pp.fill('#clNueva', 'clavenueva1');
  await pp.fill('#clRepetir', 'clavenueva1');
  await pp.click('#btnCambiarClave');
  await pp.waitForFunction(() =>
    document.getElementById('mensajePerfil').textContent.includes('incorrecta'), null, { timeout: 10000 });
  ok('con la clave actual mal tecleada, el servidor no cambia nada', true);

  // Ver las claves, igual que en la entrada.
  ok('las tres claves nacen ocultas',
     (await pp.getAttribute('#clActual', 'type')) === 'password' &&
     (await pp.getAttribute('#clNueva', 'type')) === 'password' &&
     (await pp.getAttribute('#clRepetir', 'type')) === 'password');
  await pp.check('#verClaves');
  ok('la casilla las enseña las tres',
     (await pp.getAttribute('#clActual', 'type')) === 'text' &&
     (await pp.getAttribute('#clNueva', 'type')) === 'text' &&
     (await pp.getAttribute('#clRepetir', 'type')) === 'text');
  await pp.uncheck('#verClaves');

  // Ahora sí, el cambio bueno.
  await pp.fill('#clActual', 'secreta');
  await pp.fill('#clNueva', 'clavenueva1');
  await pp.fill('#clRepetir', 'clavenueva1');
  await pp.click('#btnCambiarClave');
  await pp.waitForFunction(() =>
    document.getElementById('mensajePerfil').textContent.includes('quedó cambiada'), null, { timeout: 10000 });
  ok('la clave se cambia', true);
  ok('y los campos quedan vacíos, sin la clave a la vista',
     (await pp.inputValue('#clActual')) === '' && (await pp.inputValue('#clNueva')) === '');

  // Ya con una clave lo bastante larga, sí se alcanza esta negativa: antes el
  // largo saltaba primero y la tapaba.
  await pp.fill('#clActual', 'clavenueva1');
  await pp.fill('#clNueva', 'clavenueva1');
  await pp.fill('#clRepetir', 'clavenueva1');
  await pp.click('#btnCambiarClave');
  ok('poner de nuevo la clave que ya se tiene se rechaza',
     (await mensajeP()).includes('misma de antes'), await mensajeP());
  await pp.fill('#clActual', '');
  await pp.fill('#clNueva', '');
  await pp.fill('#clRepetir', '');

  // Lo que más importa: esta pantalla NO se queda hablando con la clave vieja.
  await pp.click('.pestana[data-panel="paneRifas"]');
  // Se espera a que la consulta TERMINE, no a que arranque: «Cargando…»
  // tampoco dice «incorrecta», así que mirar ahí daría un verde de mentira.
  await pp.waitForFunction(() =>
    document.getElementById('mensajeRifas').textContent !== 'Cargando…', null, { timeout: 10000 });
  ok('y la misma pantalla sigue trabajando con la clave nueva',
     (await pp.textContent('#mensajeRifas')) === '' &&
     (await pp.locator('#listaRifas .rifa').count()) > 0,
     'mensaje: «' + (await pp.textContent('#mensajeRifas')) + '» · rifas: ' +
     (await pp.locator('#listaRifas .rifa').count()));

  // Un aparato nuevo ya no entra con la vieja, y sí con la nueva.
  const otroP = await ctxP.newPage();
  otroP.on('pageerror', (e) => errP.push(String(e)));
  await otroP.goto(BASE + '/panel.html');
  await otroP.fill('#clave', 'secreta');
  await otroP.click('#btnEntrar');
  await otroP.waitForFunction(() =>
    document.getElementById('mensajeClave').textContent.includes('incorrecta'), null, { timeout: 10000 });
  ok('la clave vieja ya no sirve en otro aparato', true);
  await otroP.fill('#clave', 'clavenueva1');
  await otroP.click('#btnEntrar');
  await otroP.waitForSelector('#pestanas:not([hidden])', { timeout: 15000 });
  ok('y la nueva sí', true);

  // Se deja como estaba, para no ensuciarle el estado a nadie más. Hay que
  // volver a Perfil: la prueba anterior se fue a Rifas y este pane está oculto.
  await pp.click('.pestana[data-panel="panePerfil"]');
  await pp.fill('#clActual', 'clavenueva1');
  await pp.fill('#clNueva', 'secretaotra');
  await pp.fill('#clRepetir', 'secretaotra');
  await pp.click('#btnCambiarClave');
  await pp.waitForFunction(() =>
    document.getElementById('mensajePerfil').textContent.includes('quedó cambiada'), null, { timeout: 10000 });
  ok('y se puede volver a cambiar cuantas veces haga falta', true);

  ok('sin errores de JavaScript en Perfil', errP.length === 0, errP.join(' | '));
  await ctxP.close();
}

ok('sin errores de JavaScript en el panel', errores.length === 0, errores.join(' | '));
ok('sin errores de JavaScript en el boleto', err2.length === 0, err2.join(' | '));

await navegador.close();
servidor.kill();
console.log('\n' + (fallos.length ? 'FALLARON ' + fallos.length + ': ' + fallos.join(', ') : 'Todo pasó.'));
process.exit(fallos.length ? 1 : 0);
