CREATE TABLE IF NOT EXISTS configuracion_plataforma (
  id TINYINT UNSIGNED NOT NULL,
  porcentaje_comision DECIMAL(5,2) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_configuracion_plataforma_porcentaje
    CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

INSERT INTO configuracion_plataforma (id, porcentaje_comision)
VALUES (1, 10.00)
ON DUPLICATE KEY UPDATE id = id;
