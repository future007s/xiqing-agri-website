import type { CollectionEntry } from 'astro:content';

export const traceStatusLabels = {
	draft: '草稿',
	planned: '已计划',
	active: '生产中',
	suspended: '已暂停',
	ended: '已结束',
	closed: '已关闭',
	cancelled: '已取消',
	void: '已作废',
} as const;

export const traceStatusLabelsEn = {
	draft: 'Draft',
	planned: 'Planned',
	active: 'Active',
	suspended: 'Suspended',
	ended: 'Ended',
	closed: 'Closed',
	cancelled: 'Cancelled',
	void: 'Void',
} as const;

export const resolutionLabels = {
	entity_exact: '实体直接事实',
	set_exact: '明确成员集合',
	batch_scope: '批次范围',
	shared_exposure: '共享暴露',
	mass_balance_allocation: '质量守恒分配',
	derived: '计算结果',
	unknown: '范围待确认',
} as const;

export const resolutionLabelsEn = {
	entity_exact: 'Entity exact',
	set_exact: 'Known member set',
	batch_scope: 'Batch scope',
	shared_exposure: 'Shared exposure',
	mass_balance_allocation: 'Mass-balance allocation',
	derived: 'Derived',
	unknown: 'Scope pending',
} as const;

export function formatTraceDate(value: string | null | undefined, locale: 'zh' | 'en' = 'zh'): string {
	if (!value) return locale === 'en' ? 'Pending' : '待记录';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
}

export function sortTraceBatchesNewestFirst(
	a: CollectionEntry<'traceBatches'> | CollectionEntry<'traceBatchesEn'>,
	b: CollectionEntry<'traceBatches'> | CollectionEntry<'traceBatchesEn'>,
): number {
	return b.data.id.localeCompare(a.data.id);
}
