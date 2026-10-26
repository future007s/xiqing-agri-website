type Metric = { metric: string; label: string; unit: string; sensor_count: number };
type ChartPoint = {
	at: string;
	average: number | null;
	minimum: number | null;
	maximum: number | null;
	validCount: number;
	totalCount: number;
	quality: string;
};
type ChartSeries = { id: string; label: string; sensorId?: string; points: ChartPoint[] };
type ChartResponse = { metric: string; unit: string; series: ChartSeries[]; generatedAt?: string; stale?: boolean };

const svgNamespace = 'http://www.w3.org/2000/svg';
// 优先使用蓝色与橙红色，避免相邻曲线都落在灰绿、灰蓝的近似色系。
const colors = ['#0072b2', '#d55e00', '#00875a', '#8b43c5', '#c7256e', '#9c6b00', '#007f88', '#3b3b3b'];
const metricLabels: Record<string, { zh: string; en: string }> = {
	air_temperature: { zh: '温度', en: 'Air temperature' },
	air_humidity: { zh: '相对湿度', en: 'Relative humidity' },
	co2_ppm: { zh: '二氧化碳', en: 'Carbon dioxide' },
	illuminance: { zh: '光照强度', en: 'Illuminance' },
	ppfd: { zh: '光合有效辐射', en: 'PAR photon flux' },
	ec: { zh: '营养液电导率', en: 'Nutrient EC' },
	electrical_conductivity: { zh: '营养液电导率', en: 'Nutrient EC' },
	solution_temperature: { zh: '液温', en: 'Solution temperature' },
	ph: { zh: '酸碱度', en: 'pH' },
	pressure: { zh: '压力', en: 'Pressure' },
	pressure_p1: { zh: '泵出口压力', en: 'Pump outlet pressure' },
	pressure_p2: { zh: '远端压力', en: 'Remote pressure' },
};

// General display baselines for common horticulture measurements, not crop setpoints.
// Pressure remains data-scaled because its useful range depends on the pump, nozzle, and unit.
const referenceAxisRanges: Record<string, Record<string, [number, number]>> = {
	air_temperature: { '°c': [10, 35], degc: [10, 35] },
	air_humidity: { '%rh': [30, 90], '%': [30, 90] },
	co2_ppm: { ppm: [300, 1500] },
	illuminance: { lx: [0, 100_000], lux: [0, 100_000] },
	ppfd: { 'µmol/m²·s': [0, 2000], 'µmol/m²/s': [0, 2000], 'µmol/m2/s': [0, 2000] },
	ec: { 'ms/cm': [0, 4], 'ds/m': [0, 4], 'µs/cm': [0, 4000] },
	ph: { ph: [5, 7] },
};

const referenceRangeFor = (metric: string, unit: string): [number, number] | undefined => {
	const normalizedUnit = unit.trim().toLowerCase().replaceAll('μ', 'µ').replace(/\s+/g, '');
	return referenceAxisRanges[metric === 'electrical_conductivity' ? 'ec' : metric]?.[normalizedUnit];
};

const dayInChina = (date = new Date()): string =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

const offsetDay = (day: string, days: number): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

const createSvg = (tag: string, attributes: Record<string, string> = {}): SVGElement => {
	const element = document.createElementNS(svgNamespace, tag);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
	return element;
};

async function responseJson<T>(url: string, signal = AbortSignal.timeout(10000)): Promise<T> {
	const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', signal });
	if (response.status === 401) { location.href = '/login'; throw new Error('请先登录现场管理。'); }
	const body = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
	return body;
}

type DashboardOptions = { metric?: string; unit?: string; sensorIds?: string[]; day?: string; pressureInMPa?: boolean };

