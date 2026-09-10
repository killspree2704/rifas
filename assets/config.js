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
  fechaSorteo: '2026-09-11T18:00:00-06:00',
  zonaHoraria: 'America/Mexico_City',

  supabaseUrl: 'https://fgwavuaolmrwagaymgos.supabase.co',
  supabaseKey: 'sb_publishable_x6KN6Eihq2wtEcAehggb_A_fXAuvitw',
};
