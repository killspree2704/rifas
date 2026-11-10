/**
 * Panel de sorteo. No habla con la base de datos: todo pasa por la función
 * de borde `sorteo`, que es la única que puede escribir, y que exige la clave
 * del panel en cada llamada.
 *
 * La clave no se guarda en el navegador: si recargas, se vuelve a pedir.
 *
 * Tres pestañas:
 *   Sorteo     — revelar, cerrar la rifa que se esté manejando.
 *   Rifas      — crear una nueva con folios nuevos, ver el historial completo
 *                y sacar la hoja de boletos para imprimir.
 *   Verificar  — folio + código a mano: dice si el boleto de papel es original.
 */
(function () {
  'use strict';

  var CFG = window.RIFA_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var FUNCION = CFG.supabaseUrl + '/functions/v1/sorteo';

  var clave = '';
  var rifaActual = CFG.rifaId;   // sobre cuál rifa actúan los botones del sorteo
  var rifasConocidas = [];       // el último historial recibido
  var disenoPorOmision = null;   // el que heredará la próxima rifa que se cree
  var ultimoEstado = null;

  var ETIQUETAS = {
    espera: 'En espera',
    en_vivo: 'En vivo',
    revelado: 'Ganador revelado',
    cerrado: 'Cerrada',
  };

  function llamar(accion, extra) {
    var cuerpo = Object.assign({ rifa: rifaActual, accion: accion, clave: clave }, extra || {});
    return fetch(FUNCION, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }).then(function (r) {
      return r.json().then(function (datos) {
        if (!r.ok) { throw new Error(datos.error || 'Error ' + r.status); }
        return datos;
      });
    }).catch(function (e) {
      // `fetch` tira un `TypeError` —«Failed to fetch», en inglés, sin
      // explicación— cuando la red se cae de plano. Es distinto del `Error`
      // que se arma arriba cuando el servidor SÍ contestó pero con un
      // error: ese ya trae un mensaje en español que vale la pena enseñar
      // tal cual. Mostrarle el de la red cruda a quien está a medio sorteo,
      // en vivo frente a la gente, no ayuda en nada.
      if (e instanceof TypeError) {
        throw new Error('No se pudo conectar con el servidor. Revisa la red e ' +
          'inténtalo de nuevo —nada se guardó todavía—.');
      }
      throw e;
    });
  }

  function mensaje(texto, tipo, donde) {
    var el = $(donde || 'mensaje');
    el.textContent = texto || '';
    el.className = 'mensaje' + (tipo ? ' ' + tipo : '');
  }

  /**
   * Conecta una casilla con unos campos de clave para poder ver lo tecleado.
   *
   * La clave del panel es larga y se escribe en un celular, a veces con el sol
   * encima y siempre con prisa. A ciegas, un dedazo solo se descubre cuando el
   * servidor contesta que no, y entonces hay que volver a escribirla entera.
   * Enseñarla es decisión de quien la teclea: la casilla nace apagada.
   */
  function casillaDeVer(casilla, campos) {
    var marca = $(casilla);
    if (!marca) { return; }
    marca.addEventListener('change', function () {
      campos.forEach(function (id) {
        var campo = $(id);
        if (campo) { campo.type = marca.checked ? 'text' : 'password'; }
      });
    });
  }

  /** Fecha larga, siempre en la zona del evento y no en la del teléfono. */
  function fecha(iso) {
    if (!iso) { return '—'; }
    var opciones = { day: 'numeric', month: 'short', year: 'numeric',
                     hour: '2-digit', minute: '2-digit', timeZone: CFG.zonaHoraria || undefined };
    return new Date(iso).toLocaleString('es-MX', opciones);
  }

  // ------------------------------------------------------------------
  // Pestañas
  // ------------------------------------------------------------------
  var PANES = ['paneSorteo', 'paneRifas', 'paneVerificar', 'paneDiseno', 'panePerfil', 'paneAyuda'];

  function abrirPestana(id) {
    PANES.forEach(function (p) { $(p).hidden = (p !== id); });
    if (id === 'paneSorteo' && !rifaActual) {
      mensaje('Todavía no hay ninguna rifa que manejar. Crea una en la pestaña «Rifas».', 'error');
    }
    Array.prototype.forEach.call(document.querySelectorAll('.pestana'), function (b) {
      b.classList.toggle('activa', b.dataset.panel === id);
    });
    if (id === 'paneRifas') { cargarRifas(); }
    if (id === 'paneDiseno') { abrirDiseno(); }
  }

  Array.prototype.forEach.call(document.querySelectorAll('.pestana'), function (b) {
    b.addEventListener('click', function () { abrirPestana(b.dataset.panel); });
  });

  // ------------------------------------------------------------------
  // Pestaña 1: el sorteo
  // ------------------------------------------------------------------
  function pintar(datos) {
    ultimoEstado = datos.rifa;
    rifaActual = datos.rifa.id;
    $('tituloRifa').textContent = datos.rifa.nombre;
    // Boletos y números son dos cuentas distintas ahora: la tómbola lleva
    // números, pero lo que se entrega es un boleto.
    var porBoleto = datos.rifa.folios_por_boleto || 1;
    var cuantosBoletos = Math.round(datos.folios.length / porBoleto);
    $('subtitulo').textContent = 'Serie ' + datos.rifa.serie + ' · ' + cuantosBoletos +
      ' boletos · ' + datos.folios.length + ' números · ' + fecha(datos.rifa.fecha_sorteo);
    $('estadoTexto').textContent = ETIQUETAS[datos.rifa.estado] || datos.rifa.estado;
    $('conteoFolios').textContent = datos.folios.length;
    $('listaFolios').textContent = datos.folios.join(' ');
    pintarEstadisticas(datos.rifa, cuantosBoletos, datos.folios.length);

    var revelada = !!datos.rifa.folio_ganador;
    $('btnRevelarAzar').disabled = revelada;
    $('folioGanador').disabled = revelada;
    $('btnCerrar').disabled = datos.rifa.estado === 'cerrado';
    if (revelada) { pintarCotejo('nada'); }
    mandarBotones();

    if (revelada) {
      mensaje('Folio ganador: ' + datos.rifa.folio_ganador + ' — registrado y bloqueado.', 'ok');
    }
  }

  /**
   * Las cuatro cifras de arriba de la pestaña Sorteo. Todas salen de datos
   * reales de ESTA rifa —nada inventado ni de muestra—: lo que no se puede
   * calcular (precio sin poner, por ejemplo) se queda en guion, no en un
   * cero que haga pensar que de verdad no hay nada recaudado.
   */
  function pintarEstadisticas(rifa, cuantosBoletos, cuantosFolios) {
    $('statBoletos').textContent = cuantosBoletos.toLocaleString('es-MX');
    $('statFolios').textContent = cuantosFolios.toLocaleString('es-MX');

    var precio = rifa.precio_boleto;
    $('statRecaudado').textContent = (precio !== null && precio !== undefined)
      ? '$' + (precio * cuantosBoletos).toLocaleString('es-MX', { minimumFractionDigits: 2 })
      : '—';

    var faltan = $('statFaltan');
    var fechaSorteo = rifa.fecha_sorteo ? new Date(rifa.fecha_sorteo) : null;
    if (!fechaSorteo || isNaN(fechaSorteo.getTime())) {
      faltan.textContent = '—';
    } else if (rifa.folio_ganador) {
      faltan.textContent = 'Revelada';
    } else {
      var dias = Math.ceil((fechaSorteo.getTime() - Date.now()) / 86400000);
      faltan.textContent = dias > 1 ? dias + ' días'
        : dias === 1 ? 'Mañana'
        : dias === 0 ? 'Hoy'
        : 'Ya pasó';
    }
  }

  /**
   * Revelar por folio pide dos cosas: que la rifa siga abierta y que el folio
   * escrito ya se haya cotejado. Sin lo segundo el botón no se enciende.
   */
  function mandarBotones() {
    var revelada = !!(ultimoEstado && ultimoEstado.folio_ganador);
    $('btnRevelarFolio').disabled = revelada || !folioCotejado;
  }

  function accion(nombre, extra) {
    mensaje('Enviando…');
    llamar(nombre, extra)
      .then(function (datos) {
        pintar(datos);
        if (nombre === 'revelar') {
          mensaje('Ganador revelado: ' + datos.rifa.folio_ganador + '. Ya está en todos los teléfonos.', 'ok');
        } else {
          mensaje('Listo.', 'ok');
        }
      })
      .catch(function (e) {
        mensaje(e.message, 'error');
        // El servidor puede saber algo que aquí no se sabía, así que se
        // vuelve a preguntar para que la pantalla enseñe de qué está hablando.
        llamar('estado').then(pintar).catch(function () { /* ya se avisó */ });
      });
  }

  $('btnCerrar').addEventListener('click', function () { accion('cerrar'); });

  // ------------------------------------------------------------------
  // Cotejo del folio ganador contra el talón de papel
  //
  // Es el único error del sistema que no tiene vuelta atrás: si se teclea
  // 11053 en vez de 11052 y ese folio también existe, queda coronada otra
  // persona para siempre. Así que antes de confirmar se enseña el folio con
  // su código, para compararlo con el boleto que se trae en la mano.
  // ------------------------------------------------------------------
  // De un folio al boleto de papel que lo lleva. Cada boleto trae varios
  // números, así que de la bolita hay que llegar al papel, no al revés.
  var mapaCodigos = null;      // folio -> { boleto, codigo, folios }
  var rifaDelMapa = null;
  var pidiendoCodigos = null;
  var folioCotejado = null;    // el folio que ya se comprobó y está a la vista

  /** Trae los boletos una sola vez, y solo cuando de verdad hacen falta. */
  function asegurarCodigos() {
    if (mapaCodigos && rifaDelMapa === rifaActual) { return Promise.resolve(mapaCodigos); }
    if (pidiendoCodigos) { return pidiendoCodigos; }
    var deQuien = rifaActual;
    pidiendoCodigos = llamar('boletos', { rifa: deQuien })
      .then(function (datos) {
        var mapa = {};
        (datos.boletos || []).forEach(function (b) {
          (b.folios || []).forEach(function (f) {
            mapa[f] = { boleto: b.id, codigo: b.codigo, folios: b.folios || [] };
          });
        });
        mapaCodigos = mapa;
        rifaDelMapa = deQuien;
        pidiendoCodigos = null;
        return mapa;
      })
      .catch(function (e) { pidiendoCodigos = null; throw e; });
    return pidiendoCodigos;
  }

  /** El folio tal como lo teclean: puede venir con la serie pegada delante. */
  function folioEscrito() {
    return $('folioGanador').value.trim().replace(/^[A-Za-z]+-/, '');
  }

  function pintarCotejo(estado, folio, ficha) {
    var caja = $('cotejoFolio');
    if (estado === 'nada') {
      caja.hidden = true;
      folioCotejado = null;
      mandarBotones();
      return;
    }
    caja.hidden = false;
    caja.className = 'cotejo ' + estado;
    if (estado === 'buscando') {
      $('cotejoRotulo').textContent = 'Buscando…';
      $('cotejoNumero').textContent = folio;
      $('cotejoCodigo').textContent = '';
      folioCotejado = null;
    } else if (estado === 'ajeno') {
      $('cotejoRotulo').textContent = 'Ese folio no es de esta rifa';
      $('cotejoNumero').textContent = folio;
      $('cotejoCodigo').textContent = 'Revísalo antes de revelar.';
      folioCotejado = null;
    } else {
      var serie = (ultimoEstado && ultimoEstado.serie) ? ultimoEstado.serie + '-' : '';
      $('cotejoRotulo').textContent = 'Compara con el talón que traes en la mano';
      $('cotejoNumero').textContent = serie + folio;
      // El talón trae los cuatro números y un solo código: se enseñan los dos
      // para que el cotejo sea contra el papel entero y no contra un número
      // suelto que podría estar en otro boleto parecido.
      var otros = (ficha.folios || []).filter(function (f) { return f !== folio; });
      $('cotejoCodigo').textContent = 'boleto ' + ficha.boleto + ' · código ' + ficha.codigo +
        (otros.length ? ' · sus otros números: ' + otros.map(function (f) { return serie + f; }).join(' ') : '');
      folioCotejado = folio;
    }
    mandarBotones();
  }

  var relojCotejo = null;
  function revisarFolio() {
    var folio = folioEscrito();
    // Cualquier cambio invalida la confirmación anterior: nadie debe poder
    // confirmar un folio distinto del que aprobó con la vista.
    pendiente = null;
    if (!folio) { return pintarCotejo('nada'); }

    pintarCotejo('buscando', folio);
    clearTimeout(relojCotejo);
    relojCotejo = setTimeout(function () {
      var pedido = folio;
      asegurarCodigos()
        .then(function (mapa) {
          if (folioEscrito() !== pedido) { return; }   // ya siguió escribiendo
          if (mapa[pedido]) { pintarCotejo('bien', pedido, mapa[pedido]); }
          else { pintarCotejo('ajeno', pedido); }
        })
        .catch(function () {
          if (folioEscrito() !== pedido) { return; }
          pintarCotejo('nada');
          mensaje('No se pudieron traer los códigos para comprobar el folio.', 'error');
        });
    }, 250);
  }

  $('folioGanador').addEventListener('input', revisarFolio);

  $('btnRevelarFolio').addEventListener('click', function () {
    var folio = folioEscrito();
    if (!folio) { mensaje('Escribe el folio que salió en la tómbola.', 'error'); return; }
    if (folio !== folioCotejado) {
      mensaje('Espera a que aparezca el código para compararlo con el talón.', 'error');
      return;
    }
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

  // ------------------------------------------------------------------
  // Pestaña 2: historial y rifas nuevas
  // ------------------------------------------------------------------
  /**
   * Recarga el historial. `aviso` es lo que queda escrito al terminar: sin él,
   * recargar borraría el mensaje de la acción que acaba de hacerse.
   */
  function cargarRifas(aviso) {
    mensaje('Cargando…', '', 'mensajeRifas');
    return llamar('rifas')
      .then(function (datos) {
        disenoPorOmision = datos.diseno_nuevo || null;
        pintarRifas(datos.rifas || []);
        mensaje(aviso || '', aviso ? 'ok' : '', 'mensajeRifas');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeRifas'); });
  }

  function pintarRifas(rifas) {
    // Se guardan tal cual llegaron: la pestaña «Diseño» saca de aquí el
    // diseño de la rifa que se está manejando, sin volver a preguntar.
    rifasConocidas = rifas;
    var caja = $('listaRifas');
    caja.textContent = '';
    if (!rifas.length) {
      caja.textContent = 'Todavía no hay ninguna rifa.';
      return;
    }
    rifas.forEach(function (r) {
      var fila = document.createElement('article');
      fila.className = 'rifa' + (r.id === rifaActual ? ' manejando' : '');

      var cabeza = document.createElement('div');
      cabeza.className = 'rifa-cabeza';
      var nombre = document.createElement('strong');
      nombre.textContent = r.nombre;
      cabeza.appendChild(nombre);
      var marca = document.createElement('span');
      marca.className = 'marca-estado ' + r.estado;
      marca.textContent = ETIQUETAS[r.estado] || r.estado;
      cabeza.appendChild(marca);
      fila.appendChild(cabeza);

      var detalle = document.createElement('p');
      detalle.className = 'nota';
      var trozos = ['Serie ' + r.serie, r.boletos + ' boletos', fecha(r.fecha_sorteo)];
      if (r.precio_boleto) {
        trozos.push('$' + r.precio_boleto + ' c/u · $' + (r.precio_boleto * r.boletos).toFixed(2) + ' en total');
      }
      detalle.textContent = trozos.join(' · ');
      fila.appendChild(detalle);

      if (r.folio_ganador) {
        var gana = document.createElement('p');
        gana.className = 'ganador';
        gana.textContent = 'Ganador: ' + r.serie + '-' + r.folio_ganador;
        fila.appendChild(gana);
      }

      var acciones = document.createElement('div');
      acciones.className = 'rifa-acciones';

      var manejar = document.createElement('button');
      manejar.className = 'boton';
      manejar.textContent = r.id === rifaActual ? 'La estás manejando' : 'Manejar esta';
      manejar.disabled = r.id === rifaActual;
      manejar.addEventListener('click', function () { manejarRifa(r.id); });
      acciones.appendChild(manejar);

      var hoja = document.createElement('button');
      hoja.className = 'boton';
      hoja.textContent = 'Hoja de boletos';
      hoja.addEventListener('click', function () { pedirHoja(r.id, hoja, abrirHoja); });
      acciones.appendChild(hoja);

      // Archivar no borra nada —sus folios se quedan reservados para
      // siempre—, así que no hace falta el candado del ganador: sirve
      // igual para una rifa ya cerrada que para una que apenas se creó.
      var archivar = document.createElement('button');
      archivar.className = 'boton fantasma chico';
      archivar.textContent = 'Archivar';
      archivar.addEventListener('click', function () {
        if (!confirmarArchivar('archivar «' + r.nombre + '». Sigue en la base, solo deja de salir aquí.')) {
          return;
        }
        var eraManejada = r.id === rifaActual;
        mensaje('Archivando…', '', 'mensajeRifas');
        llamar('archivar_rifa', { rifa: r.id })
          .then(function () {
            if (eraManejada) {
              rifaActual = null;
              ultimoEstado = null;
              $('tituloRifa').textContent = 'Todavía no hay ninguna rifa';
              $('subtitulo').textContent = 'Crea una o maneja otra desde aquí abajo.';
            }
            return cargarRifas('«' + r.nombre + '» se archivó.');
          })
          .catch(function (e) { mensaje(e.message, 'error', 'mensajeRifas'); });
      });
      acciones.appendChild(archivar);

      fila.appendChild(acciones);
      caja.appendChild(fila);
    });
  }

  /** Pasa el mando a otra rifa: los botones del sorteo actúan sobre ella. */
  function manejarRifa(id) {
    mensaje('Cambiando…', '', 'mensajeRifas');
    var previa = rifaActual;
    rifaActual = id;
    llamar('activar', { rifa: id })
      .then(function () { return llamar('estado'); })
      .then(function (datos) {
        pintar(datos);
        return cargarRifas('Ahora manejas «' + datos.rifa.nombre + '».');
      })
      .catch(function (e) {
        rifaActual = previa;
        mensaje(e.message, 'error', 'mensajeRifas');
      });
  }

  // ------------------------------------------------------------------
  // Archivar una rifa: no borra nada, solo la saca del historial
  // ------------------------------------------------------------------
  // No hace falta teclear el nombre: a diferencia de un borrado de verdad,
  // esto se puede deshacer con «Reactivar», así que basta con el mismo
  // doble toque que se usa en el resto del panel.
  var pendienteArchivar = null;
  function confirmarArchivar(texto) {
    if (pendienteArchivar === texto) { pendienteArchivar = null; return true; }
    pendienteArchivar = texto;
    mensaje('Vas a ' + texto + ' Toca otra vez para confirmar.', 'error', 'mensajeRifas');
    setTimeout(function () { if (pendienteArchivar === texto) { pendienteArchivar = null; } }, 8000);
    return false;
  }

  // La lista de archivadas se pide solo al abrir el desplegable: nadie la
  // necesita antes de preguntar por ella.
  $('cajaArchivadas').addEventListener('toggle', function () {
    if ($('cajaArchivadas').open) { cargarArchivadas(); }
  });

  function cargarArchivadas() {
    mensaje('Cargando…', '', 'mensajeArchivadas');
    llamar('rifas', { archivadas: true })
      .then(function (datos) {
        pintarArchivadas(datos.rifas || []);
        mensaje('', '', 'mensajeArchivadas');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeArchivadas'); });
  }

  function pintarArchivadas(rifas) {
    var caja = $('listaArchivadas');
    caja.textContent = '';
    if (!rifas.length) {
      caja.textContent = 'No hay ninguna archivada.';
      return;
    }
    rifas.forEach(function (r) {
      var fila = document.createElement('article');
      fila.className = 'rifa';

      var cabeza = document.createElement('div');
      cabeza.className = 'rifa-cabeza';
      var nombre = document.createElement('strong');
      nombre.textContent = r.nombre;
      cabeza.appendChild(nombre);
      fila.appendChild(cabeza);

      var detalle = document.createElement('p');
      detalle.className = 'nota';
      detalle.textContent = 'Serie ' + r.serie + ' · ' + r.boletos + ' boletos · ' + fecha(r.fecha_sorteo);
      fila.appendChild(detalle);

      if (r.folio_ganador) {
        var gana = document.createElement('p');
        gana.className = 'ganador';
        gana.textContent = 'Ganador: ' + r.serie + '-' + r.folio_ganador;
        fila.appendChild(gana);
      }

      var acciones = document.createElement('div');
      acciones.className = 'rifa-acciones';
      var reactivar = document.createElement('button');
      reactivar.className = 'boton';
      reactivar.textContent = 'Reactivar';
      reactivar.addEventListener('click', function () {
        mensaje('Reactivando…', '', 'mensajeArchivadas');
        llamar('reactivar_rifa', { rifa: r.id })
          .then(function () {
            cargarArchivadas();
            return cargarRifas('«' + r.nombre + '» volvió al historial.');
          })
          .catch(function (e) { mensaje(e.message, 'error', 'mensajeArchivadas'); });
      });
      acciones.appendChild(reactivar);
      fila.appendChild(acciones);

      caja.appendChild(fila);
    });
  }

  // ------------------------------------------------------------------
  // Nueva rifa
  // ------------------------------------------------------------------
  // Los atajos son solo eso: un atajo. El número lo pone quien crea la rifa,
  // desde 1 hasta 5000, y por eso la casilla arranca vacía.
  Array.prototype.forEach.call(
    document.querySelectorAll('#atajosCantidad button'),
    function (b) {
      b.addEventListener('click', function () {
        $('nvCantidad').value = b.dataset.cantidad;
        resumenNueva();
      });
    }
  );

  /**
   * Va diciendo en voz alta qué se va a generar, y avisa ANTES de apretar el
   * botón si los folios no alcanzan: con pocos dígitos el lote se apretuja y
   * los números se vuelven adivinables, así que el servidor lo rechaza. Más
   * vale enterarse aquí que después de esperar la generación.
   */
  function foliosPorBoleto() {
    var n = parseInt($('nvFoliosPorBoleto').value, 10);
    return (n >= 1 && n <= 10) ? n : 4;
  }

  /** El tope escrito a mano, o nulo si se deja vacío (modo de siempre). */
  function topeEscrito() {
    var n = parseInt($('nvTope').value, 10);
    return n > 0 ? n : null;
  }

  function resumenNueva() {
    var cantidad = parseInt($('nvCantidad').value, 10);
    var digitos = parseInt($('nvDigitos').value, 10) || 4;
    var porBoleto = foliosPorBoleto();
    var elegido = topeEscrito();
    var usaTope = elegido !== null;
    // Sin tope: el 30% de siempre, para que el número siga siendo raro de
    // adivinar. Con tope: el límite de verdad del sorteo de canastas —y el
    // espacio real va de 0 a tope, tope + 1 números, porque el 0000 también
    // es un resultado posible de la saca—.
    var tope = usaTope ? elegido : Math.floor((Math.pow(10, digitos) - Math.pow(10, digitos - 1)) * 0.3);
    var capacidad = usaTope ? tope + 1 : tope;
    var topeBoletos = Math.floor(capacidad / porBoleto);
    var caja = $('cuentaNueva');

    if (usaTope && elegido > Math.pow(10, digitos) - 1) {
      caja.textContent = 'El tope ' + elegido.toLocaleString('es-MX') + ' no cabe en ' + digitos +
        ' dígitos (el máximo con ' + digitos + ' dígitos es ' +
        (Math.pow(10, digitos) - 1).toLocaleString('es-MX') + '). Sube los dígitos o baja el tope.';
      caja.className = 'mensaje error';
      return;
    }

    if (!(cantidad > 0)) {
      caja.textContent = (usaTope ? 'Con tope ' + tope.toLocaleString('es-MX')
                                   : 'Con ' + digitos + ' dígitos') +
        ' y ' + porBoleto + ' números por boleto caben hasta ' +
        topeBoletos.toLocaleString('es-MX') + ' boletos.';
      caja.className = 'nota';
      return;
    }
    var totalFolios = cantidad * porBoleto;
    if (totalFolios > capacidad) {
      caja.textContent = cantidad.toLocaleString('es-MX') + ' boletos de ' + porBoleto +
        ' números son ' + totalFolios.toLocaleString('es-MX') + ' folios, y no caben en el tope de ' +
        tope.toLocaleString('es-MX') + (usaTope ? ' (caben ' + capacidad.toLocaleString('es-MX') + ')' : '') + '. ' +
        (usaTope ? 'Sube el tope o baja la cantidad.' : 'Sube los dígitos del folio o baja los números por boleto.');
      caja.className = 'mensaje error';
      return;
    }
    var precio = parseFloat($('nvPrecio').value);
    var texto = 'Se van a generar ' + cantidad.toLocaleString('es-MX') +
      ' boletos con ' + porBoleto + ' números cada uno: ' +
      totalFolios.toLocaleString('es-MX') + ' folios' +
      (usaTope
        ? (', de 0 a ' + tope.toLocaleString('es-MX') + ' — SÍ se repetirán en la siguiente rifa')
        : (' de ' + digitos + ' dígitos, únicos para toda la vida del proyecto'));
    if (precio > 0) {
      texto += ', que a $' + precio + ' suman $' +
        (precio * cantidad).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    }

    // Un tope que apenas cruza al siguiente escalón (p. ej. 1000 en vez de
    // 1999) deja casi vacía la canasta de más a la izquierda: con 1000 de
    // los 1001 folios empezando en 0 y solo uno en 1 (el 1000 exacto), esa
    // bolita del 1 casi nunca cae en un boleto de verdad al sacarla en vivo.
    // Se avisa ANTES de generar nada, no después de imprimir —que fue justo cómo se encontró
    // este caso la primera vez—. El aviso ofrece las DOS salidas, no solo
    // subir: si la canasta de verdad ya trae esa bolita extra, 1999 la
    // aprovecha; si no la tienes armada, el tope correcto es 999, no 1000 a
    // medias —1000 no es un punto intermedio válido, es el peor de los dos
    // mundos—.
    var avisoCanasta = '';
    if (usaTope && digitos >= 2) {
      var escalon = Math.pow(10, digitos - 1);
      var escalonTope = Math.floor(tope / escalon);
      if (escalonTope > 0) {
        var enUltimoEscalon = tope - escalonTope * escalon + 1;
        var fraccion = enUltimoEscalon / escalon;
        if (fraccion < 0.3) {
          avisoCanasta = ' Ojo: con este tope, la canasta de más a la izquierda está casi vacía ' +
            '—solo ' + enUltimoEscalon.toLocaleString('es-MX') + ' de cada ' + escalon.toLocaleString('es-MX') +
            ' folios posibles usan su última bolita (la del ' + escalonTope + ')—. ' +
            'Si esa canasta de verdad tiene armada esa bolita, sube el tope hasta ' +
            ((escalonTope + 1) * escalon - 1).toLocaleString('es-MX') +
            ' para aprovecharla de verdad; si no la tienes, bájalo a ' +
            (escalonTope * escalon - 1).toLocaleString('es-MX') +
            ' y usa solo hasta la bolita ' + (escalonTope - 1) + '.';
        }
      }
    }

    // El aviso de arriba solo cubre la canasta de más a la izquierda. Pero el
    // mismo problema —una bolita que casi nunca encuentra pareja al sacarla
    // en vivo— puede pasar con CUALQUIER combinación de bolitas, no solo esa,
    // en cuanto se imprimen muchos menos folios de los que caben en el tope:
    // si el tope es 1999 (2,000 números posibles, el 0000 incluido) y solo se
    // venden 40, el 98% de las sacadas posibles no va a coincidir con ningún
    // boleto vendido. El sorteo real SÍ reparte cualquier número de 0 al tope
    // (ver el comentario en `supabase/funciones/sorteo/index.ts`), así que
    // esto no impide generar la rifa —hay rifas que de verdad venden solo una
    // fracción de sus canastas—, pero quien la crea tiene que saberlo ANTES
    // de imprimir, no enterarse en vivo el día del sorteo.
    if (usaTope) {
      var cobertura = totalFolios / capacidad;
      if (cobertura < 0.5) {
        avisoCanasta += ' Ojo: estos boletos cubren ' + totalFolios.toLocaleString('es-MX') +
          ' de los ' + capacidad.toLocaleString('es-MX') + ' números posibles en las canastas (' +
          Math.round(cobertura * 100) + '%). Si al sacar las bolitas en vivo cae un número que ' +
          'nadie compró, esa saca no tiene ganador: hay que repetir la saca hasta que caiga uno ' +
          'que sí esté vendido.';
      }
    }

    caja.textContent = texto + '.' + avisoCanasta;
    caja.className = avisoCanasta ? 'mensaje error' : 'nota';
  }

  ['nvCantidad', 'nvDigitos', 'nvTope', 'nvPrecio', 'nvFoliosPorBoleto'].forEach(function (id) {
    $(id).addEventListener('input', resumenNueva);
  });
  resumenNueva();

  $('btnCrear').addEventListener('click', function () {
    var nombre = $('nvNombre').value.trim();
    var serie = $('nvSerie').value.trim().toUpperCase();
    var fechaLocal = $('nvFecha').value;
    var cantidad = parseInt($('nvCantidad').value, 10);
    var digitos = parseInt($('nvDigitos').value, 10);
    var precio = $('nvPrecio').value.trim();

    if (!nombre) { return mensaje('Ponle nombre a la rifa.', 'error', 'mensajeNueva'); }
    if (!fechaLocal) { return mensaje('Falta el día y la hora del sorteo.', 'error', 'mensajeNueva'); }
    if (!(cantidad > 0)) {
      return mensaje('Escribe cuántos boletos quieres, de 1 a 5000.', 'error', 'mensajeNueva');
    }

    var porBoleto = foliosPorBoleto();
    if (!confirmarNueva(cantidad + ' boletos nuevos para «' + nombre + '», con ' +
        porBoleto + ' números cada uno.')) { return; }

    mensaje('Generando ' + (cantidad * porBoleto) + ' folios… puede tardar unos segundos.', '', 'mensajeNueva');
    $('btnCrear').disabled = true;

    llamar('crear_rifa', {
      nombre: nombre,
      serie: serie || 'A',
      // `datetime-local` no trae zona: se le pega la del evento para que la
      // hora escrita sea la hora del lugar, no la del navegador.
      fecha_sorteo: conZona(fechaLocal),
      cantidad: cantidad,
      digitos: digitos,
      folios_por_boleto: porBoleto,
      tope: topeEscrito(),
      precio: precio === '' ? null : Number(precio),
    })
      .then(function (datos) {
        $('btnCrear').disabled = false;
        mensaje('Lista: ' + datos.boletos.length + ' boletos (' + datos.rifa.folios +
          ' números). Abriendo la hoja para imprimir…', 'ok', 'mensajeNueva');
        abrirHoja(datos.rifa, datos.boletos);

        // Y el panel se pasa solo a la rifa recién creada. Antes se quedaba
        // manejando la anterior —normalmente una ya cerrada, con todo
        // apagado— y parecía que el panel se había trabado.
        rifaActual = datos.rifa.id;
        mapaCodigos = null;
        return llamar('activar', { rifa: datos.rifa.id })
          .then(function () { return llamar('estado'); })
          .then(function (estado) {
            pintar(estado);
            abrirPestana('paneSorteo');
            mensaje('«' + estado.rifa.nombre + '» creada y lista. El panel ya la está manejando.', 'ok');
            limpiarFormularioNueva();
          });
      })
      .catch(function (e) {
        $('btnCrear').disabled = false;
        mensaje(e.message, 'error', 'mensajeNueva');
      });
  });

  /**
   * Deja el formulario listo para la siguiente, sin arrastrar lo anterior.
   *
   * `nvTope` NO se limpia a propósito: refleja las canastas físicas que ya
   * se tienen armadas, y esas no cambian de una rifa a la siguiente —solo
   * cuando de verdad se le agrega una bolita más a una canasta—.
   */
  function limpiarFormularioNueva() {
    ['nvNombre', 'nvSerie', 'nvFecha', 'nvCantidad', 'nvPrecio'].forEach(function (id) {
      $(id).value = '';
    });
    $('nvDigitos').value = '4';
    $('nvFoliosPorBoleto').value = '4';
    resumenNueva();
    mensaje('', '', 'mensajeNueva');
    $('cajaNueva').open = false;
  }

  var pendienteNueva = null;
  function confirmarNueva(texto) {
    if (pendienteNueva === texto) { pendienteNueva = null; return true; }
    pendienteNueva = texto;
    mensaje('Vas a crear ' + texto + ' Toca otra vez para confirmar.', 'error', 'mensajeNueva');
    setTimeout(function () { if (pendienteNueva === texto) { pendienteNueva = null; } }, 8000);
    return false;
  }

  /**
   * «2026-09-13T18:00» -> el instante exacto en la zona del evento.
   *
   * El campo del formulario no trae zona horaria, y el navegador que llena el
   * formulario puede estar en otra: si se tomara la del navegador, la rifa
   * quedaría programada a una hora distinta de la que se escribió. Así que la
   * hora tecleada se interpreta siempre como hora del lugar del evento.
   */
  function conZona(local) {
    var zona = CFG.zonaHoraria;
    if (!zona) { return new Date(local).toISOString(); }
    // Se lee la hora tecleada como si fuera UTC, y se mide cuánto se corre al
    // mostrarla en la zona del evento: eso es el desfase que hay que quitar.
    var comoUtc = Date.parse(local + 'Z');
    var partes = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(comoUtc)).reduce(function (acc, p) {
      acc[p.type] = p.value; return acc;
    }, {});
    var enZona = Date.UTC(+partes.year, partes.month - 1, +partes.day,
                          +partes.hour % 24, +partes.minute, +partes.second);
    var desfase = enZona - comoUtc;
    return new Date(comoUtc - desfase).toISOString();
  }

  // ------------------------------------------------------------------
  // Hoja de boletos para imprimir
  // ------------------------------------------------------------------
  /** Trae los boletos de una rifa y arma con ellos la hoja que se pida. */
  function pedirHoja(id, boton, armar) {
    var antes = boton.textContent;
    boton.textContent = 'Armando…';
    boton.disabled = true;
    llamar('boletos', { rifa: id })
      .then(function (datos) {
        boton.textContent = antes;
        boton.disabled = false;
        armar(datos.rifa, datos.boletos);
      })
      .catch(function (e) {
        boton.textContent = antes;
        boton.disabled = false;
        mensaje(e.message, 'error', 'mensajeRifas');
      });
  }

  /**
   * El QR, dibujado aquí mismo: la hoja se imprime aunque no haya red.
   *
   * `width`/`height` van EXPLÍCITOS, no solo el `viewBox`: un SVG que
   * depende nada más del CSS (`.qr svg { width: 100%; ... }`) para su
   * tamaño se ve bien en un navegador de escritorio, pero el motor de
   * «Imprimir a PDF» de varios celulares no le calcula tamaño y lo pinta
   * como un cuadro gris roto, sin ningún QR —justo lo que reportó el
   * dueño con una hoja generada desde el teléfono del cliente—. Con
   * tamaño propio, el SVG ya no depende de que el CSS se aplique a
   * tiempo en ESE motor de impresión en particular; el `width: 100%`
   * del CSS lo sigue reescalando normal en todos los demás.
   */
  function qrSvg(texto) {
    var qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    var n = qr.getModuleCount();
    var margen = 4;
    var lado = n + margen * 2;
    var rects = [];
    for (var f = 0; f < n; f++) {
      var inicio = -1;
      for (var c = 0; c <= n; c++) {
        var oscuro = c < n && qr.isDark(f, c);
        if (oscuro && inicio < 0) { inicio = c; }
        if (!oscuro && inicio >= 0) {
          rects.push('<rect x="' + (inicio + margen) + '" y="' + (f + margen) +
                     '" width="' + (c - inicio) + '" height="1"/>');
          inicio = -1;
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + lado + '" height="' + lado +
      '" viewBox="0 0 ' + lado + ' ' + lado +
      '" shape-rendering="crispEdges"><rect width="' + lado + '" height="' + lado +
      '" fill="#fff"/><g fill="#000">' + rects.join('') + '</g></svg>';
  }

  function escapar(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** La dirección que lleva el QR: la de este mismo sitio, sin nombres fijos. */
  function baseDelSitio() {
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }

  // ------------------------------------------------------------------
  // El diseño del boleto impreso
  // ------------------------------------------------------------------
  /*
   * Todo lo que pinta un boleto vive aquí, y lo usan DOS pantallas: la hoja
   * que se imprime y la vista previa de la pestaña «Diseño». A propósito es el
   * mismo código: una vista previa que dibuja por su cuenta tarde o temprano
   * miente, y de eso uno se entera con doscientos boletos ya impresos.
   */

  var AVISO_DE_SIEMPRE = 'El boleto se anulará si se encuentra roto, con tachones, ' +
    'borrones o enmendaduras.';

  /**
   * Un diseño guardado, completado con lo que falte.
   *
   * Nulo significa «el de siempre»: por eso las rifas de antes de que esto
   * existiera siguen imprimiéndose exactamente igual que antes. Ya no hay
   * temas ni colores que elegir: sin plantilla el boleto sale con el diseño
   * clásico fijo (ver `estiloBoleto`); con plantilla, sale con la foto y las
   * medidas que se hayan cargado.
   */
  function disenoCompleto(guardado) {
    var d = guardado && typeof guardado === 'object' ? guardado : {};
    return {
      plantilla: plantillaValida(d.plantilla) ? d.plantilla : null,
      aviso: typeof d.aviso === 'string' ? d.aviso : AVISO_DE_SIEMPRE,
      columnas: (d.columnas === 1 || d.columnas === 3) ? d.columnas : 2,
      caducidad: typeof d.caducidad === 'string' ? d.caducidad : '1 día',
    };
  }

  /** Un color solo si de verdad lo es: lo que se cuela aquí va a un `style`. */
  function color(valor) {
    return /^#[0-9a-fA-F]{6}$/.test(String(valor || '')) ? String(valor).toLowerCase() : '';
  }

  /** ¿Trae esto lo mínimo que una plantilla necesita para dibujarse? */
  function plantillaValida(p) {
    return !!(p && typeof p === 'object' &&
      typeof p.foto === 'string' && p.foto.indexOf('data:image/') === 0 &&
      Number(p.fotoAncho) > 0 && Number(p.fotoAlto) > 0 &&
      color(p.fondo) && color(p.tinta) && color(p.acento) && color(p.borde) &&
      p.caja && p.qr && p.precio && p.pie);
  }

  // --- Contraste -----------------------------------------------------
  /*
   * En pantalla un color flojo se ve flojo. En papel, y sobre todo fotocopiado
   * o impreso en una impresora con poca tinta, desaparece. Esto no prohíbe
   * nada —el gusto es de quien sube la plantilla— pero avisa antes de las
   * doscientas copias, que es cuando ya no tiene remedio. El boleto clásico
   * (sin plantilla) ya usa colores fijos y probados: no hace falta avisar
   * de nada ahí.
   */
  function luminancia(hex) {
    var canales = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
  }

  function contraste(a, b) {
    var la = luminancia(a), lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Qué habría que arreglar antes de imprimir, en palabras. */
  function avisosDeContraste(d) {
    if (!d.plantilla) { return []; }
    var p = d.plantilla;
    var avisos = [];
    // 4.5 es el mínimo para texto corrido; los números van grandes y aguantan 3.
    if (contraste(p.tinta, p.fondo) < 4.5) {
      avisos.push('la letra chica casi no se distingue del fondo');
    }
    if (contraste(p.acento, p.fondo) < 3) {
      avisos.push('los números se pierden contra el fondo');
    }
    return avisos;
  }

  /**
   * El lugar de cada número, para un boleto de `cuantos` folios.
   *
   * El boleto trae cuatro números en las cuatro esquinas del centro, pero
   * una rifa puede llevar de 1 a 10 por boleto. Los números se acomodan en
   * dos columnas y en tantos renglones como hagan falta: con cuatro caen
   * exactamente donde el original, y con más se aprietan hacia adentro.
   * Imprimir solo los primeros cuatro no es opción: los demás siguen
   * valiendo y pueden salir ganadores sin que el papel los muestre.
   */
  function cajasPlantilla(plantilla, cuantos) {
    var c = plantilla.caja;
    var renglones = Math.ceil(cuantos / 2);
    var paso = renglones > 1 ? (c.ultimo - c.primer) / (renglones - 1) : 0;
    var lugares = [];
    for (var i = 0; i < cuantos; i++) {
      lugares.push({
        izq: c.columna[i % 2],
        arriba: Number((c.primer + Math.floor(i / 2) * paso).toFixed(2)),
      });
    }
    return lugares;
  }

  /**
   * ¿Con tantos folios hay que apretar el boleto?
   *
   * Pasando de cuatro los números ocupan los costados de arriba a abajo, y ahí
   * vivía la caducidad. Se muda al pie.
   */
  function plantillaApretada(cuantos) {
    return cuantos > 4;
  }

  /**
   * El estilo de un boleto con foto de fondo.
   *
   * `aspect-ratio` en vez de una altura fija: así la hoja puede imprimirlo a
   * uno, dos o tres por renglón y el boleto conserva su forma en los tres
   * casos, en vez de estirarse.
   */
  function estiloPlantilla(plantilla, p) {
    // Algunas plantillas traen `fechas` —cubre una muestra de la foto—;
    // otras no: su hueco lo ocupa el QR y la caducidad siempre va al pie
    // (ver más abajo, en `boletoPlantillaHtml`).
    var f = plantilla.fechas;
    return (
      // Todo el boleto se mide en `--u`, que vale un milímetro del boleto
      // impreso a 60 mm de ancho... y, donde el navegador sepa de
      // contenedores, la sesentava parte del ancho REAL.
      //
      // Hace falta porque el boleto no siempre sale de 60 mm: en la pantalla
      // la hoja lo enseña al doble, y con las letras clavadas en milímetros
      // se veían diminutas ahí y correctas en papel. Un boleto que no se ve
      // como va a salir no sirve para decidir si va a salir bien.
      //
      // El milímetro va primero: un navegador viejo que no entienda
      // `@container` se queda con él y el papel sale igual que siempre.
      // `page-break-inside` además de `break-inside`: dentro de un
      // `display: grid`, Safari/WebKit (el que arma el PDF al imprimir
      // desde Mac o iOS) a veces ignora la propiedad nueva y parte un
      // boleto a la mitad entre una página y la siguiente —justo lo que
      // reportó el dueño—; la propiedad vieja es la que varios motores de
      // impresión de Apple sí respetan en un grid.
      p + '.boleto { position: relative; box-sizing: border-box;' +
      ' container-type: inline-size; --u: 1mm; background-color: ' + plantilla.fondo + ';' +
      ' color: ' + plantilla.tinta + '; overflow: hidden;' +
      ' break-inside: avoid; page-break-inside: avoid; }' +
      // El relleno de abajo es el de la FOTO de esta plantilla, no un valor
      // inventado: viene de `fotoAncho`/`fotoAlto`, medidos junto con todo lo
      // demás de aquí abajo. El truco del `padding-top` —en vez de
      // `aspect-ratio`— hace falta porque varios navegadores, Chromium entre
      // ellos, no le dan una altura «definida» a un elemento que solo trae
      // `aspect-ratio`: los hijos con `height` en porcentaje se quedan en 0
      // aunque el boleto se vea perfecto. El `padding-top` sí cuenta, porque
      // se calcula contra el ANCHO, que nunca tiene ese lío.
      p + '.boleto::before { content: ""; display: block;' +
      ' padding-top: ' + (plantilla.fotoAlto / plantilla.fotoAncho * 100).toFixed(4) + '%;' +
      ' background-image: url(\'' + plantilla.foto + '\');' +
      ' background-size: 100% 100%; background-repeat: no-repeat; }' +
      p + '.boleto > * { --u: 1mm; }' +
      '@container (min-width: 1px) { ' + p + '.boleto > * { --u: 1.6667cqw; } }' +
      // `border-box`: el recuadro vacío que trae la foto ya incluye su
      // propia línea; sin esto el borde se suma y el número no cae encima.
      //
      // `padding: 0` no es cosmético: el panel YA tiene una regla genérica
      // `.caja { padding: 20px; }` para las tarjetas de vidrio de cada
      // pestaña —coincide el nombre de clase con estos recuadros de número
      // por pura casualidad—, y con `box-sizing: border-box` esos 20px por
      // lado nunca se sobreescribían: la altura no podía bajar de padding +
      // borde (42px) sin importar lo que dijera `height`. Se vio igual con
      // 7.1%, con `calc()`, hasta con `aspect-ratio` —la caja de verdad SE
      // ACHICABA, pero el relleno la volvía a estirar—. Este `padding: 0`
      // es lo que de verdad arregla el tamaño del recuadro.
      p + '.caja { position: absolute; box-sizing: border-box; padding: 0;' +
      ' width: ' + plantilla.caja.ancho + '%; height: ' + plantilla.caja.alto + '%;' +
      ' border: calc(var(--u) * 0.26) solid ' + plantilla.borde + ';' +
      ' border-radius: calc(var(--u) * 0.85); display: flex;' +
      ' align-items: center; justify-content: center; background: ' + plantilla.fondo + ';' +
      ' font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700;' +
      ' font-size: calc(var(--u) * 4.4); color: ' + plantilla.acento + '; }' +
      // El QR, siempre sobre blanco y con su margen: no se negocia ni aquí.
      // Tapa lo que haya de muestra en ese lugar de la foto —QR o logo—, por
      // eso es opaco y no un poco más grande que la malla real: tiene que
      // cubrirlo entero.
      p + '.qr { position: absolute; left: ' + plantilla.qr.left + '%; width: ' + plantilla.qr.width + '%;' +
      ' top: ' + plantilla.qr.top + '%; height: ' + plantilla.qr.height + '%;' +
      ' background: #fff; box-sizing: border-box; padding: calc(var(--u) * 0.9);' +
      ' border-radius: calc(var(--u) * 0.8); }' +
      p + '.qr svg { width: 100%; height: auto; display: block; }' +
      (f
        ? p + '.fechas { position: absolute; left: ' + f.left + '%; width: ' + f.width + '%;' +
          ' top: ' + f.top + '%; height: ' + f.height + '%;' +
          ' box-sizing: border-box; background: ' + plantilla.fondo + '; display: flex;' +
          ' align-items: center; justify-content: center; text-align: center;' +
          (f.vertical ? ' writing-mode: vertical-rl;' : '') +
          ' font-size: calc(var(--u) * ' + f.fuente + '); font-weight: 700;' +
          ' line-height: 1.3; white-space: nowrap; color: ' + plantilla.tinta + '; }'
        : '') +
      p + '.precio { position: absolute; left: ' + plantilla.precio.left + '%; width: ' + plantilla.precio.width + '%;' +
      ' top: ' + plantilla.precio.top + '%; height: ' + plantilla.precio.height + '%;' +
      ' box-sizing: border-box; background: ' + plantilla.fondo + ';' +
      ' display: flex; align-items: center; justify-content: center;' +
      ' font-size: calc(var(--u) * 5.25); font-weight: 800; font-style: italic;' +
      ' color: ' + plantilla.acento + '; text-shadow: calc(var(--u) * 0.35) calc(var(--u) * 0.4)' +
      ' calc(var(--u) * 0.45) rgba(0, 0, 0, 0.45); }' +
      // El identificador y el código, impresos. El día del sorteo hay que
      // cotejar el código del panel contra el talón que trae el ganador, y un
      // boleto que solo los lleve dentro del QR no se puede cotejar si el
      // teléfono no lo lee. Va bajo el aviso de la foto, pegado al borde de
      // abajo: es el único hueco en blanco que queda ahí en las dos fotos.
      //
      // `margin: 0; padding-top: 0` no son cosméticos: `estilos.css` —que
      // este mismo panel también carga, para los colores y tipos
      // compartidos— ya tiene una regla `.pie { margin-top: 24px;
      // padding-top: 15px; ...}` para el pie de la PANTALLA del boleto, sin
      // relación con este. Coincide el nombre de clase por casualidad —como
      // pasó antes con `.caja`—, y esos 24+15 px empujaban este pie FUERA
      // del boleto: `overflow: hidden` se lo comía entero y el código
      // quedaba sin imprimirse, sin que ningún aviso lo dijera. Las pruebas
      // de texto seguían en verde porque leen el DOM, no lo que de verdad se
      // ve —la lección de siempre: medir la posición, no solo el contenido—.
      p + '.pie { position: absolute; left: ' + plantilla.pie.left + '%; right: ' + plantilla.pie.right + '%;' +
      ' top: ' + plantilla.pie.top + '%; height: ' + plantilla.pie.height + '%;' +
      ' margin: 0; padding-top: 0; border-top: none;' +
      ' display: flex; align-items: center; justify-content: space-between;' +
      ' gap: calc(var(--u) * 1.2); font-size: calc(var(--u) * 1.6); line-height: 1;' +
      ' color: ' + plantilla.tinta + '; opacity: 0.85; }' +
      p + '.pie span { font-family: ui-monospace, Menlo, Consolas, monospace;' +
      ' white-space: nowrap; }' +
      p + '.serial { letter-spacing: 0.04em; }' +
      p + '.codigo { letter-spacing: 0.08em; font-weight: 700; }' +
      // `min-width: 0`: sin eso la fecha no se deja recortar y es el código el
      // que se sale del boleto.
      p + '.fechas-pie { font-family: inherit; letter-spacing: 0; min-width: 0;' +
      ' overflow: hidden; text-overflow: ellipsis; }' +
      // Apretado, al pie le cabe además la caducidad: con la letra del
      // boleto normal salía cortada con puntos suspensivos.
      p + '.apretado .pie { font-size: calc(var(--u) * 1.4); }'
    );
  }

  function boletoPlantillaHtml(plantilla, rifa, boleto, url, precio, d) {
    var numeros = boleto.folios || [];
    var lugares = cajasPlantilla(plantilla, numeros.length);
    var apretado = plantillaApretada(numeros.length);
    // Sin `fechas` propia (Bono: el QR ya ocupa ese hueco) la caducidad
    // siempre va al pie, igual que en un boleto apretado de Suertudito.
    var fechasEnPie = apretado || !plantilla.fechas;
    var fechas = [];
    if (d.caducidad) { fechas.push('Caducidad: ' + escapar(d.caducidad)); }
    return '<article class="boleto' + (apretado ? ' apretado' : '') + '">' +
      numeros.map(function (f, i) {
        return '<div class="caja" style="left: ' + lugares[i].izq + '%; top: ' +
          lugares[i].arriba + '%">' + escapar(f) + '</div>';
      }).join('') +
      '<div class="qr">' + qrSvg(url) + '</div>' +
      // Siempre se pinta, aunque no haya fechas que mostrar: la foto trae
      // una muestra justo ahí y hay que taparla sin excepción.
      (!fechasEnPie ? '<div class="fechas">' + fechas.join('<br />') + '</div>' : '') +
      // Igual el precio: las dos fotos traen un «$20» de muestra ahí.
      '<div class="precio">' + escapar(precio || '') + '</div>' +
      '<div class="pie">' +
      '<span class="serial">' + escapar(boleto.id) + '</span>' +
      (fechasEnPie && fechas.length
        ? '<span class="fechas-pie">' + fechas.join(' · ') + '</span>' : '') +
      '<span class="codigo">Código ' + escapar(boleto.codigo) + '</span>' +
      '</div>' +
      '</article>';
  }

  /**
   * El estilo de un boleto. Lo comparten la hoja y la vista previa.
   *
   * `sufijo` permite encerrarlo bajo un selector en la vista previa, para que
   * los colores del boleto no se desparramen por el panel.
   */
  // El boleto clásico (sin plantilla) usa siempre estos cuatro colores: ya
  // no hay temas que elegir, y son los que ya se venían usando por omisión.
  var CLASICO = { fondo: '#ffffff', tinta: '#111111', acento: '#c2185b', borde: '#333333' };

  function estiloBoleto(d, prefijo) {
    var p = prefijo || '';
    if (d.plantilla) { return estiloPlantilla(d.plantilla, p); }
    return (
      p + '.boleto { background-color: ' + CLASICO.fondo + '; color: ' + CLASICO.tinta + ';' +
      // Sin esquinas redondeadas a propósito: pegados sin espacio (ver
      // `.rejilla` arriba), una esquina redonda dejaría un triángulo
      // blanco justo donde se tocan cuatro boletos.
      ' border: 1px solid ' + CLASICO.borde + '; padding: 3mm 4mm;' +
      ' break-inside: avoid; page-break-inside: avoid; }' +
      p + '.marca { font-size: 13pt; font-weight: 700; text-transform: uppercase;' +
      ' letter-spacing: 0.04em; text-align: center; margin: 0 0 1mm; }' +
      p + '.aviso { font-size: 5.5pt; opacity: 0.75; text-align: center; margin: 0 0 2mm;' +
      ' line-height: 1.25; }' +
      p + '.medio { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }' +
      // Los números en rejilla de dos: así cuatro caben cuadrados y parejos,
      // y con uno o dos la caja no se deforma.
      p + '.numeros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));' +
      ' gap: 1.5mm; flex: 1 1 auto; }' +
      p + '.num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14pt;' +
      ' font-weight: 700; color: ' + CLASICO.acento + '; background: ' + CLASICO.fondo + ';' +
      ' border: 0.4mm solid ' + CLASICO.borde + ';' +
      ' border-radius: 1mm; padding: 0.8mm 1mm; text-align: center; letter-spacing: 0.03em; }' +
      // El QR SIEMPRE sobre blanco y con su margen. No es negociable ni con el
      // tema más oscuro: un QR sin contraste no lo lee ningún teléfono, y de
      // eso uno se entera cuando los boletos ya están repartidos.
      p + '.qr { width: 19mm; flex: 0 0 auto; background: #fff; padding: 1mm;' +
      ' border-radius: 0.8mm; }' +
      p + '.qr svg { width: 100%; height: auto; display: block; }' +
      p + '.pie { display: flex; align-items: baseline; justify-content: space-between;' +
      ' gap: 2mm; margin: 2mm 0 0; font-size: 6.5pt; opacity: 0.85; }' +
      p + '.serial { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.06em; }' +
      p + '.codigo { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.1em; }' +
      p + '.precio { font-weight: 700; font-size: 9pt; opacity: 1; }'
    );
  }

  /**
   * Un boleto. El mismo que va a la hoja y el que se ve en la vista previa.
   *
   * Recibe la rifa entera y no solo su nombre porque la clásica imprime
   * `rifa.nombre` en el boleto; las plantillas con foto no lo necesitan —el
   * nombre de la rifa no sale en la foto—, pero conservan la misma firma
   * para que el que llama no tenga que saber cuál disposición es cuál.
   */
  function boletoHtml(rifa, boleto, url, precio, d) {
    if (d.plantilla) {
      return boletoPlantillaHtml(d.plantilla, rifa, boleto, url, precio, d);
    }
    var nombre = rifa.nombre;
    var numeros = (boleto.folios || []).map(function (f) {
      return '<span class="num">' + escapar(f) + '</span>';
    }).join('');
    return '<article class="boleto">' +
      '<p class="marca">' + escapar(nombre) + '</p>' +
      (d.aviso ? '<p class="aviso">' + escapar(d.aviso) + '</p>' : '') +
      '<div class="medio">' +
      '<div class="numeros">' + numeros + '</div>' +
      '<div class="qr">' + qrSvg(url) + '</div>' +
      '</div>' +
      '<p class="pie">' +
      '<span class="serial">' + escapar(boleto.id) + '</span>' +
      '<span class="codigo">Código ' + escapar(boleto.codigo) + '</span>' +
      (precio ? '<span class="precio">' + escapar(precio) + '</span>' : '') +
      '</p>' +
      '</article>';
  }

  function hojaHtml(rifa, boletos) {
    var base = baseDelSitio();
    var d = disenoCompleto(rifa.diseno);
    var porBoleto = (boletos[0] && boletos[0].folios ? boletos[0].folios.length : 1);
    var totalFolios = boletos.reduce(function (n, b) { return n + (b.folios || []).length; }, 0);
    var precio = (rifa.precio_boleto === null || rifa.precio_boleto === undefined)
      ? '' : '$' + rifa.precio_boleto;

    var trozos = boletos.map(function (b) {
      // El QR lleva el boleto, no un folio: un papel, un código.
      var url = base + '?b=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(b.codigo);
      return boletoHtml(rifa, b, url, precio, d);
    });

    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />' +
      // El boleto trae sus propios colores fijos —ninguno pensado para
      // modo oscuro—, pero varios celulares Android «fuerzan oscuro»
      // sobre cualquier página que no diga lo contrario: invierten los
      // colores a su manera, y a un SVG complejo como el QR a veces ni
      // lo intentan —lo pintan como un cuadro gris liso—. Esto se
      // confirmó con una hoja real: las cajas de número salieron con
      // fondo oscuro y letra clara, invertidas, y el QR en gris sin
      // patrón. El `meta` y el `color-scheme` de abajo le dicen al
      // celular que esta página YA es clara a propósito, para que no
      // la toque.
      '<meta name="color-scheme" content="light only" />' +
      '<title>Boletos ' + escapar(rifa.serie) + ' — ' + boletos.length + '</title><style>' +
      '@page { size: letter; margin: 10mm; }' +
      ':root { color-scheme: light only; }' +
      'body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0;' +
      ' background: #fff; color: #111; }' +
      '.encabezado { padding: 8mm 6mm 0; }' +
      'h1 { font-size: 13pt; margin: 0 0 2mm; }' +
      '.pie-hoja { font-size: 9pt; color: #666; margin: 0 0 6mm; }' +
      'button { font: inherit; padding: 3mm 6mm; margin-bottom: 6mm; }' +
      // `display: flex` con `flex-wrap`, NO `display: grid`: Safari/WebKit
      // —el motor detrás de «Imprimir a PDF» en Mac e iOS— tiene un bug
      // viejo y conocido donde, al paginar un grid para imprimir, corta un
      // renglón completo a la mitad entre una página y la siguiente, aun
      // con `break-inside: avoid` puesto en cada boleto —se confirmó con
      // una hoja real generada desde una Mac: el renglón quedaba partido
      // justo en la frontera de página—. Safari pagina un flex mucho
      // mejor. Cada boleto lleva su ancho fijo —`calc(100% / columnas)`,
      // abajo— en vez de que lo reparta el contenedor, así que con un
      // lote chico (menos boletos que `columnas`) se quedan en su tamaño
      // normal de un renglón completo, no crecen a llenar la hoja como
      // antes con `grid-template-columns: repeat(auto-fit, ...)` —un
      // cambio de comportamiento menor, aceptado a cambio de que no se
      // corten los boletos—. `justify-content: center` centra el ÚLTIMO
      // renglón cuando le faltan boletos para completar la fila.
      //
      // Sin espacio entre boletos (`gap`, aquí no existe en flex: ver
      // `.rejilla > .boleto` abajo) a propósito: para que el corte en la
      // imprenta sea de un solo tirón —cortes rectos de lado a lado de la
      // hoja, no uno por uno con tijeras—, los boletos tienen que quedar
      // pegados, formando una rejilla continua. Un espacio entre ellos
      // deja una «pestaña» blanca de sobra en cada corte, que hay que
      // volver a recortar aparte.
      '.rejilla { display: flex; flex-wrap: wrap;' +
      ' justify-content: center; padding: 0 6mm 8mm; }' +
      '.rejilla > .boleto { width: calc(100% / ' + d.columnas + '); box-sizing: border-box; }' +
      // Sin esto, Chrome y la mayoría de navegadores NO imprimen ni
      // `background-image` ni `background-color` por omisión —la casilla
      // «Gráficos de fondo» del diálogo de impresión nace destildada—. Eso
      // se lleva la foto entera del boleto «Suertudito», el fondo de la
      // caja del número y el de las fechas/precio que tapan la muestra:
      // la hoja sale en blanco con solo los bordes y el texto. Esta línea
      // fuerza a imprimir los fondos siempre, sin que quien imprime tenga
      // que saber de esa casilla.
      '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
      estiloBoleto(d, '') +
      '@media print { .encabezado { display: none; } .rejilla { padding: 0; } }' +
      '</style></head><body><div class="encabezado">' +
      '<h1>' + escapar(rifa.nombre) + ' · serie ' + escapar(rifa.serie) + ' · ' +
      boletos.length + ' boletos · ' + totalFolios + ' números (' + porBoleto + ' por boleto)</h1>' +
      '<p class="pie-hoja">Cada boleto lleva sus ' + porBoleto + ' números, un código de verificación ' +
      'y el QR que apunta a ' + escapar(base) + '. Cualquiera de sus números puede ser el ganador. ' +
      'Imprime esta hoja o guárdala como PDF desde el mismo diálogo de impresión.</p>' +
      '<button onclick="window.print()">Imprimir o guardar como PDF</button></div>' +
      '<div class="rejilla">' + trozos.join('') + '</div></body></html>';
  }

  function abrirHoja(rifa, boletos) {
    abrirEnVentana(hojaHtml(rifa, boletos), 'boletos-' + rifa.id + '.html');
  }

  /** Abre una hoja lista para imprimir, o la descarga si hay bloqueador. */
  function abrirEnVentana(html, nombreArchivo) {
    var ventana = window.open('', '_blank');
    if (ventana && ventana.document) {
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
      return;
    }
    // Con el bloqueador de ventanas puesto, se descarga el archivo.
    var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    var enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // ------------------------------------------------------------------
  // Pestaña 4: diseño del boleto impreso
  // ------------------------------------------------------------------
  var disenoEnEdicion = disenoCompleto(null);

  // Un boleto de muestra. Los números son los de la foto que dio origen a los
  // cuatro folios por boleto: se ve de lejos que son de ejemplo.
  var MUESTRA = { id: '9171057830', codigo: 'R5VR', folios: ['1018', '4307', '2850', '3267'] };

  function rifaConocida(id) {
    for (var i = 0; i < rifasConocidas.length; i++) {
      if (rifasConocidas[i].id === id) { return rifasConocidas[i]; }
    }
    return null;
  }

  /** Abrir la pestaña: se parte de lo que la rifa tenga guardado. */
  function abrirDiseno() {
    cargarPlantillasGuardadas();
    // Por si se llegó aquí por un camino que no trajo el historial: se pide y
    // se vuelve. Más vale una consulta de más que decirle a alguien que su
    // rifa no existe.
    if (!rifasConocidas.length || (rifaActual && !rifaConocida(rifaActual))) {
      return llamar('rifas')
        .then(function (datos) {
          rifasConocidas = datos.rifas || [];
          disenoPorOmision = datos.diseno_nuevo || null;
        })
        .catch(function () { /* se pinta con lo que haya */ })
        .then(pintarDiseno);
    }
    return pintarDiseno();
  }

  function pintarDiseno() {
    var r = rifaConocida(rifaActual);
    // Sin rifa esto NO es un callejón sin salida: lo natural es decidir cómo
    // se va a ver el boleto y después mandar a hacer el lote, no al revés.
    // Lo que se guarde aquí se le copia a la próxima rifa al crearla.
    $('disenoDeQuien').textContent = r
      ? 'Estás diseñando el boleto de «' + r.nombre + '», serie ' + r.serie + '.'
      : 'Todavía no hay ninguna rifa, así que esto se va a guardar para la ' +
        'próxima que crees. Al crearla, el diseño pasa a ser suyo: cambiarlo ' +
        'después no toca las hojas que ya se imprimieron.';
    $('btnGuardarDiseno').textContent = r
      ? 'Guardar el diseño' : 'Guardar para la próxima rifa';
    $('btnGuardarDiseno').disabled = false;
    $('btnDisenoDeSiempre').disabled = false;

    // El precio es DE LA RIFA, no del diseño —entra en el total vendido—,
    // por eso se corrige aparte con su propio botón: sin rifa todavía no
    // hay nada que corregir.
    $('campoPrecio').hidden = !r;
    $('btnGuardarPrecio').hidden = !r;
    $('dsPrecio').value = (r && r.precio_boleto !== null && r.precio_boleto !== undefined)
      ? r.precio_boleto : '';
    mensaje('', '', 'mensajePrecio');

    disenoEnEdicion = disenoCompleto(r ? r.diseno : disenoPorOmision);
    escribirControles(disenoEnEdicion);
    refrescarVista();
  }

  /**
   * La plantilla se arma con DOS archivos, en cualquier orden: la foto del
   * boleto y el JSON de medidas que salió de `medir_plantilla.py` corrido
   * por fuera. Mientras falte uno de los dos, el otro se queda a la espera
   * —no hay plantilla a medias—.
   */
  var plantillaFotoCargada = null;   // { foto, fotoAncho, fotoAlto }
  var plantillaJsonCargado = null;   // { fondo, tinta, acento, borde, caja, qr, fechas?, precio, pie }

  var PLANTILLA_MAX_ANCHO = 1400;
  var PLANTILLA_MAX_BYTES = 1.4 * 1024 * 1024;

  /** Achica la foto de la plantilla y regresa su tamaño real, ya achicado. */
  function prepararFotoPlantilla(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onerror = function () { rechazar(new Error('No se pudo leer esa imagen.')); };
      lector.onload = function () {
        var img = new Image();
        img.onerror = function () { rechazar(new Error('Eso no parece una imagen.')); };
        img.onload = function () {
          var ancho = Math.min(PLANTILLA_MAX_ANCHO, img.width);
          for (var intento = 0; intento < 5; intento++) {
            var lienzo = document.createElement('canvas');
            lienzo.width = Math.round(ancho);
            lienzo.height = Math.round(img.height * (ancho / img.width));
            lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
            var dataUrl = lienzo.toDataURL('image/jpeg', 0.88);
            if (dataUrl.length * 0.75 <= PLANTILLA_MAX_BYTES) {
              return resolver({ foto: dataUrl, fotoAncho: lienzo.width, fotoAlto: lienzo.height });
            }
            ancho = ancho * 0.75;
          }
          rechazar(new Error('Esa foto no se pudo achicar lo suficiente. Prueba con una más chica.'));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  /**
   * Comprueba que un archivo de medidas traiga datos de verdad usables, no
   * solo las claves correctas —las mismas reglas que aplica el servidor al
   * guardar, repetidas aquí para avisar al instante, antes de que la vista
   * previa salga rota en silencio (un color inválido o una medida que no es
   * número no truena nada: la vista previa simplemente se ve mal y nadie
   * sabe por qué).
   */
  var COLOR_VALIDO = /^#[0-9a-fA-F]{6}$/;
  function medidaValida(valor) {
    var n = Number(valor);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }
  function cajaValida(c) {
    return c && typeof c === 'object' &&
      medidaValida(c.left) && medidaValida(c.width) && medidaValida(c.top) && medidaValida(c.height);
  }
  function pieValido(c) {
    return c && typeof c === 'object' &&
      medidaValida(c.left) && medidaValida(c.right) && medidaValida(c.top) && medidaValida(c.height);
  }
  function cuadriculaValida(c) {
    return c && typeof c === 'object' && Array.isArray(c.columna) && c.columna.length === 2 &&
      medidaValida(c.primer) && medidaValida(c.ultimo) && medidaValida(c.alto) && medidaValida(c.ancho) &&
      medidaValida(c.columna[0]) && medidaValida(c.columna[1]);
  }

  /** Lee y comprueba el JSON de medidas: la forma Y que los datos sirvan de verdad. */
  function leerJsonMedidas(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onerror = function () { rechazar(new Error('No se pudo leer ese archivo.')); };
      lector.onload = function () {
        var datos;
        try { datos = JSON.parse(lector.result); }
        catch (e) { return rechazar(new Error('Ese archivo no se pudo abrir: no tiene el formato correcto.')); }
        var FALTA = ['caja', 'qr', 'precio', 'pie', 'fondo', 'tinta', 'acento', 'borde'];
        var falta = FALTA.filter(function (campo) { return !(campo in datos); });
        if (falta.length) {
          return rechazar(new Error('A ese archivo le falta información: ' + falta.join(', ') + '.'));
        }
        var COLORES = { fondo: 'de fondo', tinta: 'de la letra chica', acento: 'de los números', borde: 'del marco' };
        for (var clave in COLORES) {
          if (!COLOR_VALIDO.test(String(datos[clave] || ''))) {
            return rechazar(new Error('El color ' + COLORES[clave] + ' de ese archivo no es válido. Vuelve a medir esta plantilla.'));
          }
        }
        if (!cuadriculaValida(datos.caja)) {
          return rechazar(new Error('Los recuadros de número de ese archivo no son válidos. Vuelve a medir esta plantilla.'));
        }
        if (!cajaValida(datos.qr) || !cajaValida(datos.precio)) {
          return rechazar(new Error('El QR o el precio de ese archivo no son válidos. Vuelve a medir esta plantilla.'));
        }
        if (!pieValido(datos.pie)) {
          return rechazar(new Error('El pie de ese archivo no es válido. Vuelve a medir esta plantilla.'));
        }
        if (datos.fechas && !cajaValida(datos.fechas)) {
          return rechazar(new Error('La franja de fechas de ese archivo no es válida. Vuelve a medir esta plantilla.'));
        }
        resolver(datos);
      };
      lector.readAsText(archivo);
    });
  }

  /** Cuando ya se tienen los dos archivos, se arma la plantilla completa. */
  function intentarArmarPlantilla() {
    if (!plantillaFotoCargada || !plantillaJsonCargado) { return; }
    disenoEnEdicion.plantilla = Object.assign({}, plantillaJsonCargado, plantillaFotoCargada);
    mensaje('Plantilla cargada. Revisa la vista previa antes de guardar.', 'ok', 'mensajeDiseno');
    pintarEstadoPlantilla();
    refrescarVista();
  }

  $('dsPlantillaFoto').addEventListener('change', function () {
    var archivo = this.files && this.files[0];
    if (!archivo) { return; }
    mensaje('Preparando la foto…', '', 'mensajeDiseno');
    prepararFotoPlantilla(archivo)
      .then(function (resultado) {
        plantillaFotoCargada = resultado;
        mensaje('', '', 'mensajeDiseno');
        intentarArmarPlantilla();
        prepararMedidorConFoto(resultado);
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeDiseno'); });
  });

  // -------------------------------------------------------------------------
  // Medidor de plantilla: mide la foto del boleto AQUÍ MISMO, en el
  // navegador, para quien no quiera tocar herramientas/medir_plantilla.py ni
  // el repositorio. Reimplementa en JS, sobre un <canvas>, el mismo
  // algoritmo del script: dado un punto aproximado de dónde cae el marco de
  // un recuadro, camina hacia los cuatro lados buscando el primer salto de
  // contraste (el borde). El resto de las zonas (QR, precio, pie, fechas) no
  // tienen un borde que detectar solas, así que se marcan arrastrando un
  // rectángulo a ojo, igual de válido porque ahí la medida nunca fue del
  // borde sino de dónde el panel debe COLOCAR esos elementos encima.
  // -------------------------------------------------------------------------
  var PASOS_MEDIDOR = [
    {
      tipo: 'puntos4', clave: 'caja', titulo: 'Los cuatro recuadros de número',
      ayuda: 'Haz clic cerca del borde de CADA uno de los cuatro recuadros ' +
        'donde van los números del boleto —el orden no importa—. No hace ' +
        'falta ser exacto: basta acercarse, el navegador encuentra el ' +
        'borde exacto escaneando alrededor del punto.',
    },
    {
      tipo: 'rectangulo', clave: 'qr', titulo: 'El código QR',
      ayuda: 'Arrastra un rectángulo que cubra el espacio completo donde va el QR.',
    },
    {
      tipo: 'rectangulo', clave: 'precio', titulo: 'El precio del boleto',
      ayuda: 'Arrastra un rectángulo sobre dónde debe aparecer el precio.',
    },
    {
      tipo: 'rectanguloPie', clave: 'pie', titulo: 'El pie (folio y código en letra chica)',
      ayuda: 'Arrastra un rectángulo angosto cerca del borde de abajo, a lo ' +
        'ancho de donde va a ir el folio con su código de verificación.',
    },
    {
      tipo: 'rectanguloFechas', clave: 'fechas', titulo: '(Opcional) Franja de fechas a tapar',
      ayuda: 'Solo si la FOTO ya trae impresa una fecha de muestra que haya ' +
        'que cubrir con la fecha real. Si esta foto no trae nada así, salta este paso.',
      opcional: true,
    },
    {
      tipo: 'color', clave: 'fondo', titulo: 'Color de fondo',
      ayuda: 'Haz clic sobre una zona de fondo liso del boleto, lejos de letras o líneas.',
    },
    {
      tipo: 'color', clave: 'tinta', titulo: 'Color de la letra chica',
      ayuda: 'Haz clic sobre el texto pequeño del boleto, por ejemplo el aviso legal.',
    },
    {
      tipo: 'color', clave: 'acento', titulo: 'Color de los números',
      ayuda: 'Haz clic sobre uno de los números ya impresos en el boleto.',
    },
    {
      tipo: 'color', clave: 'borde', titulo: 'Color del marco de los recuadros',
      ayuda: 'Haz clic sobre la línea que dibuja el marco de un recuadro de número.',
    },
  ];

  var medidorImagen = null;       // Image ya cargada, tamaño natural = fotoAncho×fotoAlto
  var medidorGris = null;         // Int32Array de luminancia, una entrada por píxel
  var medidorPixeles = null;      // Uint8ClampedArray RGBA, de getImageData
  var medidorAncho = 0;
  var medidorAlto = 0;
  var medidorPaso = 0;            // índice en PASOS_MEDIDOR
  var medidorPuntos = [];         // puntos sueltos del paso 'puntos4' ya confirmados
  var medidorResultado = {};      // piezas ya armadas: caja, qr, precio, pie, fechas?, fondo…
  var medidorArrastrando = null;  // {x0,y0,x1,y1} en fracción, mientras se arrastra un rectángulo
  var medidorCtx = null;

  function redondear2(n) { return Math.round(n * 100) / 100; }

  /** Construye la escala de grises y el RGBA una sola vez por foto cargada. */
  function prepararMedidorConFoto(resultado) {
    var img = new Image();
    img.onload = function () {
      medidorImagen = img;
      medidorAncho = resultado.fotoAncho;
      medidorAlto = resultado.fotoAlto;
      var lienzo = document.createElement('canvas');
      lienzo.width = medidorAncho;
      lienzo.height = medidorAlto;
      var ctx = lienzo.getContext('2d');
      ctx.drawImage(img, 0, 0, medidorAncho, medidorAlto);
      var datos = ctx.getImageData(0, 0, medidorAncho, medidorAlto);
      medidorPixeles = datos.data;
      medidorGris = new Int32Array(medidorAncho * medidorAlto);
      for (var i = 0, p = 0; i < medidorPixeles.length; i += 4, p++) {
        medidorGris[p] = ((medidorPixeles[i] + medidorPixeles[i + 1] + medidorPixeles[i + 2]) / 3) | 0;
      }
      $('btnIniciarMedidor').hidden = false;
    };
    img.src = resultado.foto;
  }

  /** El algoritmo central: desde `centro`, el primer salto de contraste > umbral. */
  function primerSalto(perfil, centro, umbral, direccion) {
    var base = perfil[centro];
    var i = centro;
    var n = perfil.length;
    while (i + direccion >= 0 && i + direccion < n) {
      i += direccion;
      if (Math.abs(perfil[i] - base) > umbral) { return i; }
    }
    return i;
  }

  /** Dado un punto aproximado, el rectángulo exacto del recuadro con marco. */
  function recuadroCercano(xAprox, yAprox, ventana, umbral) {
    ventana = ventana || 0.10;
    umbral = umbral || 24;
    var ancho = medidorAncho, alto = medidorAlto;
    var cx = Math.max(0, Math.min(ancho - 1, Math.round(xAprox * ancho)));
    var cy = Math.max(0, Math.min(alto - 1, Math.round(yAprox * alto)));
    var radio = Math.round(ventana * Math.max(ancho, alto));
    var x0 = Math.max(0, cx - radio), x1 = Math.min(ancho, cx + radio);
    var y0 = Math.max(0, cy - radio), y1 = Math.min(alto, cy + radio);

    var fila = [];
    for (var x = x0; x < x1; x++) { fila.push(medidorGris[cy * ancho + x]); }
    var columna = [];
    for (var y = y0; y < y1; y++) { columna.push(medidorGris[y * ancho + cx]); }

    var cxLocal = cx - x0, cyLocal = cy - y0;
    var li = primerSalto(fila, cxLocal, umbral, -1);
    var ld = primerSalto(fila, cxLocal, umbral, +1);
    var ti = primerSalto(columna, cyLocal, umbral, -1);
    var td = primerSalto(columna, cyLocal, umbral, +1);

    var izqPx = x0 + li, derPx = x0 + ld;
    var arrPx = y0 + ti, abaPx = y0 + td;

    return {
      left: redondear2(100 * izqPx / ancho),
      top: redondear2(100 * arrPx / alto),
      width: redondear2(100 * (derPx - izqPx) / ancho),
      height: redondear2(100 * (abaPx - arrPx) / alto),
    };
  }

  /** Los cuatro puntos marcados → el `caja` que pide la plantilla. */
  function cuadriculaDeCajas(cajas) {
    function agrupar(valores) {
      var orden = Array.from(new Set(valores.map(function (v) { return Math.round(v * 10) / 10; })))
        .sort(function (a, b) { return a - b; });
      var grupos = [];
      orden.forEach(function (v) {
        if (!grupos.length || v - grupos[grupos.length - 1] > 2) { grupos.push(v); }
      });
      return grupos;
    }
    var izqs = agrupar(cajas.map(function (c) { return c.left; }));
    var columnaIzq = Math.min.apply(null, izqs);
    var columnaDer = izqs.length > 1 ? Math.max.apply(null, izqs) : columnaIzq;

    var tops = agrupar(cajas.map(function (c) { return c.top; }));
    var primer = Math.min.apply(null, tops);
    var ultimo = tops.length > 1 ? Math.max.apply(null, tops) : primer;

    var anchoProm = redondear2(cajas.reduce(function (s, c) { return s + c.width; }, 0) / cajas.length);
    var altoProm = redondear2(cajas.reduce(function (s, c) { return s + c.height; }, 0) / cajas.length);

    return { primer: primer, ultimo: ultimo, alto: altoProm, ancho: anchoProm, columna: [columnaIzq, columnaDer] };
  }

  /** El color exacto, en hex, de un punto de la foto. */
  function colorHexEnPunto(xFrac, yFrac) {
    var px = Math.max(0, Math.min(medidorAncho - 1, Math.round(xFrac * medidorAncho)));
    var py = Math.max(0, Math.min(medidorAlto - 1, Math.round(yFrac * medidorAlto)));
    var i = (py * medidorAncho + px) * 4;
    function hex2(v) { return ('0' + v.toString(16)).slice(-2); }
    return '#' + hex2(medidorPixeles[i]) + hex2(medidorPixeles[i + 1]) + hex2(medidorPixeles[i + 2]);
  }

  function pasoActual() { return PASOS_MEDIDOR[medidorPaso]; }

  function iniciarMedidor() {
    if (!medidorImagen) { return; }
    medidorPaso = 0;
    medidorPuntos = [];
    medidorResultado = {};
    medidorArrastrando = null;
    $('medidorPlantilla').hidden = false;
    $('btnIniciarMedidor').hidden = true;
    var lienzo = $('medidorLienzo');
    lienzo.width = medidorAncho;
    lienzo.height = medidorAlto;
    medidorCtx = lienzo.getContext('2d');
    aplicarZoomMedidor();
    pintarPasoMedidor();
    pintarLienzoMedidor();
  }

  function aplicarZoomMedidor() {
    var z = Number($('medidorZoom').value) || 1.6;
    var lienzo = $('medidorLienzo');
    lienzo.style.width = Math.round(medidorAncho * z) + 'px';
    lienzo.style.height = Math.round(medidorAlto * z) + 'px';
  }

  function pintarPasoMedidor() {
    var paso = pasoActual();
    if (!paso) { return; }
    $('medidorTitulo').textContent =
      'Paso ' + (medidorPaso + 1) + ' de ' + PASOS_MEDIDOR.length + ': ' + paso.titulo;
    $('medidorAyuda').textContent = paso.ayuda +
      (paso.tipo === 'puntos4' ? ' (' + medidorPuntos.length + ' de 4 marcados)' : '');
    $('btnMedidorSaltar').hidden = !paso.opcional;
    $('medidorExtra').hidden = paso.tipo !== 'rectanguloFechas';
    $('medidorColorVisto').hidden = paso.tipo !== 'color' || !medidorResultado[paso.clave + '__color'];
    mensaje('', '', 'mensajeMedidor');
  }

  /** Redibuja la foto más las marcas de los pasos ya confirmados. */
  function pintarLienzoMedidor() {
    if (!medidorCtx) { return; }
    medidorCtx.drawImage(medidorImagen, 0, 0, medidorAncho, medidorAlto);
    medidorCtx.lineWidth = Math.max(1, medidorAncho * 0.003);
    // Puntos del paso 'puntos4' ya confirmados.
    medidorCtx.strokeStyle = '#2563eb';
    medidorCtx.fillStyle = '#2563eb';
    medidorPuntos.forEach(function (pt) {
      var px = pt.x * medidorAncho, py = pt.y * medidorAlto;
      medidorCtx.beginPath();
      medidorCtx.arc(px, py, Math.max(3, medidorAncho * 0.01), 0, Math.PI * 2);
      medidorCtx.fill();
    });
    // Rectángulos ya confirmados en pasos anteriores.
    ['qr', 'precio', 'pie', 'fechas'].forEach(function (clave) {
      var r = medidorResultado[clave];
      if (!r) { return; }
      var left = r.left, width = r.width !== undefined ? r.width : (100 - r.left - r.right);
      medidorCtx.strokeStyle = '#16a34a';
      medidorCtx.strokeRect(
        left / 100 * medidorAncho, r.top / 100 * medidorAlto,
        width / 100 * medidorAncho, r.height / 100 * medidorAlto
      );
    });
    // El rectángulo que se está arrastrando ahora mismo.
    if (medidorArrastrando) {
      var a = medidorArrastrando;
      var x = Math.min(a.x0, a.x1) * medidorAncho, y = Math.min(a.y0, a.y1) * medidorAlto;
      var w = Math.abs(a.x1 - a.x0) * medidorAncho, h = Math.abs(a.y1 - a.y0) * medidorAlto;
      medidorCtx.strokeStyle = '#be123c';
      medidorCtx.strokeRect(x, y, w, h);
    }
  }

  /** Coordenadas del evento del mouse/tacto → fracción (0-1) de la foto real. */
  function fraccionDesdeEvento(ev) {
    var lienzo = $('medidorLienzo');
    var caja = lienzo.getBoundingClientRect();
    var x = (ev.clientX - caja.left) / caja.width;
    var y = (ev.clientY - caja.top) / caja.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function avanzarPaso() {
    medidorPaso++;
    medidorPuntos = [];
    medidorArrastrando = null;
    if (medidorPaso >= PASOS_MEDIDOR.length) {
      terminarMedidor();
      return;
    }
    pintarPasoMedidor();
    pintarLienzoMedidor();
  }

  function terminarMedidor() {
    var r = medidorResultado;
    var medidas = {
      fondo: r.fondo, tinta: r.tinta, acento: r.acento, borde: r.borde,
      caja: r.caja, qr: r.qr, precio: r.precio, pie: r.pie,
    };
    if (r.fechas) { medidas.fechas = r.fechas; }
    plantillaJsonCargado = medidas;
    $('medidorPlantilla').hidden = true;
    intentarArmarPlantilla();
  }

  $('medidorLienzo').addEventListener('click', function (ev) {
    var paso = pasoActual();
    if (!paso || paso.tipo !== 'puntos4') { return; }
    var frac = fraccionDesdeEvento(ev);
    var caja = recuadroCercano(frac.x, frac.y);
    medidorPuntos.push({ x: frac.x, y: frac.y, caja: caja });
    pintarPasoMedidor();
    pintarLienzoMedidor();
    if (medidorPuntos.length >= 4) {
      medidorResultado.caja = cuadriculaDeCajas(medidorPuntos.map(function (p) { return p.caja; }));
      avanzarPaso();
    }
  });

  $('medidorLienzo').addEventListener('click', function (ev) {
    var paso = pasoActual();
    if (!paso || paso.tipo !== 'color') { return; }
    var frac = fraccionDesdeEvento(ev);
    var hex = colorHexEnPunto(frac.x, frac.y);
    medidorResultado[paso.clave] = hex;
    medidorResultado[paso.clave + '__color'] = true;
    $('medidorMuestraColor').style.background = hex;
    $('medidorHexColor').textContent = hex;
    pintarPasoMedidor();
    window.setTimeout(avanzarPaso, 450); // deja ver el color tomado antes de seguir
  });

  var medidorPunteroId = null;

  $('medidorLienzo').addEventListener('pointerdown', function (ev) {
    var paso = pasoActual();
    if (!paso || (paso.tipo !== 'rectangulo' && paso.tipo !== 'rectanguloPie' && paso.tipo !== 'rectanguloFechas')) { return; }
    medidorPunteroId = ev.pointerId;
    var frac = fraccionDesdeEvento(ev);
    medidorArrastrando = { x0: frac.x, y0: frac.y, x1: frac.x, y1: frac.y };
    pintarLienzoMedidor();
  });

  $('medidorLienzo').addEventListener('pointermove', function (ev) {
    if (!medidorArrastrando || ev.pointerId !== medidorPunteroId) { return; }
    var frac = fraccionDesdeEvento(ev);
    medidorArrastrando.x1 = frac.x;
    medidorArrastrando.y1 = frac.y;
    pintarLienzoMedidor();
  });

  $('medidorLienzo').addEventListener('pointerup', function (ev) {
    if (!medidorArrastrando || ev.pointerId !== medidorPunteroId) { return; }
    var paso = pasoActual();
    var a = medidorArrastrando;
    var left = Math.min(a.x0, a.x1) * 100, top = Math.min(a.y0, a.y1) * 100;
    var width = Math.abs(a.x1 - a.x0) * 100, height = Math.abs(a.y1 - a.y0) * 100;
    medidorArrastrando = null;
    medidorPunteroId = null;
    if (width < 1 || height < 1) {
      mensaje('Ese rectángulo salió demasiado chico. Arrastra de nuevo, de una esquina a la otra.', 'error', 'mensajeMedidor');
      pintarLienzoMedidor();
      return;
    }
    if (paso.tipo === 'rectangulo') {
      medidorResultado[paso.clave] = {
        left: redondear2(left), top: redondear2(top), width: redondear2(width), height: redondear2(height),
      };
    } else if (paso.tipo === 'rectanguloPie') {
      medidorResultado[paso.clave] = {
        left: redondear2(left), top: redondear2(top), height: redondear2(height),
        right: redondear2(100 - left - width),
      };
    } else if (paso.tipo === 'rectanguloFechas') {
      medidorResultado[paso.clave] = {
        left: redondear2(left), top: redondear2(top), width: redondear2(width), height: redondear2(height),
        vertical: $('medidorVertical').checked,
        fuente: Number($('medidorFuente').value) || 1.5,
      };
    }
    pintarLienzoMedidor();
    avanzarPaso();
  });

  $('btnIniciarMedidor').addEventListener('click', iniciarMedidor);
  $('medidorZoom').addEventListener('input', aplicarZoomMedidor);

  $('btnMedidorSaltar').addEventListener('click', function () {
    if (!pasoActual().opcional) { return; }
    avanzarPaso();
  });

  $('btnMedidorDeshacer').addEventListener('click', function () {
    var paso = pasoActual();
    if (paso.tipo === 'puntos4' && medidorPuntos.length) {
      medidorPuntos.pop();
      pintarPasoMedidor();
      pintarLienzoMedidor();
      return;
    }
    if (medidorPaso > 0) {
      medidorPaso--;
      delete medidorResultado[PASOS_MEDIDOR[medidorPaso].clave];
      medidorPuntos = [];
      medidorArrastrando = null;
      pintarPasoMedidor();
      pintarLienzoMedidor();
    }
  });

  $('btnMedidorCancelar').addEventListener('click', function () {
    $('medidorPlantilla').hidden = true;
    $('btnIniciarMedidor').hidden = !medidorImagen;
  });

  $('dsPlantillaJson').addEventListener('change', function () {
    var archivo = this.files && this.files[0];
    if (!archivo) { return; }
    leerJsonMedidas(archivo)
      .then(function (datos) {
        plantillaJsonCargado = datos;
        intentarArmarPlantilla();
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeDiseno'); });
  });

  $('btnQuitarPlantilla').addEventListener('click', function () {
    disenoEnEdicion.plantilla = null;
    plantillaFotoCargada = null;
    plantillaJsonCargado = null;
    $('dsPlantillaFoto').value = '';
    $('dsPlantillaJson').value = '';
    medidorImagen = null;
    $('btnIniciarMedidor').hidden = true;
    $('medidorPlantilla').hidden = true;
    pintarEstadoPlantilla();
    refrescarVista();
  });

  function pintarEstadoPlantilla() {
    var p = disenoEnEdicion.plantilla;
    $('plantillaEstado').textContent = p
      ? 'Plantilla cargada: foto de ' + p.fotoAncho + '×' + p.fotoAlto + ' px.'
      : 'Todavía no hay ninguna plantilla cargada: el boleto sale con el diseño clásico de siempre.';
    $('btnQuitarPlantilla').hidden = !p;
    $('guardarEnBiblioteca').hidden = !p;
    // La caducidad solo tiene dónde imprimirse cuando hay una foto de fondo:
    // el boleto clásico no trae ese hueco.
    $('campoCaducidad').hidden = !p;
  }

  // -------------------------------------------------------------------------
  // Biblioteca de plantillas guardadas: medir una foto cuesta lo mismo la
  // primera vez que la quinta si no queda guardada en ningún lado más que en
  // la rifa donde se usó. Esto es la lista de donde se elige una ya medida,
  // con nombre propio, en vez de repetir el trabajo.
  // -------------------------------------------------------------------------
  var plantillasGuardadas = [];
  var plantillaRenombrando = null;   // id de la que está en edición de nombre
  var pendienteBorrarPlantilla = null; // { id, temporizador } del doble clic

  function cargarPlantillasGuardadas() {
    $('bibliotecaEstado').textContent = 'Buscando tus plantillas guardadas…';
    return llamar('plantillas', {})
      .then(function (datos) {
        plantillasGuardadas = datos.plantillas || [];
        pintarListaPlantillas();
      })
      .catch(function (e) {
        $('bibliotecaEstado').textContent = 'No se pudo traer la lista: ' + e.message;
        $('listaPlantillas').textContent = '';
      });
  }

  function usarPlantillaGuardada(item) {
    disenoEnEdicion.plantilla = Object.assign({}, item.plantilla);
    // Esta plantilla ya viene completa de la biblioteca: no queda ningún
    // archivo a medio cargar ni ningún medidor a medias esperando el otro.
    plantillaFotoCargada = null;
    plantillaJsonCargado = null;
    medidorImagen = null;
    $('btnIniciarMedidor').hidden = true;
    $('medidorPlantilla').hidden = true;
    $('dsPlantillaFoto').value = '';
    $('dsPlantillaJson').value = '';
    mensaje('Plantilla «' + item.nombre + '» puesta. Revisa la vista previa antes de guardar.', 'ok', 'mensajeDiseno');
    pintarEstadoPlantilla();
    refrescarVista();
  }

  function pintarListaPlantillas() {
    var caja = $('listaPlantillas');
    caja.textContent = '';
    if (!plantillasGuardadas.length) {
      $('bibliotecaEstado').textContent =
        'Todavía no has guardado ninguna plantilla. Mide una foto nueva, abajo, y guárdala para la próxima vez.';
      return;
    }
    $('bibliotecaEstado').textContent = 'Toca «Usar esta» para ponerla en la rifa que estás diseñando.';

    plantillasGuardadas.forEach(function (item) {
      var tarjeta = document.createElement('div');
      tarjeta.className = 'plantilla-guardada';

      var img = document.createElement('img');
      img.src = item.plantilla.foto;
      img.alt = item.nombre;
      img.loading = 'lazy';
      tarjeta.appendChild(img);

      if (plantillaRenombrando === item.id) {
        var campo = document.createElement('input');
        campo.type = 'text';
        campo.maxLength = 60;
        campo.value = item.nombre;
        tarjeta.appendChild(campo);

        var btnGuardarNombre = document.createElement('button');
        btnGuardarNombre.type = 'button';
        btnGuardarNombre.className = 'boton fantasma chico';
        btnGuardarNombre.textContent = 'Guardar nombre';
        btnGuardarNombre.addEventListener('click', function () {
          var nuevo = campo.value.trim();
          if (!nuevo) { return; }
          llamar('renombrar_plantilla', { id: item.id, nombre: nuevo })
            .then(function () { plantillaRenombrando = null; return cargarPlantillasGuardadas(); })
            .catch(function (e) {
              $('bibliotecaEstado').textContent = 'No se pudo renombrar: ' + e.message;
            });
        });
        tarjeta.appendChild(btnGuardarNombre);

        var btnCancelarNombre = document.createElement('button');
        btnCancelarNombre.type = 'button';
        btnCancelarNombre.className = 'boton fantasma chico';
        btnCancelarNombre.textContent = 'Cancelar';
        btnCancelarNombre.addEventListener('click', function () {
          plantillaRenombrando = null;
          pintarListaPlantillas();
        });
        tarjeta.appendChild(btnCancelarNombre);
      } else {
        var nombre = document.createElement('div');
        nombre.className = 'nombre-plantilla';
        nombre.textContent = item.nombre;
        tarjeta.appendChild(nombre);

        var btnUsar = document.createElement('button');
        btnUsar.type = 'button';
        btnUsar.className = 'boton primario chico';
        btnUsar.textContent = 'Usar esta';
        btnUsar.addEventListener('click', function () { usarPlantillaGuardada(item); });
        tarjeta.appendChild(btnUsar);

        var btnRenombrar = document.createElement('button');
        btnRenombrar.type = 'button';
        btnRenombrar.className = 'boton fantasma chico';
        btnRenombrar.textContent = 'Renombrar';
        btnRenombrar.addEventListener('click', function () {
          plantillaRenombrando = item.id;
          pintarListaPlantillas();
        });
        tarjeta.appendChild(btnRenombrar);

        var confirmando = !!pendienteBorrarPlantilla && pendienteBorrarPlantilla.id === item.id;
        var btnBorrar = document.createElement('button');
        btnBorrar.type = 'button';
        btnBorrar.className = 'boton fantasma chico';
        btnBorrar.textContent = confirmando ? '¿Seguro? Toca de nuevo' : 'Borrar';
        btnBorrar.addEventListener('click', function () {
          if (pendienteBorrarPlantilla && pendienteBorrarPlantilla.id === item.id) {
            clearTimeout(pendienteBorrarPlantilla.temporizador);
            pendienteBorrarPlantilla = null;
            llamar('borrar_plantilla', { id: item.id })
              .then(cargarPlantillasGuardadas)
              .catch(function (e) { $('bibliotecaEstado').textContent = 'No se pudo borrar: ' + e.message; });
            return;
          }
          if (pendienteBorrarPlantilla) { clearTimeout(pendienteBorrarPlantilla.temporizador); }
          pendienteBorrarPlantilla = {
            id: item.id,
            // Mismo plazo que el resto de confirmaciones del panel —ocho
            // segundos—: si nadie confirma, vuelve a decir «Borrar» solo.
            temporizador: setTimeout(function () {
              pendienteBorrarPlantilla = null;
              pintarListaPlantillas();
            }, 8000),
          };
          pintarListaPlantillas();
        });
        tarjeta.appendChild(btnBorrar);
      }

      caja.appendChild(tarjeta);
    });
  }

  $('btnGuardarEnBiblioteca').addEventListener('click', function () {
    var nombre = $('nombrePlantillaGuardar').value.trim();
    if (!nombre) {
      mensaje('Ponle un nombre antes de guardarla.', 'error', 'mensajeBiblioteca');
      return;
    }
    if (!disenoEnEdicion.plantilla) { return; }
    mensaje('Guardando…', '', 'mensajeBiblioteca');
    llamar('guardar_plantilla', { nombre: nombre, plantilla: disenoEnEdicion.plantilla })
      .then(function () {
        $('nombrePlantillaGuardar').value = '';
        mensaje('Guardada en tu biblioteca.', 'ok', 'mensajeBiblioteca');
        return cargarPlantillasGuardadas();
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeBiblioteca'); });
  });

  function escribirControles(d) {
    $('dsAviso').value = d.aviso;
    $('dsColumnas').value = String(d.columnas);
    $('dsCaducidad').value = d.caducidad;
    // Un diseño recién leído empieza sin archivos a medio cargar: si ya
    // trae plantilla, está completa de una pieza, no hay nada que esperar.
    plantillaFotoCargada = null;
    plantillaJsonCargado = null;
    $('dsPlantillaFoto').value = '';
    $('dsPlantillaJson').value = '';
    medidorImagen = null;
    $('btnIniciarMedidor').hidden = true;
    $('medidorPlantilla').hidden = true;
    pintarEstadoPlantilla();
  }

  function leerControles() {
    disenoEnEdicion.aviso = $('dsAviso').value;
    disenoEnEdicion.columnas = Number($('dsColumnas').value);
    disenoEnEdicion.caducidad = $('dsCaducidad').value;
    refrescarVista();
  }

  $('dsAviso').addEventListener('input', leerControles);
  $('dsColumnas').addEventListener('change', leerControles);
  $('dsCaducidad').addEventListener('input', leerControles);

  /**
   * La vista previa. Dibuja UN boleto con el mismo código que la hoja de
   * verdad, a su tamaño real en milímetros, y luego lo encoge para que quepa.
   */
  function refrescarVista() {
    var d = disenoCompleto(disenoEnEdicion);
    var r = rifaConocida(rifaActual);
    var nombre = r ? r.nombre : 'Nombre de la rifa';
    var precio = (r && r.precio_boleto !== null && r.precio_boleto !== undefined)
      ? '$' + r.precio_boleto : '';

    // Tantos números como lleve de verdad un boleto de esta rifa.
    var cuantos = (r && r.folios_por_boleto) || 4;
    var muestra = { id: MUESTRA.id, codigo: MUESTRA.codigo, folios: [] };
    for (var i = 0; i < cuantos; i++) {
      muestra.folios.push(MUESTRA.folios[i % MUESTRA.folios.length]);
    }

    // El ancho real que va a tener impreso: hoja carta (216 mm) menos los
    // márgenes de página (10 mm por lado), menos el relleno de la rejilla
    // (6 mm por lado), menos los huecos entre columnas.
    var anchoMm = (184 - 5 * (d.columnas - 1)) / d.columnas;

    var caja = $('vistaBoleto');
    caja.textContent = '';
    var estilo = document.createElement('style');
    // Los colores del boleto quedan encerrados bajo el contenedor: si no,
    // el tema «Noche» le pintaría el fondo a medio panel.
    estilo.textContent = estiloBoleto(d, '#vistaBoleto ');
    var envoltura = document.createElement('div');
    envoltura.className = 'envoltura';
    envoltura.style.width = anchoMm + 'mm';
    envoltura.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    envoltura.innerHTML = boletoHtml(
      { nombre: nombre, serie: (r && r.serie) || 'A', creada_en: (r && r.creada_en) || new Date().toISOString() },
      muestra, baseDelSitio() + '?b=' + muestra.id + '&c=' + muestra.codigo, precio, d);

    caja.appendChild(estilo);
    caja.appendChild(envoltura);
    encogerVista();
    pintarAvisoContraste(d);
  }

  /** Encoge el boleto lo justo para que quepa, sin deformarlo. */
  function encogerVista() {
    var caja = $('vistaBoleto');
    var envoltura = caja.querySelector('.envoltura');
    if (!envoltura) { return; }
    envoltura.style.transform = '';
    var disponible = caja.clientWidth - 20;          // el relleno de la caja
    var real = envoltura.offsetWidth;
    var escala = real > disponible ? disponible / real : 1;
    envoltura.style.transform = 'scale(' + escala + ')';
    caja.style.height = (envoltura.offsetHeight * escala) + 'px';
  }

  window.addEventListener('resize', function () {
    if (!$('paneDiseno').hidden) { encogerVista(); }
  });

  function pintarAvisoContraste(d) {
    var caja = $('avisoContraste');
    var avisos = avisosDeContraste(d);
    caja.hidden = avisos.length === 0;
    if (avisos.length) {
      caja.textContent = 'Ojo antes de imprimir: ' + avisos.join('; ') +
        '. En pantalla se alcanza a ver; en papel, y más en una impresora con poca tinta, no.';
    }
  }

  // --- Guardar -------------------------------------------------------
  $('btnGuardarDiseno').addEventListener('click', function () {
    var d = disenoCompleto(disenoEnEdicion);
    var hayRifa = !!rifaConocida(rifaActual);
    mensaje('Guardando…', '', 'mensajeDiseno');
    llamar('guardar_diseno', { rifa: hayRifa ? rifaActual : null, diseno: d })
      .then(function (datos) {
        if (hayRifa) {
          var r = rifaConocida(rifaActual);
          if (r) { r.diseno = (datos.rifa && datos.rifa.diseno) || d; }
          mensaje('Listo. La próxima hoja de boletos de esta rifa va a salir así.',
                  'ok', 'mensajeDiseno');
        } else {
          disenoPorOmision = d;
          mensaje('Listo. La próxima rifa que crees va a nacer con este diseño.',
                  'ok', 'mensajeDiseno');
        }
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeDiseno'); });
  });

  $('btnGuardarPrecio').addEventListener('click', function () {
    var r = rifaConocida(rifaActual);
    if (!r) { return; }
    var valor = $('dsPrecio').value.trim();
    mensaje('Guardando…', '', 'mensajePrecio');
    llamar('fijar_precio', { precio: valor === '' ? '' : Number(valor) })
      .then(function (datos) {
        r.precio_boleto = datos.rifa.precio_boleto;
        refrescarVista();
        mensaje('Listo. La próxima hoja de esta rifa va a imprimir ese precio.', 'ok', 'mensajePrecio');
        // «Recaudado», en la pestaña Sorteo, se calcula del precio: sin
        // esto se quedaba con el número viejo hasta el siguiente refresco,
        // aunque el precio ya hubiera cambiado de verdad.
        llamar('estado').then(pintar).catch(function () { /* no es urgente */ });
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajePrecio'); });
  });

  $('btnDisenoDeSiempre').addEventListener('click', function () {
    confirmarDiseno('Vuelve al boleto clásico, sin la plantilla cargada. ¿Seguro?');
  });

  var pendienteDiseno = null;
  function confirmarDiseno(texto) {
    if (pendienteDiseno) { clearTimeout(pendienteDiseno); }
    var boton = $('btnDisenoDeSiempre');
    if (boton.dataset.confirmando === '1') {
      boton.dataset.confirmando = '';
      boton.textContent = 'Volver al de siempre';
      mensaje('Guardando…', '', 'mensajeDiseno');
      var hayRifa = !!rifaConocida(rifaActual);
      return llamar('guardar_diseno', { rifa: hayRifa ? rifaActual : null, diseno: null })
        .then(function () {
          var r = rifaConocida(rifaActual);
          if (r) { r.diseno = null; } else { disenoPorOmision = null; }
          disenoEnEdicion = disenoCompleto(null);
          escribirControles(disenoEnEdicion);
          refrescarVista();
          mensaje('Volvió al diseño de siempre.', 'ok', 'mensajeDiseno');
        })
        .catch(function (e) { mensaje(e.message, 'error', 'mensajeDiseno'); });
    }
    boton.dataset.confirmando = '1';
    boton.textContent = 'Confirmar';
    mensaje(texto, '', 'mensajeDiseno');
    pendienteDiseno = setTimeout(function () {
      boton.dataset.confirmando = '';
      boton.textContent = 'Volver al de siempre';
      mensaje('', '', 'mensajeDiseno');
    }, 6000);
  }

  // ------------------------------------------------------------------
  // Pestaña 3: verificar un boleto de papel
  // ------------------------------------------------------------------
  $('btnVerificar').addEventListener('click', verificar);
  $('vfCodigo').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); verificar(); }
  });

  function verificar() {
    var escrito = $('vfFolio').value.trim().replace(/^[A-Za-z]+-/, '');
    var codigo = $('vfCodigo').value.trim().toUpperCase();
    var caja = $('resultadoVerificar');
    caja.hidden = true;
    if (!escrito || !codigo) {
      return mensaje('Faltan el número del boleto y su código.', 'error', 'mensajeVerificar');
    }

    // Un identificador de boleto es largo; un folio es corto. Se manda como lo
    // uno o lo otro, y el servidor llega al mismo papel por los dos caminos.
    // El código va siempre: es lo único que prueba que el papel es original.
    var esBoleto = escrito.length >= 8;
    var peticion = esBoleto
      ? { boleto: escrito, codigo: codigo, rifa: rifaActual }
      : { folio: escrito, codigo: codigo, rifa: rifaActual };

    mensaje('Comprobando…', '', 'mensajeVerificar');
    llamar('verificar', peticion)
      .then(function (datos) {
        mensaje('', '', 'mensajeVerificar');
        caja.hidden = false;
        caja.textContent = '';
        caja.className = 'veredicto-boleto ' + (datos.valido ? 'valido' : 'falso');

        var titulo = document.createElement('strong');
        titulo.textContent = datos.valido ? 'Boleto original' : 'No coincide';
        caja.appendChild(titulo);

        var detalle = document.createElement('p');
        detalle.className = 'nota';
        if (!datos.valido) {
          detalle.textContent = 'Ese número y ese código no van juntos en ninguna rifa. ' +
            'O está mal tecleado, o el boleto no salió de aquí.';
        } else {
          var serie = datos.rifa.serie + '-';
          var numeros = (datos.folios || []).map(function (f) {
            // Se marca cuál de los números ganó: con cuatro por boleto,
            // buscarlo a ojo es justo donde se cuelan los errores.
            return serie + f + (f === datos.folio_ganador ? ' ←' : '');
          }).join('  ');
          detalle.textContent = 'Boleto ' + datos.boleto + ' · código ' + datos.codigo +
            ' · ' + numeros + ' · ' + datos.rifa.nombre + ' · ' + fecha(datos.rifa.fecha_sorteo) +
            (datos.ganador ? ' · ES EL BOLETO GANADOR'
                           : (datos.rifa.folio_ganador ? ' · no fue el ganador' : ' · sorteo pendiente'));
        }
        caja.appendChild(detalle);
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeVerificar'); });
  }

  // ------------------------------------------------------------------
  // Pestaña 4: perfil — cambiar la clave del panel
  // ------------------------------------------------------------------
  $('btnCambiarClave').addEventListener('click', cambiarClave);
  $('clRepetir').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); cambiarClave(); }
  });

  function cambiarClave() {
    // Se recorta igual que al entrar. No es cosmético: si aquí se guardara una
    // clave con un espacio al final y la entrada lo quitara, quedaría una
    // clave imposible de teclear y nadie podría volver a abrir el panel.
    var actual = $('clActual').value.trim();
    var nueva = $('clNueva').value.trim();
    var repetir = $('clRepetir').value.trim();

    if (!actual || !nueva || !repetir) {
      return mensaje('Llena los tres campos.', 'error', 'mensajePerfil');
    }
    if (nueva.length < 8) {
      return mensaje('La clave nueva necesita ocho caracteres o más.', 'error', 'mensajePerfil');
    }
    if (nueva !== repetir) {
      return mensaje('Las dos claves nuevas no son iguales.', 'error', 'mensajePerfil');
    }
    if (nueva === actual) {
      return mensaje('La clave nueva es la misma de antes.', 'error', 'mensajePerfil');
    }

    mensaje('Cambiando…', '', 'mensajePerfil');
    // La clave actual va TECLEADA, no la que esta pantalla trae guardada: así
    // quien encuentre el panel abierto y sin dueño no puede dejar al dueño
    // fuera. El servidor la comprueba como comprueba cualquier otra acción.
    llamar('cambiar_clave', { clave: actual, nueva: nueva })
      .then(function () {
        // Esta pantalla sigue trabajando con la nueva; si no, la siguiente
        // consulta contestaría «clave incorrecta» sin que nada esté mal.
        clave = nueva;
        $('clActual').value = '';
        $('clNueva').value = '';
        $('clRepetir').value = '';
        mensaje('Listo: la clave quedó cambiada. Guárdala donde no se pierda, ' +
                'porque de ella no queda copia que se pueda leer.', 'ok', 'mensajePerfil');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajePerfil'); });
  }

  // ------------------------------------------------------------------
  // Entrada
  // ------------------------------------------------------------------
  casillaDeVer('verClave', ['clave']);
  casillaDeVer('verClaves', ['clActual', 'clNueva', 'clRepetir']);

  function entrar() {
    clave = $('clave').value.trim();
    if (!clave) { mensaje('Escribe la clave.', 'error', 'mensajeClave'); return; }
    mensaje('Comprobando…', '', 'mensajeClave');

    // Primero el historial: de ahí sale cuál rifa está marcada como activa, y
    // así el panel no depende de ningún identificador escrito en el código.
    llamar('rifas')
      .then(function (datos) {
        var lista = datos.rifas || [];
        // El historial ya viene aquí: se guarda de una vez. Si no, entrar y
        // pulsar «Diseño» sin pasar por «Rifas» encontraba la lista vacía y el
        // panel juraba que no había ninguna rifa.
        rifasConocidas = lista;
        disenoPorOmision = datos.diseno_nuevo || null;
        var activa = lista.filter(function (r) { return r.activa; })[0] || lista[0];

        $('vistaClave').hidden = true;
        $('cuerpo').hidden = false;
        $('pestanas').hidden = false;

        // Base recién estrenada, o borrada para empezar de nuevo: no hay nada
        // que manejar todavía. Se entra igual, directo a crear la primera.
        if (!activa) {
          rifaActual = null;
          ultimoEstado = null;
          $('tituloRifa').textContent = 'Todavía no hay ninguna rifa';
          $('subtitulo').textContent = 'Crea la primera aquí abajo.';
          abrirPestana('paneRifas');
          $('cajaNueva').open = true;
          return null;
        }

        rifaActual = activa.id;
        return llamar('estado').then(function (estado) {
          abrirPestana('paneSorteo');
          pintar(estado);
        });
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

  // Refresco de cortesía por si alguien más movió el estado.
  setInterval(function () {
    if (!clave || !rifaActual || !ultimoEstado || $('paneSorteo').hidden) { return; }
    llamar('estado').then(pintar).catch(function () { /* el siguiente intento reintenta */ });
  }, 10000);

  // ------------------------------------------------------------------
  // Conmutador de tema: claro u oscuro a mano
  // ------------------------------------------------------------------
  // El script en el <head> ya aplicó lo guardado antes del primer pintado;
  // esto solo conecta el botón para cambiarlo y acordarse. Mismo código que
  // en el boleto: una sola cosa que hacer, no valía la pena un archivo aparte.
  (function () {
    var boton = $('btnTema');
    if (!boton) { return; }
    var raiz = document.documentElement;
    var ICONOS = { light: '🌙', dark: '☀️' };
    var ETIQUETAS = { light: 'Cambiar a tema oscuro', dark: 'Cambiar a tema claro' };

    function temaActual() {
      return raiz.dataset.theme ||
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    function pintarBoton() {
      var t = temaActual();
      boton.firstElementChild.textContent = ICONOS[t];
      boton.setAttribute('aria-label', ETIQUETAS[t]);
      boton.setAttribute('aria-pressed', String(t === 'dark'));
    }
    boton.addEventListener('click', function () {
      var nuevo = temaActual() === 'dark' ? 'light' : 'dark';
      raiz.dataset.theme = nuevo;
      try { localStorage.setItem('tema', nuevo); } catch (e) { /* modo privado */ }
      pintarBoton();
    });
    pintarBoton();
  })();
})();
