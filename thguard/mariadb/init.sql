CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    VARCHAR(200) NOT NULL,
  role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  created_at  DATETIME     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensors (
  id           VARCHAR(50)  PRIMARY KEY,
  mac          VARCHAR(20)  UNIQUE,
  kind         VARCHAR(20)  NOT NULL DEFAULT 'thguard',
  model        VARCHAR(30),
  fw           VARCHAR(30),
  name         VARCHAR(100) NOT NULL,
  location     VARCHAR(200) NOT NULL DEFAULT 'Sem localizacao',
  tag          VARCHAR(50),
  online       TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen    DATETIME,
  ip           VARCHAR(45),
  ssid         VARCHAR(100),
  temp_limit   FLOAT        NOT NULL DEFAULT 25,
  humid_limit  FLOAT        NOT NULL DEFAULT 80,
  alert_active TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_tags (
  user_id VARCHAR(36) NOT NULL,
  tag     VARCHAR(50) NOT NULL,
  PRIMARY KEY (user_id, tag),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Calibracao dos sensores industriais (VA01). Editada pelo painel, aba Industrial.
CREATE TABLE IF NOT EXISTS industrial_config (
  sensor_id   VARCHAR(50) NOT NULL PRIMARY KEY,
  range_min   DOUBLE NOT NULL DEFAULT 0,
  range_max   DOUBLE NOT NULL DEFAULT 150,
  v_full      DOUBLE NOT NULL DEFAULT 10,
  divisor     DOUBLE NOT NULL DEFAULT 5,
  offset_mv   DOUBLE NOT NULL DEFAULT -16,
  gain        DOUBLE NOT NULL DEFAULT 1,
  offset_temp DOUBLE NOT NULL DEFAULT 0,
  fault_v     DOUBLE NOT NULL DEFAULT 10.5,
  low_v       DOUBLE NOT NULL DEFAULT 0.05,
  interval_s  INT   NOT NULL DEFAULT 5,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sensor_alerts (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  sensor_id VARCHAR(50) NOT NULL,
  type      VARCHAR(50) NOT NULL,
  enabled   TINYINT(1)  NOT NULL DEFAULT 0,
  to_emails TEXT,
  cc        TEXT,
  bcc       TEXT,
  subject   TEXT,
  body      TEXT,
  UNIQUE KEY uq_sensor_type (sensor_id, type),
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_history (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  sensor_id VARCHAR(50) NOT NULL,
  type      VARCHAR(50) NOT NULL,
  ts        DATETIME    NOT NULL DEFAULT NOW(),
  to_emails TEXT,
  subject   TEXT,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS smtp_config (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  host      VARCHAR(200),
  port      INT         DEFAULT 587,
  user      VARCHAR(200),
  pass      VARCHAR(200),
  from_name VARCHAR(100) DEFAULT 'TH-GUARD'
);

INSERT IGNORE INTO smtp_config (id) VALUES (1);
