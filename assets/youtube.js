/**
 * Reconoce un enlace de YouTube y lo deja en su forma canónica.
 *
 * Existe porque el enlace se pega a mano, muchas veces con prisa y desde el
 * celular: puede venir copiado de la app (`youtu.be/…`), del botón compartir
 * de un directo (`/live/…`), con parámetros de rastreo pegados, o sin el
 * `https://`. Todas esas formas llevan al mismo lugar; conviene guardar una
 * sola y descartar de una vez lo que no es de YouTube.
 *
 * Devuelve la dirección limpia, o null si eso no es un enlace de YouTube.
 *
 * NOTA: esta misma lógica está repetida en la función de borde `sorteo`. Aquí
 * sirve para avisar al instante mientras se escribe; allá es la que manda,
 * porque una comprobación que solo vive en el navegador no comprueba nada.
 */
(function (global) {
  'use strict';

  var ID = /^[A-Za-z0-9_-]{11}$/;

  function normalizarYouTube(entrada) {
    var texto = String(entrada || '').trim();
    if (!texto) { return null; }
    if (!/^https?:\/\//i.test(texto)) { texto = 'https://' + texto; }

    var url;
    try { url = new URL(texto); } catch (e) { return null; }

    var host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    var partes = url.pathname.split('/').filter(Boolean);

    // youtu.be/ID — lo que copia la app al compartir
    if (host === 'youtu.be') {
      return ID.test(partes[0] || '') ? watch(partes[0]) : null;
    }

    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') { return null; }

    // youtube.com/watch?v=ID
    if (partes[0] === 'watch') {
      var v = url.searchParams.get('v') || '';
      return ID.test(v) ? watch(v) : null;
    }

    // youtube.com/live/ID — el botón compartir de un directo
    if ((partes[0] === 'live' || partes[0] === 'embed' || partes[0] === 'shorts') && partes[1]) {
      return ID.test(partes[1]) ? watch(partes[1]) : null;
    }

    // youtube.com/@canal/live y youtube.com/channel/UC…/live
    // Este es el bueno para una rifa recurrente: apunta siempre al directo que
    // esté al aire en ese canal, así que se pega una vez y sirve para todas.
    if (partes[partes.length - 1] === 'live' && partes.length >= 2) {
      var canal = partes[0];
      if (canal.charAt(0) === '@' && canal.length > 1) {
        return 'https://www.youtube.com/' + canal + '/live';
      }
      if ((canal === 'channel' || canal === 'c' || canal === 'user') && partes[1]) {
        return 'https://www.youtube.com/' + canal + '/' + partes[1] + '/live';
      }
    }

    return null;
  }

  function watch(id) { return 'https://www.youtube.com/watch?v=' + id; }

  /**
   * La dirección del reproductor incrustado, o null si con este enlace no se
   * puede incrustar.
   *
   * No todas las formas sirven: incrustar necesita el identificador del video,
   * o el del canal. El enlace cómodo `youtube.com/@canal/live` no trae
   * ninguno de los dos —el arroba es un apodo, no un identificador—, así que
   * con ese solo queda mandar a la gente a YouTube. Es el precio de que sea
   * permanente.
   */
  function incrustarYouTube(entrada) {
    var limpia = normalizarYouTube(entrada);
    if (!limpia) { return null; }

    var video = limpia.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (video) {
      return 'https://www.youtube.com/embed/' + video[1] +
             '?autoplay=1&playsinline=1&rel=0';
    }

    // Un canal por su identificador: YouTube resuelve solo cuál directo está
    // al aire. Menos fiable que el del video, pero mejor que nada.
    var canal = limpia.match(/\/channel\/(UC[A-Za-z0-9_-]{10,})\/live$/);
    if (canal) {
      return 'https://www.youtube.com/embed/live_stream?channel=' + canal[1] +
             '&autoplay=1&playsinline=1';
    }

    return null;
  }

  global.normalizarYouTube = normalizarYouTube;
  global.incrustarYouTube = incrustarYouTube;
  if (typeof module === 'object' && module.exports) {
    module.exports = normalizarYouTube;
    module.exports.incrustar = incrustarYouTube;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
