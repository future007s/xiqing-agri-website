-- 官网 D1 公开追溯读模型（设计草案；尚未部署）。
--
-- PostgreSQL + TimescaleDB 是生产追溯事实源。
-- D1 只保存经过审核并明确批准发布到官网的摘要。
-- D1 不得成为高频遥测存储或控制路径。

PRAGMA foreign_keys = ON;

-- 实验仍是可选的研发上下文，不是生产、采收、包装、检验、召回或订单事实的父身份。
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('preparing', 'running', 'completed', 'failed', 'paused')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  source TEXT NOT NULL DEFAULT 'markdown'
    CHECK (source IN ('markdown', 'api', 'import')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(id) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS experiments_status_idx
  ON experiments (status, start_date DESC);

-- 每行是一个经批准的生产批次公开投影。内部 UUID 永不对外暴露；
-- `business_id` 保持稳定，`display_id` 可在不破坏内部追溯关系的前提下更改。
CREATE TABLE IF NOT EXISTS published_production_batches (
  business_id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'planned', 'active', 'suspended', 'ended', 'closed', 'cancelled', 'void')
  ),
  farm_business_id TEXT NOT NULL,
  crop_cycle_business_id TEXT NOT NULL,
  source_experiment_id TEXT,
  member_resolution TEXT NOT NULL CHECK (
    member_resolution IN ('entity_exact', 'set_exact', 'batch_scope', 'unknown')
  ),
  declared_member_count INTEGER,
  started_at TEXT,
  planned_harvest_at TEXT,
  ended_at TEXT,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_experiment_id) REFERENCES experiments(id) ON UPDATE CASCADE,
  CHECK (declared_member_count IS NULL OR declared_member_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS published_production_batches_display_idx
  ON published_production_batches (display_id);

CREATE INDEX IF NOT EXISTS published_production_batches_status_idx
  ON published_production_batches (status, published_at DESC);

-- 各语言文案与批次身份分开保存。中英文共享同一条血缘记录，
-- 不会争用同一业务键或逐渐变成两个独立批次。
CREATE TABLE IF NOT EXISTS published_production_batch_localizations (
  production_batch_id TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('zh-CN', 'en')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  farm_name TEXT NOT NULL,
  location_label TEXT,
  crop_name TEXT NOT NULL,
  cultivar_name TEXT,
  crop_cycle_label TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (production_batch_id, locale),
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE (locale, slug)
);

-- 带时间有效性的公开拓扑标签。它们是生产关系的投影，不是第二套资产清册。
CREATE TABLE IF NOT EXISTS published_batch_topology (
  id TEXT PRIMARY KEY,
  production_batch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('zone', 'tower', 'nutrient_loop')),
  entity_business_id TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  source_revision TEXT NOT NULL,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS published_batch_topology_unique_idx
  ON published_batch_topology (production_batch_id, entity_type, entity_business_id, valid_from);

-- 已审核的生产事件。更正通过引用 `corrects_event_id` 的新事件表达；
-- 已发布历史绝不覆盖。
CREATE TABLE IF NOT EXISTS published_trace_events (
  id TEXT PRIMARY KEY,
  production_batch_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (
    resolution IN ('entity_exact', 'set_exact', 'batch_scope', 'shared_exposure', 'mass_balance_allocation', 'derived', 'unknown')
  ),
  source_scope_type TEXT NOT NULL,
  source_scope_id TEXT NOT NULL,
  corrects_event_id TEXT,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (corrects_event_id) REFERENCES published_trace_events(id) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS published_trace_events_batch_time_idx
  ON published_trace_events (production_batch_id, occurred_at DESC);

-- 此处只复制已审核的低频摘要。真实传感器安装关系、原始样本、
-- 聚合数据和来源信息保留在 TimescaleDB。
CREATE TABLE IF NOT EXISTS published_measurement_summaries (
  id TEXT PRIMARY KEY,
  production_batch_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  unit TEXT,
  measured_at TEXT,
  window_start TEXT,
  window_end TEXT,
  sample_count INTEGER,
  quality TEXT NOT NULL CHECK (quality IN ('observed', 'partial', 'pending', 'invalid')),
  resolution TEXT NOT NULL CHECK (
    resolution IN ('entity_exact', 'set_exact', 'batch_scope', 'shared_exposure', 'mass_balance_allocation', 'derived', 'unknown')
  ),
  source_scope_type TEXT NOT NULL CHECK (
    source_scope_type IN ('zone', 'nutrient_loop', 'tower', 'position', 'plant_instance', 'production_batch')
  ),
  source_scope_id TEXT NOT NULL,
  source_measurement_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (value_num IS NOT NULL OR value_text IS NOT NULL),
  CHECK (sample_count IS NULL OR sample_count >= 0),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start)
);

CREATE INDEX IF NOT EXISTS published_measurements_batch_time_idx
  ON published_measurement_summaries (production_batch_id, metric_key, measured_at DESC);

-- 检验适用范围必须明确。批次结果不得静默变成单株结果，
-- 也不得扩展到其血缘范围以外。
CREATE TABLE IF NOT EXISTS published_inspections (
  id TEXT PRIMARY KEY,
  production_batch_id TEXT NOT NULL,
  inspection_type TEXT NOT NULL,
  inspected_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pending', 'passed', 'failed', 'inconclusive')),
  scope_type TEXT NOT NULL,
  scope_business_id TEXT NOT NULL,
  sample_description TEXT,
  summary TEXT NOT NULL,
  report_url TEXT,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS published_inspections_batch_time_idx
  ON published_inspections (production_batch_id, inspected_at DESC);

-- 采收批次与生产批次相互独立。来源采用多对多关系，
-- 使跨批采收和部分采收保持可见。
CREATE TABLE IF NOT EXISTS published_harvest_batches (
  business_id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'open', 'quarantined', 'released', 'failed', 'consumed', 'closed', 'void')
  ),
  harvested_at TEXT,
  quantity_value REAL,
  quantity_unit TEXT,
  summary TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  CHECK (quantity_value IS NULL OR quantity_value >= 0)
);

CREATE TABLE IF NOT EXISTS published_harvest_sources (
  id TEXT PRIMARY KEY,
  harvest_batch_id TEXT NOT NULL,
  production_batch_id TEXT NOT NULL,
  source_resolution TEXT NOT NULL CHECK (
    source_resolution IN ('entity_exact', 'set_exact', 'batch_scope', 'mass_balance_allocation', 'unknown')
  ),
  quantity_value REAL,
  quantity_unit TEXT,
  source_revision TEXT NOT NULL,
  FOREIGN KEY (harvest_batch_id)
    REFERENCES published_harvest_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (quantity_value IS NULL OR quantity_value >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS published_harvest_sources_unique_idx
  ON published_harvest_sources (harvest_batch_id, production_batch_id, source_resolution);

-- 合格证明是带版本并具有明确声明范围的公开投影。
CREATE TABLE IF NOT EXISTS published_certificates (
  id TEXT PRIMARY KEY,
  production_batch_id TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  certificate_no TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'active', 'expired', 'revoked', 'superseded', 'void')
  ),
  scope_type TEXT NOT NULL,
  scope_business_id TEXT NOT NULL,
  issued_at TEXT,
  valid_until TEXT,
  document_url TEXT,
  source_revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY (production_batch_id)
    REFERENCES published_production_batches(business_id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS published_certificates_batch_idx
  ON published_certificates (production_batch_id, status, issued_at DESC);
