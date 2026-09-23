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
type ChartSeries = { id: string; label: string; points: ChartPoint[] };
type ChartResponse = { unit: string; series: ChartSeries[] };

const svgNamespace = 'http://www.w3.org/2000/svg';
const colors = ['#6f7952', '#497681', '#a06e4a', '#6c5d8d', '#a74f4b', '#6b7374', '#b08d37', '#3e6c4f'];
const metricLabels: Record<string, { zh: string; en: string }> = {
	air_temperature: { zh: '温度', en: 'Air temperature' },
	air_humidity: { zh: '相对湿度', en: 'Relative humidity' },
	co2_ppm: { zh: '二氧化碳', en: 'Carbon dioxide' },
	illuminance: { zh: '光照强度', en: 'Illuminance' },
	ppfd: { zh: '光合有效辐射', en: 'PAR photon flux' },
	ec: { zh: '营养液电导率', en: 'Nutrient EC' },
	ph: { zh: '酸碱度', en: 'pH' },
	pressure: { zh: '压力', en: 'Pressure' },
	pressure_p1: { zh: '泵出口压力', en: 'Pump outlet pressure' },
	pressure_p2: { zh: '远端压力', en: 'Remote pressure' },
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

async function responseJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
	const body = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
	return body;
}

function setupDashboard(root: HTMLElement): void {
	const isEnglish = root.dataset.locale === 'en';
	const metricSelect = root.querySelector<HTMLSelectElement>('[data-metric-select]');
	const daySelect = root.querySelector<HTMLInputElement>('[data-day-select]');
	const chart = root.querySelector<SVGSVGElement>('[data-chart]');
	const legend = root.querySelector<HTMLDivElement>('[data-chart-legend]');
	const unitLabel = root.querySelector<HTMLDivElement>('[data-chart-unit]');
	const status = root.querySelector<HTMLParagraphElement>('[data-chart-status]');
	const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-group-by]')];
	if (!metricSelect || !daySelect || !chart || !legend || !unitLabel || !status) return;
	const say = (zh: string, en: string) => isEnglish ? en : zh;
	const setStatus = (message: string) => { status.textContent = message; };
	const clearChart = () => { chart.replaceChildren(); legend.replaceChildren(); unitLabel.textContent = ''; };
	let groupBy = 'device';
	const drawChart = (data: ChartResponse) => {
		clearChart();
		unitLabel.textContent = data.unit ? `${say('单位', 'Unit')}: ${data.unit}` : '';
		const width = 1000;
		const height = 440;
		const margin = { left: 82, right: 22, top: 18, bottom: 46 };
		const plotWidth = width - margin.left - margin.right;
		const plotHeight = height - margin.top - margin.bottom;
		const values = data.series.flatMap((series) => series.points
			.map((point) => point.average).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
		if (!values.length) return 0;
		let low = Math.min(...values);
		let high = Math.max(...values);
		if (low === high) {
			const pad = Math.max(Math.abs(low) * 0.05, 1);
			low -= pad;
			high += pad;
		} else {
			const pad = (high - low) * 0.08;
			low -= pad;
			high += pad;
		}
		const decimalPlaces = /ppm|lux/i.test(data.unit) ? 0 : /%|mS\/cm/i.test(data.unit) ? 2 : 1;
		for (let line = 0; line <= 4; line += 1) {
			const y = margin.top + (plotHeight * line) / 4;
			const value = high - ((high - low) * line) / 4;
			chart.append(createSvg('line', { x1: String(margin.left), x2: String(width - margin.right), y1: String(y), y2: String(y), class: 'telemetry-chart__grid' }));
			const label = createSvg('text', { x: String(margin.left - 12), y: String(y + 4), 'text-anchor': 'end', class: 'telemetry-chart__axis-label' });
			label.textContent = value.toFixed(decimalPlaces);
			chart.append(label);
		}
		for (let hour = 0; hour < 24; hour += 1) {
			const x = margin.left + (plotWidth * hour) / 24;
			chart.append(createSvg('line', { x1: String(x), x2: String(x), y1: String(margin.top), y2: String(height - margin.bottom), class: 'telemetry-chart__grid telemetry-chart__grid--vertical' }));
			const label = createSvg('text', { x: String(x), y: String(height - 14), 'text-anchor': 'middle', class: 'telemetry-chart__axis-label' });
			label.textContent = `${String(hour).padStart(2, '0')}:00`;
			chart.append(label);
		}
		chart.append(createSvg('line', { x1: String(margin.left), x2: String(margin.left), y1: String(margin.top), y2: String(height - margin.bottom), class: 'telemetry-chart__axis' }));
		chart.append(createSvg('line', { x1: String(margin.left), x2: String(width - margin.right), y1: String(height - margin.bottom), y2: String(height - margin.bottom), class: 'telemetry-chart__axis' }));

		let plottedPoints = 0;
		data.series.forEach((series, index) => {
			const color = colors[index % colors.length];
			let path = '';
			let activeSegment = false;
			const validPoints = series.points.flatMap((point) => {
				if (typeof point.average !== 'number' || !Number.isFinite(point.average)) {
					activeSegment = false;
					return [];
				}
				const localDate = new Date(Date.parse(point.at) + 8 * 60 * 60 * 1000);
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
				const circle = createSvg('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: '2.7', fill: color, tabindex: '0', role: 'graphics-symbol', class: 'telemetry-chart__point' });
				const local = new Date(Date.parse(point.at) + 8 * 60 * 60 * 1000);
				const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
				const detail = `${time} · ${average.toFixed(decimalPlaces)} ${data.unit} · ${say('范围', 'range')} ${point.minimum ?? '—'}–${point.maximum ?? '—'} · ${say('有效样本', 'valid samples')} ${point.validCount}/${point.totalCount}`;
				circle.setAttribute('aria-label', `${series.label}, ${detail}`);
				const title = createSvg('title');
				title.textContent = `${series.label}: ${detail}`;
				circle.append(title);
				chart.append(circle);
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
		let selected: [string, string];
		try { selected = JSON.parse(metricSelect.value) as [string, string]; }
		catch { return; }
		const [metric, unit] = selected;
		const day = daySelect.value;
		if (!metric || !day) return;
		setStatus(say('正在读取所选日期的数据…', 'Loading measurements for this day…'));
		clearChart();
		try {
			const data = await responseJson<ChartResponse>(`/api/telemetry?day=${encodeURIComponent(day)}&metric=${encodeURIComponent(metric)}&unit=${encodeURIComponent(unit)}&groupBy=${groupBy}`);
			const pointCount = drawChart(data) ?? 0;
			if (!pointCount) {
				setStatus(say('这一天没有有效读数；空档不会补成零。', 'No valid readings for this day. Missing intervals are left blank.'));
				return;
			}
			const sensorCount = data.series.length;
			setStatus(say(`显示 ${sensorCount} 条测量曲线、${pointCount} 个有效数据点。`, `${sensorCount} measurement lines · ${pointCount} valid points.`));
		} catch (error) {
			setStatus(error instanceof Error ? error.message : say('读取失败，请稍后重试。', 'Could not load measurements. Please try again.'));
		}
	};

	const loadMetrics = async () => {
		try {
			const data = await responseJson<{ metrics: Metric[] }>('/api/telemetry/metrics');
			const metrics = data.metrics;
			metricSelect.replaceChildren();
			if (!metrics.length) {
				metricSelect.disabled = true;
				daySelect.disabled = true;
				setStatus(say('暂无公开传感器数据。数据接入后会显示在这里。', 'No public sensor data is available yet. Measurements will appear here after data sync is enabled.'));
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
			daySelect.value = today;
			metricSelect.disabled = false;
			daySelect.disabled = false;
			await loadChart();
		} catch (error) {
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
}

document.querySelectorAll<HTMLElement>('[data-telemetry-dashboard]').forEach(setupDashboard);
