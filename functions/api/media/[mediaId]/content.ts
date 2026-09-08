import { authorized, getMediaRow, jsonResponse, optionsResponse, withDatabaseErrors, type PagesContext } from '../../../_shared/media';

export const onRequestOptions = (): Response => optionsResponse();
export const onRequestGet = withDatabaseErrors(async ({ request, env, params }: PagesContext): Promise<Response> => {
	if (!env.DB || !env.MEDIA_PRIVATE_BUCKET) return jsonResponse({ error: '媒体服务尚未配置。' }, 503);
	const row = await getMediaRow(env.DB, params.mediaId ?? '');
	if (!row || row.storage_backend !== 'private_r2' || row.purge_state !== 'active' || row.deleted_at || (!authorized(request, env) && (row.visibility !== 'public' || row.review_status !== 'confirmed'))) return jsonResponse({ error: '媒体不存在或不可访问。' }, 404);
	const metadata = await env.MEDIA_PRIVATE_BUCKET.head(String(row.object_key));
	if (!metadata) return jsonResponse({ error: '媒体文件不存在。' }, 404);
	const headers: Record<string, string> = {
		'Content-Type': String(row.mime_type), 'Cache-Control': 'private, no-store',
		'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
		'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'Vary': 'Authorization',
	};
	let range: { offset: number; length: number } | undefined;
	const requested = request.headers.get('Range');
	if (requested) {
		const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
		const start = match?.[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match?.[2]));
		const end = match?.[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
		if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= metadata.size || end < start) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${metadata.size}` } });
		range = { offset: start, length: end - start + 1 };
		headers['Content-Range'] = `bytes ${start}-${end}/${metadata.size}`;
	}
	headers['Content-Length'] = String(range?.length ?? metadata.size);
	if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
	const object = await env.MEDIA_PRIVATE_BUCKET.get(String(row.object_key), range ? { range } : undefined);
	if (!object) return jsonResponse({ error: '媒体文件不存在。' }, 404);
	return new Response(object.body, { status: range ? 206 : 200, headers });
});
export const onRequestHead = onRequestGet;
