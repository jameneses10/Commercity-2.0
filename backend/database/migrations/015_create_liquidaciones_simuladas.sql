CREATE TABLE IF NOT EXISTS liquidaciones_simuladas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  comision_id INT UNSIGNED NOT NULL,
  valor_liquidado DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_liquidaciones_comision_id (comision_id),
  CONSTRAINT chk_liquidaciones_valor_no_negativo CHECK (valor_liquidado >= 0),
  CONSTRAINT fk_liquidaciones_comisiones FOREIGN KEY (comision_id) REFERENCES comisiones(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

INSERT INTO liquidaciones_simuladas (comision_id, valor_liquidado, created_at)
SELECT c.id, c.valor_vendedor, c.created_at
FROM comisiones c
WHERE NOT EXISTS (
  SELECT 1 FROM liquidaciones_simuladas l WHERE l.comision_id = c.id
);
