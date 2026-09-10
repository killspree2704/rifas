/**
 * Rifa El Muerde Manos — pantalla del participante.
 *
 * Lee folio y código del QR, valida el boleto contra Supabase y sigue el
 * estado de la rifa en vivo. Sin datos personales: la página solo maneja
 * números de folio.
 *
 * Modo ensayo (sin servidor), para probar el guion antes del evento:
 *   ?f=11052&c=R5VR&ensayo=1              -> espera / en vivo según el reloj
 *   ?f=11052&c=R5VR&ensayo=1&ganador=11052 -> fuerza el resultado
 */
(function () {
  'use strict';

  var CFG = window.RIFA_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  var folio = (params.get('f') || params.get('folio') || '').trim();
  var codigo = (params.get('c') || params.get('codigo') || '').trim().toUpperCase();
  var ensayo = params.get('ensayo') === '1';
  var fechaSorteo = new Date(CFG.fechaSorteo);

  var VISTAS = ['vistaCargando', 'vistaEspera', 'vistaEnVivo', 'vistaResultado', 'vistaInvalido', 'vistaSinFolio'];
  var estadoActual = null;
  var cliente = null;
  var sondeo = null;

  // ------------------------------------------------------------------
  // Pintado
  // ------------------------------------------------------------------
  function mostrar(id) {
    VISTAS.forEach(function (v) { $(v).hidden = (v !== id); });
  }

  function avisar(texto) {
    var el = $('avisoConexion');
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  function formatearFecha() {
    if (isNaN(fechaSorteo.getTime())) { return ''; }
    var zona = CFG.zonaHoraria || undefined;
    var f = fechaSorteo.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona });
    var h = fechaSorteo.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: zona });
    return 'Sorteo: ' + f + ' a las ' + h;
  }

  function dosDigitos(n) { return String(n).padStart(2, '0'); }

  /** Actualiza los dos cronómetros y avisa cuando llega la hora. */
  function pintarCronometro() {
    var restante = fechaSorteo.getTime() - Date.now();
    if (isNaN(restante)) { return false; }
    var seg = Math.max(0, Math.floor(restante / 1000));
    var partes = {
      Dias: Math.floor(seg / 86400),
      Horas: Math.floor((seg % 86400) / 3600),
      Min: Math.floor((seg % 3600) / 60),
      Seg: seg % 60,
    };
    Object.keys(partes).forEach(function (k) {
      var a = $('c' + k), b = $('c2' + k);
      if (a) { a.textContent = dosDigitos(partes[k]); }
      if (b) { b.textContent = dosDigitos(partes[k]); }
    });
    return seg === 0;
  }

  function pintarEstado(estado) {
    estadoActual = estado;

    if (estado.estado === 'revelado' || estado.estado === 'cerrado') {
      var gano = String(estado.folio_ganador || '') === folio;
      $('veredicto').textContent = gano ? '¡Ganaste!' : 'No ganaste';
      $('veredicto').className = 'veredicto' + (gano ? ' gana' : '');
      $('fraseResultado').textContent = gano
        ? 'Tu folio es el ganador.'
        : 'Suerte para la próxima.';
      $('notaResultado').textContent = gano
        ? 'Presenta tu boleto físico para reclamar el premio.'
        : 'Folio ganador: ' + estado.folio_ganador;
      mostrar('vistaResultado');
      return;
    }

    if (estado.estado === 'en_vivo') {
      mostrar('vistaEnVivo');
      return;
    }

    // En espera: si el reloj ya pasó la hora, la página entra sola en vivo.
    if (pintarCronometro()) {
      mostrar('vistaEnVivo');
    } else {
      mostrar('vistaEspera');
    }
  }

  // ------------------------------------------------------------------
  // Origen del estado
  // ------------------------------------------------------------------
  function estadoLocal() {
    var ganador = params.get('ganador');
    if (ganador) { return { estado: 'revelado', folio_ganador: ganador }; }
    return { estado: Date.now() >= fechaSorteo.getTime() ? 'en_vivo' : 'espera', folio_ganador: null };
  }

  function hayServidor() {
    return !ensayo && CFG.supabaseUrl && CFG.supabaseKey && CFG.rifaId && window.supabase;
  }

  function leerEstado() {
    return cliente
      .from('rifas')
      .select('estado, folio_ganador, fecha_sorteo')
      .eq('id', CFG.rifaId)
      .single()
      .then(function (r) {
        if (r.error) { throw r.error; }
        return r.data;
      });
  }

  /** Realtime como canal principal; sondeo con desfase como respaldo. */
  function seguirEstado() {
    cliente
      .channel('rifa-' + CFG.rifaId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rifas', filter: 'id=eq.' + CFG.rifaId },
        function (mensaje) { pintarEstado(mensaje.new); }
      )
      .subscribe();

    if (sondeo) { clearInterval(sondeo); }
    sondeo = setInterval(function () {
      leerEstado().then(pintarEstado).catch(function () { /* el siguiente sondeo reintenta */ });
    }, 4000 + Math.floor(Math.random() * 2000));
  }

  // ------------------------------------------------------------------
  // Validación del boleto
  // ------------------------------------------------------------------
  function validar() {
    if (!hayServidor()) {
      // En ensayo no se puede comprobar la firma: se acepta cualquier folio.
      return Promise.resolve(true);
    }
    return cliente
      .rpc('validar_boleto', { p_rifa: CFG.rifaId, p_folio: folio, p_codigo: codigo })
      .then(function (r) { return !r.error && r.data === true; });
  }

  // ------------------------------------------------------------------
  // Arranque
  // ------------------------------------------------------------------
  function iniciar() {
    $('tituloRifa').textContent = CFG.nombre || 'Rifa';
    document.title = CFG.nombre || 'Rifa';
    $('serieTexto').textContent = 'Serie ' + (CFG.serie || 'A');
    $('fechaTexto').textContent = formatearFecha();
    $('fechaTexto2').textContent = formatearFecha();
    pintarCronometro();
    setInterval(function () {
      var llego = pintarCronometro();
      // Arranque automático a la hora: solo si el administrador no ha revelado.
      if (llego && estadoActual && estadoActual.estado === 'espera') {
        mostrar('vistaEnVivo');
      }
    }, 1000);

    if (!folio) {
      mostrar('vistaSinFolio');
      return;
    }

    $('folio').textContent = (CFG.serie ? CFG.serie + '-' : '') + folio;
    $('bloqueFolio').hidden = false;

    if (hayServidor()) {
      cliente = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    } else if (!ensayo) {
      avisar('Modo sin conexión al servidor: la pantalla se guía por el reloj.');
    }

    validar()
      .then(function (valido) {
        if (!valido) {
          mostrar('vistaInvalido');
          $('bloqueFolio').hidden = true;
          return;
        }
        if (!hayServidor()) {
          pintarEstado(estadoLocal());
          return;
        }
        return leerEstado().then(function (estado) {
          pintarEstado(estado);
          seguirEstado();
        });
      })
      .catch(function () {
        // Si el servidor no responde, el reloj manda: nadie se queda en blanco.
        avisar('No pudimos consultar el servidor. La pantalla se guía por el reloj.');
        pintarEstado(estadoLocal());
      });
  }

  iniciar();
})();
