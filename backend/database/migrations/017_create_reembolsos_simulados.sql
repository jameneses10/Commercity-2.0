CREATE TABLE IF NOT EXISTS reembolsos_simulados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  devolucion_id INT UNSIGNED NOT NULL,
  pedido_id INT UNSIGNED NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reembolsos_devolucion_id (devolucion_id),
  KEY idx_reembolsos_pedido_id (pedido_id),
  CONSTRAINT chk_reembolsos_monto_no_negativo CHECK (monto >= 0),
  CONSTRAINT fk_reembolsos_devolucion
    FOREIGN KEY (devolucion_id)
    REFERENCES devoluciones(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_reembolsos_pedido
    FOREIGN KEY (pedido_id)
    REFERENCES pedidos(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
