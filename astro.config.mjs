// @ts-check
import { defineConfig } from 'astro/config';
import { syncEnglishRecords } from './scripts/sync-english-records.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'https://xiqingagri.com',
	integrations: [{name:'english-records', hooks:{'astro:config:setup': async () => { await syncEnglishRecords(); }}}],
	trailingSlash: 'never',
	i18n: {
		locales: ['zh', 'en'],
		defaultLocale: 'zh',
		routing: {
			prefixDefaultLocale: false,
		},
	},
});
