import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeSample } from '../functions/_shared/telemetry.ts';
import { onRequest as chart } from '../functions/api/telemetry/index.ts';
import { onRequest as metrics } from '../functions/api/telemetry/metrics.ts';
import { onRequest as publish } from '../functions/api/telemetry/publish.ts';
import { onRequest as fallback } from '../functions/api/telemetry/[[path]].ts';
import worker from '../src/worker.ts';

test('canonical chart preserves EC labels and unit-specific baselines for private reuse', () => {
  const source=readFileSync('src/scripts/telemetry-chart.ts','utf8');
  const match=source.match(/const metricLabels[^=]*=\s*(\{[\s\S]*?\n\});/);
  assert.ok(match);const labels=runInNewContext(`(${match[1]})`);
  assert.equal(labels.electrical_conductivity.zh,'营养液电导率');
  assert.equal(labels.solution_temperature.en,'Solution temperature');
  assert.ok(source.includes("metric === 'electrical_conductivity' ? 'ec' : metric"));
});
test('every retired Pages telemetry endpoint refuses all methods without touching D1',async () => {
  const env={get DB(){throw new Error('must not access D1');},get TELEMETRY_PUBLISH_TOKEN(){throw new Error('no public authorization');}};
  for(const handler of [chart,metrics,publish,fallback]) for(const method of ['GET','HEAD','POST','OPTIONS','DELETE']) {
    const response=handler({request:new Request('https://test.invalid/api/telemetry',{method}),env});
    assert.equal(response.status,410);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const data=await response.json();assert.equal(data.code,'data_moved_to_private_field');
    assert.equal('series' in data,false);assert.equal('metrics' in data,false);
  }
});
test('old publisher and website admin tokens cannot reopen public sensor data',async () => {
  for(const token of ['legacy-publisher','website-admin','']) {
    const request=new Request('https://test.invalid/api/telemetry/publish',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{"samples":[{"average":25}]}'});
    assert.equal(publish({request,env:{DB:{prepare(){throw Error('no write');}},TELEMETRY_PUBLISH_TOKEN:token}}).status,410);
  }
});
test('standalone Worker blocks the telemetry namespace rather than serving an asset fallback',async () => {
  const env={ASSETS:{fetch(){throw Error('no telemetry asset fallback');}}};
  for(const pathname of ['/api/telemetry','/api/telemetry/metrics','/api/telemetry/publish','/api/telemetry/old/path']) {
    assert.equal((await worker.fetch(new Request('https://test.invalid'+pathname),env)).status,410);
  }
});
test('public navigation, pages and sitemap contain no data dashboard or data API call',() => {
  const header=readFileSync('src/components/Header.astro','utf8');
  assert.equal(header.includes("label: '数据'"),false);assert.equal(header.includes("label: 'Data'"),false);
  for(const file of ['src/pages/data.astro','src/pages/en/data.astro']) {
    const source=readFileSync(file,'utf8');
    assert.equal(source.includes('TelemetryDashboard'),false);assert.ok(source.includes('noindex'));
    assert.ok(source.includes('https://aeroponics-node-h110.tail6677b4.ts.net:8443/data'));
    assert.equal(source.includes('control.xiqingagri.com'),false);
  }
  const sitemap=readFileSync('src/pages/sitemap.xml.ts','utf8');
  assert.equal(sitemap.includes("'/data'"),false);assert.equal(sitemap.includes("'/en/data'"),false);
});
test('field management links use Tailscale HTTPS while preserving sign-in and locale',() => {
  const header=readFileSync('src/components/Header.astro','utf8');
  assert.ok(header.includes('href="https://aeroponics-node-h110.tail6677b4.ts.net:8443/"'));
  assert.ok(header.includes('需要连接 Tailscale 并登录'));assert.ok(header.includes('requires Tailscale and sign-in'));
  assert.ok(header.includes('rel="noopener noreferrer"'));
  assert.ok(header.includes('请先连接 Tailscale'));
  assert.equal(header.includes('control.xiqingagri.com'),false);
  assert.equal(header.includes('fd7a:'),false);
  assert.ok(readFileSync('src/pages/data.astro','utf8').includes('href="https://aeroponics-node-h110.tail6677b4.ts.net:8443/data"'));
  assert.ok(readFileSync('src/pages/en/data.astro','utf8').includes('href="https://aeroponics-node-h110.tail6677b4.ts.net:8443/data?lang=en"'));
});
test('legacy normalization stays available for historical schema review without an upload endpoint',() => {
  assert.equal(normalizeSample({bucketStart:'2026-09-23T00:11:00Z'}),null);
  const source=readFileSync('src/scripts/telemetry-chart.ts','utf8');
  assert.ok(source.includes('pointAt - lastPointAt > 10 * 60 * 1000'));
  assert.ok(source.includes("response.status === 401"));
});
