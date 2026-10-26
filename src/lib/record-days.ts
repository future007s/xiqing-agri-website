export interface DayContext {
  crop: string; material: string; phase: string;
  sowing: { precision: string; value: string | null };
  tray_holes: number | null; sown_seeds: number | null;
}
export interface DayImage { id: string; date: string; src: string; alt: string }
export interface DayRecord {
  id: string; date: string; kind: 'daily' | 'operation' | 'anomaly'; title: string;
  when?: {precision: string; value: string; basis?: string};
  fields: {label: string; value: string}[]; images: DayImage[]; status?: string;
}
export interface RecordDay {
  schema_version: 1; experiment_id: string; date: string;
  batches: {key: string; label: string; context: DayContext; records: DayRecord[]}[];
  environment: {key: string; metrics: {label: string; mean: number; unit: string}[]}[];
}
export interface RecordContract {
  schema_version: 1; projection_version: 4; experiment_id: string; days: RecordDay[];
}
export interface RecordIndex { schema_version: 1; experiment_id: string; latest: string | null; dates: string[] }

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function object(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string'; }
function count(value: unknown) { return value === null || (Number.isInteger(value) && Number(value) > 0); }
export function readDay(value: unknown, experimentId: string, date: string): RecordDay {
  if (!object(value) || value.schema_version !== 1 || value.experiment_id !== experimentId || value.date !== date || !isDay(date)
      || !Array.isArray(value.batches) || !Array.isArray(value.environment)) throw new Error('Invalid record day');
  const ids = new Set<string>();
  for (const batch of value.batches) {
    const c = batch?.context;
    if (!object(batch) || !text(batch.key) || !text(batch.label) || !object(c)
        || ![c.crop, c.material, c.phase].every(text) || !object(c.sowing)
        || !text(c.sowing.precision) || !(c.sowing.value === null || isDay(c.sowing.value))
        || !count(c.tray_holes) || !count(c.sown_seeds) || !Array.isArray(batch.records)) throw new Error('Invalid batch');
    for (const record of batch.records) {
      if (!object(record) || !text(record.id) || ids.has(record.id) || record.date !== date
          || !['daily', 'operation', 'anomaly'].includes(record.kind) || !text(record.title)
          || !Array.isArray(record.fields) || !Array.isArray(record.images)) throw new Error('Invalid dated record');
      ids.add(record.id);
      if (!record.fields.every((f: unknown) => object(f) && text(f.label) && text(f.value))) throw new Error('Invalid fields');
      for (const image of record.images) {
        if (!object(image) || !text(image.id) || image.date !== date || !text(image.alt)
            || !/^\/media\/record-sync\/[a-f0-9]{64}\.jpg$/.test(image.src)) throw new Error('Invalid dated image');
      }
    }
  }
  for (const env of value.environment) {
    if (!object(env) || !text(env.key) || !Array.isArray(env.metrics)
        || !env.metrics.every((m: unknown) => object(m) && text(m.label) && text(m.unit) && typeof m.mean === 'number' && Number.isFinite(m.mean))) throw new Error('Invalid environment');
  }
  return value as RecordDay;
}
export function readIndex(value: unknown, experimentId: string): RecordIndex {
  if (!object(value) || value.schema_version !== 1 || value.experiment_id !== experimentId
      || !Array.isArray(value.dates) || !value.dates.every(isDay)
      || value.dates.some((date: string, i: number) => i > 0 && date <= value.dates[i - 1])
      || value.latest !== (value.dates.at(-1) ?? null)) throw new Error('Invalid date index');
  return value as RecordIndex;
}
export function parseRecordContract(body: string | undefined, experimentId: string): RecordContract | null {
  const begin = '<!-- xiqing-record-days:v1\n', end = '\nxiqing-record-days:v1 -->';
  if (!body?.includes('xiqing-record-days:')) return null;
  if (body.split(begin).length !== 2 || body.split(end).length !== 2) throw new Error('Invalid day contract markers');
  const raw: unknown = JSON.parse(body.split(begin)[1].split(end)[0]);
  if (!object(raw) || raw.schema_version !== 1 || raw.projection_version !== 4
      || raw.experiment_id !== experimentId || !Array.isArray(raw.days)) throw new Error('Invalid day contract');
  const dates = raw.days.map((day: any) => day.date);
  readIndex({schema_version: 1, experiment_id: experimentId, dates, latest: dates.at(-1) ?? null}, experimentId);
  for (const day of raw.days) readDay(day, experimentId, day.date);
  return raw as RecordContract;
}
export function dateIndex(contract: RecordContract): RecordIndex {
  const dates = contract.days.map(day => day.date);
  return {schema_version: 1, experiment_id: contract.experiment_id, dates, latest: dates.at(-1) ?? null};
}
export function adjacentDates(dates: string[], selected: string) {
  return {previous: dates.filter(date => date < selected).at(-1) ?? null, next: dates.find(date => date > selected) ?? null};
}
