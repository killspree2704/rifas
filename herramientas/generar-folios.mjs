#!/usr/bin/env node
/**
 * Genera un lote de folios con su código de verificación.
 *
 *   node generar-folios.mjs --cantidad 500 --digitos 5 --serie A
 *
 * El código sale de HMAC-SHA256(LLAVE_RIFA, serie:folio) recortado a 4
 * caracteres en base32 de Crockford (sin I, L, O ni U, para que nadie
 * confunda un 1 con una I al teclearlo). La llave vive en la variable de
 * entorno LLAVE_RIFA y NUNCA se publica: quien la tenga puede fabricar
 * boletos válidos.
 *
 * Salida: JSON y CSV con folio, código y la ruta lista para el QR.
 */
import { createHmac, randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const LARGO_CODIGO = 4;

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf('--' + nombre);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const cantidad = parseInt(arg('cantidad', '10'), 10);
const digitos = parseInt(arg('digitos', '5'), 10);
const serie = arg('serie', 'A');
const salida = resolve(arg('salida', './lote'));
const llave = process.env.LLAVE_RIFA;

if (!llave) {
  console.error('Falta LLAVE_RIFA en el entorno. Genera una con:');
  console.error('  export LLAVE_RIFA=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  process.exit(1);
}

/** Código de verificación de un folio. Determinista: mismo folio, mismo código. */
export function codigoDe(serieBoleto, folio) {
  const mac = createHmac('sha256', llave).update(`${serieBoleto}:${folio}`).digest();
  let codigo = '';
  for (let i = 0; i < LARGO_CODIGO; i++) {
    codigo += ALFABETO[mac[i] % ALFABETO.length];
  }
  return codigo;
}

const minimo = Math.pow(10, digitos - 1);
const maximo = Math.pow(10, digitos) - 1;
if (cantidad > (maximo - minimo + 1) * 0.3) {
  console.error(`Pedir ${cantidad} folios de ${digitos} dígitos ocupa demasiado del espacio disponible.`);
  console.error('Sube los dígitos: mientras más disperso el lote, menos adivinable.');
  process.exit(1);
}

const usados = new Set();
while (usados.size < cantidad) {
  usados.add(randomInt(minimo, maximo + 1));
}

const boletos = [...usados].sort((a, b) => a - b).map((numero) => {
  const folio = String(numero);
  return { serie, folio, codigo: codigoDe(serie, folio), consulta: `?f=${folio}&c=${codigoDe(serie, folio)}` };
});

writeFileSync(`${salida}.json`, JSON.stringify({ serie, digitos, generado: new Date().toISOString(), boletos }, null, 2));
writeFileSync(
  `${salida}.csv`,
  ['serie,folio,codigo,consulta', ...boletos.map((b) => `${b.serie},${b.folio},${b.codigo},"${b.consulta}"`)].join('\n') + '\n'
);

console.log(`${boletos.length} folios de la serie ${serie}:\n`);
boletos.forEach((b) => console.log(`  ${b.serie}-${b.folio}   código ${b.codigo}`));
console.log(`\n  ${salida}.json`);
console.log(`  ${salida}.csv`);
