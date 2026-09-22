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
  const azar = new Uint32Array(1);

  for (let vuelta = 0; nuevos.size < cantidad; vuelta++) {
    if (vuelta > 20) throw new Error("no se pudieron generar folios suficientes; usa más dígitos");
    const candidatos = new Set<string>();
    // Se piden de más para que una vuelta baste casi siempre.
    const faltan = cantidad - nuevos.size;
    let intentos = 0;
    while (candidatos.size < faltan && intentos < faltan * 200) {
      intentos++;
      crypto.getRandomValues(azar);
      const folio = String(minimo + (azar[0] % espacio));
      if (!nuevos.has(folio)) candidatos.add(folio);
    }
    const ocupados = await yaUsados(tabla, columna, [...candidatos]);
    for (const numero of candidatos) if (!ocupados.has(numero)) nuevos.add(numero);
  }

  return [...nuevos].slice(0, cantidad).sort();
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

  if (!(await claveValida(clave))) {
    // Un respiro para que probar claves al por mayor no sea gratis.
    await new Promise((r) => setTimeout(r, 700));
    return responder({ error: "clave incorrecta" }, 401);
  }

  // ---- Acciones que no dependen de una rifa concreta ----------------------

  /** El histórico completo. Nada se borra nunca. */
  if (accion === "rifas") {
    const { data: rifas } = await db
      .from("rifas")
      .select("id, nombre, serie, estado, activa, folio_ganador, fecha_sorteo, revelado_en, creada_en, precio_boleto, transmision_url, folios_por_boleto")
      .order("fecha_sorteo", { ascending: false });
    const { data: boletos } = await db.from("boletos").select("rifa_id");
    const { data: folios } = await db.from("folios").select("rifa_id");
    const conteo: Record<string, number> = {};
    for (const b of boletos ?? []) conteo[b.rifa_id] = (conteo[b.rifa_id] ?? 0) + 1;
    const conteoFolios: Record<string, number> = {};
    for (const f of folios ?? []) conteoFolios[f.rifa_id] = (conteoFolios[f.rifa_id] ?? 0) + 1;
    return responder({
      rifas: (rifas ?? []).map((r) => ({
        ...r,
        boletos: conteo[r.id] ?? 0,
        folios: conteoFolios[r.id] ?? 0,
      })),
    });
  }

  /** Los boletos de una rifa, para reimprimir la hoja cuando haga falta. */
  if (accion === "boletos") {
    const rifaPedida = String(cuerpo.rifa ?? "");
    if (!rifaPedida) return responder({ error: "falta la rifa" }, 400);
    const { data: ficha } = await db
      .from("rifas").select("id, nombre, serie, fecha_sorteo, precio_boleto, folios_por_boleto")
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
      const { data: suelto } = await db
        .from("folios").select("boleto_id").eq("folio", pedidoFolio).maybeSingle();
      if (!suelto) return responder({ valido: false });
      idBoleto = suelto.boleto_id;
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

    const { data: rifasPrevias } = await db.from("rifas").select("id");
    const idsUsados = new Set((rifasPrevias ?? []).map((r) => r.id));

    // Un folio por oportunidad: si son 200 boletos de 4, son 800 números, y
    // los 800 tienen que caber holgados en el espacio de dígitos elegido.
    const totalFolios = cantidad * porBoleto;

    let folios: string[];
    let identificadores: string[];
    try {
      folios = await generarUnicos(totalFolios, digitos, "folios", "folio");
      identificadores = await generarUnicos(cantidad, DIGITOS_BOLETO, "boletos", "id");
    } catch (e) {
      return responder({ error: (e as Error).message }, 400);
    }

    // Los folios salieron ordenados del generador. Se revuelven antes de
    // repartirlos para que los cuatro de un mismo papel no queden vecinos:
    // con números seguidos, ver uno daría pistas de los otros tres.
    for (let i = folios.length - 1; i > 0; i--) {
      const azar = new Uint32Array(1);
      crypto.getRandomValues(azar);
      const j = azar[0] % (i + 1);
      [folios[i], folios[j]] = [folios[j], folios[i]];
    }

    const id = idDeRifa(nombre, fecha, idsUsados);
    const { error: errorRifa } = await db.from("rifas").insert({
      id, nombre, serie, fecha_sorteo: fecha, estado: "espera", activa: false,
      precio_boleto: precio, folios_por_boleto: porBoleto,
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
        precio_boleto: precio,
      },
      boletos,
    });
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
        return responder({ error: `el folio ${ganador} no pertenece a esta rifa` }, 400);
      }
    } else {
      if (folios.length === 0) return responder({ error: "la rifa no tiene boletos" }, 400);
      const azar = new Uint32Array(1);
      crypto.getRandomValues(azar);
      ganador = folios[azar[0] % folios.length];
      modo = "aleatorio";
    }
    // De qué papel salió ese número: es lo que hay que pedir para entregar.
    const { data: duenoDelFolio } = await db
      .from("folios").select("boleto_id").eq("folio", ganador).maybeSingle();

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