export function setupDashboard(root: HTMLElement, options: DashboardOptions = {}): () => void {
	const isEnglish = root.dataset.locale === 'en';
	const metricSelect = root.querySelector<HTMLSelectElement>('[data-metric-select]');
	const daySelect = root.querySelector<HTMLInputElement>('[data-day-select]');
	const chart = root.querySelector<SVGSVGElement>('[data-chart]');
	const legend = root.querySelector<HTMLDivElement>('[data-chart-legend]');
	const unitLabel = root.querySelector<HTMLDivElement>('[data-chart-unit]');
	const referenceLegend = root.querySelector<HTMLDivElement>('[data-chart-reference-legend]');
	const tooltip = root.querySelector<HTMLDivElement>('[data-chart-tooltip]');
	const chartCard = root.querySelector<HTMLDivElement>('.telemetry-chart-card');
	const status = root.querySelector<HTMLParagraphElement>('[data-chart-status]');
	const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-group-by]')];
	if (!metricSelect || !daySelect || !chart || !legend || !unitLabel || !referenceLegend || !tooltip || !chartCard || !status) return () => {};
	let disposed = false, requestVersion = 0;
	let pending: AbortController | undefined;
	const say = (zh: string, en: string) => isEnglish ? en : zh;
	const setStatus = (message: string) => { status.textContent = message; };
	const hideTooltip = () => { tooltip.hidden = true; };
	const clearChart = () => {
		chart.replaceChildren();
		legend.replaceChildren();
		referenceLegend.replaceChildren();
		referenceLegend.hidden = true;
		unitLabel.textContent = '';
		hideTooltip();
	};
	const showTooltip = (target: SVGCircleElement, content: string, event?: PointerEvent) => {
		tooltip.textContent = content;
		tooltip.hidden = false;
		const cardRect = chartCard.getBoundingClientRect();
		const pointRect = target.getBoundingClientRect();
		const anchorX = event?.clientX ?? pointRect.left + pointRect.width / 2;
		const anchorY = event?.clientY ?? pointRect.top + pointRect.height / 2;
		const inset = 8;
		const left = Math.max(inset, Math.min(anchorX - cardRect.left + 12, chartCard.clientWidth - tooltip.offsetWidth - inset));
		let top = anchorY - cardRect.top - tooltip.offsetHeight - 12;
		if (top < inset) top = Math.min(anchorY - cardRect.top + 12, chartCard.clientHeight - tooltip.offsetHeight - inset);
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${Math.max(inset, top)}px`;
	};
	let groupBy = 'device';
	const drawChart = (data: ChartResponse) => {
		clearChart();
		const referenceRange = referenceRangeFor(data.metric, data.unit);
		const referenceText = referenceRange
			? `${say('通用农业参考刻度', 'General agriculture reference')}: ${referenceRange[0]}–${referenceRange[1]}`
			: say('按当日实测范围定标', 'Scaled to observed values');
		unitLabel.textContent = data.unit ? `${say('单位', 'Unit')}: ${data.unit} · ${referenceText}` : referenceText;
		if (referenceRange) {
			referenceLegend.hidden = false;
			for (const [kind, label, value] of [
				['upper', say('上限', 'Upper limit'), referenceRange[1]],
				['lower', say('下限', 'Lower limit'), referenceRange[0]],
			] as const) {
				const item = document.createElement('span');
				item.className = 'telemetry-reference-legend__item';
				const marker = document.createElement('i');
				marker.className = `telemetry-reference-legend__line telemetry-reference-legend__line--${kind}`;
				marker.setAttribute('aria-hidden', 'true');
				const text = document.createElement('span');
				text.textContent = `${label} ${value} ${data.unit}`;
				item.append(marker, text);
				referenceLegend.append(item);
			}
		}
		const width = 1000;
		const height = 440;
		const margin = { left: 82, right: 22, top: 18, bottom: 46 };
		const plotWidth = width - margin.left - margin.right;
		const plotHeight = height - margin.top - margin.bottom;
		const values = data.series.flatMap((series) => series.points
			.map((point) => point.average).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
		if (!values.length) {
			unitLabel.textContent = '';
			referenceLegend.replaceChildren();
			referenceLegend.hidden = true;
			return 0;
		}
		let low = Math.min(...values);
		let high = Math.max(...values);
		if (referenceRange) {
			low = Math.min(low, referenceRange[0]);
			high = Math.max(high, referenceRange[1]);
		} else if (low === high) {
			const pad = Math.max(Math.abs(low) * 0.05, 1);
			low -= pad;
			high += pad;
		} else {
			const pad = (high - low) * 0.08;
			low -= pad;
			high += pad;
		}
		const decimalPlaces = /^MPa$/i.test(data.unit) ? 3 : /ppm|lux/i.test(data.unit) ? 0 : /%|mS\/cm/i.test(data.unit) ? 2 : 1;
		for (let line = 0; line <= 4; line += 1) {
			const y = margin.top + (plotHeight * line) / 4;
			const value = high - ((high - low) * line) / 4;
			chart.append(createSvg('line', { x1: String(margin.left), x2: String(width - margin.right), y1: String(y), y2: String(y), class: 'telemetry-chart__grid' }));
			const label = createSvg('text', { x: String(margin.left - 12), y: String(y + 4), 'text-anchor': 'end', class: 'telemetry-chart__axis-label' });
			label.textContent = value.toFixed(decimalPlaces);
			chart.append(label);
		}
		if (referenceRange) {
			for (const [value, kind] of [[referenceRange[1], 'upper'], [referenceRange[0], 'lower']] as const) {
				const y = margin.top + (plotHeight * (high - value)) / (high - low);
				chart.append(createSvg('line', {
					x1: String(margin.left),
					x2: String(width - margin.right),
					y1: String(y),
					y2: String(y),
					class: `telemetry-chart__reference-line telemetry-chart__reference-line--${kind}`,
				}));
			}
		}
		for (let hour = 0; hour < 24; hour += 1) {
			const x = margin.left + (plotWidth * hour) / 24;
			chart.append(createSvg('line', { x1: String(x), x2: String(x), y1: String(margin.top), y2: String(height - margin.bottom), class: 'telemetry-chart__grid telemetry-chart__grid--vertical' }));
			const label = createSvg('text', { x: String(x), y: String(height - 14), 'text-anchor': 'middle', class: 'telemetry-chart__axis-label' });
			label.textContent = String(hour).padStart(2, '0');
			chart.append(label);
		}
		chart.append(createSvg('line', { x1: String(margin.left), x2: String(margin.left), y1: String(margin.top), y2: String(height - margin.bottom), class: 'telemetry-chart__axis' }));
		chart.append(createSvg('line', { x1: String(margin.left), x2: String(width - margin.right), y1: String(height - margin.bottom), y2: String(height - margin.bottom), class: 'telemetry-chart__axis' }));

		let plottedPoints = 0;
		data.series.forEach((series, index) => {
			const color = colors[index % colors.length];
			let path = '';
			let activeSegment = false;
			let lastPointAt: number | null = null;
			const validPoints = series.points.flatMap((point) => {
				if (typeof point.average !== 'number' || !Number.isFinite(point.average)) {
					activeSegment = false;
					return [];
				}
				const localDate = new Date(Date.parse(point.at) + 8 * 60 * 60 * 1000);
				const pointAt = Date.parse(point.at);
				if (lastPointAt !== null && pointAt - lastPointAt > 10 * 60 * 1000) activeSegment = false;
				lastPointAt = pointAt;
				const minute = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
				const x = margin.left + (plotWidth * minute) / (24 * 60);
				const y = margin.top + (plotHeight * (high - point.average)) / (high - low);
				path += `${activeSegment ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `;
				activeSegment = true;
				plottedPoints += 1;
				return [{ point, average: point.average, x, y }];
			});
			if (!validPoints.length) return;
			chart.append(createSvg('path', { d: path.trim(), stroke: color, class: 'telemetry-chart__line' }));
			for (const { point, average, x, y } of validPoints) {
				const local = new Date(Date.parse(point.at) + 8 * 60 * 60 * 1000);
				const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
				const valueText = `${average.toFixed(decimalPlaces)} ${data.unit}`;
				const details = `${time} · ${valueText}`;
				const hitArea = createSvg('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: '3', tabindex: '0', role: 'graphics-symbol', class: 'telemetry-chart__point-hit' }) as SVGCircleElement;
				hitArea.setAttribute('aria-label', `${series.label}: ${details}`);
				hitArea.setAttribute('aria-describedby', tooltip.id);
				hitArea.addEventListener('pointerenter', (event) => showTooltip(hitArea, `${series.label}\n${details}`, event));
				hitArea.addEventListener('pointermove', (event) => showTooltip(hitArea, `${series.label}\n${details}`, event));
				hitArea.addEventListener('pointerleave', hideTooltip);
				hitArea.addEventListener('focus', () => showTooltip(hitArea, `${series.label}\n${details}`));
				hitArea.addEventListener('blur', hideTooltip);
				chart.append(hitArea);
				chart.append(createSvg('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: '2.7', fill: color, class: 'telemetry-chart__point' }));
			}
			const entry = document.createElement('span');
			entry.className = 'telemetry-legend__item';
			const marker = document.createElement('i');
			marker.style.backgroundColor = color;
			marker.setAttribute('aria-hidden', 'true');
			const name = document.createElement('span');
			name.textContent = series.label;
			entry.append(marker, name);
			legend.append(entry);
		});
		return plottedPoints;
	};

	const loadChart = async () => {
		if (disposed) return;
		let selected: [string, string];
		try { selected = JSON.parse(metricSelect.value) as [string, string]; }
		catch { return; }
		const [metric, unit] = selected;
		const day = daySelect.value;
		if (!metric || !day) return;
		const version = ++requestVersion;
		pending?.abort(); pending = new AbortController();
		setStatus(say('正在读取所选日期的数据…', 'Loading measurements for this day…'));
		clearChart();
		try {
			const parameters = new URLSearchParams({ day, metric, unit, groupBy });
			for (const sensor of options.sensorIds || []) parameters.append('sensor', sensor);
			const data = await responseJson<ChartResponse>(`/api/telemetry?${parameters}`, AbortSignal.any([pending.signal, AbortSignal.timeout(10000)]));
			if (disposed || version !== requestVersion) return;
			if (data.metric !== metric || data.unit !== unit || (options.sensorIds?.length && data.series.some(series => !series.sensorId || !options.sensorIds!.includes(series.sensorId)))) {
				throw new Error(say('历史服务版本或传感器范围不匹配，请管理员刷新网页服务后重试。', 'History service version or sensor scope mismatch. Ask the administrator to reload the web service.'));
			}
			if (options.pressureInMPa && data.metric === 'pressure' && data.unit === 'Pa') {
				data.unit = 'MPa';
				data.series = data.series.map(series => ({ ...series, points: series.points.map(point => ({ ...point,
					average: point.average === null ? null : point.average / 1e6,
					minimum: point.minimum === null ? null : point.minimum / 1e6,
					maximum: point.maximum === null ? null : point.maximum / 1e6,
				})) }));
			}
			const sync = root.querySelector<HTMLElement>('[data-sync-status]');
			if (sync && data.generatedAt) sync.textContent = `${say('摘要更新时间', 'Summary updated')}: ${new Date(data.generatedAt).toLocaleString(isEnglish ? 'en-GB' : 'zh-CN', {timeZone:'Asia/Shanghai'})}${data.stale ? say(' · 当前日摘要未及时刷新', ' · Today’s summary is stale') : ''}`;
			const pointCount = drawChart(data) ?? 0;
			if (!pointCount) {
				setStatus(say('这一天没有有效读数；空档不会补成零。', 'No valid readings for this day. Missing intervals are left blank.'));
				return;
			}
			const sensorCount = data.series.length;
			setStatus(say(`显示 ${sensorCount} 条测量曲线、${pointCount} 个有效数据点。`, `${sensorCount} measurement lines · ${pointCount} valid points.`));
		} catch (error) {
			if (disposed || version !== requestVersion) return;
			setStatus(error instanceof Error ? error.message : say('读取失败，请稍后重试。', 'Could not load measurements. Please try again.'));
		}
	};

	const loadMetrics = async () => {
		try {
			const data = options.metric && options.unit
				? { metrics: [{ metric: options.metric, unit: options.unit, label: options.metric, sensor_count: options.sensorIds?.length || 1 }] }
				: await responseJson<{ metrics: Metric[] }>('/api/telemetry/metrics');
			if (disposed) return;
			const metrics = data.metrics;
			metricSelect.replaceChildren();
			if (!metrics.length) {
				metricSelect.disabled = true;
				daySelect.disabled = true;
				setStatus(say('暂无已登记传感器数据。数据接入后会显示在这里。', 'No registered sensor data is available yet. Measurements will appear after data sync.'));
				return;
			}
			for (const metric of metrics) {
				const option = document.createElement('option');
				option.value = JSON.stringify([metric.metric, metric.unit]);
				const localized = metricLabels[metric.metric];
				option.textContent = `${localized ? (isEnglish ? localized.en : localized.zh) : metric.label} (${metric.unit})`;
				metricSelect.append(option);
			}
			const today = dayInChina();
			daySelect.max = today;
			daySelect.min = offsetDay(today, -29);
			daySelect.value = options.day && options.day >= daySelect.min && options.day <= today ? options.day : today;
			metricSelect.disabled = false;
			daySelect.disabled = false;
			await loadChart();
		} catch (error) {
			if (disposed) return;
			metricSelect.disabled = true;
			daySelect.disabled = true;
			setStatus(error instanceof Error ? error.message : say('数据服务暂不可用。', 'The data service is unavailable.'));
		}
	};

	metricSelect.addEventListener('change', loadChart);
	daySelect.addEventListener('change', loadChart);
	for (const button of modeButtons) {
		button.addEventListener('click', () => {
			groupBy = button.dataset.groupBy === 'site' ? 'site' : 'device';
			modeButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
			void loadChart();
		});
	}
	void loadMetrics();
	return () => { disposed = true; ++requestVersion; pending?.abort(); clearChart(); };
}

document.querySelectorAll<HTMLElement>('[data-telemetry-dashboard]').forEach(root => setupDashboard(root));
