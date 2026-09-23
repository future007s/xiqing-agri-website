import {
	databaseUnavailable,
	dayBounds,
	isValidDay,
	json,
	localDate,
} from '../../_shared/telemetry';
import type { TelemetryContext } from '../../_shared/telemetry';

interface PointRow extends Record<string, unknown> {
	bucket_start: string;
	sensor_id: string;
	sensor_label: string;
	device_id: string;
	device_label: string;
	site_id: string;
	site_label: string;
	value_avg: number | null;
	value_min: number | null;
	value_max: number | null;
	valid_count: number;
	total_count: number;
	quality: string;
	unit: string;
}

export async function onRequestGet({ request, env }: TelemetryContext): Promise<Response> {
	if (!env.DB) return databaseUnavailable(env);
	const url = new URL(request.url);
	const day = url.searchParams.get('day') ?? '';
	const metric = url.searchParams.get('metric') ?? '';
	const unit = url.searchParams.get('unit') ?? '';
	const groupBy = url.searchParams.get('groupBy') ?? 'device';
	if (!isValidDay(day) || day > localDate() || !/^[a-z][a-z0-9_]{0,63}$/.test(metric) || !unit || unit.length > 24 || !['device', 'site'].includes(groupBy)) {
		return json({ error: '日期、指标或分组方式无效。' }, 400);
	}
	const { start, end } = dayBounds(day);
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	const groupColumn = groupBy === 'device' ? 'device_id' : 'site_id';
	const groupLabelColumn = groupBy === 'device' ? 'device_label' : 'site_label';
	try {
		const { results } = await env.DB.prepare(`
			SELECT bucket_start, sensor_id, sensor_label, ${groupColumn} AS group_id,
				${groupLabelColumn} AS group_label, value_avg, value_min, value_max,
				valid_count, total_count, quality, unit
			FROM telemetry_10m
			WHERE metric = ? AND unit = ? AND bucket_start >= ? AND bucket_start >= ? AND bucket_start < ?
			ORDER BY bucket_start, ${groupColumn}, sensor_id LIMIT 25000
		`).bind(metric, unit, start, since, end).all<PointRow>();
		const seriesMap = new Map<string, { id: string; label: string; group: string; points: unknown[] }>();
		for (const row of results) {
			const id = `${String(row.group_id)}:${row.sensor_id}`;
			let series = seriesMap.get(id);
			if (!series) {
				series = { id, label: `${row.group_label} · ${row.sensor_label}`, group: String(row.group_label), points: [] };
				seriesMap.set(id, series);
			}
			series.points.push({
				at: row.bucket_start,
				average: row.value_avg,
				minimum: row.value_min,
				maximum: row.value_max,
				validCount: row.valid_count,
				totalCount: row.total_count,
				quality: row.quality,
			});
		}
		return json({
			day,
			metric,
			groupBy,
			unit: results[0]?.unit ?? '',
			series: [...seriesMap.values()],
		}, 200, 'public, max-age=120, stale-while-revalidate=300');
	} catch {
		return json({ error: '暂时无法读取传感器曲线。' }, 503);
	}
}
