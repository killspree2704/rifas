/**
 * Todo lo que el panel puede hacer contra la rifa.
 *
 * Autenticación propia: cada llamada trae la clave del panel y se compara
 * contra el hash guardado en `panel_clave`, que el navegador no puede leer.
 * Por eso la función va sin verify_jwt: la puerta es la clave.
 *
 * Aquí vive también la llave con la que se firman los códigos de los boletos.
 * Nunca sale de este lado: si saliera, cualquiera podría fabricar boletos.
 */
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Base32 de Crockford: sin I, L, O ni U, para que nadie confunda un 1 con una
// I al teclear el código impreso en el boleto.
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LARGO_CODIGO = 4;

// Dígitos del identificador del boleto de papel. Es lo que viaja en el QR y
// lo que se teclea para verificar, así que va largo: no se saca a mano.
const DIGITOS_BOLETO = 10;

// Cuántos folios lleva cada boleto si no se pide otra cosa.
const FOLIOS_POR_BOLETO = 4;

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(texto: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante: no filtra cuántos caracteres acertó. */
function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

async function claveValida(clave: string) {
  if (!clave) return false;
  const { data } = await db.from("panel_clave").select("hash").eq("id", 1).single();
  if (!data?.hash) return false;
  return iguales(await sha256Hex(clave), data.hash);
}

// ---------------------------------------------------------------------------
// Candado contra fuerza bruta de la clave
// ---------------------------------------------------------------------------
/*
 * El retraso de 700ms de abajo es por PETICIÓN: alguien con varias conexiones
 * a la vez prueba muchas claves en paralelo sin que ese retraso se les sume
 * entre ellas. Este candado es la pieza que sí lo frena: una sola cuenta de
 * fallos para TODOS los intentos —no por IP, porque la clave es una sola,
 * compartida—, incrementada de forma atómica en la base (`registrar_fallo_
 * clave`, evita la carrera de dos peticiones leyendo y escribiendo el mismo
 * número a la vez). Al llegar al umbral, la clave se congela un rato, sin
 * importar de dónde vengan los intentos.
 */
const CANDADO_UMBRAL = 10;      // intentos fallidos seguidos que lo disparan
const CANDADO_MINUTOS = 15;     // cuánto dura el bloqueo

async function candadoBloqueadoHasta(): Promise<Date | null> {
  const { data } = await db
    .from("panel_candado").select("bloqueado_hasta").eq("id", 1).maybeSingle();
  if (!data?.bloqueado_hasta) return null;
  const hasta = new Date(data.bloqueado_hasta);
  return hasta.getTime() > Date.now() ? hasta : null;
}

async function registrarFalloClave() {
  await db.rpc("registrar_fallo_clave", { umbral: CANDADO_UMBRAL, minutos: CANDADO_MINUTOS });
}

async function limpiarCandadoClave() {
  await db.rpc("limpiar_candado_clave");
}

async function anotar(rifa: string, evento: string, detalle: unknown) {
  await db.from("sorteo_log").insert({ rifa_id: rifa, evento, detalle });
}

// ---------------------------------------------------------------------------
// Folios y códigos
// ---------------------------------------------------------------------------
async function firmante() {
  const { data } = await db.from("llave_firma").select("llave").eq("id", 1).single();
  if (!data?.llave) throw new Error("no hay llave de firma configurada");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(data.llave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * El código impreso en el boleto. Determinista: mismo boleto, mismo código.
 *
 * Se firma el boleto, no cada folio: el papel lleva un solo código para sus
 * cuatro números, igual que lleva un solo QR.
 */
async function codigoDe(llave: CryptoKey, serie: string, boleto: string) {
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(`${serie}:${boleto}`)),
  );
  let codigo = "";
  for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO[firma[i] % ALFABETO.length];
  return codigo;
}

/**
 * Un entero al azar en [0, tope), repartido parejo.
 *
 * `getRandomValues` sobre un Uint32 da 32 bits, y eso se queda corto en dos
 * sentidos. Uno: no alcanza a cubrir un espacio de diez dígitos —9.000
 * millones—, así que `azar % espacio` dejaba fuera todo lo que pasara de
 * 5.294.967.295 y ningún boleto podía empezar con 6, 7, 8 ni 9. Dos: tomar el
 * residuo reparte de más los valores bajos, aunque el espacio sí quepa.
 *
 * Aquí se toman 53 bits —lo que un número de JavaScript representa exacto— y
 * se descarta lo que caiga en la cola incompleta. Así todos los valores salen
 * con la misma probabilidad, valga lo que valga el tope. Importa: un lote
 * predecible es un lote adivinable, y el folio ganador se saca con esto mismo.
 */
function azarHasta(tope: number) {
  const bytes = new Uint8Array(7);
  const limite = Math.floor(Math.pow(2, 53) / tope) * tope;
  for (;;) {
    crypto.getRandomValues(bytes);
    let n = 0;
    for (let i = 0; i < 6; i++) n = n * 256 + bytes[i];   // 48 bits
    n = n * 32 + (bytes[6] & 31);                         // 53 en total
    if (n < limite) return n % tope;
  }
}

/** Cuáles de estos números ya existen. Se pregunta a la base, por tandas. */
async function yaUsados(tabla: string, columna: string, candidatos: string[]) {
  const usados = new Set<string>();
  for (let i = 0; i < candidatos.length; i += 500) {
    const tanda = candidatos.slice(i, i + 500);
    const { data, error } = await db.from(tabla).select(columna).in(columna, tanda);
    if (error) throw new Error(`no se pudo comprobar los ${columna}: ` + error.message);
    for (const fila of data ?? []) usados.add((fila as Record<string, string>)[columna]);
  }
  return usados;
}

/**
 * Números al azar que no chocan con NINGUNO de ninguna rifa, nunca.
 *
 * Quién está ocupado lo dice la base en cada vuelta, no una lista traída de
 * antemano: la columna es la llave primaria de toda la historia, y una lista
 * puede venir recortada sin avisar. Así el lote sale limpio aunque haya
 * decenas de miles de boletos viejos.
 *
 * Sirve igual para los folios (`folios.folio`) que para el identificador del
 * boleto de papel (`boletos.id`): son dos espacios de números separados, y
 * ninguno de los dos se repite jamás.
 */
async function generarUnicos(cantidad: number, digitos: number, tabla: string, columna: string) {
  const minimo = Math.pow(10, digitos - 1);
  const espacio = Math.pow(10, digitos) - minimo;
  if (cantidad > espacio * 0.3) {
    throw new Error(
      `${cantidad} folios de ${digitos} dígitos ocupan demasiado del espacio disponible; usa más dígitos`,
    );
  }

  const nuevos = new Set<string>();

  for (let vuelta = 0; nuevos.size < cantidad; vuelta++) {
    if (vuelta > 20) throw new Error("no se pudieron generar folios suficientes; usa más dígitos");
    const candidatos = new Set<string>();
    // Se piden de más para que una vuelta baste casi siempre.
    const faltan = cantidad - nuevos.size;
    let intentos = 0;
    while (candidatos.size < faltan && intentos < faltan * 200) {
      intentos++;
      const folio = String(minimo + azarHasta(espacio));
      if (!nuevos.has(folio)) candidatos.add(folio);
    }
    const ocupados = await yaUsados(tabla, columna, [...candidatos]);
    for (const numero of candidatos) if (!ocupados.has(numero)) nuevos.add(numero);
  }

  return [...nuevos].slice(0, cantidad).sort();
}

/**
 * Folios de rango chico: el sorteo tradicional de canastas con bolitas por
 * dígito —una canasta por posición, cada una con sus propias bolitas—, no
 * una tómbola con un papelito por boleto vendido. El número más alto que
 * puede salir es `tope` (por ejemplo 999, o 1999 si la primera canasta ya
 * trae una bolita más), y el sorteo real reparte CUALQUIER número de 1 a
 * `tope` con la misma probabilidad, lo hayan vendido o no todavía: por eso
 * aquí no hace falta —ni tendría sentido— comprobar contra lo ya usado en
 * otras rifas. El mismo 0347 puede salir en esta rifa y en la siguiente;
 * lo que los distingue a la hora de verificar es el código firmado de cada
 * boleto, no el número.
 *
 * Se eligen `cantidad` números SIN REPETIRSE dentro de esta misma rifa —eso
 * sí importa: dos boletos de la misma rifa no pueden compartir número—, con
 * un barajado de Fisher-Yates sobre el espacio completo de 1 a `tope`. Nada
 * de consultar la base: como el tope es chico (unos cuantos miles cuando
 * mucho) y la rifa es nueva, no hay con qué chocar todavía.
 */
function foliosDeRangoChico(cantidad: number, tope: number, digitos: number): string[] {
  const espacio = Array.from({ length: tope }, (_, i) => i + 1);
  for (let i = espacio.length - 1; i > 0; i--) {
    const j = azarHasta(i + 1);
    [espacio[i], espacio[j]] = [espacio[j], espacio[i]];
  }
  return espacio.slice(0, cantidad).map((n) => String(n).padStart(digitos, "0")).sort();
}

/**
 * Reparte los folios entre los boletos, en orden.
 *
 * Los folios de un mismo boleto NO son consecutivos ni guardan relación: cada
 * uno salió del mismo sorteo ciego que todos los demás. Que estén juntos en un
 * papel no los hace parientes, y así nadie puede adivinar los otros tres
 * teniendo uno.
 */
function repartir<T>(lista: T[], porGrupo: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < lista.length; i += porGrupo) grupos.push(lista.slice(i, i + porGrupo));
  return grupos;
}

