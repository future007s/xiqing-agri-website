import {
	authorized,
	cleanText,
	jsonResponse,
	mediaFromRow,
	normalizeCapturedAt,
	optionsResponse,
	validExperimentId,
	type MediaEnv,
	type MediaRecord,
	type PagesContext,
} from '../../_shared/media';

type ManagementContext = PagesContext<MediaEnv>;
type MediaRow = Record<string, unknown>;

const MEDIA_COLUMNS = `
	id, experiment_id, kind, src, poster, thumbnail, captured_at, event_id, plant_id,
	caption, alt, visibility, review_status, object_key, mime_type, size_bytes,
	checksum, uploaded_at, deleted_at, deleted_by, delete_reason
`;

const textValue = (payload: Record<string, unknown>, key: string, maxLength: number): string | undefined => {
	if (!(key in payload)) return undefined;
	return cleanText(typeof payload[key] === 'string' ? payload[key] : '', maxLength);
};

const getRow = async (env: MediaEnv, id: string): Promise<MediaRow | null> => {
	if (!env.DB) return null;
	const result = await env.DB.prepare(`SELECT ${MEDIA_COLUMNS} FROM experiment_media WHERE id = ?`).bind(id).all<MediaRow>();
	return result.results[0] ?? null;
};

const audit = async (env: MediaEnv, mediaId: string, action: 'update' | 'soft_delete' | 'restore' | 'purge', reason: string | null, details: Record<string, unknown> = {}): Promise<void> => {
	if (!env.DB) return;
	try {
		await env.DB.prepare(`
			INSERT INTO experiment_media_audit (media_id, action, actor, reason, details_json)
			VALUES (?, ?, ?, ?, ?)
		`).bind(mediaId, action, 'media-admin', reason, JSON.stringify(details)).run();
	} catch {
		// The media operation remains usable if an older database has not run the audit migration yet.
	}
};

export const onRequestOptions = (): Response => optionsResponse();

export const onRequestGet = async ({ request, env }: ManagementContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);

	const url = new URL(request.url);
	const experimentId = cleanText(url.searchParams.get('experimentId'), 64);
	if (experimentId && !validExperimentId(experimentId)) return jsonResponse({ error: '实验编号无效。' }, 400);
	const includeDeleted = url.searchParams.get('includeDeleted') !== '0';
	const limitRaw = Number(url.searchParams.get('limit') ?? '200');
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 200;
	const where: string[] = [];
	const values: unknown[] = [];
	if (experimentId) {
		where.push('experiment_id = ?');
		values.push(experimentId);
	}
	if (!includeDeleted) where.push('deleted_at IS NULL');
	const sql = `SELECT ${MEDIA_COLUMNS} FROM experiment_media ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY captured_at DESC, uploaded_at DESC LIMIT ?`;
	values.push(limit);
	const result = await env.DB.prepare(sql).bind(...values).all<MediaRow>();
	return jsonResponse({ media: result.results.map(mediaFromRow), includeDeleted, limit });
};

export const onRequestPatch = async ({ request, env, params }: ManagementContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const mediaId = cleanText(params.mediaId ?? '', 160);
	if (!mediaId) return jsonResponse({ error: '媒体编号不能为空。' }, 400);
	const existing = await getRow(env, mediaId);
	if (!existing) return jsonResponse({ error: '媒体记录不存在。' }, 404);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json() as Record<string, unknown>;
	} catch {
		return jsonResponse({ error: '请求不是有效的 JSON。' }, 400);
	}

	const assignments: string[] = [];
	const values: unknown[] = [];
	const capturedAt = textValue(payload, 'capturedAt', 64);
	if (capturedAt !== undefined) {
		assignments.push('captured_at = ?');
		values.push(normalizeCapturedAt(capturedAt, env.DEFAULT_TIMEZONE_OFFSET ?? '+08:00'));
	}
	for (const [field, column, maxLength] of [
		['eventId', 'event_id', 128], ['plantId', 'plant_id', 128], ['poster', 'poster', 1000],
		['thumbnail', 'thumbnail', 1000], ['caption', 'caption', 240], ['alt', 'alt', 500],
	] as const) {
		const value = textValue(payload, field, maxLength);
		if (value !== undefined) {
			if ((field === 'caption' || field === 'alt') && !value) return jsonResponse({ error: `${field} 不能为空。` }, 400);
			assignments.push(`${column} = ?`);
			values.push(value || null);
		}
	}
	const visibility = textValue(payload, 'visibility', 12);
	if (visibility !== undefined) {
		if (visibility !== 'public' && visibility !== 'private') return jsonResponse({ error: '可见范围无效。' }, 400);
		assignments.push('visibility = ?');
		values.push(visibility);
	}
	const reviewStatus = textValue(payload, 'reviewStatus', 12);
	if (reviewStatus !== undefined) {
		if (!['pending', 'confirmed', 'rejected'].includes(reviewStatus)) return jsonResponse({ error: '审核状态无效。' }, 400);
		assignments.push('review_status = ?');
		values.push(reviewStatus);
	}
	if (!assignments.length) return jsonResponse({ error: '没有可修改的字段。' }, 400);

	values.push(mediaId);
	await env.DB.prepare(`UPDATE experiment_media SET ${assignments.join(', ')} WHERE id = ?`).bind(...values).run();
	await audit(env, mediaId, 'update', textValue(payload, 'reason', 240) ?? null, { fields: assignments.map((field) => field.split(' = ')[0]) });
	const updated = await getRow(env, mediaId);
	return updated ? jsonResponse({ media: mediaFromRow(updated as MediaRow) as MediaRecord, action: 'update' }) : jsonResponse({ error: '修改后无法读取媒体记录。' }, 500);
};

