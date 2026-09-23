#!/usr/bin/env node
/**
 * Arma la hoja imprimible de boletos: sus números, su código y su QR.
 *
 * Un boleto lleva varios números —cada uno es una oportunidad de ganar el
 * mismo premio— y un solo QR, que apunta al boleto entero.
 *
 *   node herramientas/hoja-boletos.mjs lote.json "https://killspree2704.github.io/rifas/" hoja.html
 *
 * Cada QR queda incrustado como SVG dentro del HTML, así que la hoja se abre
 * e imprime sin conexión y sin depender de ningún servicio.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const qrcode = require(resolve(aqui, '../vendor/qrcode.js'));

const [rutaLote, base, rutaSalida] = process.argv.slice(2);
if (!rutaLote || !base) {
  console.error('Uso: node hoja-boletos.mjs <lote.json> <url-base> [salida.html]');
  process.exit(1);
}

const lote = JSON.parse(readFileSync(resolve(rutaLote), 'utf8'));
const salida = resolve(rutaSalida || 'hoja-boletos.html');

/** QR en SVG, sin dependencias en tiempo de impresión. */
function qrSvg(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const margen = 4;
  const lado = n + margen * 2;
  const rects = [];
  for (let f = 0; f < n; f++) {
    let inicio = -1;
    for (let c = 0; c <= n; c++) {
      const oscuro = c < n && qr.isDark(f, c);
      if (oscuro && inicio < 0) inicio = c;
      if (!oscuro && inicio >= 0) {
        rects.push(`<rect x="${inicio + margen}" y="${f + margen}" width="${c - inicio}" height="1"/>`);
        inicio = -1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="QR del boleto"><rect width="${lado}" height="${lado}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}

const separador = base.includes('?') ? '&' : '?';
const porBoleto = lote.folios_por_boleto || (lote.boletos[0]?.folios?.length ?? 1);
const totalFolios = lote.boletos.reduce((n, b) => n + (b.folios || []).length, 0);

const boletos = lote.boletos.map((b) => {
  const url = `${base}${separador}b=${b.boleto}&c=${b.codigo}`;
  const numeros = (b.folios || []).map((f) => `<span class="num">${f}</span>`).join('');
  return `<article class="boleto">
    <p class="marca">${lote.nombre || 'Rifa'}</p>
    <p class="aviso">El boleto se anulará si se encuentra roto, con tachones, borrones o enmendaduras.</p>
    <div class="medio">
      <div class="numeros">${numeros}</div>
      <div class="qr">${qrSvg(url)}</div>
    </div>
    <p class="pie"><span class="serial">${b.boleto}</span><span class="codigo">Código ${b.codigo}</span></p>
  </article>`;
}).join('\n');

writeFileSync(salida, `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<title>Boletos ${lote.serie || ''} — ${lote.boletos.length}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #fff; color: #111; }
  h1 { font-size: 14pt; margin: 0 0 8mm; }
  .rejilla { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm; }
  .boleto { border: 1px solid #333; border-radius: 2mm; padding: 3mm 4mm; break-inside: avoid; }
  .marca { font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; text-align: center; margin: 0 0 1mm; }
  .aviso { font-size: 5.5pt; color: #444; text-align: center; margin: 0 0 2mm; line-height: 1.25; }
  .medio { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }
  /* En rejilla de dos: cuatro números quedan cuadrados, y con uno o dos la
     caja no se deforma. */
  .numeros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5mm; flex: 1 1 auto; }
  .num {
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14pt; font-weight: 700;
    color: #c2185b; border: 0.4mm solid #333; border-radius: 1mm; padding: 0.8mm 1mm;
    text-align: center; letter-spacing: 0.03em;
  }
  .pie { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; margin: 2mm 0 0; font-size: 6.5pt; color: #444; }
  .serial { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.06em; }
  .codigo { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.1em; }
  .qr { width: 19mm; flex: 0 0 auto; }
  .qr svg { width: 100%; height: auto; display: block; }
  @media print { h1 { display: none; } }
</style></head>
<body>
  <h1>${lote.boletos.length} boletos · ${totalFolios} números (${porBoleto} por boleto) · serie ${lote.serie} · ${base}</h1>
  <div class="rejilla">
${boletos}
  </div>
</body></html>
`);

console.log(`Hoja con ${lote.boletos.length} boletos (${totalFolios} números): ${salida}`);
console.log(`URL base: ${base}`);
