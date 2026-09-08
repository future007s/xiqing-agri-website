import {
	authorized, cleanText, jsonResponse, mediaFromRow, normalizeCapturedAt, optionsResponse,
	validExperimentId, getMediaRow, auditStatement, withDatabaseErrors, type PagesContext,
} from '../../_shared/media';

export const onRequestOptions = (): Response => optionsResponse();
export const onRequestGet = withDatabaseErrors(async ({ request, env }: PagesContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const url = new URL(request.url);
	const experimentId = (url.searchParams.get('experimentId') ?? '').trim();
	if (experimentId && !validExperimentId(experimentId)) return jsonResponse({ error: '实验编号无效。' }, 400);
	const includeDeleted = url.searchParams.get('includeDeleted') !== '0';
	const rawLimit = Number(url.searchParams.get('limit') ?? '200');
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 200;
	const where: string[] = [];
	const values: unknown[] = [];
	if (experimentId) { where.push('experiment_id = ?'); values.push(experimentId); }
	if (!includeDeleted) where.push('deleted_at IS NULL');
	const result = await env.DB.prepare(`SELECT * FROM experiment_media ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY captured_at DESC, uploaded_at DESC LIMIT ?`).bind(...values, limit).all();
	return jsonResponse({ media: result.results.map(mediaFromRow), includeDeleted, limit });
});

export const onRequestPatch = withDatabaseErrors(async ({ request, env, params }: PagesContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const id = params.mediaId ?? '';
	const existing = await getMediaRow(env.DB, id);
	if (!existing) return jsonResponse({ error: '媒体记录不存在。' }, 404);
	if (existing.purge_state !== 'active') return jsonResponse({ error: '彻底删除处理中，不能修改。' }, 409);
	let payload: Record<string, unknown>;
	try {
		const parsed: unknown = await request.json();
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		payload = parsed as Record<string, unknown>;
	} catch { return jsonResponse({ error: '请求必须是 JSON 对象。' }, 400); }
	const assignments: string[] = [];
	const values: unknown[] = [];
	for (const [field, column, maxLength] of [
		['capturedAt', 'captured_at', 64], ['eventId', 'event_id', 128], ['plantId', 'plant_id', 128],
		['caption', 'caption', 240], ['alt', 'alt', 500], ['visibility', 'visibility', 12], ['reviewStatus', 'review_status', 12],
	] as const) {
		if (!(field in payload)) continue;
		if (typeof payload[field] !== 'string') return jsonResponse({ error: `${field} 必须是文字。` }, 400);
		let value = cleanText(payload[field] as string, maxLength);
		if (['caption', 'alt', 'capturedAt'].includes(field) && !value) return jsonResponse({ error: `${field} 不能为空。` }, 400);
		if (field === 'capturedAt') {
			try { value = normalizeCapturedAt(value, env.DEFAULT_TIMEZONE_OFFSET); }
			catch { return jsonResponse({ error: '拍摄时间无效。' }, 400); }
		}
		if (field === 'visibility' && !['public', 'private'].includes(value)) return jsonResponse({ error: '可见范围无效。' }, 400);
		if (field === 'reviewStatus' && !['pending', 'confirmed', 'rejected'].includes(value)) return jsonResponse({ error: '审核状态无效。' }, 400);
		if (existing.storage_backend !== 'private_r2' && ((field === 'visibility' && value === 'public') || (field === 'reviewStatus' && value === 'confirmed'))) return jsonResponse({ error: '旧媒体须先迁移至私有存储，才能重新公开。' }, 409);
		assignments.push(`${column} = ?`); values.push(value || null);
	}
	if ('poster' in payload || 'thumbnail' in payload) return jsonResponse({ error: '封面请作为独立媒体上传并审核。' }, 400);
	if (!assignments.length) return jsonResponse({ error: '没有可修改的字段。' }, 400);
	const reason = typeof payload.reason === 'string' ? cleanText(payload.reason, 240) || null : null;
	const result = await env.DB.batch([
		env.DB.prepare(`UPDATE experiment_media SET ${assignments.join(', ')} WHERE id = ? AND purge_state = 'active' RETURNING *`).bind(...values, id),
		auditStatement(env.DB, id, 'update', reason, { fields: assignments.map((x) => x.split(' = ')[0]) }),
	]);
	return result[0].results[0] ? jsonResponse({ media: mediaFromRow(result[0].results[0]), action: 'update' }) : jsonResponse({ error: '记录状态已改变，请刷新。' }, 409);
});

