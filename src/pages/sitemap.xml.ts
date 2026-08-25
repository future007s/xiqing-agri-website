import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL('https://xiqingagri.com');
	const experiments = await getCollection('experiments');
	const paths = [
		'/',
		'/experiments',
		'/about',
		...experiments.map(({ id }) => `/experiments/${id}`),
		'/en',
		'/en/experiments',
		'/en/about',
		...experiments.map(({ id }) => `/en/experiments/${id}`),
	];
	const urls = paths.map((path) => `<url><loc>${new URL(path, base).href}</loc></url>`).join('');

	return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
