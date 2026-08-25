import type { CollectionEntry } from 'astro:content';

export const statusLabels = {
	preparing: '准备中',
	running: '运行中',
	completed: '已完成',
	failed: '未通过',
	paused: '暂停',
} as const;

export const statusLabelsEn = {
	preparing: 'Preparing',
	running: 'Running',
	completed: 'Completed',
	failed: 'Not passed',
	paused: 'Paused',
} as const;

export type ExperimentStatus = keyof typeof statusLabels;

export function displayValue(value: number | string | null | undefined, unit = '', pendingLabel = '待实测'): string {
	if (value === null || value === undefined || value === '') return pendingLabel;
	return unit ? `${value} ${unit}` : String(value);
}

export function formatDate(date: string | null | undefined): string {
	if (!date) return '待确定';
	return date.replaceAll('-', '.');
}

export function sortExperimentsNewestFirst(
	a: CollectionEntry<'experiments'> | CollectionEntry<'experimentsEn'>,
	b: CollectionEntry<'experiments'> | CollectionEntry<'experimentsEn'>,
): number {
	return b.data.startDate.localeCompare(a.data.startDate);
}
