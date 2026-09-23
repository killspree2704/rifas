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
  var PANES = ['paneSorteo', 'paneRifas', 'paneVerificar'];

  function abrirPestana(id) {
    PANES.forEach(function (p) { $(p).hidden = (p !== id); });
    if (id === 'paneSorteo' && !rifaActual) {
      mensaje('Todavía no hay ninguna rifa que manejar. Crea una en la pestaña «Rifas».', 'error');
    }
    Array.prototype.forEach.call(document.querySelectorAll('.pestana'), function (b) {
      b.classList.toggle('activa', b.dataset.panel === id);
    });
    if (id === 'paneRifas') { cargarRifas(); }
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
        pintarRifas(datos.rifas || []);
        mensaje(aviso || '', aviso ? 'ok' : '', 'mensajeRifas');
      })
      .catch(function (e) { mensaje(e.message, 'error', 'mensajeRifas'); });
  }

  function pintarRifas(rifas) {
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

  function hojaHtml(rifa, boletos) {
    var base = baseDelSitio();
    var porBoleto = (boletos[0] && boletos[0].folios ? boletos[0].folios.length : 1);
    var totalFolios = boletos.reduce(function (n, b) { return n + (b.folios || []).length; }, 0);
    var precio = (rifa.precio_boleto === null || rifa.precio_boleto === undefined)
      ? '' : '$' + rifa.precio_boleto;

    var trozos = boletos.map(function (b) {
      // El QR lleva el boleto, no un folio: un papel, un código.
      var url = base + '?b=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(b.codigo);
      var numeros = (b.folios || []).map(function (f) {
        return '<span class="num">' + escapar(f) + '</span>';
      }).join('');
      return '<article class="boleto">' +
        '<p class="marca">' + escapar(rifa.nombre) + '</p>' +
        '<p class="aviso">El boleto se anulará si se encuentra roto, con tachones, ' +
        'borrones o enmendaduras.</p>' +
        '<div class="medio">' +
        '<div class="numeros">' + numeros + '</div>' +
        '<div class="qr">' + qrSvg(url) + '</div>' +
        '</div>' +
        '<p class="pie">' +
        '<span class="serial">' + escapar(b.id) + '</span>' +
        '<span class="codigo">Código ' + escapar(b.codigo) + '</span>' +
        (precio ? '<span class="precio">' + escapar(precio) + '</span>' : '') +
        '</p>' +
        '</article>';
    });

    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />' +
      '<title>Boletos ' + escapar(rifa.serie) + ' — ' + boletos.length + '</title><style>' +
      '@page { size: letter; margin: 10mm; }' +
      'body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #fff; color: #111; }' +
      '.encabezado { padding: 8mm 6mm 0; }' +
      'h1 { font-size: 13pt; margin: 0 0 2mm; }' +
      '.pie-hoja { font-size: 9pt; color: #666; margin: 0 0 6mm; }' +
      'button { font: inherit; padding: 3mm 6mm; margin-bottom: 6mm; }' +
      '.rejilla { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm; padding: 0 6mm 8mm; }' +
      '.boleto { border: 1px solid #333; border-radius: 2mm; padding: 3mm 4mm; break-inside: avoid; }' +
      '.marca { font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;' +
      ' text-align: center; margin: 0 0 1mm; }' +
      '.aviso { font-size: 5.5pt; color: #444; text-align: center; margin: 0 0 2mm; line-height: 1.25; }' +
      '.medio { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }' +
      // Los números en rejilla de dos: así cuatro caben cuadrados y parejos,
      // y con uno o dos la caja no se deforma.
      '.numeros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5mm; flex: 1 1 auto; }' +
      '.num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14pt; font-weight: 700;' +
      ' color: #c2185b; border: 0.4mm solid #333; border-radius: 1mm; padding: 0.8mm 1mm;' +
      ' text-align: center; letter-spacing: 0.03em; }' +
      '.qr { width: 19mm; flex: 0 0 auto; }' +
      '.qr svg { width: 100%; height: auto; display: block; }' +
      '.pie { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm;' +
      ' margin: 2mm 0 0; font-size: 6.5pt; color: #444; }' +
      '.serial { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.06em; }' +
      '.codigo { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.1em; }' +
      '.precio { font-weight: 700; font-size: 9pt; color: #111; }' +
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
  // Entrada
  // ------------------------------------------------------------------
  function entrar() {
    clave = $('clave').value.trim();
    if (!clave) { mensaje('Escribe la clave.', 'error', 'mensajeClave'); return; }
    mensaje('Comprobando…', '', 'mensajeClave');

    // Primero el historial: de ahí sale cuál rifa está marcada como activa, y
    // así el panel no depende de ningún identificador escrito en el código.
    llamar('rifas')
      .then(function (datos) {
        var lista = datos.rifas || [];
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
