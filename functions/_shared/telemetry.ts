export interface TelemetryRow {
	metric: string;
	metric_label: string;
	unit: string;
	bucket_start: string;
	sensor_id: string;
	installation_id: string;
	sensor_label: string;
	device_id: string;
	device_label: string;
	site_kind: string;
	site_id: string;
	site_label: string;
	value_avg: number | null;
	value_min: number | null;
	value_max: number | null;
	valid_count: number;
	total_count: number;
	quality: string;
}

export interface TelemetryStatement {
	bind(...values: unknown[]): TelemetryStatement;
	run(): Promise<unknown>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface TelemetryDatabase {
	prepare(sql: string): TelemetryStatement;
	batch(statements: TelemetryStatement[]): Promise<unknown[]>;
}

export interface TelemetryEnv {
	DB?: TelemetryDatabase;
	TELEMETRY_PUBLISH_TOKEN?: string;
}

export interface TelemetryContext {
	request: Request;
	env: TelemetryEnv;
}

export const json = (body: unknown, status = 200, cache = 'no-store'): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': cache,
		},
	});

export const databaseUnavailable = (env: TelemetryEnv): Response =>
	env.DB ? json({ error: '数据服务暂时不可用。' }, 503) : json({ error: '遥测数据尚未配置。' }, 503);

export function localDate(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
	}).format(now);
}

export function isValidDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dayBounds(day: string): { start: string; end: string } {
	const localMidnightUtc = Date.parse(`${day}T00:00:00+08:00`);
	return {
		start: new Date(localMidnightUtc).toISOString(),
		end: new Date(localMidnightUtc + 24 * 60 * 60 * 1000).toISOString(),
	};
}

export function isAuthorized(request: Request, env: TelemetryEnv): boolean {
	const supplied = request.headers.get('Authorization') ?? '';
	return Boolean(env.TELEMETRY_PUBLISH_TOKEN) && supplied === `Bearer ${env.TELEMETRY_PUBLISH_TOKEN}`;
}

const text = (value: unknown, maximum = 160): string | null =>
	typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum ? value.trim() : null;

const numberOrNull = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : Number.NaN;

export function normalizeSample(input: unknown): TelemetryRow | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const row = input as Record<string, unknown>;
	const metric = text(row.metric, 64);
	const metricLabel = text(row.metricLabel, 100);
	const unit = text(row.unit, 24);
	const bucketStart = text(row.bucketStart, 40);
	const sensorId = text(row.sensorId, 100);
	const installationId = text(row.installationId, 24);
	const sensorLabel = text(row.sensorLabel, 120);
	const deviceId = text(row.deviceId, 100);
	const deviceLabel = text(row.deviceLabel, 120);
	const siteKind = text(row.siteKind, 24);
	const siteId = text(row.siteId, 100);
	const siteLabel = text(row.siteLabel, 160);
	const quality = text(row.quality, 16);
	const timestamp = bucketStart ? Date.parse(bucketStart) : Number.NaN;
	const bucketDate = new Date(timestamp);
	const average = numberOrNull(row.average);
	const minimum = numberOrNull(row.minimum);
	const maximum = numberOrNull(row.maximum);
	const validCount = row.validCount;
	const totalCount = row.totalCount;
	const allowedKinds = new Set(['farm', 'zone', 'nutrient_loop', 'tower', 'position']);
	const allowedQuality = new Set(['observed', 'partial', 'invalid']);
	if (!metric || !/^[a-z][a-z0-9_]{0,63}$/.test(metric) || !metricLabel || !unit || !bucketStart ||
		!sensorId || !installationId || !/^[a-f0-9]{24}$/.test(installationId) || !sensorLabel || !deviceId || !deviceLabel || !siteKind || !allowedKinds.has(siteKind) ||
		!siteId || !siteLabel || !quality || !allowedQuality.has(quality) ||
		!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|\+00:00)$/.test(bucketStart) ||
		bucketDate.getUTCMinutes() % 10 !== 0 || bucketDate.getUTCSeconds() !== 0 || bucketDate.getUTCMilliseconds() !== 0 ||
		!Number.isInteger(validCount) || !Number.isInteger(totalCount) || (validCount as number) < 0 ||
		(totalCount as number) < (validCount as number) || Number.isNaN(average) || Number.isNaN(minimum) || Number.isNaN(maximum) ||
		((validCount as number) > 0 && (average === null || minimum === null || maximum === null)) ||
		((validCount as number) === 0 && (average !== null || minimum !== null || maximum !== null))) return null;

	return {
		metric,
		metric_label: metricLabel,
		unit,
		bucket_start: bucketDate.toISOString(),
		sensor_id: sensorId,
		installation_id: installationId,
		sensor_label: sensorLabel,
		device_id: deviceId,
		device_label: deviceLabel,
		site_kind: siteKind,
		site_id: siteId,
		site_label: siteLabel,
		value_avg: average,
		value_min: minimum,
		value_max: maximum,
		valid_count: validCount as number,
		total_count: totalCount as number,
		quality,
	};
}

export const TELEMETRY_UPSERT_SQL = `INSERT INTO telemetry_10m (
	metric, metric_label, unit, bucket_start, sensor_id, installation_id, sensor_label, device_id, device_label,
	site_kind, site_id, site_label, value_avg, value_min, value_max, valid_count, total_count, quality, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT (metric, bucket_start, sensor_id, installation_id) DO UPDATE SET
	metric_label = excluded.metric_label,
	unit = excluded.unit,
	sensor_label = excluded.sensor_label,
	device_id = excluded.device_id,
	device_label = excluded.device_label,
	site_kind = excluded.site_kind,
	site_id = excluded.site_id,
	site_label = excluded.site_label,
	value_avg = excluded.value_avg,
	value_min = excluded.value_min,
	value_max = excluded.value_max,
	valid_count = excluded.valid_count,
	total_count = excluded.total_count,
	quality = excluded.quality,
	updated_at = CURRENT_TIMESTAMP`;

export function sampleBindings(row: TelemetryRow): unknown[] {
	return [row.metric, row.metric_label, row.unit, row.bucket_start, row.sensor_id, row.installation_id, row.sensor_label,
		row.device_id, row.device_label, row.site_kind, row.site_id, row.site_label, row.value_avg,
		row.value_min, row.value_max, row.valid_count, row.total_count, row.quality];
}
