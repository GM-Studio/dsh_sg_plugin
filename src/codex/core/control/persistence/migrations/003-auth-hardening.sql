-- SpecGate AI Delivery Control Plane - M2 authentication hardening
-- Preserve the M1 tables. MySQL DDL implicitly commits, so migration failures
-- must be inspected against schema_migration and the actual table structure.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Usernames are case-sensitive even when the database default collation is not.
ALTER TABLE control_user
  ADD COLUMN username VARCHAR(128) NULL AFTER user_id,
  ADD COLUMN totp_enrolled_at DATETIME(3) NULL AFTER totp_secret_ciphertext,
  ADD COLUMN totp_enrollment_required TINYINT(1) NOT NULL DEFAULT 1
    AFTER totp_enrolled_at,
  ADD COLUMN totp_last_used_counter BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER totp_enrollment_required;

UPDATE control_user SET username = user_id WHERE username IS NULL;

ALTER TABLE control_user
  MODIFY username VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  ADD UNIQUE KEY uq_control_user_username (username),
  ADD KEY idx_control_user_totp_enrollment (totp_enrollment_required, totp_enrolled_at);

ALTER TABLE control_user DROP CHECK chk_control_user_role;
ALTER TABLE control_user
  ADD CONSTRAINT chk_control_user_role CHECK (
    role IN ('owner','operator','approver','viewer','customer_acceptor')
  );

ALTER TABLE auth_session
  ADD COLUMN last_seen_at DATETIME(3) NULL AFTER expires_at,
  ADD KEY idx_session_device_status (device_id, status, expires_at);

CREATE TABLE IF NOT EXISTS auth_challenge (
  challenge_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  session_id VARCHAR(128) NULL,
  device_id VARCHAR(128) NULL,
  challenge_type VARCHAR(32) NOT NULL DEFAULT 'STEP_UP',
  action VARCHAR(128) NULL,
  resource_id VARCHAR(256) NULL,
  proof_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  proof_expires_at DATETIME(3) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  proof_consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (challenge_id),
  UNIQUE KEY uq_auth_challenge_proof (proof_hash),
  KEY idx_auth_challenge_user_status (user_id, status, expires_at),
  KEY idx_auth_challenge_session_status (session_id, status, expires_at),
  KEY idx_auth_challenge_device_status (device_id, status, expires_at),
  CONSTRAINT fk_auth_challenge_user FOREIGN KEY (user_id) REFERENCES control_user (user_id),
  CONSTRAINT fk_auth_challenge_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT chk_auth_challenge_type CHECK (
    challenge_type IN ('PASSWORD','TOTP_ENROLLMENT','STEP_UP','NEW_DEVICE')
  ),
  CONSTRAINT chk_auth_challenge_status CHECK (
    status IN ('PENDING','PROOF_READY','PROOF_CONSUMED','CONSUMED','EXPIRED','REVOKED')
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attention_nonce (
  nonce_id VARCHAR(128) NOT NULL,
  attention_id VARCHAR(128) NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  redeemed_at DATETIME(3) NULL,
  redeemed_by_user_id VARCHAR(128) NULL,
  redeemed_by_session_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (nonce_id),
  UNIQUE KEY uq_attention_nonce_hash (token_hash),
  KEY idx_attention_nonce_expiry (expires_at),
  CONSTRAINT fk_attention_nonce_attention FOREIGN KEY (attention_id)
    REFERENCES attention (attention_id),
  CONSTRAINT chk_attention_nonce_status CHECK (
    status IN ('ACTIVE','CONSUMED','EXPIRED')
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_rate_limit (
  rate_limit_id VARCHAR(128) NOT NULL,
  scope VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rate_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at DATETIME(3) NOT NULL,
  reset_at DATETIME(3) NOT NULL,
  blocked_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (rate_limit_id),
  UNIQUE KEY uq_auth_rate_limit_key (scope, rate_key_hash),
  KEY idx_auth_rate_limit_reset (reset_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_audit (
  auth_audit_id VARCHAR(128) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event VARCHAR(128) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  actor_id VARCHAR(256) NOT NULL,
  user_id VARCHAR(128) NULL,
  session_id VARCHAR(64) NULL,
  device_id VARCHAR(128) NULL,
  attention_id VARCHAR(256) NULL,
  source_ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_agent_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  detail_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (auth_audit_id),
  UNIQUE KEY uq_auth_audit_sequence (sequence),
  KEY idx_auth_audit_actor_time (actor_id, created_at),
  KEY idx_auth_audit_user_time (user_id, created_at),
  KEY idx_auth_audit_event_time (event, created_at),
  CONSTRAINT chk_auth_audit_action CHECK (
    event IN (
      'AUTH_LOGIN_SUCCESS','AUTH_LOGIN_FAILURE','AUTH_LOGIN_FAILED',
      'AUTH_TOTP_SUCCESS','AUTH_TOTP_FAILURE','AUTH_TOTP_REPLAY',
      'AUTH_DEVICE_REGISTERED','AUTH_DEVICE_REVOKED',
      'AUTH_SESSION_CREATED','AUTH_SESSION_REVOKED','AUTH_SESSION_EXPIRED',
      'AUTH_CHALLENGE_CREATED','AUTH_CHALLENGE_CONSUMED','AUTH_CHALLENGE_FAILED',
      'AUTH_NONCE_CREATED','AUTH_NONCE_CONSUMED','AUTH_NONCE_REJECTED',
      'AUTH_RATE_LIMITED',
      'LOGIN_SUCCESS','LOGIN_FAILURE','TOTP_SUCCESS','TOTP_FAILURE','TOTP_REPLAY',
      'DEVICE_REGISTERED','DEVICE_REVOKED','SESSION_CREATED','SESSION_REVOKED',
      'CHALLENGE_CREATED','CHALLENGE_CONSUMED','NONCE_CREATED','NONCE_CONSUMED',
      'RATE_LIMITED',
      'owner_initialized','user_created','rate_limited','totp_failed','totp_replayed',
      'login_failed','login_succeeded','device_enrollment_failed','device_enrolled',
      'session_rejected','csrf_failed','step_up_challenge_created','step_up_failed',
      'step_up_completed','step_up_authorization_failed','step_up_authorized',
      'device_revocation_failed','device_revoked','attention_nonce_issued',
      'attention_nonce_redeemed','logout'
    )
  ),
  CONSTRAINT chk_auth_audit_outcome CHECK (outcome IN ('success','failure'))
) ENGINE=InnoDB;

-- Single-statement trigger bodies keep the migration compatible with the
-- repository's statement-aware migrator.
CREATE TRIGGER auth_audit_no_update
BEFORE UPDATE ON auth_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auth_audit is append-only';

CREATE TRIGGER auth_audit_no_delete
BEFORE DELETE ON auth_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auth_audit is append-only';
