interface UploadedMedia {
	id: string;
	kind: 'image' | 'video';
	src: string;
	poster: string | null;
	thumbnail: string | null;
	at: string;
	eventId: string | null;
	plantId: string | null;
	caption: string;
	alt: string;
	visibility: string;
	reviewStatus: string;
	storage: string;
	objectKey: string;
}

interface UploadResponse {
	error?: string;
	metadataStatus?: 'written' | 'pending_db';
	media?: UploadedMedia;
}

const form = document.querySelector<HTMLFormElement>('#media-upload-form');
const fileInput = document.querySelector<HTMLInputElement>('#media-file');
const kindInput = document.querySelector<HTMLSelectElement>('#media-kind');
const capturedAtInput = document.querySelector<HTMLInputElement>('#captured-at');
const preview = document.querySelector<HTMLElement>('#media-preview');
const statusMessage = document.querySelector<HTMLElement>('#upload-status');
const result = document.querySelector<HTMLElement>('#upload-result');
const resultNote = document.querySelector<HTMLElement>('#upload-result-note');
const snippet = document.querySelector<HTMLElement>('#upload-snippet code');
const copyButton = document.querySelector<HTMLButtonElement>('#copy-snippet');
let previewUrl = '';

const localDateTime = (): string => {
	const now = new Date();
	const offset = now.getTimezoneOffset() * 60000;
	return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

if (capturedAtInput) capturedAtInput.value = localDateTime();

const showPreview = (): void => {
	if (!fileInput || !preview) return;
	const file = fileInput.files?.[0];
	if (!file) {
		preview.hidden = true;
		preview.replaceChildren();
		return;
	}
	if (previewUrl) URL.revokeObjectURL(previewUrl);
	previewUrl = URL.createObjectURL(file);
	preview.hidden = false;
	preview.replaceChildren();
	const label = document.createElement('p');
	label.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
	preview.append(label);
	if (file.type.startsWith('video/')) {
		const video = document.createElement('video');
		video.controls = true;
		video.src = previewUrl;
		preview.append(video);
		if (kindInput) kindInput.value = 'video';
	} else if (file.type.startsWith('image/')) {
		const image = document.createElement('img');
		image.src = previewUrl;
		image.alt = '待上传图片预览';
		preview.append(image);
		if (kindInput) kindInput.value = 'image';
	}
};

fileInput?.addEventListener('change', showPreview);

const makeSnippet = (media: UploadedMedia): string => `  - id: "${media.id}"
    kind: "${media.kind}"
    src: "${media.src}"
    poster: ${media.poster ? `"${media.poster}"` : ''}
    thumbnail: ${media.thumbnail ? `"${media.thumbnail}"` : ''}
    at: "${media.at}"
    eventId: ${media.eventId ? `"${media.eventId}"` : ''}
    plantId: ${media.plantId ? `"${media.plantId}"` : ''}
    caption: "${media.caption}"
    alt: "${media.alt}"
    visibility: "${media.visibility}"
    reviewStatus: "${media.reviewStatus}"
    storage: "${media.storage}"
    objectKey: "${media.objectKey}"`;

form?.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!fileInput?.files?.[0] || !statusMessage || !result || !resultNote || !snippet) return;
	statusMessage.textContent = '正在上传并写入媒体索引……';
	result.hidden = true;
	const formData = new FormData(form);
	const token = String(formData.get('uploadToken') || '');
	formData.delete('uploadToken');
	try {
		const response = await fetch('/api/media/upload', {
			method: 'POST',
			body: formData,
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
		const payload = (await response.json().catch(() => ({}))) as UploadResponse;
		if (!response.ok || !payload.media) throw new Error(payload.error || `上传失败（${response.status}）`);
		statusMessage.textContent = '上传成功。请检查字段后粘贴到对应实验模板。';
		result.hidden = false;
		resultNote.textContent = payload.metadataStatus === 'pending_db' ? '文件已进入 R2，但媒体索引数据库尚未绑定；请先保存下面字段。' : `媒体 ID：${payload.media.id}`;
		snippet.textContent = makeSnippet(payload.media);
	} catch (error) {
		statusMessage.textContent = error instanceof Error ? error.message : '上传失败，请稍后重试。';
	}
});

copyButton?.addEventListener('click', async () => {
	if (!snippet?.textContent) return;
	await navigator.clipboard.writeText(snippet.textContent);
	copyButton.textContent = '已复制 ✓';
	setTimeout(() => { copyButton.innerHTML = '复制到剪贴板 <span aria-hidden="true">↗</span>'; }, 1800);
});
