CREATE TABLE IF NOT EXISTS reportes_tiendas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tienda_id INT UNSIGNED NOT NULL,
  usuario_reportante_id INT UNSIGNED NOT NULL,
  motivo VARCHAR(120) NOT NULL,
  descripcion TEXT NULL,
  estado ENUM('pendiente','revisado','rechazado','accionado') NOT NULL DEFAULT 'pendiente',
  respuesta_admin TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reporte_tienda_estado (tienda_id, usuario_reportante_id, estado),
  KEY idx_reportes_tiendas_tienda (tienda_id),
  KEY idx_reportes_tiendas_reportante (usuario_reportante_id),
  KEY idx_reportes_tiendas_estado (estado),
  CONSTRAINT fk_reportes_tiendas_tienda FOREIGN KEY (tienda_id) REFERENCES tiendas(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_reportes_tiendas_reportante FOREIGN KEY (usuario_reportante_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reportes_resenas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  resena_id INT UNSIGNED NOT NULL,
  usuario_reportante_id INT UNSIGNED NOT NULL,
  motivo VARCHAR(120) NOT NULL,
  descripcion TEXT NULL,
  estado ENUM('pendiente','revisado','rechazado','accionado') NOT NULL DEFAULT 'pendiente',
  respuesta_admin TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reporte_resena_estado (resena_id, usuario_reportante_id, estado),
  KEY idx_reportes_resenas_resena (resena_id),
  KEY idx_reportes_resenas_reportante (usuario_reportante_id),
  KEY idx_reportes_resenas_estado (estado),
  CONSTRAINT fk_reportes_resenas_resena FOREIGN KEY (resena_id) REFERENCES resenas(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_reportes_resenas_reportante FOREIGN KEY (usuario_reportante_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reportes_mensajes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mensaje_id INT UNSIGNED NOT NULL,
  usuario_reportante_id INT UNSIGNED NOT NULL,
  motivo VARCHAR(120) NULL,
  descripcion TEXT NULL,
  estado ENUM('pendiente','revisado','rechazado','accionado') NOT NULL DEFAULT 'pendiente',
  respuesta_admin TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reporte_mensaje_estado (mensaje_id, usuario_reportante_id, estado),
  KEY idx_reportes_mensajes_mensaje (mensaje_id),
  KEY idx_reportes_mensajes_reportante (usuario_reportante_id),
  KEY idx_reportes_mensajes_estado (estado),
  CONSTRAINT fk_reportes_mensajes_mensaje FOREIGN KEY (mensaje_id) REFERENCES mensajes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_reportes_mensajes_reportante FOREIGN KEY (usuario_reportante_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
