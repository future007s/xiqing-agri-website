import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeSample, sampleBindings, TELEMETRY_UPSERT_SQL } from '../functions/_shared/telemetry.ts';
import { onRequestPost as publish } from '../functions/api/telemetry/publish.ts';
import { onRequestGet as chart } from '../functions/api/telemetry/index.ts';
import { onRequestGet as metrics } from '../functions/api/telemetry/metrics.ts';
import retention from '../workers/telemetry-retention/index.ts';

class D1 {
  connection = new DatabaseSync(':memory:');
  constructor() { this.connection.exec(readFileSync('migrations/0005_public_telemetry.sql', 'utf8')); }
  prepare(sql) {
    const db = this;
    return {
      sql,
      bind(...values) { return { ...this, values }; },
      async all() { return { results: db.connection.prepare(sql).all(...this.values) }; },
      async run() { return { meta: { changes: db.connection.prepare(sql).run(...this.values).changes } }; },
    };
  }
  async batch(statements) { return statements.map((statement) => this.connection.prepare(statement.sql).run(...statement.values)); }
}

const token = 'test-only-telemetry-token';
const env = () => ({ DB: new D1(), TELEMETRY_PUBLISH_TOKEN: token });
const sample = (overrides = {}) => ({
  metric: 'air_temperature', metricLabel: '温度', unit: '°C', bucketStart: '2026-09-23T00:10:00Z',
  sensorId: 'sensor-1', installationId: '0123456789abcdef01234567', sensorLabel: '温度探头',
  deviceId: 'gateway-1', deviceLabel: '采集器一', siteKind: 'tower', siteId: 'tower-1', siteLabel: '一号塔',
  average: 23.4, minimum: 22.8, maximum: 24.1, validCount: 8, totalCount: 10, quality: 'partial', ...overrides,
});
const context = (environment, path, method = 'GET', body) => ({
  env: environment,
  request: new Request(`https://test.invalid${path}`, {
    method,
    headers: { ...(method === 'POST' ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  params: {},
});

test('dashboard localizes canonical EC and solution temperature without changing units', () => {
  const source = readFileSync('src/scripts/telemetry-chart.ts', 'utf8');
  const labelMap = source.match(/const metricLabels[^=]*=\s*(\{[\s\S]*?\n\});/);
  assert.ok(labelMap, 'dashboard label map exists');
  const labels = runInNewContext(`(${labelMap[1]})`);
  for (const [metric, zh, en, unit] of [
    ['electrical_conductivity', '营养液电导率', 'Nutrient EC', 'µS/cm'],
    ['solution_temperature', '液温', 'Solution temperature', '°C'],
  ]) {
    assert.equal(labels[metric].zh, zh);
    assert.equal(labels[metric].en, en);
    assert.equal(`${labels[metric].zh} (${unit})`, `${zh} (${unit})`);
  }
  assert.equal(labels.ec.zh, labels.electrical_conductivity.zh);
});

test('metric list merges historical labels and counts distinct sensors per metric and unit', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T00:00:00Z') });
  const environment = env();
  const inputs = [
    sample({ metric: 'electrical_conductivity', metricLabel: 'electrical conductivity', unit: 'µS/cm' }),
    sample({ metric: 'electrical_conductivity', metricLabel: '营养液电导率', unit: 'µS/cm', bucketStart: '2026-09-23T00:20:00Z' }),
    sample({ metric: 'electrical_conductivity', metricLabel: '营养液电导率', unit: 'µS/cm', sensorId: 'sensor-2' }),
    sample({ metric: 'electrical_conductivity', metricLabel: '营养液电导率', unit: 'mS/cm', sensorId: 'sensor-3' }),
    sample({ metric: 'solution_temperature', metricLabel: 'solution temperature', unit: '°C' }),
    sample({ metric: 'solution_temperature', metricLabel: '液温', unit: '°C', bucketStart: '2026-09-23T00:20:00Z' }),
  ];
  assert.equal((await publish(context(environment, '/api/telemetry/publish', 'POST', { samples: inputs }))).status, 202);
  const response = await metrics(context(environment, '/api/telemetry/metrics'));
  assert.equal(response.status, 200);
  const result = (await response.json()).metrics;
  assert.equal(result.length, 3);
  const ec = result.find((row) => row.metric === 'electrical_conductivity' && row.unit === 'µS/cm');
  assert.equal(ec.label, '营养液电导率');
  assert.equal(ec.sensor_count, 2);
  assert.equal(result.find((row) => row.unit === 'mS/cm').sensor_count, 1);
  assert.equal(result.find((row) => row.metric === 'solution_temperature').label, '液温');
  assert.equal(environment.DB.connection.prepare('SELECT count(*) AS n FROM telemetry_10m').get().n, inputs.length);
});

test('ten-minute sample validation rejects off-boundary timestamps and inconsistent aggregates', () => {
  assert.ok(normalizeSample(sample()));
  assert.equal(normalizeSample(sample({ bucketStart: '2026-09-23T00:11:00Z' })), null);
  assert.equal(normalizeSample(sample({ validCount: 11, totalCount: 10 })), null);
  assert.equal(normalizeSample(sample({ installationId: 'not-an-installation' })), null);
});

test('publisher endpoint requires the secret token and validates the whole batch before writing', async () => {
  const environment = env();
  const noAuth = await publish({ ...context(environment, '/api/telemetry/publish', 'POST', { samples: [sample()] }), request: new Request('https://test.invalid/api/telemetry/publish', { method: 'POST', body: JSON.stringify({ samples: [sample()] }) }) });
  assert.equal(noAuth.status, 401);
  const invalid = await publish(context(environment, '/api/telemetry/publish', 'POST', { samples: [sample(), sample({ bucketStart: '2026-09-23T00:09:00Z' })] }));
  assert.equal(invalid.status, 400);
  assert.equal(environment.DB.connection.prepare('SELECT count(*) AS n FROM telemetry_10m').get().n, 0);
  const ok = await publish(context(environment, '/api/telemetry/publish', 'POST', { samples: [sample()] }));
  assert.equal(ok.status, 202);
  assert.equal(environment.DB.connection.prepare('SELECT count(*) AS n FROM telemetry_10m').get().n, 1);
});

test('daily chart returns separate series per sensor and supports site grouping', async () => {
  const environment = env();
  await publish(context(environment, '/api/telemetry/publish', 'POST', { samples: [
    sample(), sample({ sensorId: 'sensor-2', sensorLabel: '第二探头', bucketStart: '2026-09-23T00:20:00Z' }),
  ] }));
  const device = await chart(context(environment, '/api/telemetry?day=2026-09-23&metric=air_temperature&unit=%C2%B0C&groupBy=device'));
  const deviceData = await device.json();
  assert.equal(device.status, 200);
  assert.equal(deviceData.unit, '°C');
  assert.equal(deviceData.series.length, 2);
  const site = await chart(context(environment, '/api/telemetry?day=2026-09-23&metric=air_temperature&unit=%C2%B0C&groupBy=site'));
  assert.equal((await site.json()).series.length, 2);
  assert.equal((await chart(context(environment, '/api/telemetry?day=2026-09-24&metric=air_temperature'))).status, 400);
});

test('scheduled retention alone removes expired rows while uploads filter expired inputs', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T00:00:00Z') });
  const environment = env();
  for (const input of [
    sample({ sensorId: 'expired-existing', bucketStart: '2026-09-02T23:50:00Z' }),
    sample({ sensorId: 'retention-boundary', bucketStart: '2026-09-03T00:00:00Z' }),
  ]) {
    environment.DB.connection.prepare(TELEMETRY_UPSERT_SQL).run(...sampleBindings(normalizeSample(input)));
  }

  const response = await publish(context(environment, '/api/telemetry/publish', 'POST', { samples: [
    sample(), sample({ sensorId: 'expired-incoming', bucketStart: '2026-09-02T23:50:00Z' }),
  ] }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: 1, expired: 1 });
  const sensors = () => environment.DB.connection.prepare('SELECT sensor_id FROM telemetry_10m ORDER BY sensor_id').all().map((row) => row.sensor_id);
  assert.deepEqual(sensors(), ['expired-existing', 'retention-boundary', 'sensor-1']);

  await retention.scheduled({ cron: '10 0 * * *', scheduledTime: Date.now() }, environment);
  assert.deepEqual(sensors(), ['retention-boundary', 'sensor-1']);
});