// ---------------------------------------------------------------------------
// Diseño del boleto impreso
// ---------------------------------------------------------------------------
/*
 * Lo que llega aquí termina dentro de una hoja de estilos que el panel arma
 * en el navegador del operador. Un color no es un dato cualquiera: se escribe
 * tal cual en un `style`, así que se admite exactamente la forma de un color
 * y nada más. El panel ya filtra igual; esto es lo que manda, porque una
 * comprobación que solo vive en el navegador no comprueba nada.
 *
 * Ya no hay temas, tramas ni logo que armar aquí: el boleto se ve como la
 * FOTO que el dueño sube, medida por fuera con `herramientas/medir_plantilla.py`
 * (el mismo trabajo a mano que antes se copiaba dentro de este código para
 * «Suertudito» y «Bono Gana Hoy», ahora sin necesitar un despliegue nuevo por
 * cada plantilla). Sin plantilla, el boleto sale con el diseño clásico fijo
 * que ya trae `assets/panel.js` —sin colores que elegir—.
 */
const COLOR = /^#[0-9a-fA-F]{6}$/;
// Toda la foto del boleto, no un logo: pesa más, pero sigue siendo una sola
// imagen de unos cuantos cientos de KB ya comprimida por el panel.
const PLANTILLA_FOTO_MAX = 2 * 1024 * 1024;

/** Una medida de 0 a 100 (porcentaje), tal como la entrega medir_plantilla.py. */
function medida(valor: unknown, cual: string): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`la medida «${cual}» de la plantilla no es válida`);
  return Math.round(n * 100) / 100;
}

function limpiarCaja(entrada: unknown, cual: string) {
  if (!entrada || typeof entrada !== "object") throw new Error(`a la plantilla le falta «${cual}»`);
  const c = entrada as Record<string, unknown>;
  return { left: medida(c.left, cual), width: medida(c.width, cual), top: medida(c.top, cual), height: medida(c.height, cual) };
}

function limpiarPie(entrada: unknown) {
  if (!entrada || typeof entrada !== "object") throw new Error("a la plantilla le falta «pie»");
  const c = entrada as Record<string, unknown>;
  return { left: medida(c.left, "pie"), right: medida(c.right, "pie"), top: medida(c.top, "pie"), height: medida(c.height, "pie") };
}

