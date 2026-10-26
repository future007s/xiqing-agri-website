import {adjacentDates, isDay, readDay, readIndex, type RecordDay, type RecordIndex} from './record-days';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
};
export function renderRecordDay(day: RecordDay): HTMLElement {
  const article = element('article');
  article.dataset.recordDay = day.date;
  article.append(element('h2', day.date));
  if (day.environment.length) {
    const section = element('section'); section.className = 'record-day-item'; section.dataset.dayEnvironment = '';
    section.append(element('h3', '环境记录'));
    const list = element('dl'); list.className = 'record-day-environment';
    for (const environment of day.environment) for (const metric of environment.metrics) {
      const pair = element('div'); pair.append(element('dt', metric.label), element('dd', `${metric.mean} ${metric.unit}`)); list.append(pair);
    }
    section.append(list); article.append(section);
  }
  for (const batch of day.batches) {
    const section = element('section'); section.className = 'record-day-item'; section.dataset.recordBatch = batch.key;
    section.append(element('h3', batch.label));
    const list = element('ul'); list.className = 'record-day-batch-context';
    const c = batch.context;
    const values = [['作物', c.crop], ['材料', c.material],
      ['播种日期', c.sowing.value ? (c.sowing.precision === 'approximate_day' ? '约' : '') + c.sowing.value : null],
      ['育苗盘', c.tray_holes == null ? null : `${c.tray_holes}孔`],
      ['播种数量', c.sown_seeds == null ? null : `${c.sown_seeds}粒`], ['阶段', c.phase]];
    for (const [label, value] of values) if (value) list.append(element('li', `${label}：${value}`));
    section.append(list);
    for (const record of batch.records) {
      const observation = element('section'); observation.className = 'record-observation'; observation.dataset.recordId = record.id;
      observation.append(element('h4', record.title));
      if (record.status === 'planned') observation.append(element('p', '计划'));
      const fields = element('ul');
      for (const field of record.fields) fields.append(element('li', `${field.label}：${field.value}`));
      observation.append(fields);
      for (const image of record.images) {
        const figure = element('figure'), img = element('img');
        img.src = image.src; img.alt = image.alt; img.loading = 'lazy'; img.decoding = 'async'; img.dataset.recordDate = image.date;
        figure.append(img); observation.append(figure);
      }
      section.append(observation);
    }
    article.append(section);
  }
  return article;
}

export async function initRecordBrowser(root: HTMLElement) {
  if (root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const form = root.querySelector('form')!, input = root.querySelector<HTMLInputElement>('input')!;
  const previous = root.querySelector<HTMLButtonElement>('[data-record-previous]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-record-next]')!;
  const submit = root.querySelector<HTMLButtonElement>('[data-record-submit]')!;
  const status = root.querySelector<HTMLElement>('[data-record-status]')!;
  const target = document.querySelector<HTMLElement>('[data-record-day-content]')!;
  const experimentId = root.dataset.experimentId!, base = root.dataset.recordBase!;
  let index: RecordIndex, selected = '', request = 0, controller: AbortController | undefined;
  const message = (text: string) => target.replaceChildren(element('p', text));
  const updateButtons = () => {
    const adjacent = adjacentDates(index.dates, selected);
    previous.disabled = !adjacent.previous; next.disabled = !adjacent.next;
  };
  const show = async (date: string, push: boolean) => {
    selected = date; input.value = isDay(date) ? date : ''; updateButtons();
    const currentRequest = ++request; controller?.abort(); controller = new AbortController();
    if (push) { const url = new URL(location.href); url.searchParams.set('date', date); history.pushState(null, '', url); }
    target.setAttribute('aria-busy', 'true'); target.replaceChildren();
    if (!isDay(date) || !index.dates.includes(date)) {
      status.textContent = isDay(date) ? `${date} · 没有记录` : '请选择记录日期';
      message(isDay(date) ? '这一天没有记录。' : '请选择有效日期。'); target.removeAttribute('aria-busy'); return;
    }
    status.textContent = `${date} · 正在读取…`; message('正在读取当天记录…');
    try {
      const response = await fetch(`${base}/${date}.json`, {signal: controller.signal, cache: 'no-cache'});
      if (!response.ok) throw new Error('Day unavailable');
      const day = readDay(await response.json(), experimentId, date);
      if (request !== currentRequest) return;
      target.replaceChildren(renderRecordDay(day)); target.removeAttribute('aria-busy');
      status.textContent = `${date} · 已载入`;
    } catch (error) {
      if (request !== currentRequest || controller.signal.aborted) return;
      status.textContent = `${date} · 读取失败`; message('当天记录暂时无法读取，请点击“查看”重试。'); target.removeAttribute('aria-busy');
    }
  };
  form.addEventListener('submit', event => {event.preventDefault(); if (index) void show(input.value, true);});
  previous.addEventListener('click', () => {const date = adjacentDates(index.dates, selected).previous; if (date) void show(date, true);});
  next.addEventListener('click', () => {const date = adjacentDates(index.dates, selected).next; if (date) void show(date, true);});
  window.addEventListener('popstate', () => {if (index) void show(new URL(location.href).searchParams.get('date') ?? index.latest ?? '', false);});
  try {
    const response = await fetch(`${base}/index.json`, {cache: 'no-cache'});
    if (!response.ok) throw new Error('Index unavailable');
    index = readIndex(await response.json(), experimentId);
    input.disabled = false; submit.disabled = false;
    if (!index.latest) {status.textContent = '暂无记录'; message('暂无记录。'); return;}
    await show(new URL(location.href).searchParams.get('date') ?? index.latest, false);
  } catch {
    status.textContent = '日期暂时无法读取'; message('记录暂时无法读取，请刷新页面重试。');
  }
}
