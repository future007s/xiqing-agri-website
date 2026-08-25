import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const reviewStatus = z.enum(['pending', 'confirmed', 'rejected']).default('confirmed');

const sensorSchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.string(),
	protocol: z.string().nullable().optional(),
	location: z.string().nullable().optional(),
	unit: z.string().nullable().optional(),
	status: z.enum(['planned', 'online', 'offline', 'fault']).default('planned'),
});

const eventSchema = z.object({
	id: z.string(),
	at: z.string(),
	type: z.string(),
	title: z.string(),
	status: z.enum(['planned', 'completed', 'failed', 'paused']).default('completed'),
	summary: z.string().optional(),
	operator: z.string().nullable().optional(),
});

const telemetrySnapshotSchema = z.object({
	at: z.string(),
	source: z.string(),
	status: z.enum(['observed', 'partial', 'pending', 'invalid']).default('observed'),
	metrics: z.array(
		z.object({
			key: z.string(),
			label: z.string(),
			value: z.union([z.string(), z.number()]),
			unit: z.string().optional(),
			quality: z.enum(['observed', 'estimated', 'pending', 'invalid']).default('observed'),
		}),
	).default([]),
});

const observationSchema = z.object({
	id: z.string(),
	at: z.string(),
	category: z.string(),
	subject: z.string(),
	summary: z.string(),
	detail: z.string().optional(),
	severity: z.enum(['info', 'attention', 'critical']).default('info'),
	reviewStatus,
	});

const analysisSchema = z.object({
	id: z.string(),
	at: z.string(),
	method: z.string(),
	subject: z.string(),
	result: z.string(),
	confidence: z.number().nullable().optional(),
	sourceMediaId: z.string().nullable().optional(),
	reviewStatus,
});

const mediaSchema = z.object({
	id: z.string(),
	kind: z.enum(['image', 'video']),
	src: z.string(),
	poster: z.string().nullable().optional(),
	thumbnail: z.string().nullable().optional(),
	at: z.string(),
	eventId: z.string().nullable().optional(),
	plantId: z.string().nullable().optional(),
	caption: z.string(),
	alt: z.string(),
	visibility: z.enum(['public', 'private']).default('public'),
	reviewStatus,
	storage: z.enum(['static', 'r2', 'external']).default('static'),
	objectKey: z.string().nullable().optional(),
	mimeType: z.string().nullable().optional(),
	sizeBytes: z.number().int().nullable().optional(),
	checksum: z.string().nullable().optional(),
	source: z.enum(['manual_upload', 'camera', 'dtu', 'ocr', 'external']).default('manual_upload'),
	uploadedAt: z.string().nullable().optional(),
});

const experimentSchema = z.object({
		templateVersion: z.number().int().default(1),
		id: z.string(),
		title: z.string(),
		tower: z.string(),
		status: z.enum(['preparing', 'running', 'completed', 'failed', 'paused']),
		startDate: z.string(),
		endDate: z.string().nullable().optional(),
		harvestDate: z.string().nullable().optional(),
		plant: z.string(),
		cultivar: z.string().nullable().optional(),
		location: z.string().nullable().optional(),
		timezone: z.string().default('Asia/Shanghai'),
		operator: z.string().nullable().optional(),
		towerHeightM: z.number(),
		designPlants: z.number().int(),
		survivalRate: z.number().nullable().optional(),
		yieldKg: z.number().nullable().optional(),
		electricityKwh: z.number().nullable().optional(),
		waterL: z.number().nullable().optional(),
		costCny: z.number().nullable().optional(),
		objectives: z.array(z.string()).default([]),
		sensors: z.array(sensorSchema).default([]),
		events: z.array(eventSchema).default([]),
		telemetry: z.array(telemetrySnapshotSchema).default([]),
		observations: z.array(observationSchema).default([]),
		analyses: z.array(analysisSchema).default([]),
		media: z.array(mediaSchema).default([]),
		featured: z.boolean().default(false),
	});

const experiments = defineCollection({
	loader: glob({ base: './src/content/experiments', pattern: '**/*.{md,mdx}' }),
	schema: experimentSchema,
});

const experimentsEn = defineCollection({
	loader: glob({ base: './src/content/experiments-en', pattern: '**/*.{md,mdx}' }),
	schema: experimentSchema,
});

export const collections = { experiments, experimentsEn };