function limpiarCuadricula(entrada: unknown) {
  if (!entrada || typeof entrada !== "object") throw new Error("a la plantilla le falta «caja»");
  const c = entrada as Record<string, unknown>;
  const columna = c.columna;
  if (!Array.isArray(columna) || columna.length !== 2) {
    throw new Error("la columna de la plantilla no es válida");
  }
  return {
    primer: medida(c.primer, "caja"), ultimo: medida(c.ultimo, "caja"),
    alto: medida(c.alto, "caja"), ancho: medida(c.ancho, "caja"),
    columna: [medida(columna[0], "caja"), medida(columna[1], "caja")] as [number, number],
  };
}

function limpiarPlantilla(entrada: unknown) {
  // Nulo es legítimo: significa «el boleto clásico de siempre», sin foto.
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada !== "object") throw new Error("la plantilla no es válida");
  const p = entrada as Record<string, unknown>;

  const foto = String(p.foto ?? "");
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(foto)) {
    throw new Error("la foto de la plantilla no es una imagen válida");
  }
  if (foto.length > PLANTILLA_FOTO_MAX) throw new Error("la foto de la plantilla pesa demasiado");

  const fotoAncho = Number(p.fotoAncho);
  const fotoAlto = Number(p.fotoAlto);
  if (!Number.isInteger(fotoAncho) || fotoAncho <= 0 || !Number.isInteger(fotoAlto) || fotoAlto <= 0) {
    throw new Error("el tamaño de la foto no es válido");
  }

  const color = (valor: unknown, cual: string) => {
    const texto = String(valor ?? "");
    if (!COLOR.test(texto)) throw new Error(`el color de ${cual} en la plantilla no es válido`);
    return texto.toLowerCase();
  };

  const resultado: Record<string, unknown> = {
    foto, fotoAncho, fotoAlto,
    fondo: color(p.fondo, "fondo"),
    tinta: color(p.tinta, "letra"),
    acento: color(p.acento, "números"),
    borde: color(p.borde, "marco"),
    caja: limpiarCuadricula(p.caja),
    qr: limpiarCaja(p.qr, "qr"),
    precio: limpiarCaja(p.precio, "precio"),
    pie: limpiarPie(p.pie),
  };

  // Opcional: no todas las fotos traen un hueco propio que tapar (ver
  // «Bono Gana Hoy», donde ese lugar lo ocupa el QR).
  if (p.fechas && typeof p.fechas === "object") {
    const f = p.fechas as Record<string, unknown>;
    resultado.fechas = {
      ...limpiarCaja(f, "fechas"),
      vertical: !!f.vertical,
      fuente: Number(f.fuente) > 0 ? Number(f.fuente) : 1.5,
    };
  }

  return resultado;
}

function limpiarDiseno(entrada: unknown) {
  // Nulo es legítimo: significa «el de siempre».
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada !== "object") throw new Error("el diseño no es válido");
  const d = entrada as Record<string, unknown>;

  const columnas = Number(d.columnas ?? 2);
  if (columnas !== 1 && columnas !== 2 && columnas !== 3) {
    throw new Error("los boletos por renglón deben ser 1, 2 o 3");
  }

  return {
    plantilla: limpiarPlantilla(d.plantilla),
    aviso: String(d.aviso ?? "").slice(0, 200),
    columnas,
    caducidad: String(d.caducidad ?? "").slice(0, 40),
  };
}

// ---------------------------------------------------------------------------
// Transmisión
// ---------------------------------------------------------------------------
/**
 * Reconoce un enlace de YouTube y lo deja en su forma canónica.
 *
 * La misma lógica está en `assets/youtube.js`, que avisa al instante mientras
 * se escribe. Esta es la que manda: una comprobación que solo vive en el
 * navegador no comprueba nada.
 */
const ID_VIDEO = /^[A-Za-z0-9_-]{11}$/;

