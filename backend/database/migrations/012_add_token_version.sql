-- #103: el migrador no lleva historial y reejecuta todos los ficheros. Este
-- ADD COLUMN iba desnudo, de modo que sobre una base ya migrada moria con
-- ERROR 1060 (Duplicate column name). Como dbMigrate.js no aisla el fallo por
-- fichero —el primer rechazo cae al .catch global y hace process.exit(1)—, la
-- ejecucion se detenia aqui y las migraciones 013..020 no llegaban a correr.
-- Medido: sobre una copia de la base operativa el migrador salia con codigo 1
-- y la base se quedaba en 36 tablas.
--
-- Se decide por la definicion real de la columna, no solo por su presencia:
--   ausente              -> se crea con la definicion canonica
--   definicion canonica  -> no se toca
--   definicion distinta  -> se aborta sin sobrescribirla
--
-- El tercer caso no se resuelve con SIGNAL: dentro de una sentencia preparada
-- MySQL responde ERROR 1295. Se emite en su lugar un identificador inexistente
-- cuyo nombre es el mensaje, que es el mismo recurso que usa la migracion 020.

SET @def_actual = (SELECT CONCAT(COLUMN_TYPE, '|', IS_NULLABLE, '|', IFNULL(COLUMN_DEFAULT, '~'))
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'token_version');

SET @def_canonica = 'int|NO|0';

SET @sql = CASE
  WHEN @def_actual IS NULL THEN
    'ALTER TABLE usuarios ADD COLUMN token_version INT NOT NULL DEFAULT 0'
  WHEN @def_actual = @def_canonica THEN
    'SELECT 1'
  ELSE
    'SELECT `ABORTADO: usuarios.token_version existe con una definicion distinta de INT NOT NULL DEFAULT 0; revisela a mano antes de migrar`'
END;
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
