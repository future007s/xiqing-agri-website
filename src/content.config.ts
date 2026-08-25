import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const experiments = defineCollection({
	loader: glob({ base: './src/content/experiments', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		id: z.string(),
		title: z.string(),
		tower: z.string(),
		status: z.enum(['preparing', 'running', 'completed', 'failed', 'paused']),
		startDate: z.string(),
		harvestDate: z.string().nullable().optional(),
		plant: z.string(),
		towerHeightM: z.number(),
		designPlants: z.number().int(),
		survivalRate: z.number().nullable().optional(),
		yieldKg: z.number().nullable().optional(),
		electricityKwh: z.number().nullable().optional(),
		waterL: z.number().nullable().optional(),
		costCny: z.number().nullable().optional(),
		featured: z.boolean().default(false),
	}),
});

export const collections = { experiments };
