-- Media bytes live in R2. D1 keeps the searchable association and review state.
CREATE TABLE IF NOT EXISTS experiment_media (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  src TEXT NOT NULL,
  poster TEXT,
  thumbnail TEXT,
  captured_at TEXT NOT NULL,
  event_id TEXT,
  plant_id TEXT,
  caption TEXT NOT NULL,
  alt TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS experiment_media_public_idx
  ON experiment_media (experiment_id, visibility, review_status, captured_at DESC);

CREATE INDEX IF NOT EXISTS experiment_media_event_idx
  ON experiment_media (event_id);

CREATE INDEX IF NOT EXISTS experiment_media_plant_idx
  ON experiment_media (plant_id);
