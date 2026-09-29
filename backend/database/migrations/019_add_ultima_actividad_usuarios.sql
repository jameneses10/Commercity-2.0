-- RF-288: marca de ultima actividad para el estado de conexion en el chat.
-- El runner no lleva registro de migraciones aplicadas y vuelve a ejecutar cada
-- archivo, por lo que el ALTER debe ser idempotente (mismo patron que 008).

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE usuarios ADD COLUMN ultima_actividad_at DATETIME NULL AFTER ultimo_login_at', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'ultima_actividad_at');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'CREATE INDEX idx_usuarios_ultima_actividad ON usuarios (ultima_actividad_at)', 'SELECT 1') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND INDEX_NAME = 'idx_usuarios_ultima_actividad');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
