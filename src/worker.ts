import { onRequestGet as listExperimentMedia, onRequestOptions as listExperimentMediaOptions } from '../functions/api/experiments/[experimentId]/media';
import { onRequestPost as uploadMedia, onRequestOptions as uploadMediaOptions } from '../functions/api/media/upload';
import {
	onRequestDelete as manageDelete,
	onRequestGet as manageList,
	onRequestOptions as manageOptions,
	onRequestPatch as managePatch,
	onRequestPost as manageAction,
} from '../functions/api/media/manage';
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

		if (parts[0] === 'api' && parts[1] === 'media' && parts[2] !== 'upload') {
			if (request.method === 'OPTIONS') return manageOptions();
			if (parts.length === 2 && request.method === 'GET') return manageList({ request, env, params: {} });
			if (parts.length === 3 && parts[2]) {
				const context = { request, env, params: { mediaId: parts[2] } };
				if (request.method === 'PATCH') return managePatch(context);
				if (request.method === 'DELETE') return manageDelete(context);
			}
			if (parts.length === 4 && parts[2] && (parts[3] === 'restore' || parts[3] === 'purge') && request.method === 'POST') {
				return manageAction({ request, env, params: { mediaId: parts[2], action: parts[3] } });
			}
		}

		if (parts[0] === 'api' && parts[1] === 'experiments' && parts[3] === 'media' && parts[2]) {
			const context = { request, env, params: { experimentId: parts[2] } };
			if (request.method === 'OPTIONS') return listExperimentMediaOptions();
			if (request.method === 'GET') return listExperimentMedia(context);
		}

		return env.ASSETS.fetch(request);
	},
};