function normalizarYouTube(entrada: unknown): string | null {
  let texto = String(entrada ?? "").trim();
  if (!texto) return null;
  if (!/^https?:\/\//i.test(texto)) texto = "https://" + texto;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const partes = url.pathname.split("/").filter(Boolean);
  const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

  if (host === "youtu.be") {
    return ID_VIDEO.test(partes[0] ?? "") ? watch(partes[0]) : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  if (partes[0] === "watch") {
    const v = url.searchParams.get("v") ?? "";
    return ID_VIDEO.test(v) ? watch(v) : null;
  }
  if ((partes[0] === "live" || partes[0] === "embed" || partes[0] === "shorts") && partes[1]) {
    return ID_VIDEO.test(partes[1]) ? watch(partes[1]) : null;
  }
  // Enlace permanente al directo de un canal: se pega una vez y sirve siempre.
  if (partes[partes.length - 1] === "live" && partes.length >= 2) {
    const canal = partes[0];
    if (canal.startsWith("@") && canal.length > 1) {
      return `https://www.youtube.com/${canal}/live`;
    }
    if ((canal === "channel" || canal === "c" || canal === "user") && partes[1]) {
      return `https://www.youtube.com/${canal}/${partes[1]}/live`;
    }
  }
  return null;
}

/** Etiqueta e identificador del aparato, tal como los manda el panel. */
function aparato(valor: unknown) {
  const crudo = String(valor ?? "").trim().slice(0, 80);
  const corte = crudo.lastIndexOf("|");
  if (corte < 1) return null;
  return { etiqueta: crudo.slice(0, corte), id: crudo.slice(corte + 1), crudo };
}

/** Un identificador legible y único para la rifa. */
function idDeRifa(nombre: string, fecha: string, usados: Set<string>) {
  const base = (nombre || "rifa")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20) || "rifa";
  const dia = (fecha || "").slice(0, 10).replace(/-/g, "");
  let id = `${base}-${dia}`;
  let n = 2;
  while (usados.has(id)) id = `${base}-${dia}-${n++}`;
  return id;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "método no permitido" }, 405);

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: "cuerpo inválido" }, 400);
  }

  const accion = String(cuerpo.accion ?? "");
  const clave = String(cuerpo.clave ?? "");
  if (!accion) return responder({ error: "falta la acción" }, 400);

  const bloqueadoHasta = await candadoBloqueadoHasta();
  if (bloqueadoHasta) {
    const minutos = Math.max(1, Math.ceil((bloqueadoHasta.getTime() - Date.now()) / 60000));
    return responder(
      { error: `demasiados intentos fallidos; vuelve a intentar en ${minutos} minuto(s)` },
      429,
    );
  }

  if (!(await claveValida(clave))) {
    // Un respiro para que probar claves al por mayor no sea gratis, y se
    // anota el fallo: diez seguidos —vengan de una conexión o de muchas a la
    // vez— congelan la clave, no solo retrasan la siguiente petición.
    await new Promise((r) => setTimeout(r, 700));
    await registrarFalloClave();
    return responder({ error: "clave incorrecta" }, 401);
  }
  // Clave correcta: se borra cualquier racha de fallos que venía de antes.
  await limpiarCandadoClave();

  // ---- Acciones que no dependen de una rifa concreta ----------------------

  /**
   * Reemplazar la clave del panel.
   *
   * Llegar hasta aquí ya prueba que quien pide el cambio sabe la clave actual:
   * la comprobación de arriba es la misma para todas las acciones, y el panel
   * manda en `clave` la que se acaba de teclear, no la que trae guardada de
   * cuando se entró. Esa diferencia es el punto: un panel abierto y sin dueño
   * no alcanza para dejar al dueño fuera.
   *
   * De la clave no se guarda la clave, solo su huella. Por eso perderla no
   * tiene vuelta atrás y aquí no hay forma de «recuperarla»: se reemplaza.
   */
  if (accion === "cambiar_clave") {
    const nueva = String(cuerpo.nueva ?? "");
    if (nueva.length < 8) {
      return responder({ error: "la clave nueva necesita ocho caracteres o más" }, 400);
    }
    if (nueva === clave) {
      return responder({ error: "la clave nueva es la misma de antes" }, 400);
    }
    const { error } = await db
      .from("panel_clave")
      .update({ hash: await sha256Hex(nueva), actualizado_en: new Date().toISOString() })
      .eq("id", 1);
    if (error) {
      return responder({ error: "no se pudo cambiar la clave: " + error.message }, 400);
    }
    // No se anota en `sorteo_log`: esa bitácora cuelga de una rifa, y un cambio
    // de clave no pertenece a ninguna. La hora queda en `actualizado_en`, que
    // es justo lo que hay que saber y no revela nada.
    return responder({ ok: true });
  }

  /**
   * El histórico. Nada se borra nunca —ni los folios, ni la bitácora—,
   * «archivar» solo saca una rifa de esta lista; con `archivadas: true` se
   * pide la otra pila, la de lo archivado.
   */
  if (accion === "rifas") {
    const verArchivadas = cuerpo.archivadas === true;
    const { data: rifas } = await db
      .from("rifas")
      .select("id, nombre, serie, estado, activa, folio_ganador, fecha_sorteo, revelado_en, creada_en, emision, precio_boleto, transmision_url, folios_por_boleto, diseno, archivada")
      .eq("archivada", verArchivadas)
      .order("fecha_sorteo", { ascending: false });
    const { data: boletos } = await db.from("boletos").select("rifa_id");
    const { data: folios } = await db.from("folios").select("rifa_id");
    const conteo: Record<string, number> = {};
    for (const b of boletos ?? []) conteo[b.rifa_id] = (conteo[b.rifa_id] ?? 0) + 1;
    const conteoFolios: Record<string, number> = {};
    for (const f of folios ?? []) conteoFolios[f.rifa_id] = (conteoFolios[f.rifa_id] ?? 0) + 1;
    // Y el diseño que heredará la próxima rifa: el panel lo necesita para que
    // la pestaña «Diseño» sirva aunque todavía no exista ninguna rifa.
    const { data: ajustes } = await db
      .from("panel_ajustes").select("diseno").eq("id", 1).maybeSingle();

    return responder({
      rifas: (rifas ?? []).map((r) => ({
        ...r,
        boletos: conteo[r.id] ?? 0,
        folios: conteoFolios[r.id] ?? 0,
      })),
      diseno_nuevo: ajustes?.diseno ?? null,
    });
  }

  /**
   * Biblioteca de plantillas guardadas, con nombre propio.
   *
   * Medir una foto de boleto —los nueve pasos del medidor, o el archivo que
   * salga de ahí— cuesta lo mismo la primera vez que la quinta, si no queda
   * guardada en ningún lado más que en la rifa donde se usó. Esto es
   * justo lo que deja elegir una ya medida en vez de repetir el trabajo:
   * vive aparte de `rifas.diseno` —que es LA plantilla puesta en una rifa—,
   * es la lista de donde se elige.
   */
  if (accion === "plantillas") {
    const { data, error } = await db
      .from("plantillas_guardadas")
      .select("id, nombre, plantilla, creada_en, actualizada_en")
      .order("actualizada_en", { ascending: false });
    if (error) return responder({ error: error.message }, 400);
    return responder({ plantillas: data ?? [] });
  }

  /** Guarda una plantilla nueva, o reemplaza una existente si llega `id`. */
  if (accion === "guardar_plantilla") {
    const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 60);
    if (!nombre) return responder({ error: "ponle un nombre a la plantilla" }, 400);
    let limpia: ReturnType<typeof limpiarPlantilla>;
    try {
      limpia = limpiarPlantilla(cuerpo.plantilla);
    } catch (e) {
      return responder({ error: (e as Error).message }, 400);
    }
    if (!limpia) return responder({ error: "falta la plantilla" }, 400);

    const id = cuerpo.id ? String(cuerpo.id) : null;
    if (id) {
      const { data, error } = await db
        .from("plantillas_guardadas")
        .update({ nombre, plantilla: limpia, actualizada_en: new Date().toISOString() })
        .eq("id", id)
        .select("id, nombre, plantilla, creada_en, actualizada_en")
        .maybeSingle();
      if (error) return responder({ error: error.message }, 400);
      if (!data) return responder({ error: "esa plantilla ya no existe" }, 404);
      return responder({ plantilla: data });
    }
    const { data, error } = await db
      .from("plantillas_guardadas")
      .insert({ nombre, plantilla: limpia })
      .select("id, nombre, plantilla, creada_en, actualizada_en")
      .single();
    if (error) return responder({ error: error.message }, 400);
    return responder({ plantilla: data });
  }

  /** Solo el nombre: no hace falta volver a medir para corregir un título. */
  if (accion === "renombrar_plantilla") {
    const id = String(cuerpo.id ?? "");
    const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 60);
    if (!id) return responder({ error: "falta cuál plantilla" }, 400);
    if (!nombre) return responder({ error: "ponle un nombre a la plantilla" }, 400);
    const { data, error } = await db
      .from("plantillas_guardadas")
      .update({ nombre, actualizada_en: new Date().toISOString() })
      .eq("id", id)
      .select("id, nombre, plantilla, creada_en, actualizada_en")
      .maybeSingle();
    if (error) return responder({ error: error.message }, 400);
    if (!data) return responder({ error: "esa plantilla ya no existe" }, 404);
    return responder({ plantilla: data });
  }

  /**
   * Borra una plantilla de la biblioteca. No toca ninguna rifa: una rifa que
   * ya la tenía puesta se queda exactamente igual, esto solo la saca de la
   * lista de donde se elige para una rifa nueva.
   */
  if (accion === "borrar_plantilla") {
    const id = String(cuerpo.id ?? "");
    if (!id) return responder({ error: "falta cuál plantilla" }, 400);
    const { error } = await db.from("plantillas_guardadas").delete().eq("id", id);
    if (error) return responder({ error: error.message }, 400);
    return responder({ ok: true });
  }

  /** Los boletos de una rifa, para reimprimir la hoja cuando haga falta. */
  if (accion === "boletos") {
    const rifaPedida = String(cuerpo.rifa ?? "");
    if (!rifaPedida) return responder({ error: "falta la rifa" }, 400);
    const { data: ficha } = await db
      .from("rifas").select("id, nombre, serie, fecha_sorteo, creada_en, emision, precio_boleto, folios_por_boleto, diseno")
      .eq("id", rifaPedida).maybeSingle();
    if (!ficha) return responder({ error: "rifa no encontrada" }, 404);
    const { data: lote } = await db
      .from("boletos").select("id, codigo").eq("rifa_id", rifaPedida).order("id");
    const { data: sueltos } = await db
      .from("folios").select("folio, boleto_id").eq("rifa_id", rifaPedida).order("folio");

    const porBoleto: Record<string, string[]> = {};
    for (const f of sueltos ?? []) (porBoleto[f.boleto_id] ??= []).push(f.folio);

    return responder({
      rifa: ficha,
      boletos: (lote ?? []).map((b) => ({ ...b, folios: porBoleto[b.id] ?? [] })),
    });
  }

  /**
   * ¿Es original este boleto? La doble confirmación, sin escanear nada.
   *
   * Se puede llegar al papel de dos maneras: por el identificador del boleto,
   * que es lo que trae el QR, o por CUALQUIERA de sus números, que es lo que
   * está impreso en grande. Las dos llevan al mismo boleto.
   *
   * El código se exige SIEMPRE, por los dos caminos. Esta pantalla existe para
   * confirmar que un papel es original, y eso solo lo prueba el código: sin
   * él, teclear cualquier número daría «boleto original». Quien verifica tiene
   * el papel en la mano, así que tiene los dos datos.
   */
  if (accion === "verificar") {
    const pedidoBoleto = String(cuerpo.boleto ?? "").trim();
    const pedidoFolio = String(cuerpo.folio ?? "").trim();
    const codigo = String(cuerpo.codigo ?? "").trim().toUpperCase();
    if (!pedidoBoleto && !pedidoFolio) return responder({ error: "falta el boleto o el folio" }, 400);
    if (!codigo) return responder({ error: "falta el código" }, 400);

    let idBoleto = pedidoBoleto;
    if (!idBoleto) {
      // El folio ya no es único entre rifas —se reparte en números chicos,
      // pensados para repetirse de una rifa a otra—, así que puede haber
      // VARIOS boletos con este mismo número, de rifas distintas. El código
      // es lo que de verdad desempata: se comprueba contra cada candidato,
      // no solo contra el primero que aparezca. Que dos boletos de rifas
      // distintas compartan folio Y código firmado es, en la práctica,
      // imposible.
      const { data: sueltos } = await db.from("folios").select("boleto_id").eq("folio", pedidoFolio);
      const candidatos = (sueltos ?? []).map((f) => f.boleto_id);
      if (!candidatos.length) return responder({ valido: false });
      const { data: boletosCandidatos } = await db
        .from("boletos").select("id, codigo").in("id", candidatos);
      const hit = (boletosCandidatos ?? []).find((b) => b.codigo.toUpperCase() === codigo);
      if (!hit) return responder({ valido: false });
      idBoleto = hit.id;
    }

    const { data: boleto } = await db
      .from("boletos").select("id, codigo, rifa_id").eq("id", idBoleto).maybeSingle();
    if (!boleto) return responder({ valido: false });
    if (boleto.codigo.toUpperCase() !== codigo) return responder({ valido: false });

    const { data: sueltos } = await db
      .from("folios").select("folio").eq("boleto_id", boleto.id).order("folio");
    const folios = (sueltos ?? []).map((f) => f.folio);

    const { data: rifa } = await db
      .from("rifas")
      .select("id, nombre, serie, estado, folio_ganador, fecha_sorteo")
      .eq("id", boleto.rifa_id)
      .single();

    return responder({
      valido: true,
      boleto: boleto.id,
      codigo: boleto.codigo,
      folios,
      rifa,
      ganador: !!rifa?.folio_ganador && folios.includes(rifa.folio_ganador),
      folio_ganador: rifa?.folio_ganador ?? null,
    });
  }

  /** Crear una rifa con su lote de boletos, cada uno con sus folios. */
  if (accion === "crear_rifa") {
    const nombre = String(cuerpo.nombre ?? "").trim();
    const fecha = String(cuerpo.fecha_sorteo ?? "").trim();
    const cantidad = Number(cuerpo.cantidad ?? 0);
    const digitos = Number(cuerpo.digitos ?? 5);
    const porBoleto = Number(cuerpo.folios_por_boleto ?? FOLIOS_POR_BOLETO);
    const serie = String(cuerpo.serie ?? "A").trim().toUpperCase().slice(0, 3) || "A";
    const precio = cuerpo.precio === undefined || cuerpo.precio === null || cuerpo.precio === ""
      ? null
      : Number(cuerpo.precio);
    // Nulo es legítimo: significa «imprime con la fecha de creación», que es
    // lo que siempre pasó. Solo se guarda si de verdad se escribió una.
    const fechaEmisionCruda = String(cuerpo.fecha_emision ?? "").trim();
    if (fechaEmisionCruda && isNaN(Date.parse(fechaEmisionCruda))) {
      return responder({ error: "la fecha de emisión no es válida" }, 400);
    }
    const emision = fechaEmisionCruda || null;

    if (!nombre) return responder({ error: "falta el nombre de la rifa" }, 400);
    if (!fecha || isNaN(Date.parse(fecha))) return responder({ error: "la fecha del sorteo no es válida" }, 400);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 5000) {
      return responder({ error: "la cantidad de boletos debe ir de 1 a 5000" }, 400);
    }
    if (!Number.isInteger(digitos) || digitos < 4 || digitos > 8) {
      return responder({ error: "los dígitos del folio deben ir de 4 a 8" }, 400);
    }
    if (!Number.isInteger(porBoleto) || porBoleto < 1 || porBoleto > 10) {
      return responder({ error: "los folios por boleto deben ir de 1 a 10" }, 400);
    }
    // El tope es OPCIONAL: sin él, el folio sigue siendo único entre TODAS
    // las rifas, como siempre (`generarUnicos`, espacio grande y al azar).
    // Con él, se activa el sorteo de rango chico —el de las canastas con
    // bolitas por dígito—: números de 1 a `tope`, que SÍ se pueden repetir
    // entre una rifa y otra, porque el candado contra la falsificación ya
    // no depende de que el número sea raro, depende del código firmado.
    const topeCrudo = cuerpo.tope;
    const tope = topeCrudo === undefined || topeCrudo === null || topeCrudo === ""
      ? null : Number(topeCrudo);
    if (tope !== null) {
      if (!Number.isInteger(tope) || tope < 1 || tope > Math.pow(10, digitos) - 1) {
        return responder({ error: `el tope debe ser un entero entre 1 y ${Math.pow(10, digitos) - 1}` }, 400);
      }
    }

    const { data: rifasPrevias } = await db.from("rifas").select("id");
    const idsUsados = new Set((rifasPrevias ?? []).map((r) => r.id));

    // Un folio por oportunidad: si son 200 boletos de 4, son 800 números, y
    // los 800 tienen que caber holgados en el espacio de dígitos elegido (o,
    // con tope, caber dentro del tope).
    const totalFolios = cantidad * porBoleto;
    if (tope !== null && totalFolios > tope) {
      return responder({
        error: `${totalFolios} folios no caben en un tope de ${tope}; sube el tope o baja la cantidad`,
      }, 400);
    }

    let folios: string[];
    let identificadores: string[];
    try {
      folios = tope !== null
        ? foliosDeRangoChico(totalFolios, tope, digitos)
        : await generarUnicos(totalFolios, digitos, "folios", "folio");
      identificadores = await generarUnicos(cantidad, DIGITOS_BOLETO, "boletos", "id");
    } catch (e) {
      return responder({ error: (e as Error).message }, 400);
    }

    // Los folios salieron ordenados del generador. Se revuelven antes de
    // repartirlos para que los cuatro de un mismo papel no queden vecinos:
    // con números seguidos, ver uno daría pistas de los otros tres.
    for (let i = folios.length - 1; i > 0; i--) {
      const j = azarHasta(i + 1);
      [folios[i], folios[j]] = [folios[j], folios[i]];
    }

    // El diseño se COPIA, no se referencia: a partir de aquí es de esta rifa y
    // cambiar el de omisión no reescribe ninguna hoja ya impresa.
    const { data: ajustes } = await db
      .from("panel_ajustes").select("diseno").eq("id", 1).maybeSingle();

    const id = idDeRifa(nombre, fecha, idsUsados);
    const { error: errorRifa } = await db.from("rifas").insert({
      id, nombre, serie, fecha_sorteo: fecha, estado: "espera", activa: false,
      precio_boleto: precio, folios_por_boleto: porBoleto, emision,
      diseno: ajustes?.diseno ?? null,
    });
    if (errorRifa) return responder({ error: errorRifa.message }, 400);

    /** Deshacer una rifa a medias: mejor nada que un lote incompleto. */
    const deshacer = async () => {
      await db.from("folios").delete().eq("rifa_id", id);
      await db.from("boletos").delete().eq("rifa_id", id);
      await db.from("rifas").delete().eq("id", id);
    };

    const llave = await firmante();
    const grupos = repartir(folios, porBoleto);
    const boletos = [];
    const filasBoletos = [];
    const filasFolios = [];
    for (let i = 0; i < identificadores.length; i++) {
      const idBoleto = identificadores[i];
      const codigo = await codigoDe(llave, serie, idBoleto);
      const suyos = (grupos[i] ?? []).slice().sort();
      boletos.push({ id: idBoleto, codigo, folios: suyos });
      filasBoletos.push({ id: idBoleto, rifa_id: id, codigo });
      for (const folio of suyos) filasFolios.push({ folio, boleto_id: idBoleto, rifa_id: id });
    }

    // De 500 en 500 para no mandar una sola petición gigantesca. Primero los
    // boletos: los folios apuntan a ellos.
    for (const [tabla, filas] of [["boletos", filasBoletos], ["folios", filasFolios]] as const) {
      for (let i = 0; i < filas.length; i += 500) {
        const { error } = await db.from(tabla).insert(filas.slice(i, i + 500));
        if (error) {
          await deshacer();
          return responder({ error: "no se pudo guardar el lote: " + error.message }, 400);
        }
      }
    }

    await anotar(id, "crear_rifa", {
      boletos: boletos.length, folios: filasFolios.length, folios_por_boleto: porBoleto, digitos, serie,
    });
    return responder({
      rifa: {
        id, nombre, serie, fecha_sorteo: fecha, estado: "espera", activa: false,
        boletos: boletos.length, folios: filasFolios.length, folios_por_boleto: porBoleto,
        precio_boleto: precio, emision,
      },
      boletos,
    });
  }

  /**
   * Corregir la fecha de emisión de un lote ya creado.
   *
   * Separada de `crear_rifa` porque a veces el lote se manda a imprimir días
   * después de armar la rifa en el sistema, y de eso uno no se entera hasta
   * tener la fecha real en la mano. No toca folios ni boletos, así que no hay
   * razón para bloquearla ni con la rifa cerrada: reimprimir con la fecha
   * correcta sigue siendo válido.
   */
  if (accion === "fijar_emision") {
    const rifaPedida = String(cuerpo.rifa ?? "");
    if (!rifaPedida) return responder({ error: "falta la rifa" }, 400);
    const cruda = String(cuerpo.fecha_emision ?? "").trim();
    if (cruda && isNaN(Date.parse(cruda))) {
      return responder({ error: "la fecha de emisión no es válida" }, 400);
    }
    const emision = cruda || null;
    const { data, error } = await db
      .from("rifas").update({ emision }).eq("id", rifaPedida)
      .select("id, emision").maybeSingle();
    if (error) return responder({ error: error.message }, 400);
    if (!data) return responder({ error: "rifa no encontrada" }, 404);
    await anotar(rifaPedida, "emision", { emision });
    return responder({ rifa: data });
  }

  /**
   * Corregir el precio impreso de un lote ya creado.
   *
   * Separado de `crear_rifa` por la misma razón que `fijar_emision`: un
   * precio mal tecleado al crear la rifa se nota después, y no toca folios
   * ni boletos, así que corregirlo sigue siendo válido aunque la rifa ya
   * esté cerrada.
   */
  if (accion === "fijar_precio") {
    const rifaPedida = String(cuerpo.rifa ?? "");
    if (!rifaPedida) return responder({ error: "falta la rifa" }, 400);
    const crudo = cuerpo.precio;
    const precio = crudo === undefined || crudo === null || crudo === ""
      ? null
      : Number(crudo);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return responder({ error: "el precio debe ser un número mayor o igual a cero" }, 400);
    }
    const { data, error } = await db
      .from("rifas").update({ precio_boleto: precio }).eq("id", rifaPedida)
      .select("id, precio_boleto").maybeSingle();
    if (error) return responder({ error: error.message }, 400);
    if (!data) return responder({ error: "rifa no encontrada" }, 404);
    await anotar(rifaPedida, "precio", { precio_boleto: precio });
    return responder({ rifa: data });
  }

  /**
   * Guardar el diseño del boleto impreso de una rifa.
   *
   * Va aquí y no entre las acciones sobre una rifa a propósito: aquellas se
   * bloquean en cuanto hay ganador, y con razón —el sorteo ya no se toca—,
   * pero el aspecto de la hoja sí se puede seguir corrigiendo después para
   * reimprimir. El diseño no cambia ni un número ni un código.
   */
  if (accion === "guardar_diseno") {
    const rifaPedida = String(cuerpo.rifa ?? "");

    let limpio: ReturnType<typeof limpiarDiseno>;
    try {
      limpio = limpiarDiseno(cuerpo.diseno);
    } catch (e) {
      return responder({ error: (e as Error).message }, 400);
    }

    // Sin rifa no es un error: es el diseño que heredará la próxima que se
    // cree. Lo natural es decidir cómo se va a ver el boleto y después mandar
    // a hacer el lote, no al revés.
    if (!rifaPedida) {
      const { error } = await db
        .from("panel_ajustes")
        .update({ diseno: limpio, actualizado_en: new Date().toISOString() })
        .eq("id", 1);
      if (error) return responder({ error: error.message }, 400);
      return responder({ diseno_nuevo: limpio });
    }

    const { data, error } = await db
      .from("rifas").update({ diseno: limpio }).eq("id", rifaPedida)
      .select("id, diseno").maybeSingle();
    if (error) return responder({ error: error.message }, 400);
    if (!data) return responder({ error: "rifa no encontrada" }, 404);

    // En la bitácora va si quedó con plantilla o no, nunca la foto: son cien
    // kilos de base64 que no le sirven a nadie dentro de un registro de
    // auditoría.
    await anotar(rifaPedida, "diseno", { plantilla: !!limpio?.plantilla });
    return responder({ rifa: data });
  }

  /**
   * Archivar una rifa: NO borra nada, solo la saca de la lista de siempre.
   * Sus folios se quedan ocupados para siempre —es justo lo que evita que
   * un folio se repita—, y un boleto ya impreso de esa rifa sigue abriendo
   * su resultado igual que antes. Reactivar la regresa.
   *
   * El borrado DE VERDAD, el que sí libera folios y de verdad no tiene
   * vuelta atrás, no tiene acción aquí a propósito: solo pasa a mano,
   * directo en la base, cuando lo pide quien administra el proyecto.
   */
  if (accion === "archivar_rifa" || accion === "reactivar_rifa") {
    const rifaPedida = String(cuerpo.rifa ?? "");
    if (!rifaPedida) return responder({ error: "falta la rifa" }, 400);
    const archivar = accion === "archivar_rifa";
    const { data: r, error } = await db
      .from("rifas").update({ archivada: archivar })
      .eq("id", rifaPedida).select("id, nombre, activa, archivada").maybeSingle();
    if (error) return responder({ error: error.message }, 400);
    if (!r) return responder({ error: "rifa no encontrada" }, 404);
    // Una rifa archivada no se queda manejando el panel: no tendría ni
    // dónde mostrarse.
    let eraActiva = r.activa;
    if (archivar && r.activa) {
      await db.from("rifas").update({ activa: false }).eq("id", rifaPedida);
    }
    await anotar(rifaPedida, archivar ? "archivar" : "reactivar", null);
    return responder({ id: r.id, archivada: r.archivada, era_activa: eraActiva });
  }

  /** Cuál rifa maneja el panel por omisión. Solo puede haber una. */
  if (accion === "activar") {
    const rifa = String(cuerpo.rifa ?? "");
    if (!rifa) return responder({ error: "falta la rifa" }, 400);
    // Primero se apaga la anterior: el índice único no admite dos activas.
    await db.from("rifas").update({ activa: false }).eq("activa", true);
    const { data, error } = await db
      .from("rifas").update({ activa: true }).eq("id", rifa)
      .select("id, nombre, activa").single();
    if (error) return responder({ error: error.message }, 400);
    await anotar(rifa, "activar", null);
    return responder({ rifa: data });
  }

  // ---- Acciones sobre una rifa -------------------------------------------
  const rifa = String(cuerpo.rifa ?? "");
  if (!rifa) return responder({ error: "falta la rifa" }, 400);

  const { data: actual, error: errorLectura } = await db
    .from("rifas")
    .select("id, nombre, serie, estado, activa, folio_ganador, fecha_sorteo, transmision_url, transmite_desde, folios_por_boleto")
    .eq("id", rifa)
    .single();
  if (errorLectura || !actual) return responder({ error: "rifa no encontrada" }, 404);

  const { data: sueltos } = await db.from("folios").select("folio").eq("rifa_id", rifa);
  const folios = (sueltos ?? []).map((f) => f.folio).sort();

  if (accion === "estado") {
    return responder({ rifa: actual, folios });
  }

  /**
   * Guardar el enlace de la transmisión sin prender nada. Se hace antes, con
   * calma; a la hora del sorteo ya solo queda apretar un botón.
   */
  if (accion === "transmision") {
    const crudo = String(cuerpo.transmision ?? "").trim();
    let enlace: string | null = null;
    if (crudo) {
      enlace = normalizarYouTube(crudo);
      if (!enlace) {
        return responder({ error: "eso no parece un enlace de YouTube" }, 400);
      }
    }
    const { data, error } = await db
      .from("rifas").update({ transmision_url: enlace }).eq("id", rifa)
      .select("id, nombre, serie, estado, activa, folio_ganador, fecha_sorteo, transmision_url, transmite_desde")
      .single();
    if (error) return responder({ error: error.message }, 400);
    await anotar(rifa, "transmision", { enlace });
    return responder({ rifa: data, folios });
  }

  if (actual.folio_ganador && accion !== "cerrar") {
    return responder(
      { error: "esta rifa ya tiene ganador registrado y no se puede modificar", rifa: actual },
      409,
    );
  }

  let cambios: Record<string, unknown> | null = null;

  if (accion === "en_vivo") {
    const quien = aparato(cuerpo.dispositivo);
    const dueno = aparato(actual.transmite_desde);
    // Dos personas con el panel abierto no deben prenderlo cada una por su
    // lado. El segundo ve de dónde está saliendo ya y decide si toma el mando.
    if (dueno && quien && dueno.id !== quien.id && cuerpo.forzar !== true) {
      return responder(
        { error: `ya se está transmitiendo desde ${dueno.etiqueta}`, transmite_desde: actual.transmite_desde },
        409,
      );
    }

    let enlace = actual.transmision_url as string | null;
    const crudo = String(cuerpo.transmision ?? "").trim();
    if (crudo) {
      enlace = normalizarYouTube(crudo);
      if (!enlace) return responder({ error: "eso no parece un enlace de YouTube" }, 400);
    }

    cambios = {
      estado: "en_vivo",
      transmision_url: enlace,
      transmite_desde: quien ? quien.crudo : null,
      transmite_en: new Date().toISOString(),
    };
  } else if (accion === "espera") {
    // Al volver a espera se suelta el candado: cualquier aparato puede retomar.
    cambios = { estado: "espera", transmite_desde: null, transmite_en: null };
  } else if (accion === "cerrar") {
    cambios = { estado: "cerrado", transmite_desde: null, transmite_en: null };
  } else if (accion === "revelar") {
    let ganador = String(cuerpo.folio ?? "").trim();
    let modo = "capturado";
    if (ganador) {
      if (!folios.includes(ganador)) {
        // Que quede escrito, no solo rechazado: si algún papelito que cae de
        // la tómbola no es de los que esta rifa imprimió —ajeno, mal tecleado
        // o de mala fe—, la bitácora tiene que poder probar después que pasó
        // y que el sistema lo paró, aunque en el momento nadie lo mirara.
        await anotar(rifa, "intento_rechazado", { folio: ganador, folios: folios.length });
        return responder({ error: `el folio ${ganador} no pertenece a esta rifa` }, 400);
      }
    } else {
      if (folios.length === 0) return responder({ error: "la rifa no tiene boletos" }, 400);
      ganador = folios[azarHasta(folios.length)];
      modo = "aleatorio";
    }
    // De qué papel salió ese número: es lo que hay que pedir para entregar.
    // Con `rifa_id`: el folio ya no es único entre rifas, así que sin este
    // filtro una coincidencia en otra rifa rompería el `.maybeSingle()`.
    const { data: duenoDelFolio } = await db
      .from("folios").select("boleto_id").eq("folio", ganador).eq("rifa_id", rifa).maybeSingle();

    cambios = { estado: "revelado", folio_ganador: ganador };
    await anotar(rifa, "revelar", {
      folio: ganador, modo, folios: folios.length, boleto: duenoDelFolio?.boleto_id ?? null,
    });
  } else {
    return responder({ error: "acción desconocida" }, 400);
  }

  const { data: nueva, error: errorEscritura } = await db
    .from("rifas")
    .update(cambios)
    .eq("id", rifa)
    .select("id, nombre, serie, estado, activa, folio_ganador, revelado_en, fecha_sorteo, transmision_url, transmite_desde")
    .single();

  if (errorEscritura) return responder({ error: errorEscritura.message }, 400);
  if (accion !== "revelar") await anotar(rifa, accion, null);

  return responder({ rifa: nueva, folios });
});
