#!/usr/bin/env node
/**
 * Genera el QR de acceso a la página de la rifa.
 *
 *   node web/rifa/tools/generar-qr.mjs "https://tu-dominio/rifa/" [salida-sin-extension]
 *
 * Escribe dos archivos junto a la página: un SVG (para imprimir a cualquier
 * tamaño) y un PNG en blanco y negro (para pegar en WhatsApp, Canva, etc.).
 * No requiere dependencias externas: usa la copia de qrcode-generator que
 * ya vive en web/rifa/vendor/.
 */
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const qrcode = require(resolve(aqui, '../vendor/qrcode.js'));

const texto = process.argv[2];
if (!texto) {
  console.error('Uso: node generar-qr.mjs "<url o texto>" [ruta-de-salida-sin-extension]');
  process.exit(1);
}
const salida = resolve(process.cwd(), process.argv[3] || resolve(aqui, '../qr-acceso'));

// --- Matriz del QR -------------------------------------------------------
const MARGEN = 4; // zona silenciosa que exige el estándar
const qr = qrcode(0, 'M'); // 0 = versión automática, M = 15% de corrección
qr.addData(texto);
qr.make();
const modulos = qr.getModuleCount();
const lado = modulos + MARGEN * 2;

const esOscuro = (fila, col) => {
  const f = fila - MARGEN;
  const c = col - MARGEN;
  return f >= 0 && f < modulos && c >= 0 && c < modulos && qr.isDark(f, c);
};

// --- SVG -----------------------------------------------------------------
const rectangulos = [];
for (let f = 0; f < lado; f++) {
  let inicio = -1;
  for (let c = 0; c <= lado; c++) {
    const oscuro = c < lado && esOscuro(f, c);
    if (oscuro && inicio < 0) { inicio = c; }
    if (!oscuro && inicio >= 0) {
      rectangulos.push(`<rect x="${inicio}" y="${f}" width="${c - inicio}" height="1"/>`);
      inicio = -1;
    }
  }
}
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="512" height="512" shape-rendering="crispEdges" role="img" aria-label="Código QR: ${texto.replace(/[<>&"]/g, '')}">\n` +
  `<rect width="${lado}" height="${lado}" fill="#ffffff"/>\n` +
  `<g fill="#000000">${rectangulos.join('')}</g>\n</svg>\n`;
writeFileSync(`${salida}.svg`, svg);

// --- PNG (escala de grises, 1 byte por píxel) ----------------------------
const ESCALA = 12;
const px = lado * ESCALA;

const crcTabla = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { c = crcTabla[(c ^ buf[i]) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (tipo, datos) => {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(px, 0);
ihdr.writeUInt32BE(px, 4);
ihdr[8] = 8;  // profundidad de bits
ihdr[9] = 0;  // color: escala de grises
ihdr[10] = 0; // compresión
ihdr[11] = 0; // filtro
ihdr[12] = 0; // entrelazado

const filas = Buffer.alloc((px + 1) * px);
for (let f = 0; f < lado; f++) {
  const plantilla = Buffer.alloc(px + 1, 0xff);
  plantilla[0] = 0; // tipo de filtro "None"
  for (let c = 0; c < lado; c++) {
    if (esOscuro(f, c)) { plantilla.fill(0x00, 1 + c * ESCALA, 1 + (c + 1) * ESCALA); }
  }
  for (let r = 0; r < ESCALA; r++) {
    plantilla.copy(filas, (f * ESCALA + r) * (px + 1));
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(filas, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(`${salida}.png`, png);

console.log(`QR generado para: ${texto}`);
console.log(`  ${salida}.svg  (vectorial, ideal para imprimir)`);
console.log(`  ${salida}.png  (${px}×${px} px)`);
