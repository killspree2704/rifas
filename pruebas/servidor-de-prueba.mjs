/**
 * Servidor de prueba: sirve el sitio real y finge ser Supabase.
 * No toca la base de verdad; solo comprueba que el panel y el boleto
 * hagan lo que deben con las respuestas que el servidor real daría.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// El mismo normalizador que usa el panel: si él cambia, la prueba lo nota.
// `fileURLToPath` y no `.pathname`: en Windows el pathname trae la unidad con
// una barra delante («/C:/Users/…») y ni `require` ni `spawn` la resuelven.
const normalizarYouTube = createRequire(import.meta.url)(
  fileURLToPath(new URL('../assets/youtube.js', import.meta.url)));

const RAIZ = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '');
// Cambia: el panel puede reemplazarla desde la pestaña «Perfil», y la prueba
// necesita ver que el cambio surte efecto de verdad.
let clavePanel = 'secreta';

// El diseño que heredará la próxima rifa creada, como `panel_ajustes`.
let disenoNuevo = null;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

// --- estado fingido ---------------------------------------------------------
const rifas = [{
  id: 'mm-2026-09', nombre: 'Rifa El Muerde Manos', serie: 'A', estado: 'espera',
  activa: true, folio_ganador: null,
  // Relativa a hoy, no fija: una fecha escrita a mano se vuelve pasado y la
  // prueba empieza a fallar sola, sin que nada se haya roto.
  fecha_sorteo: new Date(Date.now() + 3 * 86400000).toISOString(),
  // Con desfase explícito y no «Z»: a medianoche UTC, la zona del evento
  // (UTC-6) ya está en el día anterior, y una prueba que mida la fecha
  // impresa fallaría sola sin que nada se hubiera roto.
  revelado_en: null, creada_en: '2026-09-01T00:00:00-06:00', emision: null, precio_boleto: 50, folios_por_boleto: 4,
  transmision_url: null, transmite_desde: null,
}, {
  id: 'vieja-2025-01', nombre: 'Rifa de estreno', serie: 'Z', estado: 'cerrado',
  activa: false, folio_ganador: '90001', fecha_sorteo: '2025-01-10T18:00:00-06:00',
  revelado_en: '2025-01-10T18:30:00Z', creada_en: '2025-01-01T00:00:00Z', emision: null, precio_boleto: null, folios_por_boleto: 2,
  transmision_url: null, transmite_desde: null,
}];
rifas.push({
  id: 'pronto', nombre: 'Rifa que va a empezar', serie: 'P', estado: 'espera',
  activa: false, folio_ganador: null,
  // A minuto y medio: la pantalla del boleto entra en su ritmo rápido.
  fecha_sorteo: new Date(Date.now() + 90000).toISOString(),
  revelado_en: null, creada_en: new Date().toISOString(), emision: null, precio_boleto: null, folios_por_boleto: 2,
  transmision_url: null, transmite_desde: null,
});
rifas.push({
  id: 'suspendida', nombre: 'Rifa suspendida', serie: 'S', estado: 'cerrado',
  activa: false, folio_ganador: null, fecha_sorteo: '2025-06-01T18:00:00-06:00',
  revelado_en: null, creada_en: '2025-05-01T00:00:00Z', emision: null, precio_boleto: null, folios_por_boleto: 2,
  transmision_url: null, transmite_desde: null,
});
// Una rifa de nueve números por boleto, ya con la disposición vertical puesta:
// el boleto del cliente trae cuatro, pero el formulario acepta hasta diez y
// los nueve tienen que caber impresos.
rifas.push({
  id: 'generosa', nombre: 'Rifa de nueve números', serie: 'G', estado: 'cerrado',
  activa: false, folio_ganador: null, fecha_sorteo: '2025-08-01T18:00:00-06:00',
  // Una fecha de emisión distinta de la de creación, para probar que el
  // boleto imprime ESA y no `creada_en` cuando la primera existe. Con
  // desfase explícito: a medianoche UTC la zona del evento ya está en el
  // día anterior.
  revelado_en: null, creada_en: '2025-07-01T00:00:00-06:00', emision: '2025-07-15T00:00:00-06:00', precio_boleto: 100,
  folios_por_boleto: 9, transmision_url: null, transmite_desde: null,
  diseno: { disposicion: 'suertudito', tema: 'trebol', caducidad: '3 días' },
});
// Un boleto de papel con varios números. Igual que en el servidor de verdad:
// el código es del boleto, no de cada folio.
const boletos = {
  suspendida: [{ id: '9000000301', codigo: 'SSSS', folios: ['33301', '33302'] }],
  pronto: [
    { id: '9000000501', codigo: 'PPPP', folios: ['55501', '55502'] },
    { id: '9000000502', codigo: 'QQQQ', folios: ['55503', '55504'] },
  ],
  'mm-2026-09': [
    { id: '9000001052', codigo: 'R5VR', folios: ['11052', '11053', '11054', '11055'] },
    { id: '9000001060', codigo: 'EFGH', folios: ['11060', '11061', '11062', '11063'] },
  ],
  'vieja-2025-01': [{ id: '9000009001', codigo: 'ZZZZ', folios: ['90001', '90002'] }],
  generosa: [{
    id: '9000007001', codigo: 'NUE9',
    folios: ['70001', '70002', '70003', '70004', '70005', '70006', '70007', '70008', '70009'],
  }],
};
let contadorNuevas = 0;

function rifaDe(id) { return rifas.find((r) => r.id === id); }

/** Todos los folios de una rifa, como los devuelve el servidor real. */
function foliosDe(id) {
  return (boletos[id] || []).flatMap((b) => b.folios);
}