export const onRequestDelete = withDatabaseErrors(async ({ request, env, params }: PagesContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	const id = params.mediaId ?? '';
	const existing = await getMediaRow(env.DB, id);
	const url = new URL(request.url);
	if (!existing) {
		// A successful purge response can be lost after commit. Its durable audit
		// distinguishes an already completed retry from an unknown media ID.
		if (url.searchParams.get('purge') === '1' && request.headers.get('X-Confirm-Purge') === 'PURGE') {
			const completed = await env.DB.prepare("SELECT media_id FROM experiment_media_audit WHERE media_id = ? AND action = 'purge' LIMIT 1").bind(id).all();
			if (completed.results.length) return jsonResponse({ id, action: 'purge', alreadyPurged: true });
		}
		return jsonResponse({ error: '媒体记录不存在。' }, 404);
	}
	const reason = cleanText(url.searchParams.get('reason'), 240) || null;
	if (url.searchParams.get('purge') !== '1') {
		const result = await env.DB.batch([
			env.DB.prepare(`UPDATE experiment_media SET deleted_at = COALESCE(deleted_at, ?), deleted_by = COALESCE(deleted_by, 'media-admin'), delete_reason = COALESCE(delete_reason, ?) WHERE id = ? AND purge_state = 'active' RETURNING *`).bind(new Date().toISOString(), reason, id),
			auditStatement(env.DB, id, 'soft_delete', reason),
		]);
		return result[0].results[0] ? jsonResponse({ media: mediaFromRow(result[0].results[0]), action: 'soft_delete' }) : jsonResponse({ error: '记录正在彻底删除。' }, 409);
	}
	if (request.headers.get('X-Confirm-Purge') !== 'PURGE') return jsonResponse({ error: '彻底删除需要 X-Confirm-Purge: PURGE。' }, 400);
	if (!existing.deleted_at) return jsonResponse({ error: '请先软删除，再执行彻底删除。' }, 409);
	if (existing.storage_backend !== 'private_r2') return jsonResponse({ error: '旧公共存储文件须按迁移清单单独处理，当前接口不会删除旧桶。' }, 409);
	if (!env.MEDIA_PRIVATE_BUCKET) return jsonResponse({ error: '私有媒体存储尚未配置。' }, 503);
	// Persist intent before touching R2. Restore/update cannot race a pending purge.
	const prepared = await env.DB.batch([
		env.DB.prepare(`UPDATE experiment_media SET purge_state = 'purging' WHERE id = ? AND deleted_at IS NOT NULL AND purge_state = 'active' RETURNING *`).bind(id),
		auditStatement(env.DB, id, 'update', reason, { operation: 'purge_requested' }),
		env.DB.prepare(`SELECT * FROM experiment_media WHERE id = ? AND deleted_at IS NOT NULL AND purge_state = 'purging'`).bind(id),
	]);
	const pending = prepared[2].results[0];
	if (!pending) return jsonResponse({ error: '记录状态已改变，请刷新。' }, 409);
	try { await env.MEDIA_PRIVATE_BUCKET.delete(String(pending.object_key)); }
	catch { return jsonResponse({ error: '文件删除未完成。记录已锁定，可重试彻底删除。' }, 502); }
	// On failure this entire batch rolls back; the durable purging row supports retry.
	await env.DB.batch([
		env.DB.prepare(`DELETE FROM experiment_media WHERE id = ? AND purge_state = 'purging' RETURNING *`).bind(id),
		auditStatement(env.DB, id, 'purge', reason, { objectKey: pending.object_key }),
	]);
	return jsonResponse({ id, action: 'purge' });
});

export const onRequestPost = withDatabaseErrors(async ({ request, env, params }: PagesContext): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '管理口令无效。' }, 401);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);
	if (params.action === 'purge') {
		const url = new URL(request.url); url.searchParams.set('purge', '1');
		return onRequestDelete({ request: new Request(url, { method: 'DELETE', headers: request.headers }), env, params });
	}
	if (params.action !== 'restore') return jsonResponse({ error: '管理操作不存在。' }, 404);
	const id = params.mediaId ?? '';
	const existing = await getMediaRow(env.DB, id);
	if (!existing) return jsonResponse({ error: '媒体记录不存在。' }, 404);
	const result = await env.DB.batch([
		env.DB.prepare(`UPDATE experiment_media SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = ? AND purge_state = 'active' RETURNING *`).bind(id),
		auditStatement(env.DB, id, 'restore', null),
	]);
	return result[0].results[0] ? jsonResponse({ media: mediaFromRow(result[0].results[0]), action: 'restore' }) : jsonResponse({ error: '彻底删除处理中，不能恢复。' }, 409);
});
