#!/usr/bin/env python3
"""Publish ten-minute sensor summaries to the public website projection."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


UTC = timezone.utc
BUCKET_SECONDS = 10 * 60
REPLAY_SECONDS = 20 * 60
MAX_BATCH = 250
DEFAULT_URL = "https://xiqingagri.com/api/telemetry/publish"
STATE_PATH = Path(
    os.environ.get(
        "TELEMETRY_STATE_PATH",
        "/mnt/data4t/aeroponics/telemetry/website-publisher.sqlite3",
    )
)
METRIC_LABELS = {
    "air_temperature": "温度",
    "air_humidity": "相对湿度",
    "co2_ppm": "二氧化碳",
    "illuminance": "光照强度",
    "ppfd": "光合有效辐射",
    "ec": "营养液电导率",
    "ph": "酸碱度",
    "pressure": "压力",
    "pressure_p1": "泵出口压力",
    "pressure_p2": "远端压力",
}

QUERY = """
WITH grouped AS (
    SELECT
        time_bucket(INTERVAL '10 minutes', r.measured_at) AS bucket_start,
        si.sensor_installation_pk,
        min(r.value_numeric) FILTER (WHERE r.quality = 'observed') AS value_min,
        max(r.value_numeric) FILTER (WHERE r.quality = 'observed') AS value_max,
        avg(r.value_numeric) FILTER (WHERE r.quality = 'observed') AS value_avg,
        count(*) FILTER (WHERE r.quality = 'observed')::integer AS valid_count,
        count(*)::integer AS total_count
    FROM sensor_readings r
    JOIN sensor_installations si USING (sensor_installation_pk)
    WHERE r.measured_at >= %s AND r.measured_at < %s
      AND r.value_numeric IS NOT NULL
    GROUP BY bucket_start, si.sensor_installation_pk
)
SELECT
    to_char(g.bucket_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket_start,
    s.business_id AS sensor_id,
    s.display_id AS sensor_label,
    s.metric,
    s.canonical_unit AS unit,
    d.business_id AS device_id,
    d.display_id AS device_label,
    si.scope_kind AS site_kind,
    CASE si.scope_kind
        WHEN 'farm' THEN f.business_id
        WHEN 'zone' THEN z.business_id
        WHEN 'nutrient_loop' THEN nl.business_id
        WHEN 'tower' THEN t.business_id
        WHEN 'position' THEN p.business_id
    END AS site_id,
    CASE si.scope_kind
        WHEN 'farm' THEN concat_ws(' · ', f.display_id, f.name)
        WHEN 'zone' THEN concat_ws(' · ', z.display_id, z.name)
        WHEN 'nutrient_loop' THEN concat_ws(' · ', nl.display_id, nl.name)
        WHEN 'tower' THEN concat_ws(' · ', t.display_id, t.name)
        WHEN 'position' THEN concat_ws(' · ', pt.display_id, pt.name, p.display_id)
    END AS site_label,
    encode(substring(digest(s.business_id || '|' || lower(si.valid_during)::text, 'sha256') FROM 1 FOR 12), 'hex') AS installation_id,
    g.value_avg,
    g.value_min,
    g.value_max,
    g.valid_count,
    g.total_count,
    CASE WHEN g.valid_count = g.total_count THEN 'observed'
         WHEN g.valid_count > 0 THEN 'partial'
         ELSE 'invalid' END AS quality
FROM grouped g
JOIN sensor_installations si USING (sensor_installation_pk)
JOIN sensors s USING (sensor_pk)
JOIN devices d USING (device_pk)
LEFT JOIN farms f ON si.scope_kind = 'farm' AND f.farm_pk = si.farm_pk
LEFT JOIN zones z ON si.scope_kind = 'zone' AND z.zone_pk = si.zone_pk
LEFT JOIN nutrient_loops nl ON si.scope_kind = 'nutrient_loop' AND nl.nutrient_loop_pk = si.nutrient_loop_pk
LEFT JOIN towers t ON si.scope_kind = 'tower' AND t.tower_pk = si.tower_pk
LEFT JOIN positions p ON si.scope_kind = 'position' AND p.position_pk = si.position_pk
LEFT JOIN towers pt ON p.tower_pk = pt.tower_pk
WHERE s.status <> 'retired'
ORDER BY g.bucket_start, s.business_id, installation_id
"""


def utc_now() -> datetime:
    return datetime.now(UTC)


def floor_bucket(value: datetime) -> datetime:
    seconds = int(value.timestamp())
    return datetime.fromtimestamp(seconds - seconds % BUCKET_SECONDS, UTC)


def state_connection() -> sqlite3.Connection:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(STATE_PATH, timeout=10)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS publisher_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    os.chmod(STATE_PATH, 0o600)
    return connection


def get_cursor() -> datetime | None:
    with state_connection() as db:
        row = db.execute("SELECT value FROM publisher_state WHERE key = 'last_completed_bucket'").fetchone()
    return datetime.fromisoformat(row[0]) if row else None


def set_cursor(value: datetime) -> None:
    with state_connection() as db:
        db.execute(
            "INSERT INTO publisher_state(key, value) VALUES ('last_completed_bucket', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (value.isoformat(),),
        )


def pg_connection() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        connect_timeout=int(os.environ.get("PGCONNECT_TIMEOUT", "8")),
    )


def load_rows(start: datetime, end: datetime) -> list[dict[str, object]]:
    with pg_connection() as connection, connection.cursor() as cursor:
        cursor.execute(QUERY, (start, end))
        names = [column.name for column in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def json_value(value: object) -> object:
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (int, float)):
        return value
    return float(value)


def serialize_row(row: dict[str, object]) -> dict[str, object]:
    metric = str(row["metric"])
    return {
        "metric": metric,
        "metricLabel": METRIC_LABELS.get(metric, metric.replace("_", " ")),
        "unit": str(row["unit"]),
        "bucketStart": str(row["bucket_start"]),
        "sensorId": str(row["sensor_id"]),
        "installationId": str(row["installation_id"]),
        "sensorLabel": str(row["sensor_label"]),
        "deviceId": str(row["device_id"]),
        "deviceLabel": str(row["device_label"]),
        "siteKind": str(row["site_kind"]),
        "siteId": str(row["site_id"]),
        "siteLabel": str(row["site_label"]),
        "average": json_value(row["value_avg"]),
        "minimum": json_value(row["value_min"]),
        "maximum": json_value(row["value_max"]),
        "validCount": int(row["valid_count"]),
        "totalCount": int(row["total_count"]),
        "quality": str(row["quality"]),
    }


def publish(rows: list[dict[str, object]]) -> None:
    endpoint = os.environ.get("TELEMETRY_PUBLISH_URL", DEFAULT_URL)
    token = os.environ["TELEMETRY_PUBLISH_TOKEN"]
    payload = json.dumps({"samples": rows}, ensure_ascii=False, separators=(",", ":")).encode()
    request = Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Content-Length": str(len(payload)),
            "User-Agent": "Xiqing-Agriculture-Telemetry-Publisher/1.0",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"publish_http_{error.code}") from None
    except URLError as error:
        raise RuntimeError(f"publish_network_error:{error.reason.__class__.__name__}") from None
    if not isinstance(result, dict) or int(result.get("accepted", -1)) + int(result.get("expired", 0)) != len(rows):
        raise RuntimeError("publish_response_mismatch")


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    token = os.environ.get("TELEMETRY_PUBLISH_TOKEN", "")
    if not token:
        logging.error("publisher_configuration_missing")
        return 2

    now = utc_now()
    end = floor_bucket(now)
    if end <= datetime(2020, 1, 1, tzinfo=UTC):
        logging.error("system_clock_invalid")
        return 2
    cursor = get_cursor()
    retention_start = floor_bucket(now - timedelta(days=30))
    start = max(retention_start, cursor - timedelta(seconds=REPLAY_SECONDS)) if cursor else retention_start
    if start >= end:
        return 0

    try:
        rows = [serialize_row(row) for row in load_rows(start, end)]
        for offset in range(0, len(rows), MAX_BATCH):
            publish(rows[offset:offset + MAX_BATCH])
        set_cursor(end - timedelta(seconds=BUCKET_SECONDS))
        logging.info("published summaries=%d range_start=%s range_end=%s", len(rows), start.isoformat(), end.isoformat())
        return 0
    except Exception as error:
        logging.error("publish_failed type=%s detail=%s", error.__class__.__name__, str(error)[:160])
        return 1


if __name__ == "__main__":
    sys.exit(run())
