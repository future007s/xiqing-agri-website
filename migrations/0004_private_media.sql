-- Existing object URLs stay in the database for recovery, but are quarantined by the API.
-- Do not bind the old public bucket as MEDIA_PRIVATE_BUCKET. See the deployment runbook.
ALTER TABLE experiment_media ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'legacy_public'
  CHECK (storage_backend IN ('legacy_public', 'private_r2'));
ALTER TABLE experiment_media ADD COLUMN purge_state TEXT NOT NULL DEFAULT 'active'
  CHECK (purge_state IN ('active', 'purging'));

-- One canonical record per byte-identical file within an experiment. Across experiments
-- records own separate unique objects: there are no shared blobs or reference-count races.
CREATE UNIQUE INDEX experiment_media_private_checksum_idx
  ON experiment_media (experiment_id, checksum) WHERE storage_backend = 'private_r2';