export const onRequestDelete = async ({ request, env, params }: ManagementContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const mediaId = cleanText(params.mediaId ?? '', 160);
	const existing = await getRow(env, mediaId);
	if (!existing) return jsonResponse({ error: '媒体记录不存在。' }, 404);
	const url = new URL(request.url);
	const reason = cleanText(url.searchParams.get('reason'), 240) || null;
	if (url.searchParams.get('purge') !== '1') {
		await env.DB.prepare(`UPDATE experiment_media SET deleted_at = COALESCE(deleted_at, ?), deleted_by = COALESCE(deleted_by, ?), delete_reason = COALESCE(delete_reason, ?) WHERE id = ?`)
			.bind(new Date().toISOString(), 'media-admin', reason, mediaId).run();
		await audit(env, mediaId, 'soft_delete', reason);
		const deleted = await getRow(env, mediaId);
		return deleted ? jsonResponse({ media: mediaFromRow(deleted), action: 'soft_delete' }) : jsonResponse({ error: '删除后无法读取媒体记录。' }, 500);
	}

	if (request.headers.get('X-Confirm-Purge') !== 'PURGE') return jsonResponse({ error: '彻底删除需要 X-Confirm-Purge: PURGE。' }, 400);
	if (!existing.deleted_at) return jsonResponse({ error: '请先软删除媒体记录，再执行彻底删除。' }, 409);
	if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'R2 存储桶尚未配置，无法彻底删除。' }, 503);
	try {
		await env.MEDIA_BUCKET.delete(String(existing.object_key));
	} catch {
		return jsonResponse({ error: 'R2 文件删除失败，数据库记录仍保留。' }, 502);
	}
	await audit(env, mediaId, 'purge', reason, { objectKey: existing.object_key });
	await env.DB.prepare(`DELETE FROM experiment_media WHERE id = ?`).bind(mediaId).run();
	return jsonResponse({ id: mediaId, action: 'purge' });
};

export const onRequestPost = async ({ request, env, params }: ManagementContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const mediaId = cleanText(params.mediaId ?? '', 160);
	if (params.action === 'purge') {
		const url = new URL(request.url);
		url.searchParams.set('purge', '1');
		const purgeRequest = new Request(url, { method: 'DELETE', headers: new Headers(request.headers) });
		purgeRequest.headers.set('X-Confirm-Purge', 'PURGE');
		return onRequestDelete({ request: purgeRequest, env, params: { mediaId } });
	}
	if (params.action !== 'restore') return jsonResponse({ error: '管理操作不存在。' }, 404);
	const existing = await getRow(env, mediaId);
	if (!existing) return jsonResponse({ error: '媒体记录不存在。' }, 404);
	await env.DB.prepare(`UPDATE experiment_media SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = ?`).bind(mediaId).run();
	await audit(env, mediaId, 'restore', null);
	const restored = await getRow(env, mediaId);
	return restored ? jsonResponse({ media: mediaFromRow(restored), action: 'restore' }) : jsonResponse({ error: '恢复后无法读取媒体记录。' }, 500);
};
