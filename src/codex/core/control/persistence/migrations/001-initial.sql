-- SpecGate AI Delivery Control Plane - MySQL 8.0+ schema
-- M1 baseline. The migrator requests a transaction, but MySQL DDL implicitly commits.
-- On failure, inspect schema_migration and the actual table structure before retrying.
-- Every table uses utf8mb4 and UTC timestamps.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schema_migration (
  migration_id VARCHAR(128) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (migration_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS control_user (
  user_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(256) NOT NULL,
  password_hash VARCHAR(512) NOT NULL,
  totp_secret_ciphertext TEXT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'owner',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id),
  CONSTRAINT chk_control_user_role CHECK (role IN ('owner','operator','viewer')),
  CONSTRAINT chk_control_user_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS device (
  device_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(256) NOT NULL,
  public_key_fingerprint CHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  last_seen_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id),
  KEY idx_device_user_status (user_id, status),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES control_user (user_id),
  CONSTRAINT chk_device_status CHECK (status IN ('ACTIVE','REVOKED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_session (
  session_id CHAR(64) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  auth_level VARCHAR(32) NOT NULL DEFAULT 'session',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_session_token (token_hash),
  KEY idx_session_user_status (user_id, status),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES control_user (user_id),
  CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT chk_session_auth_level CHECK (auth_level IN ('session','step-up')),
  CONSTRAINT chk_session_status CHECK (status IN ('ACTIVE','REVOKED','EXPIRED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project (
  project_id VARCHAR(128) NOT NULL,
  name VARCHAR(256) NOT NULL,
  root_hash CHAR(64) NOT NULL,
  control_mode VARCHAR(32) NOT NULL DEFAULT 'aggregate',
  status VARCHAR(32) NOT NULL DEFAULT 'READY',
  evidence_retention_days INT UNSIGNED NOT NULL DEFAULT 7,
  notification_retention_days INT UNSIGNED NOT NULL DEFAULT 30,
  decision_retention_days INT UNSIGNED NOT NULL DEFAULT 365,
  audit_retention_days INT UNSIGNED NOT NULL DEFAULT 365,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id),
  UNIQUE KEY uq_project_root_hash (root_hash),
  CONSTRAINT chk_project_mode CHECK (control_mode IN ('aggregate','isolated')),
  CONSTRAINT chk_project_status CHECK (status IN ('READY','DISABLED','ARCHIVED')),
  CONSTRAINT chk_project_retention CHECK (
    evidence_retention_days BETWEEN 1 AND 3650 AND
    notification_retention_days BETWEEN 1 AND 3650 AND
    decision_retention_days BETWEEN 1 AND 3650 AND
    audit_retention_days BETWEEN 1 AND 3650
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS worker (
  worker_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(256) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
  capabilities_json JSON NOT NULL,
  last_heartbeat_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (worker_id),
  UNIQUE KEY uq_worker_token (token_hash),
  CONSTRAINT chk_worker_status CHECK (status IN ('ONLINE','OFFLINE','INTERRUPTED','SUSPECT','REVOKED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_worker (
  project_id VARCHAR(128) NOT NULL,
  worker_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (project_id, worker_id),
  CONSTRAINT fk_project_worker_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT fk_project_worker_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS work_item (
  work_item_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  title VARCHAR(256) NOT NULL,
  request_text MEDIUMTEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  execution_state VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
  business_milestone VARCHAR(32) NOT NULL DEFAULT 'PROJECT_READY',
  host_health VARCHAR(32) NOT NULL DEFAULT 'ONLINE',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  current_run_id VARCHAR(128) NULL,
  current_attention_id VARCHAR(128) NULL,
  budget_json JSON NOT NULL,
  budget_usage_json JSON NOT NULL,
  outcome_json JSON NULL,
  next_owner VARCHAR(16) NOT NULL DEFAULT 'system',
  next_action VARCHAR(4000) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (work_item_id),
  KEY idx_work_item_queue (project_id, execution_state, priority, created_at),
  CONSTRAINT fk_work_item_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT chk_work_item_priority CHECK (priority IN ('high','normal','low')),
  CONSTRAINT chk_work_item_state CHECK (execution_state IN (
    'QUEUED','RUNNING','WAITING_FOR_USER','PAUSED','BLOCKED','FAILED',
    'DECIDED_PENDING_APPLY','RESUMING','DELIVERING','COMPLETED','CANCELLED'
  )),
  CONSTRAINT chk_work_item_host CHECK (host_health IN ('ONLINE','OFFLINE','INTERRUPTED','SUSPECT')),
  CONSTRAINT chk_work_item_owner CHECK (next_owner IN ('ai','user','system','none'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS execution_run (
  run_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  worker_id VARCHAR(128) NOT NULL,
  execution_state VARCHAR(32) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  session_id VARCHAR(256) NULL,
  checkpoint_json JSON NULL,
  budget_usage_json JSON NOT NULL,
  started_at DATETIME(3) NOT NULL,
  last_heartbeat_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  error_json JSON NULL,
  PRIMARY KEY (run_id),
  KEY idx_run_work_item (work_item_id, started_at),
  KEY idx_run_worker (worker_id, execution_state),
  CONSTRAINT fk_run_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_run_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id),
  CONSTRAINT chk_run_state CHECK (execution_state IN (
    'RUNNING','WAITING_FOR_USER','PAUSED','BLOCKED','FAILED','INTERRUPTED','COMPLETED','CANCELLED'
  ))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lease (
  lease_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  run_id VARCHAR(128) NOT NULL,
  worker_id VARCHAR(128) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  acquired_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  released_at DATETIME(3) NULL,
  active_project_id VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN released_at IS NULL THEN project_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (lease_id),
  UNIQUE KEY uq_lease_project_active (active_project_id),
  UNIQUE KEY uq_lease_run (run_id),
  KEY idx_lease_expiry (expires_at),
  CONSTRAINT fk_lease_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT fk_lease_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_lease_run FOREIGN KEY (run_id) REFERENCES execution_run (run_id),
  CONSTRAINT fk_lease_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attention (
  attention_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  scope VARCHAR(256) NOT NULL,
  attention_key CHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  previous_attention_id VARCHAR(128) NULL,
  attention_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason_text VARCHAR(4000) NOT NULL,
  question_text VARCHAR(4000) NOT NULL,
  actions_json JSON NOT NULL,
  summary_text TEXT NOT NULL,
  risks_json JSON NOT NULL,
  evidence_json JSON NOT NULL,
  artifact_hash CHAR(64) NOT NULL,
  work_item_version BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  decision_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  decided_at DATETIME(3) NULL,
  PRIMARY KEY (attention_id),
  UNIQUE KEY uq_attention_revision (work_item_id, attention_key, revision),
  KEY idx_attention_inbox (status, expires_at),
  CONSTRAINT fk_attention_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_attention_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT chk_attention_type CHECK (attention_type IN (
    'H1_APPROVAL','H3_APPROVAL','CLARIFICATION','BLOCKED','FAILED','OFFLINE','BUDGET',
    'CUSTOMER_ACCEPTANCE','COMPLETION'
  )),
  CONSTRAINT chk_attention_status CHECK (status IN (
    'OPEN','DELIVERED','REMINDED','ESCALATED','DECIDED','RESOLVED','EXPIRED','SUPERSEDED','CANCELLED'
  ))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS decision (
  decision_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  attention_id VARCHAR(128) NOT NULL,
  scope VARCHAR(256) NOT NULL,
  attention_revision BIGINT UNSIGNED NOT NULL,
  expected_work_item_version BIGINT UNSIGNED NOT NULL,
  artifact_hash CHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(256) NOT NULL,
  actor_id VARCHAR(256) NOT NULL,
  actor_source VARCHAR(32) NOT NULL,
  auth_level VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RECORDED',
  created_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  applied_at DATETIME(3) NULL,
  applied_by VARCHAR(256) NULL,
  PRIMARY KEY (decision_id),
  UNIQUE KEY uq_decision_idempotency (idempotency_key),
  KEY idx_decision_work_item (work_item_id, created_at),
  CONSTRAINT fk_decision_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_decision_attention FOREIGN KEY (attention_id) REFERENCES attention (attention_id),
  CONSTRAINT chk_decision_action CHECK (action IN (
    'approve','request_changes','answer','pause','resume','retry','cancel','accept_delivery'
  )),
  CONSTRAINT chk_decision_status CHECK (status IN (
    'RECORDED','PENDING_APPLY','APPLYING','APPLIED','STALE','REJECTED'
  ))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS evidence_event (
  event_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NULL,
  run_id VARCHAR(128) NULL,
  event_type VARCHAR(128) NOT NULL,
  source VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id),
  KEY idx_evidence_payload_hash (project_id, payload_hash),
  KEY idx_evidence_timeline (work_item_id, occurred_at),
  KEY idx_evidence_retention (project_id, received_at),
  CONSTRAINT fk_evidence_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT fk_evidence_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_evidence_run FOREIGN KEY (run_id) REFERENCES execution_run (run_id),
  CONSTRAINT chk_evidence_source CHECK (source IN ('worker','web','feishu','dingtalk','cli','system','api'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_delivery (
  delivery_id VARCHAR(128) NOT NULL,
  attention_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  recipient_hash CHAR(64) NOT NULL,
  notification_kind VARCHAR(32) NOT NULL,
  notification_version BIGINT UNSIGNED NOT NULL,
  dedupe_key CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  next_attempt_at DATETIME(3) NOT NULL,
  lease_owner VARCHAR(256) NULL,
  lease_expires_at DATETIME(3) NULL,
  last_error_json JSON NULL,
  receipt_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (delivery_id),
  UNIQUE KEY uq_notification_dedupe (dedupe_key),
  KEY idx_notification_dispatch (status, next_attempt_at),
  CONSTRAINT fk_notification_attention FOREIGN KEY (attention_id) REFERENCES attention (attention_id),
  CONSTRAINT fk_notification_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT chk_notification_channel CHECK (channel IN ('feishu','dingtalk','webhook')),
  CONSTRAINT chk_notification_kind CHECK (notification_kind IN ('attention','reminder','escalation','resolution')),
  CONSTRAINT chk_notification_status CHECK (status IN ('PENDING','SENDING','SENT','FAILED','CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery (
  delivery_id VARCHAR(128) NOT NULL,
  work_item_id VARCHAR(128) NOT NULL,
  parent_delivery_id VARCHAR(128) NULL,
  artifact_hash CHAR(64) NOT NULL,
  verification_json JSON NOT NULL,
  unexecuted_checks_json JSON NOT NULL,
  rollback_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  accepted_by VARCHAR(256) NULL,
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (delivery_id),
  KEY idx_delivery_work_item (work_item_id, created_at),
  CONSTRAINT fk_delivery_work_item FOREIGN KEY (work_item_id) REFERENCES work_item (work_item_id),
  CONSTRAINT fk_delivery_parent FOREIGN KEY (parent_delivery_id) REFERENCES delivery (delivery_id),
  CONSTRAINT chk_delivery_status CHECK (status IN ('DRAFT','READY','ACCEPTED','REJECTED','SUPERSEDED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id VARCHAR(128) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id VARCHAR(128) NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(256) NOT NULL,
  action VARCHAR(128) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  detail_json JSON NOT NULL,
  previous_hash CHAR(64) NULL,
  entry_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (audit_id),
  UNIQUE KEY uq_audit_sequence (sequence),
  UNIQUE KEY uq_audit_entry_hash (entry_hash),
  KEY idx_audit_object (object_type, object_id, sequence),
  KEY idx_audit_project_time (project_id, created_at),
  CONSTRAINT fk_audit_project FOREIGN KEY (project_id) REFERENCES project (project_id),
  CONSTRAINT chk_audit_actor CHECK (actor_type IN ('user','worker','system','channel')),
  CONSTRAINT chk_audit_action CHECK (action IN (
    'CREATE','UPDATE','DELETE','DECIDE','APPLY','CANCEL','EXPIRE','NOTIFY','REVOKE','MIGRATE','RETENTION_PURGE'
  ))
) ENGINE=InnoDB;

