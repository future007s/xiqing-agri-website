-- Ten-minute public projection; source of truth remains PostgreSQL/TimescaleDB.
CREATE TABLE IF NOT EXISTS telemetry_10m (
	metric TEXT NOT NULL,
	metric_label TEXT NOT NULL,
	unit TEXT NOT NULL,
	bucket_start TEXT NOT NULL,
	sensor_id TEXT NOT NULL,
	installation_id TEXT NOT NULL,
	sensor_label TEXT NOT NULL,
	device_id TEXT NOT NULL,
	device_label TEXT NOT NULL,
	site_kind TEXT NOT NULL,
	site_id TEXT NOT NULL,
	site_label TEXT NOT NULL,
	value_avg REAL,
	value_min REAL,
	value_max REAL,
	valid_count INTEGER NOT NULL DEFAULT 0,
	total_count INTEGER NOT NULL DEFAULT 0,
	quality TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (metric, bucket_start, sensor_id, installation_id)
);

CREATE INDEX IF NOT EXISTS telemetry_10m_metric_bucket_idx
	ON telemetry_10m(metric, bucket_start);
CREATE INDEX IF NOT EXISTS telemetry_10m_device_idx
	ON telemetry_10m(metric, device_id, bucket_start);
CREATE INDEX IF NOT EXISTS telemetry_10m_site_idx
	ON telemetry_10m(metric, site_id, bucket_start);
