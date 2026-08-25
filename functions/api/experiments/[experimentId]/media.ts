import {
	jsonResponse,
	mediaFromRow,
	optionsResponse,
	validExperimentId,
	type MediaEnv,
	type PagesContext,
} from '../../../_shared/media';

export const onRequestOptions = (): Response => optionsResponse();

export const onRequestGet = async ({ env, params }: PagesContext<MediaEnv>): Promise<Response> => {
	const experimentId = params.experimentId ?? '';
	if (!validExperimentId(experimentId)) return jsonResponse({ error: '实验编号无效。' }, 400);
	if (!env.DB) return jsonResponse({ error: '媒体索引数据库尚未配置。' }, 503);

	const result = await env.DB.prepare(`
		SELECT id, experiment_id, kind, src, poster, thumbnail, captured_at, event_id, plant_id,
			caption, alt, visibility, review_status, object_key, mime_type, size_bytes, checksum, uploaded_at
		FROM experiment_media
		WHERE experiment_id = ? AND visibility = 'public' AND review_status = 'confirmed'
		ORDER BY captured_at DESC, uploaded_at DESC
	`).bind(experimentId).all();

	return jsonResponse({ experimentId, media: result.results.map(mediaFromRow) }, 200, { 'Cache-Control': 'no-store' });
};
