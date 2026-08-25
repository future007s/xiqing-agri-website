-- Management metadata is soft-deleted first. R2 bytes are only purged explicitly.
ALTER TABLE experiment_media ADD COLUMN deleted_at TEXT;
ALTER TABLE experiment_media ADD COLUMN deleted_by TEXT;
ALTER TABLE experiment_media ADD COLUMN delete_reason TEXT;

CREATE INDEX IF NOT EXISTS experiment_media_deleted_idx
  ON experiment_media (deleted_at, experiment_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS experiment_media_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('update', 'soft_delete', 'restore', 'purge')),
  actor TEXT NOT NULL DEFAULT 'media-admin',
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS experiment_media_audit_media_idx
  ON experiment_media_audit (media_id, created_at DESC);
