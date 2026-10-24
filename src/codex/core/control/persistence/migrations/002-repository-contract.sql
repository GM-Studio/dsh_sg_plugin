-- Keep 001 immutable: persist the reducer's artifact and transition evidence.
ALTER TABLE work_item
  ADD COLUMN artifact_hash CHAR(64) NULL,
  ADD COLUMN last_transition_json JSON NULL;

-- Transactional chain head: explicit sequences avoid AUTO_INCREMENT rollback gaps.
-- Every repository writer locks this singleton before changing durable state.
CREATE TABLE repository_head (
  singleton TINYINT NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL,
  entry_hash CHAR(64) NULL,
  PRIMARY KEY (singleton),
  CONSTRAINT chk_repository_singleton CHECK (singleton = 1)
) ENGINE=InnoDB;
INSERT INTO repository_head (singleton, sequence, entry_hash)
  SELECT 1, COALESCE(MAX(sequence), 0),
    (SELECT entry_hash FROM audit_log ORDER BY sequence DESC LIMIT 1)
  FROM audit_log;

-- Idempotency keys are case-sensitive opaque caller tokens.
ALTER TABLE decision MODIFY idempotency_key
  VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL;
