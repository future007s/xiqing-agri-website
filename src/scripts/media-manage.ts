import {mediaText as t, mediaError} from '../lib/media-i18n';
export {};

interface ManagedMedia {
	id: string;
	experimentId: string;
	kind: 'image' | 'video';
	src: string;
	poster: string | null;
	thumbnail: string | null;
	at: string;
	eventId: string | null;
	plantId: string | null;
	caption: string;
	alt: string;
	visibility: 'public' | 'private';
	reviewStatus: 'pending' | 'confirmed' | 'rejected';
	objectKey: string;
	mimeType: string;
	sizeBytes: number;
	deletedAt: string | null;
	deleteReason: string | null;
	purgeState: 'active' | 'purging';
	storageBackend: 'private_r2' | 'legacy_public';
}

interface ManagedResponse {
	error?: string;
	media?: ManagedMedia[] | ManagedMedia;
	includeDeleted?: boolean;
	limit?: number;
	action?: string;
}

const authForm = document.querySelector<HTMLFormElement>('#media-manage-auth');
const experimentInput = document.querySelector<HTMLInputElement>('#manage-experiment-id');
const tokenInput = document.querySelector<HTMLInputElement>('#manage-token');
const statusMessage = document.querySelector<HTMLElement>('#manage-status');
const results = document.querySelector<HTMLElement>('#media-management-results');
const summary = document.querySelector<HTMLElement>('#media-management-summary');
const list = document.querySelector<HTMLElement>('#media-management-list');
let currentToken = '';
let currentExperiment = '';
let generation = 0;
const previewUrls = new Set<string>();

const toDateTimeLocal = (value: string): string => {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};

const statusLabel = (media: ManagedMedia): string => media.purgeState === 'purging' ? t('删除待完成') : media.deletedAt ? t('已软删除') : media.reviewStatus === 'confirmed' ? t('已确认') : media.reviewStatus === 'rejected' ? t('已拒绝') : t('待审核');

const createField = (labelText: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): HTMLLabelElement => {
	const label = document.createElement('label');
	label.className = 'management-field';
	const title = document.createElement('span');
	title.textContent = labelText;
	label.append(title, control);
	return label;
};

const input = (value: string, type = 'text'): HTMLInputElement => {
	const control = document.createElement('input');
	control.type = type;
	control.value = value;
	return control;
};

const select = <T extends string>(value: T, options: readonly T[]): HTMLSelectElement => {
	const control = document.createElement('select');
	for (const optionValue of options) {
		const option = document.createElement('option');
		option.value = optionValue;
		option.textContent = optionValue === 'public' ? t('公开实验页') : optionValue === 'private' ? t('仅内部') : optionValue === 'pending' ? t('待审核') : optionValue === 'confirmed' ? t('已确认') : t('已拒绝');
		option.selected = optionValue === value;
		control.append(option);
	}
	return control;
};

