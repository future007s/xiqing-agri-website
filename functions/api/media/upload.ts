import {
	authorized, cleanText, jsonResponse, mediaFromRow, mediaContentUrl, normalizeCapturedAt,
	optionsResponse, validExperimentId, sha256Hex, auditStatement, withDatabaseErrors,
	type MediaEnv, type PagesContext,
} from '../../_shared/media';

export const onRequestOptions = (): Response => optionsResponse();

export const onRequestPost = withDatabaseErrors(async ({ request, env }: PagesContext<MediaEnv>): Promise<Response> => {
	if (!authorized(request, env)) return jsonResponse({ error: '上传口令无效。' }, 401);
	if (!env.DB || !env.MEDIA_PRIVATE_BUCKET) return jsonResponse({ error: '请先配置私有媒体存储和媒体索引数据库。' }, 503);
	let form: FormData;
	try { form = await request.formData(); } catch { return jsonResponse({ error: '上传表单无效。' }, 400); }
	const experimentId = String(form.get('experimentId') ?? '').trim();
	const kind = form.get('kind');
	const file = form.get('file');
	if (!validExperimentId(experimentId)) return jsonResponse({ error: '实验编号无效。' }, 400);
	if (kind !== 'image' && kind !== 'video') return jsonResponse({ error: '媒体类型无效。' }, 400);
	if (!(file instanceof File) || !file.size) return jsonResponse({ error: '请选择非空文件。' }, 400);
	const allowed = kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] : ['video/mp4', 'video/webm', 'video/quicktime'];
	if (!allowed.includes(file.type)) return jsonResponse({ error: '文件类型不受支持。' }, 400);
	if (file.size > (kind === 'image' ? 10 : 50) * 1024 * 1024) return jsonResponse({ error: '文件超过大小限制。' }, 413);
	const caption = cleanText(form.get('caption'), 240);
	const alt = cleanText(form.get('alt'), 500);
	if (!caption || !alt) return jsonResponse({ error: '媒体说明和无障碍描述不能为空。' }, 400);
	const visibility = form.get('visibility') || 'private';
	const reviewStatus = form.get('reviewStatus') || 'pending';
	if (!['public', 'private'].includes(String(visibility)) || !['pending', 'confirmed', 'rejected'].includes(String(reviewStatus))) return jsonResponse({ error: '可见范围或审核状态无效。' }, 400);
	// Uncontrolled external poster/thumbnail URLs would bypass the same access policy.
	if (form.get('poster') || form.get('thumbnail')) return jsonResponse({ error: '封面请作为独立媒体上传并审核。' }, 400);
	let capturedAt: string;
	try { capturedAt = normalizeCapturedAt(String(form.get('capturedAt') || new Date().toISOString()), env.DEFAULT_TIMEZONE_OFFSET); }
	catch { return jsonResponse({ error: '拍摄时间无效。' }, 400); }
	const bytes = await file.arrayBuffer();
	const checksum = await sha256Hex(bytes);
	const lookup = () => env.DB!.prepare("SELECT * FROM experiment_media WHERE experiment_id = ? AND checksum = ? AND storage_backend = 'private_r2'").bind(experimentId, checksum);
	const existing = (await lookup().all()).results[0];
	const duplicateResponse = (row: Record<string, unknown>): Response => row.deleted_at || row.purge_state === 'purging'
		? jsonResponse({ error: '相同文件已有删除中的记录。请先在媒体管理中恢复或完成彻底删除。', id: row.id }, 409)
		: jsonResponse({ media: mediaFromRow(row), metadataStatus: 'written', deduplicated: true }, 200);
	if (existing) return duplicateResponse(existing);
	const id = `${kind === 'image' ? 'IMG' : 'VID'}-${experimentId}-${crypto.randomUUID()}`;
	const objectKey = `private/${experimentId}/${crypto.randomUUID()}`;
	await env.MEDIA_PRIVATE_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: file.type, cacheControl: 'private, no-store' } });
	// Each candidate owns a unique key. Losing a concurrent insert cannot delete the winner's object.
	// A failed response may follow a committed transaction. Retain the private object
	// on uncertain D1 errors; reconcile unreferenced objects after recovery.
	const result = await env.DB.batch([
		env.DB.prepare(`INSERT INTO experiment_media
			(id, experiment_id, kind, src, captured_at, event_id, plant_id, caption, alt, visibility, review_status, object_key, mime_type, size_bytes, checksum, uploaded_at, storage_backend)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private_r2')
			ON CONFLICT (experiment_id, checksum) WHERE storage_backend = 'private_r2' DO NOTHING RETURNING *`)
			.bind(id, experimentId, kind, mediaContentUrl(id), capturedAt, cleanText(form.get('eventId'), 128) || null, cleanText(form.get('plantId'), 128) || null, caption, alt, visibility, reviewStatus, objectKey, file.type, file.size, checksum, new Date().toISOString()),
		auditStatement(env.DB, id, 'update', null, { operation: 'upload', checksum }),
		lookup(),
	]);
	const selected = result[2].results[0];
	if (selected.id !== id) {
		try { await env.MEDIA_PRIVATE_BUCKET.delete(objectKey); } catch { /* Private orphan: reconcile during maintenance. */ }
		return duplicateResponse(selected);
	}
	return jsonResponse({ media: mediaFromRow(selected), metadataStatus: 'written', deduplicated: false }, 201);
});
