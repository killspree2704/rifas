/**
 * Panel de sorteo. No habla con la base de datos: todo pasa por la función
 * de borde `sorteo`, que es la única que puede escribir, y que exige la clave
 * del panel en cada llamada.
 *
 * La clave no se guarda en el navegador: si recargas, se vuelve a pedir.
 */
(function () {
  'use strict';

  var CFG = window.RIFA_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var FUNCION = CFG.supabaseUrl + '/functions/v1/sorteo';

  var clave = '';
  var ultimoEstado = null;

  var ETIQUETAS = {
    espera: 'En espera',
    en_vivo: 'En vivo',
    revelado: 'Ganador revelado',
    cerrado: 'Cerrada',
  };

  function llamar(accion, extra) {
    var cuerpo = Object.assign({ rifa: CFG.rifaId, accion: accion, clave: clave }, extra || {});
    return fetch(FUNCION, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }).then(function (r) {
      return r.json().then(function (datos) {
        if (!r.ok) { throw new Error(datos.error || 'Error ' + r.status); }
        return datos;
      });
    });
  }

  function mensaje(texto, tipo, donde) {
    var el = $(donde || 'mensaje');
    el.textContent = texto || '';
    el.className = 'mensaje' + (tipo ? ' ' + tipo : '');
  }

  function pintar(datos) {
    ultimoEstado = datos.rifa;
    $('tituloRifa').textContent = datos.rifa.nombre;
    $('subtitulo').textContent = 'Serie ' + datos.rifa.serie + ' · ' + datos.folios.length + ' boletos';
    $('estadoTexto').textContent = ETIQUETAS[datos.rifa.estado] || datos.rifa.estado;
    $('conteoFolios').textContent = datos.folios.length;
    $('listaFolios').textContent = datos.folios.join(' ');

    var revelada = !!datos.rifa.folio_ganador;
    $('btnEnVivo').disabled = revelada || datos.rifa.estado === 'en_vivo';
    $('btnEspera').disabled = revelada || datos.rifa.estado === 'espera';
    $('btnRevelarFolio').disabled = revelada;
    $('btnRevelarAzar').disabled = revelada;
    $('folioGanador').disabled = revelada;
    $('btnCerrar').disabled = datos.rifa.estado === 'cerrado';

    if (revelada) {
      mensaje('Folio ganador: ' + datos.rifa.folio_ganador + ' — registrado y bloqueado.', 'ok');
    }
  }

  function accion(nombre, extra) {
    mensaje('Enviando…');
    llamar(nombre, extra)
      .then(function (datos) {
        pintar(datos);
        if (nombre === 'revelar') {
          mensaje('Ganador revelado: ' + datos.rifa.folio_ganador + '. Ya está en todos los teléfonos.', 'ok');
        } else if (nombre === 'en_vivo') {
          mensaje('En vivo. Las pantallas ya cambiaron.', 'ok');
        } else {
          mensaje('Listo.', 'ok');
        }
      })
      .catch(function (e) { mensaje(e.message, 'error'); });
  }

  // ------------------------------------------------------------------
  // Entrada
  // ------------------------------------------------------------------
  function entrar() {
    clave = $('clave').value.trim();
    if (!clave) { mensaje('Escribe la clave.', 'error', 'mensajeClave'); return; }
    mensaje('Comprobando…', '', 'mensajeClave');
    llamar('estado')
      .then(function (datos) {
        $('vistaClave').hidden = true;
        $('vistaPanel').hidden = false;
        pintar(datos);
      })
      .catch(function (e) {
        clave = '';
        mensaje(e.message, 'error', 'mensajeClave');
      });
  }

  $('btnEntrar').addEventListener('click', entrar);
  $('clave').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); entrar(); }
  });

  // ------------------------------------------------------------------
  // Acciones
  // ------------------------------------------------------------------
  $('btnEnVivo').addEventListener('click', function () { accion('en_vivo'); });
  $('btnEspera').addEventListener('click', function () { accion('espera'); });
  $('btnCerrar').addEventListener('click', function () { accion('cerrar'); });

  $('btnRevelarFolio').addEventListener('click', function () {
    var folio = $('folioGanador').value.trim();
    if (!folio) { mensaje('Escribe el folio que salió en la tómbola.', 'error'); return; }
    if (!confirmar('Vas a registrar el folio ' + folio + ' como ganador. Esto no se puede deshacer.')) { return; }
    accion('revelar', { folio: folio });
  });

  $('btnRevelarAzar').addEventListener('click', function () {
    if (!confirmar('El sistema elegirá un folio al azar y quedará registrado. Esto no se puede deshacer.')) { return; }
    accion('revelar', {});
  });

  /** Confirmación en dos pasos, sin diálogos del navegador. */
  var pendiente = null;
  function confirmar(texto) {
    if (pendiente === texto) { pendiente = null; return true; }
    pendiente = texto;
    mensaje(texto + ' Vuelve a tocar el mismo botón para confirmar.', 'error');
    setTimeout(function () { if (pendiente === texto) { pendiente = null; } }, 8000);
    return false;
  }

  // Refresco de cortesía por si alguien más movió el estado.
  setInterval(function () {
    if (!clave || !ultimoEstado) { return; }
    llamar('estado').then(pintar).catch(function () { /* el siguiente intento reintenta */ });
  }, 10000);
})();
