-- RF-208: add the canonical "producto recibido" state to devoluciones.estado
ALTER TABLE `devoluciones`
MODIFY COLUMN `estado` ENUM(
  'solicitada',
  'en_revision',
  'aprobada',
  'rechazada',
  'producto_recibido',
  'reembolso_simulado',
  'cerrada'
) NOT NULL DEFAULT 'solicitada';
