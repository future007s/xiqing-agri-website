import {
	databaseUnavailable,
	isAuthorized,
	json,
	normalizeSample,
	sampleBindings,
	TELEMETRY_UPSERT_SQL,
} from '../../_shared/telemetry';
import type { TelemetryContext, TelemetryRow } from '../../_shared/telemetry';

const MAX_BODY_BYTES = 400_000;
const MAX_ROWS = 500;

export async function onRequestPost(context: TelemetryContext): Promise<Response> {
	const { request, env } = context;
	if (!env.DB) return databaseUnavailable(env);
	if (!env.TELEMETRY_PUBLISH_TOKEN) return json({ error: '遥测上传服务未配置。' }, 503);
	if (!isAuthorized(request, env)) return json({ error: '未授权。' }, 401);

	const contentLength = Number(request.headers.get('Content-Length') ?? 0);
	if (contentLength > MAX_BODY_BYTES) return json({ error: '上传内容过大。' }, 413);
	const raw = await request.text();
	if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: '上传内容过大。' }, 413);

	let payload: unknown;
	try { payload = JSON.parse(raw); }
	catch { return json({ error: 'JSON 格式无效。' }, 400); }
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: '请求格式无效。' }, 400);
	const samples = (payload as Record<string, unknown>).samples;
	if (!Array.isArray(samples) || samples.length < 1 || samples.length > MAX_ROWS) {
		return json({ error: `每次需上传 1 到 ${MAX_ROWS} 条数据。` }, 400);
	}
	const rows: TelemetryRow[] = [];
	for (const sample of samples) {
		const row = normalizeSample(sample);
		if (!row) return json({ error: '数据字段无效，未写入本批数据。' }, 400);
		rows.push(row);
	}

	const expiration = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	const current = new Date(Date.now() + 15 * 60 * 1000).toISOString();
	if (rows.some((row) => row.bucket_start > current)) return json({ error: '数据时间超出允许范围。' }, 400);
	const currentRows = rows.filter((row) => row.bucket_start >= expiration);
	const expiredCount = rows.length - currentRows.length;
	try {
		for (let index = 0; index < currentRows.length; index += 100) {
			const statements = currentRows.slice(index, index + 100).map((row) =>
				env.DB!.prepare(TELEMETRY_UPSERT_SQL).bind(...sampleBindings(row)));
			await env.DB.batch(statements);
		}
		await env.DB.prepare('DELETE FROM telemetry_10m WHERE bucket_start < ?').bind(expiration).run();
		return json({ accepted: currentRows.length, expired: expiredCount }, 202);
	} catch {
		return json({ error: '数据写入未完成，可使用相同数据安全重试。' }, 503);
	}
}
