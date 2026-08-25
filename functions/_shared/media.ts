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
}

export interface R2BucketLike {
	put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
}

export interface D1PreparedLike {
	bind(...values: unknown[]): D1PreparedLike;
	run(): Promise<unknown>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
	prepare(sql: string): D1PreparedLike;
}

export interface MediaEnv {
	MEDIA_BUCKET?: R2BucketLike;
	DB?: D1DatabaseLike;
	MEDIA_PUBLIC_BASE_URL?: string;
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
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
	const trimmed = value.trim();
	if (!trimmed) return new Date().toISOString();
	if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
	return `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}${offset}`;
}

export function safeFileName(fileName: string): { base: string; extension: string } {
	const original = fileName.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
	const dot = original.lastIndexOf('.');
	const extension = dot > 0 ? original.slice(dot + 1).toLowerCase().slice(0, 12) : 'bin';
	const base = (dot > 0 ? original.slice(0, dot) : original).slice(0, 80) || 'upload';
	return { base, extension };
}

export function publicObjectUrl(baseUrl: string | undefined, objectKey: string): string {
	const base = (baseUrl ?? '').replace(/\/+$/, '');
	const encodedKey = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
	return `${base}/${encodedKey}`;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mediaFromRow(row: Record<string, unknown>): MediaRecord {
	return {
		id: String(row.id),
		experimentId: String(row.experiment_id),
		kind: row.kind === 'video' ? 'video' : 'image',
		src: String(row.src),
		poster: row.poster ? String(row.poster) : null,
		thumbnail: row.thumbnail ? String(row.thumbnail) : null,
		at: String(row.captured_at),
		eventId: row.event_id ? String(row.event_id) : null,
		plantId: row.plant_id ? String(row.plant_id) : null,
		caption: String(row.caption),
		alt: String(row.alt),
		visibility: row.visibility === 'private' ? 'private' : 'public',
		reviewStatus: row.review_status === 'rejected' ? 'rejected' : row.review_status === 'pending' ? 'pending' : 'confirmed',
		storage: 'r2',
		objectKey: String(row.object_key),
		mimeType: String(row.mime_type),
		sizeBytes: Number(row.size_bytes),
		checksum: String(row.checksum),
		source: 'manual_upload',
		uploadedAt: String(row.uploaded_at),
	};
}
