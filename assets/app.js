/**
 * Rifa — pantalla del participante.
 *
 * Lee folio y código del QR, valida el boleto contra Supabase y sigue el
 * estado de la rifa. Sin datos personales: aquí solo viajan números de folio.
 *
 * El seguimiento del estado está pensado para un evento con cientos de
 * personas en la misma antena, cambiando de wifi a datos y de vuelta:
 *
 *   1. Canal en vivo (Realtime) como vía principal. Si la red cambia, el
 *      socket muere sin avisar, así que se vuelve a abrir con espera
 *      creciente y desfase aleatorio para no reconectar todos a la vez.
 *   2. Sondeo como red de seguridad, con ritmo variable: lento cuando falta
 *      mucho o el canal está sano, rápido en los minutos del sorteo o si el
 *      canal se cayó, y detenido del todo cuando ya hay resultado.
 *   3. Consulta inmediata cuando vuelve la red o cuando la persona desbloquea
 *      el teléfono, que es justo lo que pasa a la hora del sorteo.
 *
 * Modo ensayo (sin servidor), para probar el guion antes del evento:
 *   ?f=11052&c=R5VR&ensayo=1               -> espera / en vivo según el reloj
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

  // Ritmos del sondeo, en milisegundos. Ver el comentario de arriba.
  var SONDEO_CANAL_SANO = CFG.sondeoCanalSanoMs || 30000;
  var SONDEO_SIN_CANAL = CFG.sondeoSinCanalMs || 5000;
  var SONDEO_LEJOS = CFG.sondeoLejosMs || 60000;
  var SONDEO_OCULTO = CFG.sondeoOcultoMs || 90000;
  var VENTANA_CALIENTE_MS = (CFG.ventanaCalienteMin || 15) * 60000;

  var VISTAS = ['vistaCargando', 'vistaEspera', 'vistaEnVivo', 'vistaResultado', 'vistaInvalido', 'vistaSinFolio'];

  var estadoActual = null;
  var cliente = null;
  var canal = null;
  var canalSano = false;
  var canalCerradoAdrede = false;
  var reintentosCanal = 0;
  var fallosSeguidos = 0;
  var temporizador = null;

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

  /** Actualiza los cronómetros. Devuelve true cuando llegó la hora. */
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

  function hayResultado() {
    return !!estadoActual && (estadoActual.estado === 'revelado' || estadoActual.estado === 'cerrado');
  }

  function pintarEstado(estado) {
    if (!estado) { return; }
    // Un estado viejo (de un sondeo lento que llegó tarde) no debe borrar el
    // resultado que ya se está mostrando.
    if (hayResultado() && estado.estado !== 'revelado' && estado.estado !== 'cerrado') { return; }
    estadoActual = estado;

    if (hayResultado()) {
      var gano = String(estado.folio_ganador || '') === folio;
      $('veredicto').textContent = gano ? '¡Ganaste!' : 'No ganaste';
      $('veredicto').className = 'veredicto' + (gano ? ' gana' : '');
      $('fraseResultado').textContent = gano ? 'Tu folio es el ganador.' : 'Suerte para la próxima.';
      $('notaResultado').textContent = gano
        ? 'Presenta tu boleto físico para reclamar el premio.'
        : 'Folio ganador: ' + estado.folio_ganador;
      mostrar('vistaResultado');
      avisar('');
      cerrarSeguimiento();   // ya no hace falta molestar al servidor
      return;
    }

    if (estado.estado === 'en_vivo') { mostrar('vistaEnVivo'); return; }

    // En espera: si el reloj ya pasó la hora, la pantalla entra sola en vivo.
    mostrar(pintarCronometro() ? 'vistaEnVivo' : 'vistaEspera');
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

  /**
   * Con red móvil mala, una petición se queda colgada sin fallar nunca. Si no
   * se corta, el ciclo se congela justo cuando hay que enterarse del
   * resultado, así que toda consulta lleva tiempo límite.
   */
  function conLimite(promesa, ms) {
    return new Promise(function (resolver, rechazar) {
      var reloj = setTimeout(function () { rechazar(new Error('tiempo agotado')); }, ms);
      promesa.then(
        function (v) { clearTimeout(reloj); resolver(v); },
        function (e) { clearTimeout(reloj); rechazar(e); }
      );
    });
  }

  function leerEstado() {
    var consulta = cliente
      .from('rifas')
      .select('id, estado, folio_ganador, fecha_sorteo')
      .eq('id', CFG.rifaId)
      .single()
      .then(function (r) {
        if (r.error) { throw r.error; }
        return r.data;
      });
    return conLimite(consulta, CFG.limiteConsultaMs || 7000);
  }

  /** Una consulta, tolerante a fallos: reintenta y avisa sin romper nada. */
  function refrescar() {
    if (!hayServidor() || hayResultado()) { return Promise.resolve(); }
    return leerEstado()
      .then(function (estado) {
        fallosSeguidos = 0;
        avisar('');
        pintarEstado(estado);
      })
      .catch(function () {
        fallosSeguidos++;
        // Un tropiezo suelto no merece asustar a nadie.
        if (fallosSeguidos >= 3) {
          avisar('Sin conexión estable. Seguimos intentando: no cierres esta pantalla.');
        }
      });
  }

  // ------------------------------------------------------------------
  // Ritmo del sondeo
  // ------------------------------------------------------------------
  /** Cuánto esperar hasta la próxima consulta, según la situación. */
  function proximoSondeo() {
    if (hayResultado()) { return 0; }                       // ya está: no se pregunta más
    if (document.hidden) { return SONDEO_OCULTO; }          // teléfono en el bolsillo

    var faltan = fechaSorteo.getTime() - Date.now();
    // El ritmo se aprieta por dos motivos: porque se acerca la hora, o porque
    // el sorteo ya arrancó. Lo segundo importa si el organizador abre la
    // transmisión antes de tiempo: nadie debe quedarse esperando un minuto.
    var enCaliente = faltan <= VENTANA_CALIENTE_MS ||
      (estadoActual && estadoActual.estado === 'en_vivo');

    var base = enCaliente
      ? (canalSano ? SONDEO_CANAL_SANO : SONDEO_SIN_CANAL)
      : SONDEO_LEJOS;                                       // falta mucho: casi no se consulta

    // Ante fallos, esperar cada vez más: si el servidor sufre, no lo empujamos.
    // Pero en los minutos del sorteo el castigo se limita, porque ahí llegar
    // tarde con el resultado es peor que una consulta de más.
    var tope = enCaliente ? 1 : 4;
    base = base * Math.pow(2, Math.min(fallosSeguidos, tope));

    // Techo duro en los minutos del sorteo: pase lo que pase, nadie espera más
    // de esto para enterarse. Es la diferencia entre volver del apagón de red
    // en dos segundos o en veinte.
    if (enCaliente) {
      base = Math.min(base, CFG.sondeoTechoMs || 5000);
    }

    // Desfase aleatorio: evita que los 500 teléfonos pregunten en el mismo instante.
    return base + Math.floor(Math.random() * base * 0.5);
  }

  function programarSondeo() {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    var espera = proximoSondeo();
    if (!espera) { return; }
    temporizador = setTimeout(function () {
      refrescar().then(programarSondeo);
    }, espera);
  }

  // ------------------------------------------------------------------
  // Canal en vivo
  // ------------------------------------------------------------------
  function abrirCanal() {
    if (!hayServidor() || hayResultado()) { return; }
    if (canal) {
      canalCerradoAdrede = true;
      try { cliente.removeChannel(canal); } catch (e) { /* ya estaba cerrado */ }
      canal = null;
    }
    canalCerradoAdrede = false;

    canal = cliente
      .channel('rifa-' + CFG.rifaId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rifas', filter: 'id=eq.' + CFG.rifaId },
        function (mensaje) {
          fallosSeguidos = 0;
          pintarEstado(mensaje.new);
          programarSondeo();
        }
      )
      .subscribe(function (situacion) {
        if (situacion === 'SUBSCRIBED') {
          canalSano = true;
          reintentosCanal = 0;
          // Puede haber pasado algo mientras el canal estaba caído.
          refrescar().then(programarSondeo);
          return;
        }
        if (situacion === 'CHANNEL_ERROR' || situacion === 'TIMED_OUT' || situacion === 'CLOSED') {
          canalSano = false;
          programarSondeo();                       // el sondeo toma el relevo
          if (canalCerradoAdrede || hayResultado()) { return; }
          reintentosCanal = Math.min(reintentosCanal + 1, 5);
          var espera = 1000 * Math.pow(2, reintentosCanal) + Math.floor(Math.random() * 3000);
          setTimeout(abrirCanal, espera);
        }
      });
  }

  function cerrarSeguimiento() {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    if (canal) {
      canalCerradoAdrede = true;
      try { cliente.removeChannel(canal); } catch (e) { /* daba igual */ }
      canal = null;
    }
    canalSano = false;
  }

  // ------------------------------------------------------------------
  // Sucesos del dispositivo
  // ------------------------------------------------------------------
  /**
   * Reacciona a que volvió la red o a que la persona miró el teléfono.
   *
   * Cuando el sistema anuncia que hay red, muchas veces todavía no la hay del
   * todo y el primer intento falla. Por eso no se hace uno solo: se hace una
   * ráfaga corta de intentos y solo después se vuelve al ritmo normal. Es la
   * diferencia entre enterarse en tres segundos o en quince.
   */
  function reaccionar(conDesfase) {
    if (hayResultado()) { return; }
    // Al volver la red, los 500 teléfonos reaccionan a la vez: un desfase de
    // hasta dos segundos reparte esa avalancha.
    var espera = conDesfase ? Math.floor(Math.random() * 2000) : 0;
    var intentos = 0;

    function intentar() {
      if (hayResultado()) { return; }
      refrescar().then(function () {
        intentos++;
        if (!hayResultado() && intentos < 3) {
          setTimeout(intentar, 1500 + Math.floor(Math.random() * 1000));
          return;
        }
        programarSondeo();
      });
    }

    setTimeout(function () {
      intentar();
      if (hayServidor() && !canalSano) { abrirCanal(); }
    }, espera);
  }

  function escucharDispositivo() {
    window.addEventListener('online', function () {
      // Los fallos eran de la red, no del servidor: se empieza de cero.
      fallosSeguidos = 0;
      reaccionar(true);
    });
    window.addEventListener('offline', function () { canalSano = false; });
    // Desbloquear el teléfono o volver a la pestaña: consultar ya.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { programarSondeo(); } else { reaccionar(false); }
    });
    // Volver con el botón «atrás» desde la caché del navegador.
    window.addEventListener('pageshow', function (ev) {
      if (ev.persisted) { reaccionar(false); }
    });
  }

  // ------------------------------------------------------------------
  // Validación del boleto
  // ------------------------------------------------------------------
  function validar() {
    if (!hayServidor()) {
      // En ensayo no se puede comprobar la firma: se acepta cualquier folio.
      return Promise.resolve(true);
    }
    var consulta = cliente
      .rpc('validar_boleto', { p_rifa: CFG.rifaId, p_folio: folio, p_codigo: codigo })
      .then(function (r) { return !r.error && r.data === true; });
    // Si el servidor no contesta a tiempo, no se acusa a nadie de traer un
    // boleto falso: se le da por bueno y el estado sigue su curso.
    return conLimite(consulta, CFG.limiteConsultaMs || 7000).catch(function () { return true; });
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
      // Arranque automático a la hora, aunque no haya red ni nadie toque nada.
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
      cliente = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        realtime: { params: { eventsPerSecond: 2 } },
      });
    } else if (!ensayo) {
      avisar('Sin conexión al servidor: la pantalla se guía por el reloj.');
    }

    escucharDispositivo();

    // El cronómetro aparece de inmediato, sin esperar ninguna respuesta de red.
    pintarEstado(estadoLocal());

    validar()
      .then(function (valido) {
        if (!valido) {
          mostrar('vistaInvalido');
          $('bloqueFolio').hidden = true;
          return;
        }
        if (!hayServidor()) { return; }
        return refrescar().then(function () {
          abrirCanal();
          programarSondeo();
        });
      })
      .catch(function () {
        // Si el servidor no responde, el reloj manda: nadie se queda en blanco.
        avisar('No pudimos consultar el servidor. La pantalla se guía por el reloj.');
        pintarEstado(estadoLocal());
        programarSondeo();
      });
  }

  iniciar();

  // Deja la página utilizable aunque la red vaya y venga.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // Sin trabajador de servicio la página sigue funcionando igual.
      });
    });
  }
})();
