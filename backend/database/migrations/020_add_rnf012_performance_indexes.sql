-- RNF-012: indices para los campos por los que se ordenan y buscan los listados
-- principales. Cada uno se añadio con una mejora MEDIDA sobre el SQL real que
-- ejecuta la API, capturado instrumentando el pool, no sobre consultas
-- reescritas a mano.
--
-- El patron era siempre el mismo: ORDER BY created_at DESC LIMIT 20 sin indice
-- de fecha obliga a recorrer la tabla completa y ordenarla entera para devolver
-- 20 filas. Con el indice, el filesort desaparece y las filas examinadas bajan
-- a ~20. Medido sobre un perfil de ~190.000 filas:
--
--   logs_acciones    ALL 29.896 filas + filesort  33,4 ms  ->  20 filas  0,8 ms   x43,6
--   productos (cat.) ALL 14.815 filas + filesort  32,2 ms  ->  23 filas  1,1 ms   x30,7
--   productos (adm.) ALL 14.782 filas + filesort  19,4 ms  ->  20 filas  0,7 ms   x28,3
--   resenas          ALL 12.000 filas + filesort  15,4 ms  ->  20 filas  0,7 ms   x21,7
--   envios           ALL 13.755 filas + filesort  14,4 ms  ->  20 filas  0,9 ms   x16,0
--   comisiones       ALL 13.000 filas + filesort  12,2 ms  ->  20 filas  0,8 ms   x16,0
--   pagos            ALL  7.768 filas + filesort   9,8 ms  ->  20 filas  0,8 ms   x11,9
--
-- productos lleva DOS indices a proposito: el catalogo publico ordena por
-- COALESCE(fecha_publicacion, created_at) y el listado del administrador por
-- created_at. Un indice funcional sobre la expresion no sirve para la columna
-- simple ni al contrario.
--
-- Quedan fuera, con evidencia:
--   devoluciones(creado_en)  el optimizador lo ignora incluso con LIMIT 20 y la
--                            mejora es x1,1: con 2.000 filas el scan gana.
--   productos(estado, COALESCE(...))  el compuesto resulto PEOR, 38,4 -> 53,2 ms.
--   usuarios(created_at)     mejora real pero inmaterial, 1,7 -> 0,5 ms.
--   LIKE '%texto%'           el comodin inicial impide usar un B-tree; FULLTEXT
--                            cambiaria la semantica de busqueda.
--   agregados del dashboard  COUNT global: el scan es inherente a la consulta.
--
-- No se declaran DESC: MySQL 8 recorre un B-tree ascendente en sentido inverso
-- para satisfacer ORDER BY ... DESC.
--
-- El runner (scripts/dbMigrate.js) no lleva registro de migraciones aplicadas y
-- vuelve a ejecutar todos los ficheros en cada invocacion, asi que cada CREATE
-- INDEX debe ser idempotente. Mismo patron que la 019.

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_logs_created_at ON logs_acciones (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs_acciones' AND INDEX_NAME = 'idx_logs_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_productos_publicacion_efectiva ON productos ((COALESCE(fecha_publicacion, created_at)))', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND INDEX_NAME = 'idx_productos_publicacion_efectiva');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_productos_created_at ON productos (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND INDEX_NAME = 'idx_productos_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_resenas_created_at ON resenas (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'resenas' AND INDEX_NAME = 'idx_resenas_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_envios_created_at ON envios (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'envios' AND INDEX_NAME = 'idx_envios_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_comisiones_created_at ON comisiones (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comisiones' AND INDEX_NAME = 'idx_comisiones_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_pagos_created_at ON pagos (created_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND INDEX_NAME = 'idx_pagos_created_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
