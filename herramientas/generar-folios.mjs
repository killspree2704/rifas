#!/usr/bin/env node
/**
 * Genera un lote de boletos, cada uno con sus folios y su código.
 *
 *   node generar-folios.mjs --cantidad 500 --digitos 5 --serie A --por-boleto 4
 *
 * Un boleto de papel lleva varios números: cada uno es una oportunidad de
 * ganar el mismo premio. El código se firma sobre el BOLETO, no sobre cada
 * folio, porque el papel lleva un solo código para todos sus números.
 *
 * El código sale de HMAC-SHA256(LLAVE_RIFA, serie:boleto) recortado a 4
 * caracteres en base32 de Crockford (sin I, L, O ni U, para que nadie
 * confunda un 1 con una I al teclearlo). La llave vive en la variable de
 * entorno LLAVE_RIFA y NUNCA se publica: quien la tenga puede fabricar
 * boletos válidos.
 *
 * Salida: JSON y CSV con el boleto, sus folios, su código y la ruta del QR.
 *
 * Para el día a día no hace falta: el panel hace esto solo. Sirve si alguna
 * vez quieres generar boletos desde la terminal.
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
const porBoleto = parseInt(arg('por-boleto', '4'), 10);
const DIGITOS_BOLETO = 10;
const serie = arg('serie', 'A');
const salida = resolve(arg('salida', './lote'));
const llave = process.env.LLAVE_RIFA;

if (!llave) {
  console.error('Falta LLAVE_RIFA en el entorno. Genera una con:');
  console.error('  export LLAVE_RIFA=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  process.exit(1);
}

/** Código del boleto. Determinista: mismo boleto, mismo código. */
export function codigoDe(serieBoleto, boleto) {
  const mac = createHmac('sha256', llave).update(`${serieBoleto}:${boleto}`).digest();
  let codigo = '';
  for (let i = 0; i < LARGO_CODIGO; i++) {
    codigo += ALFABETO[mac[i] % ALFABETO.length];
  }
  return codigo;
}

if (!(porBoleto >= 1 && porBoleto <= 10)) {
  console.error('--por-boleto debe ir de 1 a 10.');
  process.exit(1);
}

/** Números al azar sin repetir, dentro de un espacio de tantos dígitos. */
function unicos(cuantos, cuantosDigitos, etiqueta) {
  const minimo = Math.pow(10, cuantosDigitos - 1);
  const maximo = Math.pow(10, cuantosDigitos) - 1;
  if (cuantos > (maximo - minimo + 1) * 0.3) {
    console.error(`Pedir ${cuantos} ${etiqueta} de ${cuantosDigitos} dígitos ocupa demasiado del espacio disponible.`);
    console.error('Sube los dígitos: mientras más disperso el lote, menos adivinable.');
    process.exit(1);
  }
  const usados = new Set();
  while (usados.size < cuantos) usados.add(String(randomInt(minimo, maximo + 1)));
  return [...usados];
}

// Los folios se revuelven antes de repartirlos: si los cuatro de un papel
// fueran consecutivos, ver uno daría pistas de los otros tres.
const folios = unicos(cantidad * porBoleto, digitos, 'folios');
for (let i = folios.length - 1; i > 0; i--) {
  const j = randomInt(0, i + 1);
  [folios[i], folios[j]] = [folios[j], folios[i]];
}

const identificadores = unicos(cantidad, DIGITOS_BOLETO, 'boletos').sort();

const boletos = identificadores.map((id, i) => {
  const suyos = folios.slice(i * porBoleto, (i + 1) * porBoleto).sort();
  const codigo = codigoDe(serie, id);
  return { serie, boleto: id, folios: suyos, codigo, consulta: `?b=${id}&c=${codigo}` };
});

writeFileSync(`${salida}.json`, JSON.stringify(
  { serie, digitos, folios_por_boleto: porBoleto, generado: new Date().toISOString(), boletos }, null, 2));
writeFileSync(
  `${salida}.csv`,
  ['serie,boleto,codigo,folios,consulta',
   ...boletos.map((b) => `${b.serie},${b.boleto},${b.codigo},"${b.folios.join(' ')}","${b.consulta}"`)].join('\n') + '\n'
);

console.log(`${boletos.length} boletos de la serie ${serie}, ${porBoleto} números cada uno:\n`);
boletos.forEach((b) => console.log(
  `  boleto ${b.boleto}  código ${b.codigo}   ${b.folios.map((f) => serie + '-' + f).join('  ')}`));
console.log(`\n  ${salida}.json`);
console.log(`  ${salida}.csv`);
