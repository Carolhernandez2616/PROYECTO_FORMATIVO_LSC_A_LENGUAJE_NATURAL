-- Manos que Hablan · Base de datos MySQL 8
CREATE DATABASE IF NOT EXISTS manos_que_hablan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE manos_que_hablan;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  pass VARCHAR(255) NOT NULL,                   -- scrypt con sal (s1$...). Hashes SHA-256 antiguos se migran al iniciar sesión
  pw_changed BIGINT NOT NULL DEFAULT 0,         -- al cambiar la contraseña se invalidan las sesiones anteriores
  role ENUM('sordo','oyente','admin') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS presence (
  user_id BIGINT PRIMARY KEY,
  last BIGINT NOT NULL,
  online TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  owner BIGINT NOT NULL,
  names TEXT NULL,                              -- nombre del chat por persona (JSON)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(40) PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  uid BIGINT NULL,
  from_role VARCHAR(10) NULL,
  sordo TEXT NULL,                              -- versión en LSC (S-O-V)
  oyente TEXT NULL,                             -- versión en español (S-V-O)
  orig TEXT NULL,
  src VARCHAR(5) NULL,
  t BIGINT NULL,
  type VARCHAR(10) NULL,                        -- 'call' = registro de videollamada
  dur INT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  edited TINYINT(1) NOT NULL DEFAULT 0,
  fwd TINYINT(1) NOT NULL DEFAULT 0,
  audio LONGTEXT NULL,
  hidden_for TEXT NULL,                         -- JSON con ids de usuarios
  INDEX idx_msg_chat (chat_id, t),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS glossary (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  es VARCHAR(255) NOT NULL,
  lsc VARCHAR(255) NOT NULL,
  cat VARCHAR(60) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT PRIMARY KEY,
  uid VARCHAR(40) NOT NULL,                     -- id de usuario o 'ejemplo'
  name VARCHAR(120) NOT NULL,
  role VARCHAR(10) NOT NULL,
  text TEXT NOT NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT PRIMARY KEY,
  post_id BIGINT NOT NULL,
  parent_id BIGINT NULL,
  uid VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(10) NOT NULL,
  text TEXT NOT NULL,
  INDEX idx_cm_parent (parent_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reactions (
  kind CHAR(1) NOT NULL,                        -- 'p' publicación · 'c' comentario
  target_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  type VARCHAR(10) NOT NULL,                    -- 'like' | 'love'
  PRIMARY KEY (kind, target_id, user_id, type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contacts (
  id BIGINT PRIMARY KEY,
  uid BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  role VARCHAR(40) NULL,
  urole VARCHAR(10) NULL,
  subject VARCHAR(160) NULL,
  message TEXT NOT NULL,
  wants_lsc TINYINT(1) NOT NULL DEFAULT 0,
  has_reply TINYINT(1) NOT NULL DEFAULT 0,
  reply_text TEXT NULL,
  reply_t BIGINT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact_id BIGINT NOT NULL,
  type VARCHAR(10) NOT NULL,                    -- 'image' | 'video'
  src LONGTEXT NOT NULL,
  name VARCHAR(190) NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,                 -- solo se guarda el hash del enlace de recuperación
  expires BIGINT NOT NULL,
  UNIQUE KEY uq_token (token_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- La publicación de ejemplo (Karol) y el usuario administrador los crea server.js al iniciar (ver ADMIN_EMAIL y ADMIN_PASSWORD en .env).
