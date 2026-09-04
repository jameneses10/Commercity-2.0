CREATE TABLE IF NOT EXISTS comprobantes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pedido_id INT UNSIGNED NOT NULL,
  pago_id INT UNSIGNED NOT NULL,
  numero VARCHAR(60) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_comprobantes_pago_id (pago_id),
  UNIQUE KEY uk_comprobantes_numero (numero),
  KEY idx_comprobantes_pedido_id (pedido_id),
  CONSTRAINT fk_comprobantes_pedidos FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_comprobantes_pagos FOREIGN KEY (pago_id) REFERENCES pagos(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
