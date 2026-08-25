import { onRequestOptions, onRequestPost as manageAction } from '../manage';
import type { MediaEnv, PagesContext } from '../../../_shared/media';

export { onRequestOptions };

export const onRequestPost = ({ request, env, params }: PagesContext<MediaEnv>): Promise<Response> =>
	manageAction({ request, env, params: { ...params, action: 'restore' } });
