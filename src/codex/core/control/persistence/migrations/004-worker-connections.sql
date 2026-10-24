-- SpecGate AI Delivery Control Plane - M3 worker connection hardening
-- Preserve M1/M2 tables. worker and project_worker remain authoritative for
-- identity and project authorization; evidence_event remains authoritative for
-- accepted worker evidence. MySQL DDL implicitly commits.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE worker
  MODIFY token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD COLUMN token_rotated_at DATETIME(3) NULL AFTER token_hash,
  ADD COLUMN revoked_at DATETIME(3) NULL AFTER last_heartbeat_at,
  ADD KEY idx_worker_status_heartbeat (status, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS worker_command (
  command_id VARCHAR(128) NOT NULL,
  worker_id VARCHAR(128) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_json JSON NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dedupe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_by VARCHAR(256) NOT NULL,
  acked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (command_id),
  UNIQUE KEY uq_worker_command_sequence (worker_id, sequence),
  UNIQUE KEY uq_worker_command_dedupe (worker_id, dedupe_key),
  KEY idx_worker_command_dispatch (worker_id, acked_at, sequence),
  CONSTRAINT fk_worker_command_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id),
  CONSTRAINT chk_worker_command_kind CHECK (
    kind IN (
      'CLAIM','RUN_TYPED_OPERATION','UPLOAD_EVIDENCE',
      'APPLY_DECISION','RELEASE_LEASE','STOP'
    )
  ),
  CONSTRAINT chk_worker_command_payload CHECK (JSON_TYPE(payload_json) = 'OBJECT')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS worker_event (
  event_id VARCHAR(128) NOT NULL,
  worker_id VARCHAR(128) NOT NULL,
  dedupe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sanitized_payload_json JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_worker_event_dedupe (worker_id, dedupe_key),
  KEY idx_worker_event_replay (worker_id, received_at),
  CONSTRAINT fk_worker_event_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id),
  CONSTRAINT fk_worker_event_evidence FOREIGN KEY (event_id)
    REFERENCES evidence_event (event_id),
  CONSTRAINT chk_worker_event_payload CHECK (JSON_TYPE(sanitized_payload_json) = 'OBJECT')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS worker_audit (
  worker_audit_id VARCHAR(128) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  worker_id VARCHAR(128) NULL,
  event VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(256) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  command_id VARCHAR(128) NULL,
  detail_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (worker_audit_id),
  UNIQUE KEY uq_worker_audit_sequence (sequence),
  KEY idx_worker_audit_worker_time (worker_id, sequence),
  KEY idx_worker_audit_event_time (event, created_at),
  CONSTRAINT fk_worker_audit_worker FOREIGN KEY (worker_id) REFERENCES worker (worker_id),
  CONSTRAINT chk_worker_audit_event CHECK (
    event IN (
      'WORKER_CREATED','WORKER_UPDATED','WORKER_TOKEN_ROTATED','WORKER_REVOKED',
      'WORKER_PROJECTS_CHANGED','WORKER_SEEN','WORKER_OFFLINE',
      'WORKER_COMMAND_ENQUEUED','WORKER_COMMAND_ACKED','WORKER_COMMAND_REJECTED',
      'WORKER_EVENT_ACCEPTED','WORKER_EVENT_REJECTED',
      'worker.offline','worker.register','worker.token.rotate','worker.revoke',
      'worker.projects.update','worker.connect','worker.claim.deny','worker.claim',
      'worker.heartbeat','worker.release','worker.event.rejected',
      'worker.event.accepted','worker.event.replay','worker.command.rejected',
      'worker.command.issue','worker.command.ack'
    )
  ),
  CONSTRAINT chk_worker_audit_actor CHECK (
    actor_type IN ('user','worker','system','channel')
  ),
  CONSTRAINT chk_worker_audit_outcome CHECK (outcome IN ('success','failure')),
  CONSTRAINT chk_worker_audit_detail CHECK (JSON_TYPE(detail_json) = 'OBJECT')
) ENGINE=InnoDB;

CREATE TRIGGER worker_audit_no_update
BEFORE UPDATE ON worker_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'worker_audit is append-only';

CREATE TRIGGER worker_audit_no_delete
BEFORE DELETE ON worker_audit
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'worker_audit is append-only';
