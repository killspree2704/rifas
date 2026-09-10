/**
 * Configuración del sitio. Aquí no hay secretos: la clave de Supabase es la
 * pública, que solo puede hacer lo que las políticas RLS permiten (leer el
 * estado de la rifa y nada más).
 */
window.RIFA_CONFIG = {
  // Qué rifa está activa. Cambiar esto es todo lo que hace falta para la próxima.
  rifaId: 'mm-2026-09',
  nombre: 'Rifa El Muerde Manos',
  serie: 'A',

  // Momento del sorteo. La página lo muestra siempre en esta zona horaria,
  // sin importar dónde esté el teléfono que la abre.
  fechaSorteo: '2026-09-13T18:00:00-06:00',
  zonaHoraria: 'America/Mexico_City',

  // Ritmo de las consultas de respaldo, en milisegundos. El canal en vivo es
  // la vía principal; esto es solo la red de seguridad, y su costo se nota
  // cuando hay cientos de teléfonos abiertos a la vez.
  sondeoLejosMs: 60000,        // falta más de la ventana caliente para el sorteo
  sondeoCanalSanoMs: 30000,    // cerca del sorteo, con el canal en vivo funcionando
  sondeoSinCanalMs: 3500,      // cerca del sorteo y sin canal: hay que preguntar seguido
  sondeoTechoMs: 5000,         // nadie espera más que esto en los minutos del sorteo
  sondeoOcultoMs: 90000,       // el teléfono está bloqueado o en otra pestaña
  ventanaCalienteMin: 15,      // minutos antes del sorteo en que se aprieta el ritmo
  limiteConsultaMs: 7000,      // una consulta colgada se corta y se reintenta

  supabaseUrl: 'https://fgwavuaolmrwagaymgos.supabase.co',
  supabaseKey: 'sb_publishable_x6KN6Eihq2wtEcAehggb_A_fXAuvitw',
};
