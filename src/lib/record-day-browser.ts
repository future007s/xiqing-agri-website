import {availableRecordDate, calendarArrowDate, monthDays, shiftMonth} from './record-calendar';
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
  const previous = root.querySelector<HTMLButtonElement>('[data-record-previous]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-record-next]')!;
  const trigger = root.querySelector<HTMLButtonElement>('[data-calendar-trigger]')!;
  const selectedLabel = root.querySelector<HTMLElement>('[data-record-selected]')!;
  const retry = root.querySelector<HTMLButtonElement>('[data-record-retry]')!;
  const status = root.querySelector<HTMLElement>('[data-record-status]')!;
  const dialog = root.querySelector<HTMLDialogElement>('[data-record-calendar]')!;
  const monthLabel = root.querySelector<HTMLElement>('[data-calendar-month]')!;
  const grid = root.querySelector<HTMLElement>('[data-calendar-days]')!;
  const monthPrevious = root.querySelector<HTMLButtonElement>('[data-calendar-previous]')!;
  const monthNext = root.querySelector<HTMLButtonElement>('[data-calendar-next]')!;
  const target = document.querySelector<HTMLElement>('[data-record-day-content]')!;
  const experimentId = root.dataset.experimentId!, base = root.dataset.recordBase!;
  let index: RecordIndex, selected = '', month = '', focused = '', request = 0, dialogScrollY = 0, dialogWasFloating = false;
  let controller: AbortController | undefined;
  let pendingScrollRestore: number | null = null;
  const preserveFloatingScroll = () => {if (root.classList.contains('is-floating')) pendingScrollRestore = window.scrollY;};
  const restoreScrollPosition = (top: number) => {
    requestAnimationFrame(() => {
      const style = document.documentElement.style;
      const previous = style.scrollBehavior;
      style.scrollBehavior = 'auto'; window.scrollTo(0, top); style.scrollBehavior = previous;
    });
  };
  const summary = root.closest<HTMLElement>('.record-data');
  if (summary && 'IntersectionObserver' in window) {
    const summaryObserver = new IntersectionObserver(([entry]) => {
      root.classList.toggle('is-floating', entry.boundingClientRect.bottom <= 0);
    });
    summaryObserver.observe(summary);
  }
  const message = (text: string) => target.replaceChildren(element('p', text));
  const updateButtons = () => {
    const adjacent = adjacentDates(index.dates, selected);
    previous.disabled = !adjacent.previous; next.disabled = !adjacent.next;
  };
  const focusDate = (date: string) => {
    focused = date;
    for (const button of grid.querySelectorAll<HTMLButtonElement>('button')) button.tabIndex = button.dataset.calendarDay === date && !button.disabled ? 0 : -1;
    grid.querySelector<HTMLButtonElement>(`button[data-calendar-day="${date}"]:not(:disabled)`)?.focus();
  };
  const renderMonth = (moveFocus = true) => {
    monthLabel.textContent = `${month.slice(0,4)}年${Number(month.slice(5))}月`;
    monthPrevious.disabled = month <= index.dates[0].slice(0,7);
    monthNext.disabled = month >= index.dates.at(-1)!.slice(0,7);
    const cells = monthDays(month, index.dates);
    if (!cells.some(cell => cell.enabled && cell.date === focused)) focused = cells.find(cell => cell.enabled)?.date ?? '';
    const rows: HTMLTableRowElement[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const row = element('tr');
      for (const cell of cells.slice(i, i+7)) {
        const td = element('td'), button = element('button', String(cell.day));
        button.type = 'button'; button.dataset.calendarDay = cell.date;
        button.disabled = !cell.enabled; button.tabIndex = cell.enabled && cell.date === focused ? 0 : -1;
        button.setAttribute('aria-label', cell.date); button.setAttribute('aria-disabled', String(!cell.enabled));
        td.setAttribute('role', 'gridcell'); td.setAttribute('aria-selected', String(cell.enabled && cell.date === selected));
        button.setAttribute('aria-current', cell.enabled && cell.date === selected ? 'date' : 'false');
        button.addEventListener('click', () => {
          if (!index.dates.includes(cell.date) || !cell.inMonth) return;
          preserveFloatingScroll();
          dialog.close(); void show(cell.date, true);
        });
        td.append(button); row.append(td);
      }
      rows.push(row);
    }
    grid.replaceChildren(...rows);
    if (moveFocus) {if (focused) focusDate(focused); else monthLabel.focus();}
  };
  const moveMonth = (amount: number) => {
    const value = shiftMonth(month, amount);
    if (value < index.dates[0].slice(0,7) || value > index.dates.at(-1)!.slice(0,7)) return;
    month = value; renderMonth();
  };
  const show = async (date: string, push: boolean, fallback = false) => {
    if (!isDay(date) || !index.dates.includes(date)) return;
    selected = date; root.dataset.selectedDate = date; selectedLabel.textContent = date; updateButtons();
    const currentRequest = ++request; controller?.abort(); controller = new AbortController(); retry.hidden = true;
    if (push || fallback) {
      const url = new URL(location.href); url.searchParams.set('date', date);
      if (fallback) history.replaceState(null, '', url); else if (url.href !== location.href) history.pushState(null, '', url);
    }
    target.setAttribute('aria-busy', 'true'); target.replaceChildren();
    status.textContent = `${date} · 正在读取…`; message('正在读取当天记录…');
    try {
      const response = await fetch(`${base}/${date}.json`, {signal: controller.signal, cache: 'no-cache'});
      if (!response.ok) throw new Error('Day unavailable');
      const day = readDay(await response.json(), experimentId, date);
      if (request !== currentRequest) return;
      target.replaceChildren(renderRecordDay(day)); target.removeAttribute('aria-busy');
      status.textContent = `${date} · ${fallback ? '已切换至有记录日期' : '已载入'}`;
      if (pendingScrollRestore != null) {const top = pendingScrollRestore; pendingScrollRestore = null; restoreScrollPosition(top);}
    } catch {
      if (request !== currentRequest || controller.signal.aborted) return;
      status.textContent = `${date} · 读取失败`; retry.hidden = false;
      message('当天记录暂时无法读取，请重试。'); target.removeAttribute('aria-busy');
      if (pendingScrollRestore != null) {const top = pendingScrollRestore; pendingScrollRestore = null; restoreScrollPosition(top);}
    }
  };
  const showRequested = (requested: string | null) => {
    const resolved = availableRecordDate(index.dates, requested);
    if (resolved.date) void show(resolved.date, false, resolved.unavailable);
  };
  trigger.addEventListener('click', () => {
    if (!selected || !index.dates.includes(selected)) return;
    dialogScrollY = window.scrollY;
    dialogWasFloating = root.classList.contains('is-floating');
    month = selected.slice(0,7); focused = selected; renderMonth(false);
    trigger.setAttribute('aria-expanded','true'); dialog.showModal(); focusDate(selected);
  });
  root.querySelector('[data-calendar-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const restoreScroll = dialogWasFloating && pendingScrollRestore == null;
    dialogWasFloating = false;
    trigger.setAttribute('aria-expanded','false'); trigger.focus({preventScroll:true});
    if (restoreScroll) restoreScrollPosition(dialogScrollY);
  });
  monthPrevious.addEventListener('click', () => moveMonth(-1));
  monthNext.addEventListener('click', () => moveMonth(1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'PageUp' || event.key === 'PageDown') {event.preventDefault(); moveMonth(event.key === 'PageUp' ? -1 : 1); return;}
    const active = event.target as HTMLElement;
    if (!active.dataset.calendarDay || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const date = calendarArrowDate(index.dates, active.dataset.calendarDay, event.key);
    if (!date) return;
    if (date.slice(0,7) !== month) {month = date.slice(0,7); focused = date; renderMonth(false);}
    focusDate(date);
  });
  retry.addEventListener('click', () => {if (selected) {preserveFloatingScroll(); void show(selected, false);}});
  previous.addEventListener('click', () => {const date = adjacentDates(index.dates, selected).previous; if (date) {preserveFloatingScroll(); void show(date, true);}});
  next.addEventListener('click', () => {const date = adjacentDates(index.dates, selected).next; if (date) {preserveFloatingScroll(); void show(date, true);}});
  window.addEventListener('popstate', () => {if (index) {preserveFloatingScroll(); if (dialog.open) dialog.close(); showRequested(new URL(location.href).searchParams.get('date'));}});
  try {
    const response = await fetch(`${base}/index.json`, {cache: 'no-cache'});
    if (!response.ok) throw new Error('Index unavailable');
    index = readIndex(await response.json(), experimentId);
    if (!index.latest) {selectedLabel.textContent='暂无记录'; status.textContent='暂无记录'; message('暂无记录。'); return;}
    trigger.disabled = false;
    const resolved = availableRecordDate(index.dates, new URL(location.href).searchParams.get('date'));
    await show(resolved.date!, false, resolved.unavailable);
  } catch {
    status.textContent = '日期暂时无法读取'; message('记录暂时无法读取，请刷新页面重试。');
  }
}
