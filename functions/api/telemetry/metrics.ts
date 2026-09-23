import { databaseUnavailable, json } from '../../_shared/telemetry';
import type { TelemetryContext } from '../../_shared/telemetry';

export async function onRequestGet({ env }: TelemetryContext): Promise<Response> {
	if (!env.DB) return databaseUnavailable(env);
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	try {
		const { results } = await env.DB.prepare(`
			SELECT metric, metric_label AS label, unit, COUNT(DISTINCT sensor_id) AS sensor_count
			FROM telemetry_10m WHERE bucket_start >= ?
			GROUP BY metric, metric_label, unit ORDER BY metric_label
		`).bind(since).all();
		return json({ metrics: results }, 200, 'public, max-age=120, stale-while-revalidate=300');
	} catch {
		return json({ error: '暂时无法读取传感器类型。' }, 503);
	}
}
