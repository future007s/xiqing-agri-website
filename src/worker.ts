import { onRequestGet as listExperimentMedia, onRequestOptions as listExperimentMediaOptions } from '../functions/api/experiments/[experimentId]/media';
import { onRequestPost as uploadMedia, onRequestOptions as uploadMediaOptions } from '../functions/api/media/upload';
import type { MediaEnv } from '../functions/_shared/media';

interface AssetsFetcher {
	fetch(request: Request): Promise<Response>;
}

type WorkerEnv = MediaEnv & { ASSETS: AssetsFetcher };

function routeParts(request: Request): string[] {
	return new URL(request.url).pathname.split('/').filter(Boolean);
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const parts = routeParts(request);

		if (parts[0] === 'api' && parts[1] === 'media' && parts[2] === 'upload') {
			if (request.method === 'OPTIONS') return uploadMediaOptions();
			if (request.method === 'POST') return uploadMedia({ request, env, params: {} });
		}

		if (parts[0] === 'api' && parts[1] === 'experiments' && parts[3] === 'media' && parts[2]) {
			const context = { request, env, params: { experimentId: parts[2] } };
			if (request.method === 'OPTIONS') return listExperimentMediaOptions();
			if (request.method === 'GET') return listExperimentMedia(context);
		}

		return env.ASSETS.fetch(request);
	},
};
