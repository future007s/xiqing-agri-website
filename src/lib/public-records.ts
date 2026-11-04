import { parseRecordContract } from './record-days';

// Keep the original starter records in source without publishing them as field records.
export function isPublicExperiment(entry: { data: { id: string } }): boolean {
	return entry.data.id !== 'T01-001';
}

export function isPublicTraceBatch(entry: { data: { id: string } }): boolean {
	return entry.data.id !== 'PB-QDF01-20260824-01';
}

type ExperimentIdentity = { data: { id: string; productionBatchId?: string | null } };
type BatchIdentity = { id: string; data: { id: string; sourceExperimentId?: string | null } };

export function productionBatchesForExperiment<T extends BatchIdentity>(experiment: ExperimentIdentity, batches: T[]): T[] {
	return batches.filter(batch => isPublicTraceBatch(batch) &&
		(batch.data.sourceExperimentId === experiment.data.id || batch.data.id === experiment.data.productionBatchId))
		.sort((a, b) => b.data.id.localeCompare(a.data.id));
}

export function currentGrowingRecord(experiment: { body?: string; data: { id: string } }) {
	const day = parseRecordContract(experiment.body, experiment.data.id)?.days.at(-1);
	const records = day?.batches.flatMap(batch => batch.records) ?? [];
	const operations = records.filter(record => record.kind === 'operation').flatMap(record => record.fields.filter(field => field.label === '操作'));
	const observations = records.filter(record => record.kind === 'daily').flatMap(record => record.fields.filter(field => field.label === '可见范围与变化'));
	return { date: day?.date, phase: [...new Set(day?.batches.map(batch => batch.context.phase))].join('、'),
		summary: (operations.length ? operations : observations).map(field => field.value).join('；') };
}