const request = async (url: string, init: RequestInit = {}): Promise<ManagedResponse> => {
	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${currentToken}`);
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const response = await fetch(url, { ...init, headers });
	const payload = (await response.json().catch(() => ({}))) as ManagedResponse;
	if (!response.ok) throw new Error(payload.error || `${t('操作失败。')} (${response.status})`);
	return payload;
};

const load = async (): Promise<void> => {
	if (!list || !results || !summary || !statusMessage) return;
	const loadGeneration = ++generation;
	previewUrls.forEach((url) => URL.revokeObjectURL(url)); previewUrls.clear();
	list.replaceChildren();
	statusMessage.textContent = t('正在读取媒体索引……');
	const query = currentExperiment ? `?experimentId=${encodeURIComponent(currentExperiment)}` : '';
	try {
		const payload = await request(`/api/media${query}`);
		if (loadGeneration !== generation) return;
		const media = Array.isArray(payload.media) ? payload.media : [];
		list.replaceChildren(...media.map(renderCard));
		results.hidden = false;
		summary.textContent = document.documentElement.lang === 'en' ? `${media.length} records${currentExperiment ? ` · Experiment ${currentExperiment}` : ''}. Includes soft-deleted records.` : `${media.length} 条记录${currentExperiment ? ` · 实验 ${currentExperiment}` : ''}。已软删除记录仍会列出。`;
		statusMessage.textContent = t('读取完成。');
	} catch (error) {
		statusMessage.textContent = error instanceof Error ? mediaError(error.message) : t('读取失败，请稍后重试。');
	}
};

const renderCard = (media: ManagedMedia): HTMLElement => {
	const card = document.createElement('article');
	card.className = `management-card${media.deletedAt ? ' management-card--deleted' : ''}`;

	const header = document.createElement('header');
	const title = document.createElement('h3');
	title.textContent = media.caption || media.id;
	const badge = document.createElement('span');
	badge.className = 'record-badge';
	badge.textContent = statusLabel(media);
	header.append(title, badge);
	card.append(header);

	const preview = document.createElement('div');
	preview.className = 'management-card__preview';
	const previewButton = document.createElement('button');
	previewButton.type = 'button';
	previewButton.textContent = media.storageBackend === 'legacy_public' ? t('旧文件待迁移') : media.deletedAt ? t('恢复后可预览') : t('加载预览');
	previewButton.disabled = !!media.deletedAt || media.storageBackend !== 'private_r2';
	previewButton.addEventListener('click', async () => {
		const previewGeneration = generation;
		previewButton.disabled = true;
		try {
			const response = await fetch(`/api/media/${encodeURIComponent(media.id)}/content`, { headers: { Authorization: `Bearer ${currentToken}` } });
			if (!response.ok) throw new Error(t('文件暂不可访问。'));
			const blob = await response.blob();
			if (previewGeneration !== generation) return;
			const url = URL.createObjectURL(blob); previewUrls.add(url);
			const element = document.createElement(media.kind === 'video' ? 'video' : 'img');
			element.src = url;
			if (element instanceof HTMLVideoElement) element.controls = true;
			else element.alt = media.alt;
			const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = media.id;
			preview.replaceChildren(element, link);
		} catch (error) {
			previewButton.textContent = error instanceof Error ? mediaError(error.message) : t('预览失败');
			previewButton.disabled = false;
		}
	});
	preview.append(previewButton);
	card.append(preview);

	const form = document.createElement('div');
	form.className = 'management-card__form';
	const capturedAt = input(toDateTimeLocal(media.at), 'datetime-local');
	const caption = input(media.caption);
	const alt = document.createElement('textarea');
	alt.rows = 2;
	alt.value = media.alt;
	const eventId = input(media.eventId || '');
	const plantId = input(media.plantId || '');
	const visibility = select(media.visibility, ['public', 'private'] as const);
	const reviewStatus = select(media.reviewStatus, ['pending', 'confirmed', 'rejected'] as const);
	const reason = input('');
	reason.placeholder = t('可选：修改或删除原因');
	form.append(
		createField(t('拍摄时间'), capturedAt),
		createField(t('媒体说明'), caption),
		createField(t('无障碍描述'), alt),
		createField(t('关联事件'), eventId),
		createField(t('关联植物'), plantId),
		createField(t('可见范围'), visibility),
		createField(t('审核状态'), reviewStatus),
		createField(t('操作原因'), reason),
	);
	card.append(form);

	const actions = document.createElement('div');
	actions.className = 'management-card__actions';
	const save = document.createElement('button');
	save.className = 'button button--dark';
	save.type = 'button';
	save.disabled = media.purgeState === 'purging';
	save.textContent = t('保存修改');
	save.addEventListener('click', async () => {
		save.disabled = true;
		try {
			await request(`/api/media/${encodeURIComponent(media.id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ capturedAt: capturedAt.value === toDateTimeLocal(media.at) ? media.at : capturedAt.value ? new Date(capturedAt.value).toISOString() : '', caption: caption.value, alt: alt.value, eventId: eventId.value, plantId: plantId.value, visibility: visibility.value, reviewStatus: reviewStatus.value, reason: reason.value }),
			});
			statusMessage!.textContent = `${media.id} ${t('已保存。')}`;
			await load();
		} catch (error) {
			statusMessage!.textContent = error instanceof Error ? mediaError(error.message) : t('保存失败。');
		} finally {
			save.disabled = false;
		}
	});
	actions.append(save);

	const remove = document.createElement('button');
	remove.className = 'button';
	remove.type = 'button';
	remove.disabled = media.purgeState === 'purging';
	remove.textContent = media.deletedAt ? t('恢复记录') : t('软删除');
	remove.addEventListener('click', async () => {
		remove.disabled = true;
		try {
			if (media.deletedAt) {
				await request(`/api/media/${encodeURIComponent(media.id)}/restore`, { method: 'POST' });
			} else {
				await request(`/api/media/${encodeURIComponent(media.id)}?reason=${encodeURIComponent(reason.value)}`, { method: 'DELETE' });
			}
			statusMessage!.textContent = media.deletedAt ? `${media.id} ${t('已恢复。')}` : `${media.id} ${t('已软删除。')}`;
			await load();
		} catch (error) {
			statusMessage!.textContent = error instanceof Error ? mediaError(error.message) : t('操作失败。');
		} finally {
			remove.disabled = false;
		}
	});
	actions.append(remove);

	if (media.deletedAt) {
		const purge = document.createElement('button');
		purge.className = 'button button--danger';
		purge.type = 'button';
		purge.textContent = media.purgeState === 'purging' ? t('重试彻底删除') : t('彻底删除');
		purge.disabled = media.storageBackend !== 'private_r2';
		purge.addEventListener('click', async () => {
			if (!window.confirm(t('这会同时删除 R2 文件和 D1 记录，且无法恢复。确认彻底删除吗？'))) return;
			purge.disabled = true;
			try {
				await request(`/api/media/${encodeURIComponent(media.id)}/purge?reason=${encodeURIComponent(reason.value)}`, { method: 'POST', headers: { 'X-Confirm-Purge': 'PURGE' } });
				statusMessage!.textContent = `${media.id} ${t('已彻底删除。')}`;
				await load();
			} catch (error) {
				statusMessage!.textContent = error instanceof Error ? mediaError(error.message) : t('彻底删除失败。');
			} finally {
				purge.disabled = false;
			}
		});
		actions.append(purge);
	}
	card.append(actions);
	return card;
};

authForm?.addEventListener('submit', async (event) => {
	event.preventDefault();
	currentToken = tokenInput?.value.trim() || '';
	currentExperiment = experimentInput?.value.trim() || '';
	await load();
});
