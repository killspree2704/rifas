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
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:8891';

// El servidor de prueba se levanta aquí para que cada corrida empiece limpia.
const servidor = spawn(process.execPath, [new URL('./servidor-de-prueba.mjs', import.meta.url).pathname],
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
ok('lista todo el historial', tarjetas.length === 4, tarjetas.length + ' tarjetas');
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
await pagina.waitForSelector('#listaRifas .rifa:nth-child(5)');
ok('la rifa nueva entra al historial', (await pagina.$$('#listaRifas .rifa')).length === 5);
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

  ok('ofrece los seis temas', (await pg.locator('.tema').count()) === 6,
     String(await pg.locator('.tema').count()));

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
  await hojaD.close();

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
