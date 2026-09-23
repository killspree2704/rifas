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
  var PANES = ['paneSorteo', 'paneRifas', 'paneVerificar', 'paneDiseno', 'panePerfil'];

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
      hoja.addEventListener('click', function () { pedirHoja(r.id, hoja); });
      acciones.appendChild(hoja);

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
    ['nvNombre', 'nvSerie', 'nvFecha', 'nvCantidad', 'nvPrecio'].forEach(function (id) {
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
  // Hoja de boletos para imprimir
  // ------------------------------------------------------------------
  function pedirHoja(id, boton) {
    var antes = boton.textContent;
    boton.textContent = 'Armando…';
    boton.disabled = true;
    llamar('boletos', { rifa: id })
      .then(function (datos) {
        boton.textContent = antes;
        boton.disabled = false;
        abrirHoja(datos.rifa, datos.boletos);
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
    return avisos;
  }

  /**
   * El estilo de un boleto. Lo comparten la hoja y la vista previa.
   *
   * `sufijo` permite encerrarlo bajo un selector en la vista previa, para que
   * los colores del boleto no se desparramen por el panel.
   */
  function estiloBoleto(d, prefijo) {
    var p = prefijo || '';
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

  /** Un boleto. El mismo que va a la hoja y el que se ve en la vista previa. */
  function boletoHtml(nombre, boleto, url, precio, d) {
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
      return boletoHtml(rifa.nombre, b, url, precio, d);
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

  function abrirHoja(rifa, boletos) {
    var html = hojaHtml(rifa, boletos);
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
    enlace.download = 'boletos-' + rifa.id + '.html';
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
    $('btnQuitarLogo').hidden = !d.logo;
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
    envoltura.innerHTML = boletoHtml(nombre, muestra, baseDelSitio() + '?b=' + muestra.id +
      '&c=' + muestra.codigo, precio, d);

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
})();
