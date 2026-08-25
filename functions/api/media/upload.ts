import {
	authorized,
	cleanText,
	isOptions,
	jsonResponse,
	normalizeCapturedAt,
	optionsResponse,
	publicObjectUrl,
	safeFileName,
	sha256Hex,
	validExperimentId,
	type MediaEnv,
	type MediaRecord,
	type PagesContext,
} from '../../_shared/media';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export const onRequestOptions = (): Response => optionsResponse();

export const onRequestPost = async ({ request, env }: PagesContext<MediaEnv>): Promise<Response> => {
	if (isOptions(request)) return optionsResponse();
	if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'MEDIA_BUCKET 未配置。请先绑定 R2 存储桶。' }, 503);
	if (!authorized(request, env)) return jsonResponse({ error: '上传口令无效，或接口尚未配置 MEDIA_UPLOAD_TOKEN。' }, 401);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return jsonResponse({ error: '请求不是有效的 multipart/form-data。' }, 400);
	}

	const experimentId = cleanText(form.get('experimentId'), 64);
	const kind = cleanText(form.get('kind'), 12) as 'image' | 'video';
	const file = form.get('file');
	if (!validExperimentId(experimentId)) return jsonResponse({ error: '实验编号只能包含字母、数字、下划线和短横线。' }, 400);
	if (kind !== 'image' && kind !== 'video') return jsonResponse({ error: '媒体类型只能是 image 或 video。' }, 400);
	if (!(file instanceof File)) return jsonResponse({ error: '没有收到图片或视频文件。' }, 400);

	const allowedTypes = kind === 'image' ? ALLOWED_IMAGE_TYPES : ALLOWED_VIDEO_TYPES;
	const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
	if (!allowedTypes.has(file.type)) return jsonResponse({ error: `不支持的文件类型：${file.type || '未知类型'}。` }, 415);
	if (file.size <= 0 || file.size > maxBytes) return jsonResponse({ error: `文件过大。${kind === 'image' ? '图片' : '视频'}上限为 ${Math.round(maxBytes / 1024 / 1024)} MB。` }, 413);

	const capturedAt = normalizeCapturedAt(cleanText(form.get('capturedAt'), 64), env.DEFAULT_TIMEZONE_OFFSET ?? '+08:00');
	const uploadedAt = new Date().toISOString();
	const { base, extension } = safeFileName(file.name);
	const uniqueId = crypto.randomUUID();
	const mediaId = `${kind === 'image' ? 'IMG' : 'VID'}-${experimentId}-${uniqueId.slice(0, 8)}`;
	const dateKey = capturedAt.slice(0, 10).replace(/[^0-9-]/g, '') || uploadedAt.slice(0, 10);
	const objectKey = `experiments/${experimentId}/${dateKey}/${uniqueId}-${base}.${extension}`;
	const bytes = await file.arrayBuffer();
	const checksum = await sha256Hex(bytes);
	await env.MEDIA_BUCKET.put(objectKey, bytes, {
		httpMetadata: {
			contentType: file.type,
			cacheControl: 'public, max-age=31536000, immutable',
		},
	});

	const src = publicObjectUrl(env.MEDIA_PUBLIC_BASE_URL, objectKey);
	const record: MediaRecord = {
		id: mediaId,
		experimentId,
		kind,
		src,
		poster: cleanText(form.get('poster'), 1000) || null,
		thumbnail: cleanText(form.get('thumbnail'), 1000) || (kind === 'image' ? src : null),
		at: capturedAt,
		eventId: cleanText(form.get('eventId'), 128) || null,
		plantId: cleanText(form.get('plantId'), 128) || null,
		caption: cleanText(form.get('caption'), 240) || base,
		alt: cleanText(form.get('alt'), 500) || `${kind === 'image' ? '实验图片' : '实验视频'}：${base}`,
		visibility: cleanText(form.get('visibility'), 12) === 'private' ? 'private' : 'public',
		reviewStatus: cleanText(form.get('reviewStatus'), 12) === 'confirmed' ? 'confirmed' : 'pending',
		storage: 'r2',
		objectKey,
		mimeType: file.type,
		sizeBytes: file.size,
		checksum,
		source: 'manual_upload',
		uploadedAt,
		deletedAt: null,
		deleteReason: null,
	};

	let metadataStatus: 'written' | 'pending_db' = 'pending_db';
	if (env.DB) {
		try {
			await env.DB.prepare(`
				INSERT INTO experiment_media (
					id, experiment_id, kind, src, poster, thumbnail, captured_at, event_id, plant_id,
					caption, alt, visibility, review_status, object_key, mime_type, size_bytes,
					checksum, uploaded_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					src = excluded.src, poster = excluded.poster, thumbnail = excluded.thumbnail,
					caption = excluded.caption, alt = excluded.alt, visibility = excluded.visibility,
					review_status = excluded.review_status, object_key = excluded.object_key,
					mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
					checksum = excluded.checksum, uploaded_at = excluded.uploaded_at
			`).bind(
				record.id, record.experimentId, record.kind, record.src, record.poster, record.thumbnail,
				record.at, record.eventId, record.plantId, record.caption, record.alt, record.visibility,
				record.reviewStatus, record.objectKey, record.mimeType, record.sizeBytes, record.checksum,
				record.uploadedAt,
			).run();
			metadataStatus = 'written';
		} catch {
			// The R2 object is intentionally kept. The returned record can be replayed after the DB is migrated.
			metadataStatus = 'pending_db';
		}
	}

	return jsonResponse({ media: record, metadataStatus }, metadataStatus === 'written' ? 201 : 202);
};
