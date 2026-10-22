/**
 * Panel de sorteo. No habla con la base de datos: todo pasa por la función
 * de borde `sorteo`, que es la única que puede escribir, y que exige la clave
 * del panel en cada llamada.
 *
 * La clave no se guarda en el navegador: si recargas, se vuelve a pedir.
 *
 * Tres pestañas:
 *   Sorteo     — poner en vivo, revelar, cerrar la rifa que se esté manejando.
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

  /**
   * Quién es este aparato. Sirve para una cosa sola: que si la transmisión ya
   * se prendió desde el celular, la computadora lo vea y no la prenda otra vez
   * por su cuenta. No identifica a nadie ni sale de aquí más que como etiqueta.
   */
  var APARATO = (function () {
    var guardado = null;
    try { guardado = sessionStorage.getItem('aparato'); } catch (e) { /* modo privado */ }
    if (guardado) { return guardado; }
    var movil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var valor = (movil ? 'el celular' : 'la computadora') + '|' +
                Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('aparato', valor); } catch (e) { /* da igual */ }
    return valor;
  })();

  function etiquetaDe(marca) {
    var corte = String(marca || '').lastIndexOf('|');
    return corte > 0 ? marca.slice(0, corte) : '';
  }
  function idDe(marca) {
    var corte = String(marca || '').lastIndexOf('|');
    return corte > 0 ? marca.slice(corte + 1) : '';
  }

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
  var PANES = ['paneSorteo', 'paneRifas', 'paneVendedores', 'paneVerificar', 'paneDiseno', 'panePerfil'];

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
    if (id === 'paneVendedores') { cargarVendedores(); }
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

    // El enlace solo se reescribe cuando no lo estás editando, para no
    // borrarte a media escritura lo que acabas de pegar.
    if (document.activeElement !== $('transmisionUrl')) {
      $('transmisionUrl').value = datos.rifa.transmision_url || '';
      avisarIncrustar();
    }
    pintarCandado(datos.rifa);

    var revelada = !!datos.rifa.folio_ganador;
    $('btnEnVivo').disabled = revelada || datos.rifa.estado === 'en_vivo';
    $('btnEspera').disabled = revelada || datos.rifa.estado === 'espera';
    $('btnRevelarAzar').disabled = revelada;
    $('folioGanador').disabled = revelada;
    $('btnCerrar').disabled = datos.rifa.estado === 'cerrado';
    if (revelada) { pintarCotejo('nada'); }
    mandarBotones();

    if (revelada) {
      mensaje('Folio ganador: ' + datos.rifa.folio_ganador + ' — registrado y bloqueado.', 'ok');
    }
  }

  /** De dónde está saliendo la transmisión, si es que ya salió de algún lado. */
  function pintarCandado(rifa) {
    var marca = rifa.transmite_desde || '';
    var ajeno = marca && idDe(marca) !== idDe(APARATO);
    var aviso = $('candadoTransmision');

    if (!marca || rifa.estado !== 'en_vivo') {
      aviso.hidden = true;
      $('btnTomarControl').hidden = true;
      return;
    }

    aviso.hidden = false;
    aviso.textContent = ajeno
      ? 'Transmitiendo desde ' + etiquetaDe(marca) + '.'
      : 'Estás transmitiendo desde este aparato.';
    // Si el celular que transmitía se quedó sin batería, alguien tiene que
    // poder retomar desde otro lado sin regresar la rifa a espera.
    $('btnTomarControl').hidden = !ajeno || !!rifa.folio_ganador;
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
        } else if (nombre === 'en_vivo') {
          mensaje(datos.rifa.transmision_url
            ? 'En vivo. Las pantallas ya cambiaron y traen el botón a tu transmisión.'
            : 'En vivo. Las pantallas ya cambiaron. (Sin enlace de transmisión: no aparece el botón.)', 'ok');
        } else {
          mensaje('Listo.', 'ok');
        }
      })
      .catch(function (e) {
        mensaje(e.message, 'error');
        // El servidor puede saber algo que aquí no se sabía —por ejemplo, que
        // ya hay otro aparato transmitiendo—, así que se vuelve a preguntar
        // para que la pantalla enseñe de qué está hablando.
        llamar('estado').then(pintar).catch(function () { /* ya se avisó */ });
      });
  }

  $('btnEnVivo').addEventListener('click', function () { transmitir(false); });

  $('btnTomarControl').addEventListener('click', function () {
    if (!confirmar('Vas a tomar el control de la transmisión desde este aparato.')) { return; }
    transmitir(true);
  });

  /**
   * Prender la transmisión. Manda el enlace escrito en el momento, para que
   * no haga falta acordarse de guardarlo antes.
   */
  function transmitir(forzar) {
    var enlace = $('transmisionUrl').value.trim();
    if (enlace && !normalizarYouTube(enlace)) {
      mensaje('Ese enlace no es de YouTube. Revísalo antes de salir al aire.', 'error');
      return;
    }
    accion('en_vivo', { dispositivo: APARATO, transmision: enlace, forzar: !!forzar });
  }

  /**
   * Avisa, mientras se escribe, si ese enlace se va a poder ver DENTRO de la
   * página o solo abriendo YouTube. No son equivalentes y conviene saberlo
   * antes del sorteo, no durante.
   */
  function avisarIncrustar() {
    var caja = $('avisoIncrustar');
    var valor = $('transmisionUrl').value.trim();
    if (!valor) {
      caja.hidden = false;
      caja.className = 'nota aviso-incrustar';
      caja.textContent = 'Sin enlace, la pantalla del boleto no muestra nada de transmisión.';
      return;
    }
    if (!normalizarYouTube(valor)) {
      caja.hidden = false;
      caja.className = 'mensaje error aviso-incrustar';
      caja.textContent = 'Eso no es un enlace de YouTube.';
      return;
    }
    caja.hidden = false;
    if (incrustarYouTube(valor)) {
      caja.className = 'nota aviso-incrustar bien';
      caja.textContent = 'Con este enlace la transmisión se ve dentro de la página, ' +
        'sin salir del boleto. Revisa que el directo tenga permitido incrustarse.';
    } else {
      caja.className = 'nota aviso-incrustar';
      caja.textContent = 'Este enlace es permanente —siempre apunta al directo que esté ' +
        'al aire— pero no se puede incrustar: la gente saldrá a YouTube. Si quieres que ' +
        'se vea dentro de la página, pega el enlace del directo en sí.';
    }
  }

  $('transmisionUrl').addEventListener('input', avisarIncrustar);

  $('btnGuardarTransmision').addEventListener('click', function () {
    var enlace = $('transmisionUrl').value.trim();
    if (enlace && !normalizarYouTube(enlace)) {
      mensaje('Eso no es un enlace de YouTube.', 'error');
      return;
    }
    mensaje(enlace ? 'Guardando…' : 'Quitando el enlace…');
    llamar('transmision', { transmision: enlace })
      .then(function (datos) {
        pintar(datos);
        mensaje(datos.rifa.transmision_url
          ? 'Enlace guardado: ' + datos.rifa.transmision_url
          : 'Enlace quitado. Las pantallas no mostrarán el botón.', 'ok');
      })
      .catch(function (e) { mensaje(e.message, 'error'); });
  });
  $('btnEspera').addEventListener('click', function () { accion('espera'); });
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

      var papelitos = document.createElement('button');
      papelitos.className = 'boton';
      papelitos.textContent = 'Papelitos de tómbola';
      papelitos.addEventListener('click', function () {
        pedirHoja(r.id, papelitos, abrirPapelitos);
      });
      acciones.appendChild(papelitos);

      // Con ganador revelado, el botón ni aparece: el servidor también lo
      // rechaza, pero no tiene caso enseñar una puerta que va a dar a un
      // error. Ese registro ya no se toca.
      if (!r.folio_ganador) {
        var eliminar = document.createElement('button');
        eliminar.className = 'boton fantasma chico';
        eliminar.textContent = 'Eliminar';
        eliminar.addEventListener('click', function () { abrirEliminar(r); });
        acciones.appendChild(eliminar);
      }

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
  // Eliminar una rifa: irreversible, con confirmación tecleada
  // ------------------------------------------------------------------
  // El botón rojo nace apagado: solo se enciende cuando lo que se tecleó
  // calza letra por letra con el nombre de la rifa. Eso es la segunda
  // confirmación, no el clic en sí — un clic de más no basta para borrar
  // nada por accidente.
  var rifaEnBorrado = null;

  function abrirEliminar(r) {
    rifaEnBorrado = r;
    $('nombreAEliminar').textContent = r.nombre;
    $('avisoActivaEliminar').hidden = r.id !== rifaActual;
    $('confirmarNombreEliminar').value = '';
    $('btnConfirmarEliminar').disabled = true;
    mensaje('', '', 'mensajeEliminar');
    $('modalEliminar').hidden = false;
    $('confirmarNombreEliminar').focus();
  }

  function cerrarEliminar() {
    $('modalEliminar').hidden = true;
    rifaEnBorrado = null;
  }

  $('confirmarNombreEliminar').addEventListener('input', function () {
    $('btnConfirmarEliminar').disabled = !rifaEnBorrado ||
      $('confirmarNombreEliminar').value !== rifaEnBorrado.nombre;
  });

  $('btnCancelarEliminar').addEventListener('click', cerrarEliminar);

  // Tocar el fondo oscurecido cancela, igual que Escape; tocar el cuadro
  // mismo no, para que un clic dentro del cuadro no lo cierre por error.
  $('modalEliminar').addEventListener('click', function (ev) {
    if (ev.target === $('modalEliminar')) { cerrarEliminar(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('modalEliminar').hidden) { cerrarEliminar(); }
  });

  $('btnConfirmarEliminar').addEventListener('click', function () {
    if (!rifaEnBorrado) { return; }
    var r = rifaEnBorrado;
    $('btnConfirmarEliminar').disabled = true;
    mensaje('Eliminando…', '', 'mensajeEliminar');
    llamar('eliminar_rifa', { rifa: r.id, confirmar_nombre: $('confirmarNombreEliminar').value })
      .then(function (datos) {
        cerrarEliminar();
        // Era la que el panel manejaba: no se adivina otra en su lugar, se
        // deja dicho que no hay ninguna, igual que con la base vacía.
        if (datos.era_activa) {
          rifaActual = null;
          ultimoEstado = null;
          $('tituloRifa').textContent = 'Todavía no hay ninguna rifa';
          $('subtitulo').textContent = 'Crea una o maneja otra desde aquí abajo.';
        }
        return cargarRifas('«' + r.nombre + '» se eliminó para siempre.');
      })
      .catch(function (e) {
        $('btnConfirmarEliminar').disabled = false;
        mensaje(e.message, 'error', 'mensajeEliminar');
      });
  });

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

  function resumenNueva() {
    var cantidad = parseInt($('nvCantidad').value, 10);
    var digitos = parseInt($('nvDigitos').value, 10) || 5;
    var porBoleto = foliosPorBoleto();
    var tope = Math.floor((Math.pow(10, digitos) - Math.pow(10, digitos - 1)) * 0.3);
    // Lo que tiene que caber en los dígitos son los NÚMEROS, no los boletos:
    // con 4 por boleto, 500 boletos son 2000 folios.
    var topeBoletos = Math.floor(tope / porBoleto);
    var caja = $('cuentaNueva');

    if (!(cantidad > 0)) {
      caja.textContent = 'Con ' + digitos + ' dígitos y ' + porBoleto +
        ' números por boleto caben hasta ' + topeBoletos.toLocaleString('es-MX') + ' boletos.';
      caja.className = 'nota';
      return;
    }
    var totalFolios = cantidad * porBoleto;
    if (totalFolios > tope) {
      caja.textContent = cantidad.toLocaleString('es-MX') + ' boletos de ' + porBoleto +
        ' números son ' + totalFolios.toLocaleString('es-MX') + ' folios, y no caben en ' +
        digitos + ' dígitos (el tope es ' + tope.toLocaleString('es-MX') +
        '). Sube los dígitos del folio o baja los números por boleto.';
      caja.className = 'mensaje error';
      return;
    }
    var precio = parseFloat($('nvPrecio').value);
    var texto = 'Se van a generar ' + cantidad.toLocaleString('es-MX') +
      ' boletos con ' + porBoleto + ' números cada uno: ' +
      totalFolios.toLocaleString('es-MX') + ' folios de ' + digitos + ' dígitos';
    if (precio > 0) {
      texto += ', que a $' + precio + ' suman $' +
        (precio * cantidad).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    }
    caja.textContent = texto + '.';
    caja.className = 'nota';
  }

  ['nvCantidad', 'nvDigitos', 'nvPrecio', 'nvFoliosPorBoleto'].forEach(function (id) {
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

    var fechaEmisionLocal = $('nvFechaEmision').value;
    llamar('crear_rifa', {
      nombre: nombre,
      serie: serie || 'A',
      // `datetime-local` no trae zona: se le pega la del evento para que la
      // hora escrita sea la hora del lugar, no la del navegador.
      fecha_sorteo: conZona(fechaLocal),
      cantidad: cantidad,
      digitos: digitos,
      folios_por_boleto: porBoleto,
      precio: precio === '' ? null : Number(precio),
      // Mediodía y no medianoche: a medianoche, en una zona con desfase
      // negativo, convertir a UTC puede caer en el día anterior y el boleto
      // sale con la fecha equivocada.
      fecha_emision: fechaEmisionLocal ? conZona(fechaEmisionLocal + 'T12:00') : '',
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

  /** Deja el formulario listo para la siguiente, sin arrastrar lo anterior. */
  function limpiarFormularioNueva() {
    ['nvNombre', 'nvSerie', 'nvFecha', 'nvFechaEmision', 'nvCantidad', 'nvPrecio'].forEach(function (id) {
      $(id).value = '';
    });
    $('nvDigitos').value = '5';
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
  // Pestaña: vendedores
  // ------------------------------------------------------------------
  var vendedoresConocidos = [];    // el catálogo activo, con cuántos boletos tiene cada uno aquí
  var asignacionesConocidas = [];  // el reparto completo de la rifa que se está manejando

  function cargarVendedores() {
    if (!rifaActual) {
      $('vendedoresDeQuien').textContent =
        'Todavía no hay ninguna rifa que manejar. Crea una en la pestaña «Rifas».';
      $('listaVendedores').textContent = '';
      $('resumenAsignacion').textContent = '';
      vendedoresConocidos = [];
      pintarSelectorVendedores();
      return;
    }
    var r = rifaConocida(rifaActual);
    $('vendedoresDeQuien').textContent = r
      ? 'Repartiendo los boletos de «' + r.nombre + '», serie ' + r.serie + '.' : '';
    mensaje('Cargando…', '', 'mensajeVendedores');
    return Promise.all([llamar('vendedores'), llamar('asignaciones')])
      .then(function (resultados) {
        vendedoresConocidos = resultados[0].vendedores || [];
        asignacionesConocidas = resultados[1].asignaciones || [];
        pintarSelectorVendedores();
        pintarVendedores();
        mensaje('', '', 'mensajeVendedores');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeVendedores'); });
  }

  function pintarSelectorVendedores() {
    var sel = $('vdSelector');
    var elegido = sel.value;
    sel.textContent = '';
    if (!vendedoresConocidos.length) {
      var vacia = document.createElement('option');
      vacia.textContent = 'Agrega un vendedor primero';
      vacia.value = '';
      sel.appendChild(vacia);
      return;
    }
    vendedoresConocidos.forEach(function (v) {
      var opcion = document.createElement('option');
      opcion.value = v.id;
      opcion.textContent = v.nombre + (v.asignados ? ' (' + v.asignados + ')' : '');
      sel.appendChild(opcion);
    });
    if (elegido) { sel.value = elegido; }
  }

  /** «3, 4, 5, 8» se lee mejor como «Nº 3–5, Nº 8». */
  function rangosDeTexto(numeros) {
    var trozos = [];
    var inicio = numeros[0];
    var previo = numeros[0];
    for (var i = 1; i <= numeros.length; i++) {
      var actual = numeros[i];
      if (actual === previo + 1) { previo = actual; continue; }
      trozos.push(inicio === previo ? ('Nº ' + inicio) : ('Nº ' + inicio + '–' + previo));
      inicio = actual;
      previo = actual;
    }
    return trozos.join(', ');
  }

  function pintarVendedores() {
    var caja = $('listaVendedores');
    caja.textContent = '';

    var totalBoletos = (rifaConocida(rifaActual) || {}).boletos || 0;
    var sinAsignar = Math.max(0, totalBoletos - asignacionesConocidas.length);
    $('resumenAsignacion').textContent = totalBoletos
      ? asignacionesConocidas.length + ' de ' + totalBoletos + ' boletos ya tienen vendedor; ' +
        sinAsignar + ' sin asignar.'
      : '';

    if (!vendedoresConocidos.length) {
      caja.textContent = 'Todavía no hay ningún vendedor. Agrega el primero arriba.';
      return;
    }

    // Agrupar el reparto por vendedor, para enseñar sus números juntos.
    var porVendedor = {};
    asignacionesConocidas.forEach(function (a) {
      (porVendedor[a.vendedor] = porVendedor[a.vendedor] || []).push(a.numero);
    });

    vendedoresConocidos.forEach(function (v) {
      var numeros = (porVendedor[v.id] || []).slice().sort(function (a, b) { return a - b; });

      var fila = document.createElement('article');
      fila.className = 'vendedor';

      var cabeza = document.createElement('div');
      cabeza.className = 'vendedor-cabeza';
      var nombre = document.createElement('strong');
      nombre.textContent = v.nombre;
      cabeza.appendChild(nombre);
      var cuenta = document.createElement('span');
      cuenta.className = 'marca-estado';
      cuenta.textContent = numeros.length + ' boleto' + (numeros.length === 1 ? '' : 's');
      cabeza.appendChild(cuenta);
      fila.appendChild(cabeza);

      if (v.nota) {
        var nota = document.createElement('p');
        nota.className = 'nota';
        nota.textContent = v.nota;
        fila.appendChild(nota);
      }

      var rango = document.createElement('p');
      rango.className = 'nota';
      rango.textContent = numeros.length ? rangosDeTexto(numeros) : 'Sin boletos asignados todavía.';
      fila.appendChild(rango);

      var acciones = document.createElement('div');
      acciones.className = 'vendedor-acciones';

      if (numeros.length) {
        var quitar = document.createElement('button');
        quitar.className = 'boton fantasma chico';
        quitar.textContent = 'Quitarle todos los boletos';
        quitar.addEventListener('click', function () {
          if (!confirmarVendedor('quitarle ' + numeros.length + ' boletos a «' + v.nombre + '».')) { return; }
          llamar('quitar_asignacion', { numeros: numeros })
            .then(function () { return cargarVendedores(); })
            .catch(function (e) { mensaje(e.message, 'error', 'mensajeVendedores'); });
        });
        acciones.appendChild(quitar);
      }

      var archivar = document.createElement('button');
      archivar.className = 'boton fantasma chico';
      archivar.textContent = 'Archivar';
      archivar.addEventListener('click', function () {
        if (!confirmarVendedor('archivar a «' + v.nombre + '». Sus boletos ya asignados no se tocan.')) { return; }
        llamar('archivar_vendedor', { vendedor: v.id })
          .then(function () { return cargarVendedores(); })
          .catch(function (e) { mensaje(e.message, 'error', 'mensajeVendedores'); });
      });
      acciones.appendChild(archivar);

      fila.appendChild(acciones);
      caja.appendChild(fila);
    });
  }

  var pendienteVendedor = null;
  function confirmarVendedor(texto) {
    if (pendienteVendedor === texto) { pendienteVendedor = null; return true; }
    pendienteVendedor = texto;
    mensaje('Vas a ' + texto + ' Toca otra vez para confirmar.', 'error', 'mensajeVendedores');
    setTimeout(function () { if (pendienteVendedor === texto) { pendienteVendedor = null; } }, 8000);
    return false;
  }

  $('btnCrearVendedor').addEventListener('click', function () {
    var nombre = $('vdNombre').value.trim();
    var nota = $('vdNota').value.trim();
    if (!nombre) { return mensaje('Ponle nombre al vendedor.', 'error', 'mensajeVendedorNuevo'); }
    mensaje('Guardando…', '', 'mensajeVendedorNuevo');
    llamar('crear_vendedor', { nombre: nombre, nota: nota })
      .then(function () {
        $('vdNombre').value = '';
        $('vdNota').value = '';
        $('cajaNuevoVendedor').open = false;
        mensaje('', '', 'mensajeVendedorNuevo');
        return cargarVendedores();
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeVendedorNuevo'); });
  });

  $('btnAsignar').addEventListener('click', function () {
    var vendedorId = $('vdSelector').value;
    if (!vendedorId) { return mensaje('Elige a quién se le asigna.', 'error', 'mensajeAsignar'); }

    var desde = parseInt($('vdDesde').value, 10);
    var hasta = parseInt($('vdHasta').value, 10);
    var sueltos = $('vdSueltos').value.split(',')
      .map(function (t) { return parseInt(t.trim(), 10); })
      .filter(function (n) { return n > 0; });

    var extra = { vendedor: vendedorId };
    if (desde > 0 && hasta > 0) { extra.desde = desde; extra.hasta = hasta; }
    if (sueltos.length) { extra.numeros = sueltos; }
    if (!extra.desde && !extra.numeros) {
      return mensaje('Escribe un lote (del/al) o números sueltos.', 'error', 'mensajeAsignar');
    }

    mensaje('Asignando…', '', 'mensajeAsignar');
    llamar('asignar', extra)
      .then(function (datos) {
        var texto = 'Asignados: ' + datos.asignados + '.';
        if (datos.faltantes && datos.faltantes.length) {
          texto += ' No existen en esta rifa: ' + datos.faltantes.join(', ') + '.';
        }
        if (datos.reasignados && datos.reasignados.length) {
          texto += ' Se los quitaron a quien los tenía: ' + datos.reasignados.map(function (x) {
            return 'Nº ' + x.numero + ' (era de ' + (x.de || '—') + ')';
          }).join(', ') + '.';
        }
        mensaje(texto, 'ok', 'mensajeAsignar');
        $('vdDesde').value = '';
        $('vdHasta').value = '';
        $('vdSueltos').value = '';
        return cargarVendedores();
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeAsignar'); });
  });

  // ------------------------------------------------------------------
  // Hoja de boletos para imprimir
  // ------------------------------------------------------------------
  /**
   * Trae los boletos de una rifa y arma con ellos la hoja que se pida.
   *
   * La hoja de boletos y los papelitos de la tómbola salen de ESTA consulta,
   * la misma para las dos. Es lo que hace imposible que un papelito traiga un
   * número que no esté impreso en ningún boleto.
   */
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

  /** El QR, dibujado aquí mismo: la hoja se imprime aunque no haya red. */
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
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + lado + ' ' + lado +
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

  // Temas pensados para el papel, no para la pantalla. El orden es el que se
  // ve en el panel.
  var TEMAS = {
    clasico: { nombre: 'Clásico', fondo: '#ffffff', tinta: '#111111', acento: '#c2185b', borde: '#333333' },
    sobrio:  { nombre: 'Sobrio',  fondo: '#ffffff', tinta: '#000000', acento: '#000000', borde: '#000000' },
    feria:   { nombre: 'Feria',   fondo: '#fff8ec', tinta: '#3b2a1a', acento: '#c62828', borde: '#8d6e39' },
    menta:   { nombre: 'Menta',   fondo: '#f2fbf6', tinta: '#12301f', acento: '#00796b', borde: '#4f8f74' },
    oro:     { nombre: 'Oro',     fondo: '#fdf6e3', tinta: '#2a2113', acento: '#9a6f0a', borde: '#b08d3a' },
    noche:   { nombre: 'Noche',   fondo: '#1b2432', tinta: '#f2f5f9', acento: '#ffd166', borde: '#5b6b82' },
    // Los cuatro colores sacados con cuentagotas del boleto que trajo el
    // dueño, no elegidos a gusto: el papel verde pálido, el verde medio de
    // los textos, el verde oscuro de las cifras y el verde vivo del marco.
    trebol:  { nombre: 'Trébol',  fondo: '#e4e9e3', tinta: '#2a5a30', acento: '#1b4d1b', borde: '#2e7d32' },
  };

  /*
   * Fondos del boleto. Hay de dos clases y se manejan igual:
   *
   *   - de línea: rayas, puntos, rejilla. Se dibujan con degradados de CSS y
   *     toman el color del marco, rebajado. Son el papel de seguridad sobrio.
   *   - de figura: estrellas, confeti, tréboles. Son un SVG diminuto que se
   *     repite, con su propia paleta de colores de fiesta. Es lo que hace que
   *     un boleto de rifa se vea de rifa y no de recibo.
   *
   * Lo que se guarda en la base es el NOMBRE, nunca el dibujo. El panel lo
   * arma a partir de él, así que no hay forma de colar nada dentro del estilo
   * del boleto. Y el SVG va por `encodeURIComponent`, que se lleva los `<`,
   * los `>` y las comillas: lo que queda no puede escaparse de la hoja de
   * estilos aunque se quisiera.
   */

  // Pastel, como los boletos que se venden en la calle. No sale del tema
  // porque la gracia de las figuras es justo que sean de varios colores.
  var COLORES_FIESTA = ['#ef9ebc', '#8fcbe4', '#9ed8ae', '#c3aade', '#f6d08a'];

  var ESTRELLA = '<path d="M0,-10 L2.35,-3.24 L9.51,-3.09 L3.8,1.24 L5.88,8.09 ' +
    'L0,4 L-5.88,8.09 L-3.8,1.24 L-9.51,-3.09 L-2.35,-3.24 Z"/>';
  var CORAZON = '<path d="M0,7 C-9,-1 -7,-11 0,-5 C7,-11 9,-1 0,7 Z"/>';
  var TREBOL = '<g><circle cx="-3.5" cy="-1" r="3.6"/><circle cx="3.5" cy="-1" r="3.6"/>' +
    '<circle cx="0" cy="-5" r="3.6"/><circle cx="0" cy="3" r="3.6"/>' +
    '<rect x="-0.7" y="2" width="1.4" height="7" rx="0.7"/></g>';
  var CONFETI = '<rect x="-5" y="-1.6" width="10" height="3.2" rx="1.6"/>';
  var BURBUJA = '<circle cx="0" cy="0" r="6"/>';

  /**
   * Reparte una figura por el mosaico que se va a repetir.
   *
   * Las posiciones son fijas, NO al azar. Un lote de doscientos boletos tiene
   * que salir igual que la vista previa y que la reimpresión de mañana; un
   * fondo distinto cada vez sería un fondo que nadie eligió.
   */
  var SEMBRADO = [
    [18, 20, 0, 1], [62, 14, 25, 0.75], [88, 42, -15, 0.9],
    [40, 54, 12, 1.1], [12, 78, -20, 0.8], [72, 80, 8, 0.95],
  ];

  function esparcir(figura, escala) {
    return function (alfa) {
      return SEMBRADO.map(function (p, i) {
        return '<g transform="translate(' + p[0] + ',' + p[1] + ') rotate(' + p[2] +
          ') scale(' + (escala * p[3]).toFixed(2) + ')" fill="' +
          COLORES_FIESTA[i % COLORES_FIESTA.length] +
          '" fill-opacity="' + alfa + '">' + figura + '</g>';
      }).join('');
    };
  }

  /** Un mosaico de SVG listo para usarse como fondo repetido. */
  function mosaico(contenido, ladoMm) {
    // Con width y height además del viewBox: así el mosaico trae su propio
    // tamaño y no depende de que quien lo use se lo dé.
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" ' +
      'viewBox="0 0 100 100">' + contenido + '</svg>';
    return 'background-image: url("data:image/svg+xml,' + encodeURIComponent(svg) + '");' +
      ' background-size: ' + ladoMm + 'mm ' + ladoMm + 'mm;';
  }

  var TRAMAS = {
    ninguna: { nombre: 'Ninguna', tipo: 'linea', css: function () { return ''; } },

    // --- De línea -----------------------------------------------------
    lineas: {
      nombre: 'Líneas', tipo: 'linea',
      css: function (c) {
        return 'background-image: repeating-linear-gradient(45deg,' +
               c + ' 0 0.35mm, transparent 0.35mm 2mm);';
      },
    },
    puntos: {
      nombre: 'Puntos', tipo: 'linea',
      css: function (c) {
        return 'background-image: radial-gradient(' + c + ' 0.25mm, transparent 0.26mm);' +
               ' background-size: 2mm 2mm;';
      },
    },
    rejilla: {
      nombre: 'Rejilla', tipo: 'linea',
      css: function (c) {
        return 'background-image: repeating-linear-gradient(0deg,' +
               c + ' 0 0.2mm, transparent 0.2mm 2.5mm),' +
               ' repeating-linear-gradient(90deg,' + c + ' 0 0.2mm, transparent 0.2mm 2.5mm);';
      },
    },
    cruzado: {
      nombre: 'Cruzado', tipo: 'linea',
      css: function (c) {
        return 'background-image: repeating-linear-gradient(45deg,' +
               c + ' 0 0.25mm, transparent 0.25mm 2mm),' +
               ' repeating-linear-gradient(-45deg,' + c + ' 0 0.25mm, transparent 0.25mm 2mm);';
      },
    },
    zigzag: {
      nombre: 'Zigzag', tipo: 'linea',
      css: function (c) {
        return 'background-image: linear-gradient(135deg,' + c + ' 25%, transparent 25%),' +
               ' linear-gradient(225deg,' + c + ' 25%, transparent 25%);' +
               ' background-size: 3mm 3mm;';
      },
    },

    // --- De figura ----------------------------------------------------
    estrellas: {
      nombre: 'Estrellas', tipo: 'figura',
      css: function (c, alfa) { return mosaico(esparcir(ESTRELLA, 1)(alfa), 16); },
    },
    confeti: {
      nombre: 'Confeti', tipo: 'figura',
      css: function (c, alfa) { return mosaico(esparcir(CONFETI, 2)(alfa), 17); },
    },
    burbujas: {
      nombre: 'Burbujas', tipo: 'figura',
      css: function (c, alfa) { return mosaico(esparcir(BURBUJA, 1.3)(alfa), 16); },
    },
    corazones: {
      nombre: 'Corazones', tipo: 'figura',
      css: function (c, alfa) { return mosaico(esparcir(CORAZON, 1.4)(alfa), 17); },
    },
    treboles: {
      nombre: 'Tréboles', tipo: 'figura',
      css: function (c, alfa) { return mosaico(esparcir(TREBOL, 1.3)(alfa), 18); },
    },
    fiesta: {
      nombre: 'Fiesta', tipo: 'figura',
      css: function (c, alfa) {
        // Estrellas y confeti revueltos, que es como se ven los boletos de
        // feria de verdad: no un patrón, un puñado de cosas tiradas.
        return mosaico(esparcir(ESTRELLA, 1.1)(alfa) +
          '<g transform="translate(50,88) rotate(-12) scale(1.7)" fill="' +
          COLORES_FIESTA[1] + '" fill-opacity="' + alfa + '">' + CONFETI + '</g>' +
          '<g transform="translate(90,10) rotate(30) scale(1.6)" fill="' +
          COLORES_FIESTA[4] + '" fill-opacity="' + alfa + '">' + CONFETI + '</g>', 20);
      },
    },
  };

  /*
   * Qué tan marcado va el fondo. Las dos clases piden números muy distintos:
   * una raya al 60 % ensucia el boleto, y una estrella al 7 % no se ve. Por
   * eso la intensidad se lee por tipo y no como un número suelto.
   */
  var INTENSIDADES = {
    suave:   { linea: 0.07, figura: 0.35 },
    media:   { linea: 0.14, figura: 0.60 },
    marcada: { linea: 0.24, figura: 0.90 },
  };

  /** El color de la trama de línea: el del marco, rebajado. */
  function conAlfa(hex, alfa) {
    return 'rgba(' + parseInt(hex.substr(1, 2), 16) + ',' +
           parseInt(hex.substr(3, 2), 16) + ',' +
           parseInt(hex.substr(5, 2), 16) + ',' + alfa + ')';
  }

  /** El fondo completo de un boleto, sea de línea o de figura. */
  function fondoDe(d) {
    var trama = TRAMAS[d.trama];
    var alfa = INTENSIDADES[d.intensidad][trama.tipo];
    return trama.css(conAlfa(d.borde, alfa), alfa);
  }

  var AVISO_DE_SIEMPRE = 'El boleto se anulará si se encuentra roto, con tachones, ' +
    'borrones o enmendaduras.';

  /**
   * Un diseño guardado, completado con lo que falte.
   *
   * Nulo significa «el de siempre»: por eso las rifas de antes de que esto
   * existiera siguen imprimiéndose exactamente igual que antes.
   */
  function disenoCompleto(guardado) {
    var d = guardado && typeof guardado === 'object' ? guardado : {};
    var base = TEMAS[d.tema] || TEMAS.clasico;
    return {
      tema: TEMAS[d.tema] ? d.tema : 'clasico',
      fondo: color(d.fondo) || base.fondo,
      tinta: color(d.tinta) || base.tinta,
      acento: color(d.acento) || base.acento,
      borde: color(d.borde) || base.borde,
      logo: typeof d.logo === 'string' && d.logo.indexOf('data:image/') === 0 ? d.logo : '',
      aviso: typeof d.aviso === 'string' ? d.aviso : AVISO_DE_SIEMPRE,
      columnas: (d.columnas === 1 || d.columnas === 3) ? d.columnas : 2,
      trama: TRAMAS[d.trama] ? d.trama : 'ninguna',
      intensidad: INTENSIDADES[d.intensidad] ? d.intensidad : 'suave',
      disposicion: d.disposicion === 'suertudito' ? 'suertudito' : 'clasica',
      caducidad: typeof d.caducidad === 'string' ? d.caducidad : '1 día',
    };
  }

  /** Un color solo si de verdad lo es: lo que se cuela aquí va a un `style`. */
  function color(valor) {
    return /^#[0-9a-fA-F]{6}$/.test(String(valor || '')) ? String(valor).toLowerCase() : '';
  }

  // --- Contraste -----------------------------------------------------
  /*
   * En pantalla un color flojo se ve flojo. En papel, y sobre todo fotocopiado
   * o impreso en una impresora con poca tinta, desaparece. Esto no prohíbe
   * nada —el gusto es de quien imprime— pero avisa antes de las doscientas
   * copias, que es cuando ya no tiene remedio.
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

  // Dos renglones de 49.2 mm a 1.85 mm de letra. Medido sobre el boleto
  // impreso, no a ojo.
  var AVISO_CABE = 90;

  /** Qué habría que arreglar antes de imprimir, en palabras. */
  function avisosDeContraste(d) {
    var avisos = [];
    // 4.5 es el mínimo para texto corrido; los números van grandes y aguantan 3.
    if (contraste(d.tinta, d.fondo) < 4.5) {
      avisos.push('la letra chica casi no se distingue del fondo');
    }
    if (contraste(d.acento, d.fondo) < 3) {
      avisos.push('los números se pierden contra el fondo');
    }
    if (contraste(d.borde, d.fondo) < 1.6) {
      avisos.push('el marco del boleto va a quedar invisible, y es la línea por donde se recorta');
    }
    // En la disposición vertical el aviso tiene su renglón medido: lo que no
    // cabe se recorta sin decir nada, y un aviso legal a medias no sirve.
    if (d.disposicion === 'suertudito' && String(d.aviso || '').length > AVISO_CABE) {
      avisos.push('el aviso no cabe completo en el boleto vertical: déjalo en ' +
        AVISO_CABE + ' letras o menos');
    }
    return avisos;
  }

  // ------------------------------------------------------------------
  // Disposición «Suertudito»: el boleto vertical
  // ------------------------------------------------------------------
  /*
   * Una reproducción del boleto que trajo el dueño: marco verde doble,
   * tréboles, la rana, el título en cursiva, cuatro recuadros para los
   * números y el QR al centro.
   *
   * Todo el adorno va dibujado en SVG aquí mismo, no como imágenes: pesa
   * cero, sale nítido a cualquier resolución de impresora y se imprime igual
   * sin red. Lo único que viene de fuera es el logo, que se sube desde el
   * panel y vive en el mismo campo `logo` de siempre.
   *
   * Las medidas van en porcentaje del boleto, tomadas del original midiendo
   * la imagen. Así el boleto se puede imprimir a uno, dos o tres por renglón
   * y conserva sus proporciones.
   */
  /*
   * El trébol del original: seis hojas redondas repartidas cada 60°, con la
   * muesca justo arriba y justo abajo, y el tallito saliendo de la de abajo.
   * Medido sobre la foto del boleto, no inventado.
   */
  var HOJA_TREBOL = 'M50,50 C59,40 77,34 87,40 C95,45 95,55 87,60 C77,66 59,60 50,50 Z';

  function trebolSvg(color) {
    return '<svg class="trebol" viewBox="0 0 100 101">' +
      [0, 60, 120, 180, 240, 300].map(function (g) {
        return '<path d="' + HOJA_TREBOL + '" transform="rotate(' + g + ' 50 50)" fill="' +
          color + '"/>';
      }).join('') +
      '<path d="M51,78 C54,85 55,91 52,97" fill="none" stroke="' + color +
      '" stroke-width="6" stroke-linecap="round"/></svg>';
  }

  /*
   * La rana del original, calcada de la foto: la caja mide 21.8 % de ancho
   * por 11.7 % de alto —más ancha que alta—, los ojos son grandes y los
   * brazos bajan casi hasta abajo antes de engancharse.
   */
  function ranaSvg(color) {
    return '<svg class="rana" viewBox="0 0 132 96">' +
      '<g fill="none" stroke="' + color + '" stroke-width="3.2" stroke-linecap="round" ' +
      'stroke-linejoin="round">' +
      '<circle cx="50" cy="12" r="10.5"/><circle cx="82" cy="12" r="10.5"/>' +
      '<path d="M40,20 C41,36 52,46 66,46 C80,46 91,36 92,20"/>' +
      '<path d="M43,30 C20,34 5,54 4,72 C3,86 14,93 21,86 C28,79 29,68 27,59"/>' +
      '<path d="M89,30 C112,34 127,54 128,72 C129,86 118,93 111,86 C104,79 103,68 105,59"/>' +
      '<path d="M21,86 C16,92 10,94 3,93"/><path d="M111,86 C116,92 122,94 129,93"/></g>' +
      '<circle cx="50" cy="12" r="3.2" fill="' + color + '"/>' +
      '<circle cx="82" cy="12" r="3.2" fill="' + color + '"/></svg>';
  }

  function monedaSvg(color) {
    return '<svg class="moneda" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="45" fill="none" stroke="' + color + '" stroke-width="5"/>' +
      '<circle cx="50" cy="50" r="35" fill="none" stroke="' + color + '" stroke-width="4"/>' +
      '<text x="50" y="72" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" ' +
      'font-size="60" font-weight="700" fill="' + color + '">$</text></svg>';
  }

  /*
   * Las medidas del boleto vertical, en porcentaje de su alto y de su ancho.
   *
   * El boleto del cliente trae cuatro números en las cuatro esquinas del
   * centro, pero una rifa puede llevar de 1 a 10 por boleto. Los números se
   * acomodan en dos columnas y en tantos renglones como hagan falta: con
   * cuatro caen exactamente donde el original, y con más se aprietan hacia
   * adentro. Imprimir solo los primeros cuatro no es opción: los demás siguen
   * valiendo y pueden salir ganadores sin que el papel los muestre.
   */
  var CAJA_PRIMER = 39.4;
  var CAJA_ULTIMO = 76.5;
  var CAJA_ALTO = 7.8;
  var CAJA_COLUMNA = [7.2, 66.3];

  /** El lugar de cada número, para un boleto de `cuantos` folios. */
  function cajasSuerte(cuantos) {
    var renglones = Math.ceil(cuantos / 2);
    var paso = renglones > 1 ? (CAJA_ULTIMO - CAJA_PRIMER) / (renglones - 1) : 0;
    var lugares = [];
    for (var i = 0; i < cuantos; i++) {
      lugares.push({
        izq: CAJA_COLUMNA[i % 2],
        arriba: Number((CAJA_PRIMER + Math.floor(i / 2) * paso).toFixed(2)),
      });
    }
    return lugares;
  }

  /**
   * ¿Con tantos folios hay que apretar el boleto?
   *
   * Pasando de cuatro los números ocupan los costados de arriba a abajo, y ahí
   * vivían las fechas verticales y el sello. Los dos se mudan.
   */
  function suerteApretado(cuantos) {
    return cuantos > 4;
  }

  /**
   * El estilo del boleto vertical.
   *
   * `aspect-ratio` en vez de una altura fija: así la hoja puede imprimirlo a
   * uno, dos o tres por renglón y el boleto conserva su forma en los tres
   * casos, en vez de estirarse.
   */
  function estiloSuerte(d, p) {
    var tenue = conAlfa(d.borde, 0.55);
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
      p + '.boleto { position: relative; aspect-ratio: 1 / 1.4142; box-sizing: border-box;' +
      ' container-type: inline-size; --u: 1mm;' +
      ' background-color: ' + d.fondo + '; color: ' + d.tinta + '; overflow: hidden;' +
      ' break-inside: avoid; ' + fondoDe(d) + ' }' +
      p + '.boleto > * { --u: 1mm; }' +
      '@container (min-width: 1px) { ' + p + '.boleto > * { --u: 1.6667cqw; } }' +
      // Los dos marcos: el grueso a 1.84 % y el fino a 3.4 %, medidos.
      p + '.marco { position: absolute; inset: 1.84%;' +
      ' border: calc(var(--u) * 0.52) solid ' + d.borde + '; }' +
      p + '.marco2 { position: absolute; inset: 3.4%;' +
      ' border: calc(var(--u) * 0.23) solid ' + tenue + '; }' +
      // El título del original es una ROMANA NEGRITA CURSIVA, no una letra
      // manuscrita. La primera versión pedía `Segoe Script` y en la máquina
      // del cliente salía escrito a mano: otro boleto.
      p + '.titulo { position: absolute; left: 24%; right: 24%; top: 7.2%; text-align: center;' +
      ' line-height: 1; font-family: "Times New Roman", "Liberation Serif", Times, serif;' +
      ' font-weight: 700; font-style: italic; color: ' + d.tinta + '; }' +
      p + '.titulo span { display: block; white-space: nowrap; }' +
      // `border-box`: el 7.8 % medido en el original es el recuadro ENTERO,
      // con su línea. Sin esto el borde se suma y el recuadro roza las fechas.
      p + '.caja { position: absolute; box-sizing: border-box; width: 27.2%;' +
      ' height: ' + CAJA_ALTO + '%; border: calc(var(--u) * 0.26) solid ' + d.borde + ';' +
      ' border-radius: calc(var(--u) * 0.85); display: flex;' +
      ' align-items: center; justify-content: center; background: ' + d.fondo + ';' +
      ' font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700;' +
      ' font-size: calc(var(--u) * 2.8); color: ' + d.acento + '; }' +
      p + '.rana { position: absolute; left: 39%; width: 21.8%; top: 35.8%; }' +
      // El QR, siempre sobre blanco y con su margen: no se negocia ni aquí.
      p + '.qr { position: absolute; left: 36.7%; width: 29.2%; top: 49.8%; background: #fff;' +
      ' box-sizing: border-box; padding: calc(var(--u) * 0.9);' +
      ' border-radius: calc(var(--u) * 0.8); }' +
      p + '.qr svg { width: 100%; height: auto; display: block; }' +
      // `max-height` y `object-fit`: un logo vertical con `width` a secas se
      // estiraba hasta encimarse con el renglón de abajo.
      p + '.sello { position: absolute; left: 71.7%; width: 18.8%; top: 52.5%;' +
      ' height: auto; max-height: 13.3%; object-fit: contain; }' +
      // Apretado el sello no cabe al costado: se sube al hueco que queda
      // entre el título y la rana.
      p + '.apretado .sello { left: 43%; width: 14%; top: 24.3%; max-height: 10%; }' +
      p + '.trebol { position: absolute; }' +
      p + '.tr1 { left: 3.4%; top: 3.5%; width: 14%; }' +
      p + '.tr2 { left: 76%; top: 14.5%; width: 15.1%; }' +
      p + '.tr3 { left: 1.8%; top: 85.9%; width: 8.9%; }' +
      p + '.moneda { position: absolute; }' +
      p + '.mo1 { left: 5.4%; top: 31.5%; width: 7.2%; }' +
      p + '.mo2 { left: 88%; top: 68.3%; width: 8.6%; }' +
      // Apretado, la moneda de la derecha cae justo detrás de un número.
      p + '.apretado .mo2 { display: none; }' +
      // 47.4 % y no 46.8 %: en el original el texto de canto empieza justo a
      // la altura del borde de abajo del recuadro y lo roza. Medio milímetro
      // más abajo no se nota y deja de rozarlo.
      p + '.fechas { position: absolute; left: 6.7%; top: 47.4%; height: 21.6%;' +
      ' writing-mode: vertical-rl; font-size: calc(var(--u) * 1.5); font-weight: 700;' +
      ' line-height: 1.3; white-space: nowrap; }' +
      // El precio es una PALO SECO negrita cursiva con sombra suave, no una
      // romana con relieve duro.
      p + '.precio { position: absolute; left: 35.2%; width: 29.6%; top: 77.1%; height: 6.1%;' +
      ' display: flex; align-items: center; justify-content: center;' +
      ' font-size: calc(var(--u) * 5.25); font-weight: 800; font-style: italic;' +
      ' color: ' + d.acento + '; text-shadow: calc(var(--u) * 0.35) calc(var(--u) * 0.4)' +
      ' calc(var(--u) * 0.45) rgba(0, 0, 0, 0.45); }' +
      p + '.aviso { position: absolute; left: 12%; right: 6%; top: 86.4%; height: 5.6%;' +
      ' overflow: hidden; display: flex; align-items: flex-start; justify-content: center;' +
      ' text-align: center; font-size: calc(var(--u) * 1.85); font-weight: 700;' +
      ' line-height: 1.15; }' +
      // El identificador y el código, impresos. El día del sorteo hay que
      // cotejar el código del panel contra el talón que trae el ganador, y un
      // boleto que solo los lleve dentro del QR no se puede cotejar si el
      // teléfono no lo lee. Empieza en 13 % porque en la esquina de abajo a la
      // izquierda vive el trébol, y encima de un trébol no se lee un folio.
      p + '.pie { position: absolute; left: 13%; right: 6%; top: 92.4%; height: 2.9%;' +
      ' display: flex; align-items: center; justify-content: space-between;' +
      ' gap: calc(var(--u) * 1.2); font-size: calc(var(--u) * 1.6); line-height: 1;' +
      ' opacity: 0.85; }' +
      p + '.pie span { font-family: ui-monospace, Menlo, Consolas, monospace;' +
      ' white-space: nowrap; }' +
      p + '.serial { letter-spacing: 0.04em; }' +
      p + '.codigo { letter-spacing: 0.08em; font-weight: 700; }' +
      // `min-width: 0`: sin eso la fecha no se deja recortar y es el código el
      // que se sale del boleto.
      p + '.fechas-pie { font-family: inherit; letter-spacing: 0; min-width: 0;' +
      ' overflow: hidden; text-overflow: ellipsis; }' +
      // Apretado, al pie le caben además las dos fechas: con la letra del
      // boleto normal la de emisión salía cortada con puntos suspensivos.
      p + '.apretado .pie { font-size: calc(var(--u) * 1.4); }'
    );
  }

  // El título del original, «Suertudito», mide 6.1 mm de alto y ocupa 44 %
  // del ancho del boleto.
  var TITULO_MM = 6.1;
  // Lo ancho que puede ser un renglón sin montarse al trébol de arriba a la
  // derecha, que empieza en el 76 %: 2 × (76 − 50) % de 60 mm, menos un pelo.
  var TITULO_ANCHO_MM = 30.6;
  var FUENTE_TITULO = 'italic 700 100px "Times New Roman","Liberation Serif",Times,serif';

  var medidor = null;

  /**
   * Lo que mide un texto, en emes, con la letra que de verdad tenga esta
   * máquina.
   *
   * Contar letras no sirve: «Suertudito» y «Muerde Manos» tienen casi las
   * mismas y la segunda mide un tercio más, porque las emes son anchas. Con
   * la cuenta de letras el título se le montaba al trébol.
   */
  function anchoEm(texto, fuente) {
    try {
      if (!medidor) { medidor = document.createElement('canvas').getContext('2d'); }
      medidor.font = fuente;
      var w = medidor.measureText(texto).width / 100;
      if (w > 0) { return w; }
    } catch (e) { /* sin canvas se cae a la cuenta de letras */ }
    return texto.length * 0.52;
  }

  /**
   * El nombre partido en dos renglones, como el original, con el tamaño que
   * le toca.
   *
   * Se corta por el espacio más cercano a la mitad y no por el último: con
   * «Rifa El Muerde Manos», cortar por el último deja «Rifa El Muerde» arriba
   * y «Manos» solo abajo, y el título se ve chueco.
   */
  function tituloEnDos(nombre) {
    var texto = String(nombre || '').trim();
    var mitad = texto.length / 2;
    var corte = -1;
    for (var i = 0; i < texto.length; i++) {
      if (texto[i] === ' ' && (corte < 0 || Math.abs(i - mitad) < Math.abs(corte - mitad))) {
        corte = i;
      }
    }
    var renglones = corte < 1 ? [texto] : [texto.slice(0, corte), texto.slice(corte + 1)];
    var ancho = renglones.reduce(function (n, r) {
      return Math.max(n, anchoEm(r, FUENTE_TITULO));
    }, 0.1);
    var tam = Math.max(2.5, Math.min(TITULO_MM, TITULO_ANCHO_MM / ancho));
    return '<div class="titulo" style="font-size: calc(var(--u) * ' + tam.toFixed(2) + ')">' +
      renglones.map(function (r) { return '<span>' + escapar(r) + '</span>'; }).join('') +
      '</div>';
  }

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
               'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /**
   * Una fecha corta para el boleto: 30-sep-2026.
   *
   * Armada a mano y no con `toLocaleDateString`: esa devuelve «30 sept 2026»
   * o «30 sep 2026» según la versión del navegador que imprima, y un lote de
   * boletos no puede salir distinto según la computadora que lo mandó.
   */
  function fechaCorta(iso) {
    if (!iso) { return ''; }
    var f = new Date(iso);
    if (isNaN(f.getTime())) { return ''; }
    // En la zona del evento, no en la del navegador que imprime.
    var partes = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: CFG.zonaHoraria || undefined,
    }).format(f).split('-');
    return partes[2] + '-' + MESES[Number(partes[1]) - 1] + '-' + partes[0];
  }

  /** La misma fecha, en el formato que pide un `<input type="date">`: AAAA-MM-DD. */
  function fechaSoloISO(iso) {
    if (!iso) { return ''; }
    var f = new Date(iso);
    if (isNaN(f.getTime())) { return ''; }
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: CFG.zonaHoraria || undefined,
    }).format(f);
  }

  function boletoSuerteHtml(rifa, boleto, url, precio, d) {
    var numeros = boleto.folios || [];
    var lugares = cajasSuerte(numeros.length);
    var apretado = suerteApretado(numeros.length);
    var emision = fechaCorta(rifa.emision || rifa.creada_en);
    var fechas = [];
    if (d.caducidad) { fechas.push('Caducidad: ' + escapar(d.caducidad)); }
    if (emision) { fechas.push('Emisión: ' + escapar(emision)); }
    return '<article class="boleto' + (apretado ? ' apretado' : '') + '">' +
      '<div class="marco"></div><div class="marco2"></div>' +
      trebolSvg(d.borde).replace('class="trebol"', 'class="trebol tr1"') +
      trebolSvg(d.borde).replace('class="trebol"', 'class="trebol tr2"') +
      trebolSvg(d.borde).replace('class="trebol"', 'class="trebol tr3"') +
      tituloEnDos(rifa.nombre) +
      monedaSvg(d.borde).replace('class="moneda"', 'class="moneda mo1"') +
      monedaSvg(d.borde).replace('class="moneda"', 'class="moneda mo2"') +
      ranaSvg(d.tinta) +
      numeros.map(function (f, i) {
        return '<div class="caja" style="left: ' + lugares[i].izq + '%; top: ' +
          lugares[i].arriba + '%">' + escapar(f) + '</div>';
      }).join('') +
      '<div class="qr">' + qrSvg(url) + '</div>' +
      (d.logo ? '<img class="sello" src="' + escapar(d.logo) + '" alt="" />' : '') +
      (!apretado && fechas.length ? '<div class="fechas">' + fechas.join('<br />') + '</div>' : '') +
      (precio ? '<div class="precio">' + escapar(precio) + '</div>' : '') +
      (d.aviso ? '<div class="aviso">' + escapar(d.aviso) + '</div>' : '') +
      '<div class="pie">' +
      '<span class="serial">' + escapar(boleto.id) + '</span>' +
      (apretado && fechas.length
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
  function estiloBoleto(d, prefijo) {
    var p = prefijo || '';
    if (d.disposicion === 'suertudito') { return estiloSuerte(d, p); }
    return (
      // El color va por separado de la imagen: `background` a secas borraría
      // la trama que viene justo después.
      p + '.boleto { background-color: ' + d.fondo + '; color: ' + d.tinta + ';' +
      ' border: 1px solid ' + d.borde + '; border-radius: 2mm; padding: 3mm 4mm;' +
      ' break-inside: avoid; ' + fondoDe(d) + ' }' +
      p + '.logo { display: block; max-height: 9mm; max-width: 60%; margin: 0 auto 1mm; }' +
      p + '.marca { font-size: 13pt; font-weight: 700; text-transform: uppercase;' +
      ' letter-spacing: 0.04em; text-align: center; margin: 0 0 1mm; }' +
      p + '.aviso { font-size: 5.5pt; opacity: 0.75; text-align: center; margin: 0 0 2mm;' +
      ' line-height: 1.25; }' +
      p + '.medio { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }' +
      // Los números en rejilla de dos: así cuatro caben cuadrados y parejos,
      // y con uno o dos la caja no se deforma.
      p + '.numeros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));' +
      ' gap: 1.5mm; flex: 1 1 auto; }' +
      // Con fondo propio: los números son lo único que de verdad hay que poder
      // leer de lejos, y una trama por debajo se los come.
      p + '.num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14pt;' +
      ' font-weight: 700; color: ' + d.acento + '; background: ' + d.fondo + ';' +
      ' border: 0.4mm solid ' + d.borde + ';' +
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
   * Recibe la rifa entera y no solo su nombre porque la disposición vertical
   * imprime además su fecha de emisión.
   */
  function boletoHtml(rifa, boleto, url, precio, d) {
    if (d.disposicion === 'suertudito') {
      return boletoSuerteHtml(rifa, boleto, url, precio, d);
    }
    var nombre = rifa.nombre;
    var numeros = (boleto.folios || []).map(function (f) {
      return '<span class="num">' + escapar(f) + '</span>';
    }).join('');
    return '<article class="boleto">' +
      (d.logo ? '<img class="logo" src="' + escapar(d.logo) + '" alt="" />' : '') +
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
      '<title>Boletos ' + escapar(rifa.serie) + ' — ' + boletos.length + '</title><style>' +
      '@page { size: letter; margin: 10mm; }' +
      'body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0;' +
      ' background: #fff; color: #111; }' +
      '.encabezado { padding: 8mm 6mm 0; }' +
      'h1 { font-size: 13pt; margin: 0 0 2mm; }' +
      '.pie-hoja { font-size: 9pt; color: #666; margin: 0 0 6mm; }' +
      'button { font: inherit; padding: 3mm 6mm; margin-bottom: 6mm; }' +
      '.rejilla { display: grid; grid-template-columns: repeat(' + d.columnas + ', 1fr);' +
      ' gap: 5mm; padding: 0 6mm 8mm; }' +
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

  // ------------------------------------------------------------------
  // Los papelitos de la tómbola
  // ------------------------------------------------------------------
  /*
   * El eslabón que faltaba entre la app y el mundo físico.
   *
   * La app imprime boletos con números repartidos al azar por todo el espacio
   * de cinco dígitos. Eso es bueno contra la falsificación y malo para una
   * tómbola: no existe la bolsa de bolitas que los traiga, y escribir
   * ochocientos papelitos a mano es una tarde entera y un dedazo esperando a
   * pasar. Un papelito mal escrito es un número que la app va a rechazar el
   * día del sorteo, delante de todos.
   *
   * Así que los papelitos salen de la MISMA consulta que la hoja de boletos.
   * Si un número está en un papelito, está en un boleto; si está en un boleto,
   * tiene su papelito. No hay forma de que se desincronicen.
   *
   * En el papelito va el número y nada más. NO va de qué boleto salió: quien
   * mete la mano en la tómbola no tiene por qué poder ver a quién le toca.
   */
  var POR_RENGLON = 6;
  var RENGLONES = 12;
  var POR_HOJA = POR_RENGLON * RENGLONES;

  function papelitosHtml(rifa, boletos) {
    // Todos los números de la rifa, ordenados. En orden y no revueltos a
    // propósito: así se pueden contar y cotejar de un vistazo antes de
    // echarlos a la tómbola. Revolverlos es trabajo de la tómbola, no de la
    // impresora.
    var folios = [];
    boletos.forEach(function (b) {
      (b.folios || []).forEach(function (f) { folios.push(f); });
    });
    folios.sort();

    var serie = rifa.serie ? escapar(rifa.serie) + '-' : '';
    var hojas = Math.ceil(folios.length / POR_HOJA);

    var cuerpo = '';
    for (var h = 0; h < hojas; h++) {
      var tanda = folios.slice(h * POR_HOJA, (h + 1) * POR_HOJA);
      cuerpo += '<section class="hoja"><div class="rejilla">' +
        tanda.map(function (f) {
          return '<div class="papelito"><span class="numero">' + serie + escapar(f) +
            '</span><span class="dedonde">' + escapar(rifa.nombre) + '</span></div>';
        }).join('') +
        '</div><p class="pieHoja">Hoja ' + (h + 1) + ' de ' + hojas + ' · ' +
        escapar(rifa.nombre) + ' · ' + folios.length + ' papelitos en total</p></section>';
    }

    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />' +
      '<title>Papelitos para la tómbola — ' + escapar(rifa.nombre) + '</title><style>' +
      '@page { size: letter; margin: 8mm; }' +
      'body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;' +
      ' margin: 0; background: #fff; color: #000; }' +
      '.encabezado { padding: 8mm 6mm 0; }' +
      'h1 { font-size: 14pt; margin: 0 0 3mm; }' +
      '.guia { font-size: 10pt; line-height: 1.5; color: #333; margin: 0 0 4mm; max-width: 150mm; }' +
      '.guia strong { color: #000; }' +
      'button { font: inherit; padding: 3mm 6mm; margin-bottom: 6mm; }' +
      '.hoja { break-after: page; }' +
      '.hoja:last-child { break-after: auto; }' +
      '.rejilla { display: grid; grid-template-columns: repeat(' + POR_RENGLON + ', 1fr); }' +
      // Sin hueco entre papelitos y con el borde punteado compartido: se corta
      // de un solo tijeretazo por renglón, no recuadro por recuadro.
      '.papelito { border: 0.3mm dashed #999; margin: -0.15mm; height: 20mm;' +
      ' display: flex; flex-direction: column; align-items: center;' +
      ' justify-content: center; gap: 1mm; break-inside: avoid; }' +
      '.numero { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 15pt;' +
      ' font-weight: 700; letter-spacing: 0.06em; }' +
      '.dedonde { font-size: 5pt; color: #666; text-transform: uppercase;' +
      ' letter-spacing: 0.08em; max-width: 90%; overflow: hidden;' +
      ' text-overflow: ellipsis; white-space: nowrap; }' +
      '.pieHoja { font-size: 8pt; color: #555; text-align: center; margin: 3mm 0 0; }' +
      '@media print { .encabezado { display: none; } }' +
      '</style></head><body><div class="encabezado">' +
      '<h1>Papelitos para la tómbola · ' + escapar(rifa.nombre) + '</h1>' +
      '<p class="guia">' +
      'Un papelito por cada número de la rifa: <strong>' + folios.length + ' en total</strong>, ' +
      'repartidos en <strong>' + hojas + ' hoja' + (hojas === 1 ? '' : 's') + '</strong>. ' +
      'Salen de los mismos boletos que ya se imprimieron, así que no puede sobrar ni faltar ninguno.<br />' +
      '<strong>Antes de echarlos a la tómbola, comprueba que tienes las ' + hojas + ' hojas</strong> ' +
      '—cada una lo dice en su pie—. Una hoja que no se imprimió es un boleto que nunca podría ganar, ' +
      'y una hoja impresa dos veces es un boleto con el doble de suerte.' +
      '</p>' +
      '<button onclick="window.print()">Imprimir o guardar como PDF</button></div>' +
      cuerpo + '</body></html>';
  }

  function abrirHoja(rifa, boletos) {
    abrirEnVentana(hojaHtml(rifa, boletos), 'boletos-' + rifa.id + '.html');
  }

  function abrirPapelitos(rifa, boletos) {
    abrirEnVentana(papelitosHtml(rifa, boletos), 'papelitos-' + rifa.id + '.html');
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

    // La emisión es de LA RIFA, no del diseño: sin rifa no hay nada que
    // corregir todavía, así que el campo solo sale cuando se está editando
    // una que ya existe.
    $('campoEmision').hidden = !r;
    $('btnGuardarEmision').hidden = !r;
    $('dsEmision').value = r ? fechaSoloISO(r.emision) : '';
    mensaje('', '', 'mensajeEmision');
    disenoEnEdicion = disenoCompleto(r ? r.diseno : disenoPorOmision);
    escribirControles(disenoEnEdicion);
    refrescarVista();
  }

  function pintarTemas() {
    var caja = $('temas');
    caja.textContent = '';
    Object.keys(TEMAS).forEach(function (llave) {
      var t = TEMAS[llave];
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'tema' + (llave === disenoEnEdicion.tema ? ' elegido' : '');
      boton.dataset.tema = llave;

      var muestra = document.createElement('span');
      muestra.className = 'muestra';
      muestra.style.background = t.fondo;
      [t.tinta, t.acento, t.borde].forEach(function (c) {
        var punto = document.createElement('span');
        punto.className = 'punto';
        punto.style.background = c;
        muestra.appendChild(punto);
      });

      var nombre = document.createElement('span');
      nombre.className = 'nombre';
      nombre.textContent = t.nombre;

      boton.appendChild(muestra);
      boton.appendChild(nombre);
      boton.addEventListener('click', function () { elegirTema(llave); });
      caja.appendChild(boton);
    });
  }

  var DISPOSICIONES = {
    clasica: { nombre: 'Clásica', razon: '16 / 9' },
    suertudito: { nombre: 'Suertudito', razon: '60 / 84.7' },
  };

  function pintarDisposiciones() {
    var caja = $('disposiciones');
    caja.textContent = '';
    var d = disenoCompleto(disenoEnEdicion);
    Object.keys(DISPOSICIONES).forEach(function (llave) {
      var info = DISPOSICIONES[llave];
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'tema' + (llave === d.disposicion ? ' elegido' : '');
      boton.dataset.disposicion = llave;

      // La muestra enseña la FORMA, que es lo que de verdad cambia.
      var muestra = document.createElement('span');
      muestra.className = 'muestra';
      var papel = document.createElement('span');
      papel.style.cssText = 'aspect-ratio:' + info.razon + ';height:28px;border:1.5px solid ' +
        d.borde + ';border-radius:2px;background:' + d.fondo;
      muestra.appendChild(papel);

      var nombre = document.createElement('span');
      nombre.className = 'nombre';
      nombre.textContent = info.nombre;

      boton.appendChild(muestra);
      boton.appendChild(nombre);
      boton.addEventListener('click', function () { elegirDisposicion(llave); });
      caja.appendChild(boton);
    });
  }

  /**
   * Cambiar de disposición ajusta los boletos por renglón Y los colores.
   *
   * Un boleto vertical a dos por renglón sale de 90 mm de ancho y 126 de
   * alto: enorme. Tres es el tamaño del original.
   *
   * Y con los colores pasa lo mismo que con el tamaño: la disposición no es
   * una forma, es el boleto del cliente entero, y ese boleto es verde sobre
   * papel verde pálido. Elegirla en blanco y negro no se parecía al original
   * y había que acertarle a mano a cuatro colores. Las dos cosas son
   * sugerencia, no candado: se cambian enseguida desde los controles.
   */
  function elegirDisposicion(llave) {
    disenoEnEdicion.disposicion = llave;
    disenoEnEdicion.columnas = llave === 'suertudito' ? 3 : 2;
    var tema = llave === 'suertudito' ? 'trebol' : 'clasico';
    disenoEnEdicion.tema = tema;
    disenoEnEdicion.fondo = TEMAS[tema].fondo;
    disenoEnEdicion.tinta = TEMAS[tema].tinta;
    disenoEnEdicion.acento = TEMAS[tema].acento;
    disenoEnEdicion.borde = TEMAS[tema].borde;
    escribirControles(disenoEnEdicion);
    refrescarVista();
  }

  function pintarTramas() {
    var caja = $('tramas');
    caja.textContent = '';
    var d = disenoCompleto(disenoEnEdicion);
    Object.keys(TRAMAS).forEach(function (llave) {
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'tema' + (llave === d.trama ? ' elegido' : '');
      boton.dataset.trama = llave;

      // La muestra se pinta con los colores que el boleto tiene ahora mismo,
      // no con unos de catálogo: así se elige viendo cómo va a quedar.
      var muestra = document.createElement('span');
      muestra.className = 'muestra';
      // Cada muestra se pinta con SU trama pero con los colores que el boleto
      // tiene ahora: se elige viendo cómo va a quedar, no un catálogo.
      muestra.style.cssText = 'background-color:' + d.fondo + ';' +
        fondoDe({ trama: llave, intensidad: d.intensidad, borde: d.borde });

      var nombre = document.createElement('span');
      nombre.className = 'nombre';
      nombre.textContent = TRAMAS[llave].nombre;

      boton.appendChild(muestra);
      boton.appendChild(nombre);
      boton.addEventListener('click', function () {
        disenoEnEdicion.trama = llave;
        escribirControles(disenoEnEdicion);
        refrescarVista();
      });
      caja.appendChild(boton);
    });
    // Sin trama no hay nada que graduar.
    $('campoIntensidad').hidden = d.trama === 'ninguna';
  }

  /** Elegir un tema reemplaza los cuatro colores: es el punto de un tema. */
  function elegirTema(llave) {
    var t = TEMAS[llave];
    disenoEnEdicion.tema = llave;
    disenoEnEdicion.fondo = t.fondo;
    disenoEnEdicion.tinta = t.tinta;
    disenoEnEdicion.acento = t.acento;
    disenoEnEdicion.borde = t.borde;
    escribirControles(disenoEnEdicion);
    refrescarVista();
  }

  function escribirControles(d) {
    $('dsFondo').value = d.fondo;
    $('dsTinta').value = d.tinta;
    $('dsAcento').value = d.acento;
    $('dsBorde').value = d.borde;
    $('dsAviso').value = d.aviso;
    $('dsColumnas').value = String(d.columnas);
    $('dsIntensidad').value = d.intensidad;
    $('dsCaducidad').value = d.caducidad;
    // La caducidad solo existe en el boleto vertical: en el clásico no hay
    // dónde ponerla, y un control que no hace nada confunde.
    $('campoCaducidad').hidden = d.disposicion !== 'suertudito';
    $('btnQuitarLogo').hidden = !d.logo;
    pintarDisposiciones();
    pintarTemas();
    pintarTramas();
  }

  function leerControles() {
    disenoEnEdicion.fondo = $('dsFondo').value;
    disenoEnEdicion.tinta = $('dsTinta').value;
    disenoEnEdicion.acento = $('dsAcento').value;
    disenoEnEdicion.borde = $('dsBorde').value;
    disenoEnEdicion.aviso = $('dsAviso').value;
    disenoEnEdicion.columnas = Number($('dsColumnas').value);
    disenoEnEdicion.intensidad = $('dsIntensidad').value;
    disenoEnEdicion.caducidad = $('dsCaducidad').value;
    // Las muestras de trama llevan los colores de ahora: al moverlos, se
    // vuelven a pintar o enseñarían unos que ya no son.
    pintarTramas();
    refrescarVista();
  }

  ['dsFondo', 'dsTinta', 'dsAcento', 'dsBorde'].forEach(function (id) {
    $(id).addEventListener('input', leerControles);
  });
  $('dsAviso').addEventListener('input', leerControles);
  $('dsColumnas').addEventListener('change', leerControles);
  $('dsIntensidad').addEventListener('change', leerControles);
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

  // --- El logo -------------------------------------------------------
  /*
   * La imagen se achica en el navegador antes de mandarla. Un logo sacado de
   * la galería del celular pesa megabytes y va a parar a un renglón de la base
   * que después viaja completo en cada consulta de boletos. Impreso a nueve
   * milímetros de alto, 400 píxeles de ancho sobran.
   */
  var LOGO_MAX_ANCHO = 400;
  var LOGO_MAX_BYTES = 120 * 1024;

  $('dsLogo').addEventListener('change', function () {
    var archivo = this.files && this.files[0];
    if (!archivo) { return; }
    mensaje('Preparando el logo…', '', 'mensajeDiseno');
    achicarImagen(archivo)
      .then(function (dataUrl) {
        disenoEnEdicion.logo = dataUrl;
        $('btnQuitarLogo').hidden = false;
        mensaje('', '', 'mensajeDiseno');
        refrescarVista();
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeDiseno'); });
  });

  $('btnQuitarLogo').addEventListener('click', function () {
    disenoEnEdicion.logo = '';
    $('dsLogo').value = '';
    this.hidden = true;
    refrescarVista();
  });

  function achicarImagen(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onerror = function () { rechazar(new Error('No se pudo leer esa imagen.')); };
      lector.onload = function () {
        var img = new Image();
        img.onerror = function () { rechazar(new Error('Eso no parece una imagen.')); };
        img.onload = function () {
          // PNG conserva el fondo transparente, que es lo que un logo necesita
          // para no salir con un rectángulo blanco encima del boleto.
          var conAlfa = /png|webp/i.test(archivo.type);
          var ancho = Math.min(LOGO_MAX_ANCHO, img.width);
          for (var intento = 0; intento < 5; intento++) {
            var lienzo = document.createElement('canvas');
            lienzo.width = Math.round(ancho);
            lienzo.height = Math.round(img.height * (ancho / img.width));
            lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
            var dataUrl = conAlfa
              ? lienzo.toDataURL('image/png')
              : lienzo.toDataURL('image/jpeg', 0.85);
            if (dataUrl.length * 0.75 <= LOGO_MAX_BYTES) { return resolver(dataUrl); }
            ancho = ancho * 0.7;
          }
          rechazar(new Error('Esa imagen no se pudo achicar lo suficiente. ' +
                             'Prueba con una más sencilla o con menos colores.'));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
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

  $('btnGuardarEmision').addEventListener('click', function () {
    var r = rifaConocida(rifaActual);
    if (!r) { return; }
    var valor = $('dsEmision').value;
    mensaje('Guardando…', '', 'mensajeEmision');
    llamar('fijar_emision', {
      // Mediodía, por la misma razón que al crear la rifa: a medianoche una
      // zona con desfase negativo puede correr la fecha al día anterior.
      fecha_emision: valor ? conZona(valor + 'T12:00') : '',
    })
      .then(function (datos) {
        r.emision = datos.rifa.emision;
        mensaje('Listo. La próxima hoja de esta rifa va a imprimir esa fecha.', 'ok', 'mensajeEmision');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeEmision'); });
  });

  $('btnDisenoDeSiempre').addEventListener('click', function () {
    confirmarDiseno('Vuelve al tema clásico, sin trama y sin logo. ¿Seguro?');
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
          $('dsLogo').value = '';
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