/** De un folio al boleto de papel que lo lleva, en cualquier rifa. */
/**
 * El folio ya no es único entre rifas —el sorteo de rango chico lo repite a
 * propósito—, así que puede haber VARIOS boletos, en rifas distintas, con el
 * mismo número. El código es lo que de verdad desempata: se busca el que
 * calce con los dos a la vez, igual que hace el servidor real.
 */
function boletoConFolio(folio, codigo) {
  for (const [id, lote] of Object.entries(boletos)) {
    const hit = lote.find((b) => b.folios.includes(folio) && b.codigo === codigo);
    if (hit) return [id, hit];
  }
  return [null, null];
}

function sorteo(cuerpo) {
  if (cuerpo.clave !== clavePanel) return [401, { error: 'clave incorrecta' }];
  const a = cuerpo.accion;

  if (a === 'cambiar_clave') {
    const nueva = String(cuerpo.nueva ?? '');
    if (nueva.length < 8) return [400, { error: 'la clave nueva necesita ocho caracteres o más' }];
    if (nueva === cuerpo.clave) return [400, { error: 'la clave nueva es la misma de antes' }];
    clavePanel = nueva;
    return [200, { ok: true }];
  }

  if (a === 'rifas') {
    const verArchivadas = cuerpo.archivadas === true;
    return [200, {
      rifas: rifas.filter((r) => !!r.archivada === verArchivadas).map((r) => ({
        ...r, boletos: (boletos[r.id] || []).length, folios: foliosDe(r.id).length,
      })),
      diseno_nuevo: disenoNuevo,
    }];
  }
  if (a === 'guardar_diseno') {
    const entrada = cuerpo.diseno;
    let d = null;
    if (entrada) {
      if (!['clasico', 'sobrio', 'feria', 'menta', 'oro', 'noche', 'trebol', 'bono'].includes(entrada.tema)) {
        return [400, { error: 'ese tema no existe' }];
      }
      // La forma, no el catálogo: igual que el servidor de verdad.
      if (!/^[a-z]{3,20}$/.test(String(entrada.trama))) {
        return [400, { error: 'esa trama no es válida' }];
      }
      if (!['clasica', 'suertudito', 'bono'].includes(entrada.disposicion)) {
        return [400, { error: 'esa disposición no existe' }];
      }
      for (const [campo, cual] of [['fondo', 'fondo'], ['tinta', 'letra'],
                                   ['acento', 'números'], ['borde', 'marco']]) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(entrada[campo]))) {
          return [400, { error: `el color de ${cual} no es válido` }];
        }
      }
      const tono = Number(entrada.tono ?? 0);
      if (!Number.isInteger(tono) || tono < 0 || tono > 360) {
        return [400, { error: 'el tono debe ser un entero entre 0 y 360' }];
      }
      // Reconstruye SOLO los campos que el servidor de verdad guarda —no un
      // passthrough del objeto entero—: así, si el panel manda un campo
      // nuevo que el servidor de verdad todavía no conoce (pasó con `tono`:
      // se veía bien en la vista previa y se perdía solo al guardar, porque
      // `limpiarDiseno()` reconstruye un objeto con una lista fija de
      // campos, no copia el que le llega), la prueba lo nota en vez de
      // dejarlo pasar de panza.
      d = {
        tema: entrada.tema, fondo: entrada.fondo, tinta: entrada.tinta,
        acento: entrada.acento, borde: entrada.borde, logo: entrada.logo || '',
        aviso: String(entrada.aviso || '').slice(0, 200),
        columnas: Number(entrada.columnas) || 2, trama: entrada.trama,
        intensidad: entrada.intensidad, disposicion: entrada.disposicion,
        caducidad: String(entrada.caducidad || '').slice(0, 40), tono,
      };
    }
    // Sin rifa: es el diseño que heredará la próxima que se cree.
    if (!cuerpo.rifa) {
      disenoNuevo = d;
      return [200, { diseno_nuevo: disenoNuevo }];
    }
    const r = rifaDe(cuerpo.rifa);
    if (!r) return [404, { error: 'rifa no encontrada' }];
    r.diseno = d;
    return [200, { rifa: { id: r.id, diseno: r.diseno } }];
  }
  if (a === 'boletos') {
    const r = rifaDe(cuerpo.rifa);
    if (!r) return [404, { error: 'rifa no encontrada' }];
    // SOLO los campos que el servidor de verdad devuelve en esta acción.
    // Antes se mandaba la rifa entera y eso tapaba un hueco: la hoja usaba
    // `creada_en` para la fecha de emisión y el servidor real no la incluía
    // en su `select`, pero aquí sí llegaba y la prueba pasaba igual.
    const ficha = {
      id: r.id, nombre: r.nombre, serie: r.serie, fecha_sorteo: r.fecha_sorteo,
      creada_en: r.creada_en, emision: r.emision ?? null, precio_boleto: r.precio_boleto,
      folios_por_boleto: r.folios_por_boleto, diseno: r.diseno,
    };
    return [200, { rifa: ficha, boletos: boletos[r.id] || [] }];
  }
  if (a === 'verificar') {
    // Se puede preguntar por el boleto (con su código) o por cualquiera de
    // sus números, que es lo que sale de la tómbola.
    let id = null, hit = null;
    if (cuerpo.boleto) {
      for (const [rid, lote] of Object.entries(boletos)) {
        const b = lote.find((x) => x.id === cuerpo.boleto);
        if (b) { id = rid; hit = b; break; }
      }
    } else {
      [id, hit] = boletoConFolio(cuerpo.folio, String(cuerpo.codigo || '').toUpperCase());
    }
    if (!hit) return [200, { valido: false }];
    // El código se exige por los dos caminos: sin él esto no confirma nada.
    if (hit.codigo !== String(cuerpo.codigo).toUpperCase()) return [200, { valido: false }];
    const r = rifaDe(id);
    return [200, {
      valido: true, boleto: hit.id, codigo: hit.codigo, folios: hit.folios, rifa: r,
      ganador: !!r.folio_ganador && hit.folios.includes(r.folio_ganador),
      folio_ganador: r.folio_ganador,
    }];
  }
  if (a === 'crear_rifa') {
    if (!cuerpo.nombre) return [400, { error: 'falta el nombre de la rifa' }];
    const porBoleto = cuerpo.folios_por_boleto || 4;
    const digitos = cuerpo.digitos || 4;
    const tope = Number.isInteger(cuerpo.tope) && cuerpo.tope > 0 ? cuerpo.tope : null;
    const totalFolios = cuerpo.cantidad * porBoleto;
    if (tope && totalFolios > tope) {
      return [400, { error: `${totalFolios} folios no caben en un tope de ${tope}` }];
    }
    const id = 'nueva-' + (++contadorNuevas);
    const nueva = { id, nombre: cuerpo.nombre, serie: cuerpo.serie, estado: 'espera', activa: false,
      folio_ganador: null, fecha_sorteo: cuerpo.fecha_sorteo, emision: cuerpo.fecha_emision || null,
      precio_boleto: cuerpo.precio, folios_por_boleto: porBoleto,
      // El diseño se copia, no se referencia: igual que en el servidor real.
      diseno: disenoNuevo };
    rifas.unshift(nueva);

    // Con tope: sorteo de rango chico, números que SÍ se repiten entre
    // rifas —barajado de 1 a `tope`, igual que hace el servidor real—.
    // Sin tope: la numeración de siempre del servidor de prueba, única
    // dentro de esta corrida.
    let numeros = null;
    if (tope) {
      numeros = Array.from({ length: tope }, (_, i) => i + 1);
      for (let i = numeros.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numeros[i], numeros[j]] = [numeros[j], numeros[i]];
      }
      numeros = numeros.slice(0, totalFolios).map((n) => String(n).padStart(digitos, '0'));
    }

    const lote = [];
    let siguiente = 70000 + contadorNuevas * 1000;
    let cursor = 0;
    for (let i = 0; i < cuerpo.cantidad; i++) {
      const suyos = [];
      for (let j = 0; j < porBoleto; j++) suyos.push(tope ? numeros[cursor++] : String(siguiente++));
      lote.push({
        id: String(8000000000 + contadorNuevas * 1000 + i),
        // Con el número de rifa adentro, no solo el del boleto: el código
        // real se firma sobre el id del boleto y nunca se repite entre
        // rifas, así que el de prueba tampoco debe repetirse.
        codigo: 'C' + String(contadorNuevas).padStart(2, '0') + String(i).padStart(2, '0'), folios: suyos,
      });
    }
    boletos[id] = lote;
    return [200, {
      rifa: { ...nueva, boletos: lote.length, folios: lote.length * porBoleto },
      boletos: lote,
    }];
  }
  if (a === 'activar') {
    rifas.forEach((r) => { r.activa = r.id === cuerpo.rifa; });
    return [200, { rifa: rifaDe(cuerpo.rifa) }];
  }
  // Archivar NO borra nada: solo deja de salir en el historial de siempre.
  // El borrado de verdad no tiene acción aquí a propósito — solo pasa a
  // mano, directo en la base, cuando lo pide quien administra el proyecto.
  if (a === 'archivar_rifa' || a === 'reactivar_rifa') {
    const r = rifaDe(cuerpo.rifa);
    if (!r) return [404, { error: 'rifa no encontrada' }];
    r.archivada = a === 'archivar_rifa';
    const eraActiva = r.activa;
    if (r.archivada && r.activa) r.activa = false;
    return [200, { id: r.id, archivada: r.archivada, era_activa: eraActiva }];
  }
  if (a === 'fijar_emision') {
    const r2 = rifaDe(cuerpo.rifa);
    if (!r2) return [400, { error: 'falta la rifa' }];
    r2.emision = cuerpo.fecha_emision || null;
    return [200, { rifa: { id: r2.id, emision: r2.emision } }];
  }
  if (a === 'fijar_precio') {
    const r2 = rifaDe(cuerpo.rifa);
    if (!r2) return [400, { error: 'falta la rifa' }];
    const crudo = cuerpo.precio;
    const precio = crudo === undefined || crudo === null || crudo === '' ? null : Number(crudo);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return [400, { error: 'el precio debe ser un número mayor o igual a cero' }];
    }
    r2.precio_boleto = precio;
    return [200, { rifa: { id: r2.id, precio_boleto: r2.precio_boleto } }];
  }

  const r = rifaDe(cuerpo.rifa);
  if (!r) return [404, { error: 'rifa no encontrada' }];
  const folios = foliosDe(r.id);
  if (a === 'estado') return [200, { rifa: r, folios }];

  if (a === 'transmision') {
    const crudo = String(cuerpo.transmision || '').trim();
    if (crudo && !normalizarYouTube(crudo)) {
      return [400, { error: 'eso no parece un enlace de YouTube' }];
    }
    r.transmision_url = crudo ? normalizarYouTube(crudo) : null;
    return [200, { rifa: r, folios }];
  }

  if (r.folio_ganador && a !== 'cerrar') return [409, { error: 'ya tiene ganador' }];

  const marca = (v) => {
    const s = String(v || '');
    const c = s.lastIndexOf('|');
    return c > 0 ? { etiqueta: s.slice(0, c), id: s.slice(c + 1), crudo: s } : null;
  };

  if (a === 'en_vivo') {
    const quien = marca(cuerpo.dispositivo);
    const dueno = marca(r.transmite_desde);
    if (dueno && quien && dueno.id !== quien.id && cuerpo.forzar !== true) {
      return [409, { error: `ya se está transmitiendo desde ${dueno.etiqueta}`,
                     transmite_desde: r.transmite_desde }];
    }
    const crudo = String(cuerpo.transmision || '').trim();
    if (crudo) {
      const limpio = normalizarYouTube(crudo);
      if (!limpio) return [400, { error: 'eso no parece un enlace de YouTube' }];
      r.transmision_url = limpio;
    }
    r.estado = 'en_vivo';
    r.transmite_desde = quien ? quien.crudo : null;
  }
  else if (a === 'espera') { r.estado = 'espera'; r.transmite_desde = null; }
  else if (a === 'cerrar') { r.estado = 'cerrado'; r.transmite_desde = null; }
  else if (a === 'revelar') {
    const g = cuerpo.folio || folios[0];
    if (!folios.includes(g)) return [400, { error: `el folio ${g} no pertenece a esta rifa` }];
    r.estado = 'revelado'; r.folio_ganador = g;
  } else return [400, { error: 'acción desconocida' }];
  return [200, { rifa: r, folios }];
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (req.method === 'POST') {
    let datos = '';
    req.on('data', (t) => { datos += t; });
    req.on('end', () => {
      const cuerpo = JSON.parse(datos || '{}');
      let estado = 200, salida;
      if (url.pathname === '/functions/v1/sorteo') { [estado, salida] = sorteo(cuerpo); }
      else if (url.pathname === '/rest/v1/rpc/rifa_de_boleto') {
        salida = [];
        for (const [id, lote] of Object.entries(boletos)) {
          const hit = lote.find((b) => b.id === cuerpo.p_boleto &&
            b.codigo.toUpperCase() === String(cuerpo.p_codigo).toUpperCase());
          if (hit) { const r = rifaDe(id); salida = [{ id: r.id, nombre: r.nombre, serie: r.serie,
            estado: r.estado, folio_ganador: r.folio_ganador, fecha_sorteo: r.fecha_sorteo,
            transmision_url: r.transmision_url, folios: hit.folios }]; }
        }
      } else { estado = 404; salida = { error: 'no' }; }
      res.writeHead(estado, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(salida));
    });
    return;
  }

  // Lectura del estado, como la hace PostgREST.
  if (url.pathname === '/rest/v1/rifas') {
    const filtro = (url.searchParams.get('id') || '').replace(/^eq\./, '');
    const encontradas = rifas.filter((r) => !filtro || r.id === filtro);
    const uno = String(req.headers.accept || '').includes('pgrst.object');
    res.writeHead(uno && !encontradas.length ? 406 : 200,
      { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify(uno ? (encontradas[0] || null) : encontradas));
  }

  let ruta = url.pathname === '/' ? '/index.html' : url.pathname;
  const archivo = resolve(join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ) || !existsSync(archivo)) { res.writeHead(404); return res.end('no'); }

  // La configuración apunta al Supabase de verdad; aquí se desvía a este mismo
  // servidor para no tocar nada real durante la prueba.
  if (ruta === '/assets/config.js') {
    const texto = readFileSync(archivo, 'utf8')
      .replace(/supabaseUrl: '[^']*'/, "supabaseUrl: 'http://localhost:8891'");
    res.writeHead(200, { ...cors, 'content-type': TIPOS['.js'] });
    return res.end(texto);
  }
  res.writeHead(200, { ...cors, 'content-type': TIPOS[extname(archivo)] || 'application/octet-stream' });
  res.end(readFileSync(archivo));
})
  .on('error', (e) => {
    console.error(e.code === 'EADDRINUSE'
      ? 'El puerto 8891 ya está ocupado: cierra la otra corrida antes de esta.'
      : e.message);
    process.exit(1);
  })
  .listen(8891);
