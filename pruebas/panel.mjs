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

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ serviceWorkers: 'block' });
const pagina = await ctx.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
let cuerpoCreacion = null;
pagina.on('request', (r) => {
  if (r.url().endsWith('/functions/v1/sorteo') && r.postData() &&
      r.postData().includes('crear_rifa')) { cuerpoCreacion = JSON.parse(r.postData()); }
});

// ---------------------------------------------------------------- PANEL ----
console.log('\n== Panel ==');
await pagina.goto(BASE + '/panel.html');
await pagina.waitForSelector('#clave');

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
ok('el subtítulo trae fecha y boletos',
   /Serie A · 3 boletos · 13 sep\.? 2026, 06:00 p\. ?m\./.test(await pagina.textContent('#subtitulo')),
   await pagina.textContent('#subtitulo'));

// --- pestaña Rifas ---
console.log('\n== Rifas ==');
await pagina.click('.pestana[data-panel="paneRifas"]');
await pagina.waitForSelector('#listaRifas .rifa');
const tarjetas = await pagina.$$('#listaRifas .rifa');
ok('lista todo el historial', tarjetas.length === 3, tarjetas.length + ' tarjetas');
ok('marca cuál se está manejando', await pagina.isVisible('#listaRifas .rifa.manejando'));
const textoVieja = await pagina.locator('.rifa', { hasText: 'Rifa de estreno' }).textContent();
ok('la rifa vieja conserva su ganador', textoVieja.includes('Ganador: Z-90001'), textoVieja.trim().replace(/\s+/g,' '));
const textoNueva = await pagina.locator('.rifa', { hasText: 'Rifa El Muerde Manos' }).textContent();
ok('calcula el ingreso cuando hay precio', textoNueva.includes('$50 c/u') && textoNueva.includes('$150.00 en total'),
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
ok('la hoja trae un boleto por folio', boletosHoja.length === 2, boletosHoja.length + ' boletos');
ok('imprime folio con su serie', (await hoja.textContent('.boleto .folio')) === 'Z-90001');
ok('imprime el código de verificación', (await hoja.textContent('.boleto .codigo')) === 'Código ZZZZ');
ok('trae botón de imprimir/PDF', await hoja.isVisible('button'));

// el QR tiene que decodificarse de verdad
const caja = await hoja.$('.boleto .qr');
const foto = await caja.screenshot({ scale: 'css' });
const png = PNG.sync.read(foto);
const leido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
ok('el QR se lee y apunta al boleto correcto',
   !!leido && leido.data === BASE + '/?f=90001&c=ZZZZ', leido ? leido.data : 'no se pudo leer');
await hoja.close();

// --- crear una rifa nueva ---
console.log('\n== Nueva rifa ==');
await pagina.click('#cajaNueva > summary');
ok('la casilla de boletos arranca vacía: el número lo elige quien crea la rifa',
   (await pagina.inputValue('#nvCantidad')) === '',
   JSON.stringify(await pagina.inputValue('#nvCantidad')));
ok('y dice cuántos caben con los dígitos puestos',
   (await pagina.textContent('#cuentaNueva')).includes('27,000'),
   await pagina.textContent('#cuentaNueva'));

await pagina.click('#atajosCantidad button[data-cantidad="25"]');
ok('los atajos llenan la casilla', (await pagina.inputValue('#nvCantidad')) === '25');
ok('y el resumen lo dice en voz alta',
   (await pagina.textContent('#cuentaNueva')).includes('25 boletos de 5 dígitos'),
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
ok('la hoja nueva sale con su serie', (await hoja2.textContent('.boleto .folio')).startsWith('B-'),
   await hoja2.textContent('.boleto .folio'));
await hoja2.close();
await pagina.waitForSelector('#listaRifas .rifa:nth-child(4)');
ok('la rifa nueva entra al historial', (await pagina.$$('#listaRifas .rifa')).length === 4);

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
await p2.goto(BASE + '/?f=90001&c=ZZZZ');
await p2.waitForSelector('#vistaResultado:not([hidden])', { timeout: 15000 });
ok('un boleto viejo abre en su propio resultado', true);
ok('lo pone a nombre de su rifa, no de la activa',
   (await p2.textContent('#tituloRifa')) === 'Rifa de estreno', await p2.textContent('#tituloRifa'));
ok('con su serie', (await p2.textContent('#folio')) === 'Z-90001', await p2.textContent('#folio'));
ok('y le dice que ganó', (await p2.textContent('#veredicto')).includes('Ganaste'),
   await p2.textContent('#veredicto'));

// boleto de la rifa en espera
await p2.goto(BASE + '/?f=11052&c=R5VR');
await p2.waitForSelector('#vistaEspera:not([hidden])', { timeout: 15000 });
ok('un boleto de la rifa pendiente ve la cuenta regresiva', true);
ok('con el nombre de su rifa', (await p2.textContent('#tituloRifa')) === 'Rifa El Muerde Manos');
ok('y su serie', (await p2.textContent('#folio')) === 'A-11052', await p2.textContent('#folio'));

// boleto falso
await p2.goto(BASE + '/?f=11052&c=0000');
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
ok('un folio bueno enseña su código para comparar con el talón',
   (await pagina.textContent('#cotejoCodigo')) === 'código R5VR',
   await pagina.textContent('#cotejoCodigo'));
ok('con su serie delante',
   (await pagina.textContent('#cotejoNumero')) === 'A-11052',
   await pagina.textContent('#cotejoNumero'));
ok('y ahora sí se puede revelar', !(await pagina.isDisabled('#btnRevelarFolio')));

// acepta el folio tal como viene impreso, con la serie pegada
await pagina.fill('#folioGanador', 'A-11053');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoCodigo').textContent === 'código ABCD', null, { timeout: 10000 });
ok('acepta el folio tecleado con la serie, como viene en el boleto', true);

// cambiar el folio tiene que tumbar una confirmación a medias
await pagina.click('#btnRevelarFolio');
await pagina.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
await pagina.fill('#folioGanador', '11054');
await pagina.waitForFunction(() =>
  document.getElementById('cotejoCodigo').textContent === 'código EFGH', null, { timeout: 10000 });
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
await p3.goto(BASE + '/?f=55501&c=PPPP');
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

// revelar
await pagina.fill('#folioGanador', '55502');
await pagina.click('#btnRevelarFolio');
await pagina.waitForFunction(() => document.getElementById('mensaje').textContent.includes('confirmar'));
ok('revelar pide confirmación', true);
await pagina.click('#btnRevelarFolio');
// El refresco de cortesía puede reescribir el aviso con la otra redacción
// («Folio ganador: … registrado y bloqueado»). Las dos dicen lo mismo, así
// que lo que se comprueba es que el folio quede a la vista.
await pagina.waitForFunction(() =>
  document.getElementById('mensaje').textContent.includes('55502'));
ok('queda registrado el ganador', true);
ok('y ya no deja volver a revelar', await pagina.isDisabled('#btnRevelarFolio'));
ok('ni regresar a espera', await pagina.isDisabled('#btnEspera'));

await p3.waitForSelector('#vistaResultado:not([hidden])', { timeout: 25000 });
ok('el teléfono se entera del resultado solo', true);
ok('y a este folio le toca perder',
   (await p3.textContent('#veredicto')).includes('No ganaste'), await p3.textContent('#veredicto'));
ok('pero le dice cuál ganó',
   (await p3.textContent('#notaResultado')).includes('55502'), await p3.textContent('#notaResultado'));
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

ok('sin errores de JavaScript en el panel', errores.length === 0, errores.join(' | '));
ok('sin errores de JavaScript en el boleto', err2.length === 0, err2.join(' | '));

await navegador.close();
servidor.kill();
console.log('\n' + (fallos.length ? 'FALLARON ' + fallos.length + ': ' + fallos.join(', ') : 'Todo pasó.'));
process.exit(fallos.length ? 1 : 0);
