export type MediaKind = 'image' | 'video';
export type Visibility = 'public' | 'private';
export type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

export interface MediaRecord {
	id: string;
	experimentId: string;
	kind: MediaKind;
	src: string;
	poster: string | null;
	thumbnail: string | null;
	at: string;
	eventId: string | null;
	plantId: string | null;
	caption: string;
	alt: string;
	visibility: Visibility;
	reviewStatus: ReviewStatus;
	storage: 'r2';
	objectKey: string;
	mimeType: string;
	sizeBytes: number;
	checksum: string;
	source: 'manual_upload';
	uploadedAt: string;
	deletedAt: string | null;
	deleteReason: string | null;
	purgeState: 'active' | 'purging';
	storageBackend: 'private_r2' | 'legacy_public';
}

export interface R2ObjectLike {
	size: number;
	body: ReadableStream<Uint8Array>;
}

export interface R2BucketLike {
	head(key: string): Promise<{ size: number } | null>;
	get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectLike | null>;
	put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
	delete(key: string): Promise<unknown>;
}

export interface D1PreparedLike {
	bind(...values: unknown[]): D1PreparedLike;
	run(): Promise<unknown>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
	prepare(sql: string): D1PreparedLike;
	batch(statements: D1PreparedLike[]): Promise<{ results: Record<string, unknown>[] }[]>;
}

export interface MediaEnv {
	MEDIA_PRIVATE_BUCKET?: R2BucketLike;
	DB?: D1DatabaseLike;
	MEDIA_UPLOAD_TOKEN?: string;
	DEFAULT_TIMEZONE_OFFSET?: string;
}

export interface PagesContext<Env = MediaEnv> {
	request: Request;
	env: Env;
	params: Record<string, string | undefined>;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*',
			...headers,
		},
	});
}

export function isOptions(request: Request): boolean {
	return request.method.toUpperCase() === 'OPTIONS';
}

export function optionsResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Confirm-Purge',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
		},
	});
}

export function authorized(request: Request, env: MediaEnv): boolean {
	if (!env.MEDIA_UPLOAD_TOKEN) return false;
	const header = request.headers.get('Authorization') ?? '';
	return header === `Bearer ${env.MEDIA_UPLOAD_TOKEN}`;
}

export function validExperimentId(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function cleanText(value: FormDataEntryValue | string | null, maxLength: number): string {
	return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeCapturedAt(value: string, offset = '+08:00'): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?([zZ]|[+-]\d{2}:\d{2})?$/.exec(value.trim());
	if (!match) throw new Error('拍摄时间格式无效。');
	const [, year, month, day, hour, minute, second = '00', fraction = '', timezone = offset] = match;
	const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
	if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || !/^(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.test(timezone) || (/^[+-]14:/.test(timezone) && !timezone.endsWith(':00'))) throw new Error('拍摄时间或时区无效。');
	const result = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${timezone.toUpperCase()}`;
	if (!Number.isFinite(Date.parse(result))) throw new Error('拍摄时间无效。');
	return result;
}

export const mediaContentUrl = (id: string): string => `/api/media/${encodeURIComponent(id)}/content`;

export const getMediaRow = async (db: D1DatabaseLike, id: string): Promise<Record<string, unknown> | null> =>
	(await db.prepare('SELECT * FROM experiment_media WHERE id = ?').bind(id).all()).results[0] ?? null;

// Must immediately follow its mutation in the same D1 batch transaction.
export const auditStatement = (db: D1DatabaseLike, id: string, action: string, reason: string | null, details: Record<string, unknown> = {}): D1PreparedLike =>
	db.prepare(`INSERT INTO experiment_media_audit (media_id, action, actor, reason, details_json)
		SELECT ?, ?, 'media-admin', ?, ? WHERE changes() > 0`).bind(id, action, reason, JSON.stringify(details));

export function withDatabaseErrors<T extends PagesContext>(handler: (context: T) => Promise<Response>): (context: T) => Promise<Response> {
	return async (context) => {
		try { return await handler(context); }
		catch { return jsonResponse({ error: '媒体操作未完成。请检查数据库迁移及存储连接后重试。' }, 503); }
	};
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mediaFromRow(row: Record<string, unknown>): MediaRecord {
	const src = row.storage_backend === 'private_r2' ? mediaContentUrl(String(row.id)) : '';
	return {
		id: String(row.id),
		experimentId: String(row.experiment_id),
		kind: row.kind === 'video' ? 'video' : 'image',
		src,
		poster: null,
		thumbnail: row.kind === 'image' ? src || null : null,
		at: String(row.captured_at),
		eventId: row.event_id ? String(row.event_id) : null,
		plantId: row.plant_id ? String(row.plant_id) : null,
		caption: String(row.caption),
		alt: String(row.alt),
		visibility: row.visibility === 'public' ? 'public' : 'private',
		reviewStatus: row.review_status === 'confirmed' ? 'confirmed' : row.review_status === 'rejected' ? 'rejected' : 'pending',
		storage: 'r2',
		storageBackend: row.storage_backend === 'private_r2' ? 'private_r2' : 'legacy_public',
		purgeState: row.purge_state === 'purging' ? 'purging' : 'active',
		objectKey: String(row.object_key),
		mimeType: String(row.mime_type),
		sizeBytes: Number(row.size_bytes),
		checksum: String(row.checksum),
		source: 'manual_upload',
		uploadedAt: String(row.uploaded_at),
		deletedAt: row.deleted_at ? String(row.deleted_at) : null,
		deleteReason: row.delete_reason ? String(row.delete_reason) : null,
	};
}
