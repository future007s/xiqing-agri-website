import type { CollectionEntry } from 'astro:content';

export const statusLabels = {
	preparing: '准备中',
	running: '运行中',
	completed: '已完成',
	failed: '未通过',
	paused: '暂停',
} as const;

export type ExperimentStatus = keyof typeof statusLabels;

export function displayValue(value: number | string | null | undefined, unit = ''): string {
	if (value === null || value === undefined || value === '') return '待实测';
	return unit ? `${value} ${unit}` : String(value);
}

export function formatDate(date: string | null | undefined): string {
	if (!date) return '待确定';
	return date.replaceAll('-', '.');
}

export function sortExperimentsNewestFirst(
	a: CollectionEntry<'experiments'>,
	b: CollectionEntry<'experiments'>,
): number {
	return b.data.startDate.localeCompare(a.data.startDate);
}
