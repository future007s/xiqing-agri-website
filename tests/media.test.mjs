import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost as upload } from '../functions/api/media/upload.ts';
import { onRequestPatch as patch, onRequestDelete as remove, onRequestPost as action, onRequestGet as manage } from '../functions/api/media/manage.ts';
import { onRequestGet as content } from '../functions/api/media/[mediaId]/content.ts';
import { onRequestGet as publicList } from '../functions/api/experiments/[experimentId]/media.ts';
import { normalizeCapturedAt, mediaFromRow, optionsResponse } from '../functions/_shared/media.ts';
import worker from '../src/worker.ts';

// Execute the real SQL in SQLite, including transactions and injected failures.
class D1 {
  connection = new DatabaseSync(':memory:');
  failAudit = false;
  failPurgeAudit = false;
  loseNextBatchResponse = false;
  losePurgeResponse = false;
  constructor(privateMigration = true) {
    for (const name of ['0001_experiment_media.sql', '0002_media_management.sql', '0003_experiment_data_design.sql', ...(privateMigration ? ['0004_private_media.sql'] : [])]) this.connection.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  prepare(sql) {
    const db = this;
    return {
      sql, values: [],
      bind(...values) { return { ...this, values }; },
      execute() {
        if (sql.includes('INSERT INTO experiment_media_audit') && (db.failAudit || (db.failPurgeAudit && this.values[1] === 'purge'))) throw new Error('injected audit outage');
        const stmt = db.connection.prepare(sql);
        const results = stmt.columns().length ? stmt.all(...this.values) : (stmt.run(...this.values), []);
        return { results };
      },
      async all() { return this.execute(); },
      async run() { return this.execute(); },
    };
  }
  async batch(statements) {
    this.connection.exec('BEGIN');
    let results;
    try { results = statements.map((s) => s.execute()); this.connection.exec('COMMIT'); }
    catch (e) { this.connection.exec('ROLLBACK'); throw e; }
    if (this.losePurgeResponse && statements[0].sql.startsWith('DELETE FROM experiment_media')) { this.losePurgeResponse = false; throw new Error('purge committed, response lost'); }
    if (this.loseNextBatchResponse) { this.loseNextBatchResponse = false; throw new Error('committed, response lost'); }
    return results;
  }
  rows(sql = 'SELECT * FROM experiment_media') { return this.connection.prepare(sql).all(); }
}
class R2 {
  objects = new Map();
  reads = 0;
  failDelete = false;
  async put(key, bytes, options) { this.objects.set(key, { bytes: bytes.slice(0), options }); }
  async head(key) { const o = this.objects.get(key); return o ? { size: o.bytes.byteLength } : null; }
  async get(key, options) {
    this.reads++;
    const o = this.objects.get(key); if (!o) return null;
    const bytes = options?.range ? o.bytes.slice(options.range.offset, options.range.offset + options.range.length) : o.bytes;
    return { body: new Blob([bytes]).stream(), size: o.bytes.byteLength };
  }
  async delete(key) { if (this.failDelete) throw new Error('injected R2 failure'); this.objects.delete(key); }
}
const fixture = () => ({ DB: new D1(), MEDIA_PRIVATE_BUCKET: new R2(), MEDIA_UPLOAD_TOKEN: 'test-only-token' });
function request(path, method = 'GET', body, auth = true, extraHeaders = {}) {
  const headers = { ...(auth ? { Authorization: 'Bearer test-only-token' } : {}), ...extraHeaders };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  return new Request(`https://test.invalid${path}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}
async function put(env, overrides = {}, bytes = '0123456789') {
  const form = new FormData();
  for (const [k, v] of Object.entries({ experimentId: 'T01-001', kind: 'image', caption: '原说明', alt: '原图', capturedAt: '2026-09-06T10:30', ...overrides })) form.set(k, v);
  form.set('file', new File([bytes], 'a.png', { type: 'image/png' }));
  const response = await upload({ env, request: request('/api/media/upload', 'POST', form), params: {} });
  return { response, payload: await response.json() };
}
const context = (env, id, method = 'GET', body, auth = true, headers = {}) => ({ env, request: request(`/api/media/${id}/content`, method, body, auth, headers), params: { mediaId: id } });
const purgeContext = (env, id, confirmed = true) => ({ env, request: request(`/api/media/${id}/purge`, 'POST', undefined, true, confirmed ? { 'X-Confirm-Purge': 'PURGE' } : {}), params: { mediaId: id, action: 'purge' } });
const restoreContext = (env, id) => ({ ...context(env, id, 'POST'), params: { mediaId: id, action: 'restore' } });

test('upload requires auth, D1 and private binding; no public-bucket fallback', async () => {
  const env = fixture();
  assert.equal((await upload({ env, request: request('/api/media/upload', 'POST', undefined, false), params: {} })).status, 401);
  assert.equal((await put({ ...env, DB: undefined })).response.status, 503);
  assert.equal((await put({ ...env, MEDIA_PRIVATE_BUCKET: undefined, MEDIA_BUCKET: env.MEDIA_PRIVATE_BUCKET })).response.status, 503);
  assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 0);
});

test('pending/private file cannot be read anonymously; review, publish and revoke take effect', async () => {
  const env = fixture(); const { payload, response } = await put(env); const id = payload.media.id;
  assert.equal(response.status, 201); assert.match(payload.media.src, /^\/api\/media\/.*\/content$/);
  assert.equal(payload.media.visibility, 'private');
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 404);
  assert.equal(env.MEDIA_PRIVATE_BUCKET.reads, 0);
  assert.equal(await (await content(context(env, id))).text(), '0123456789');
  assert.equal((await patch(context(env, id, 'PATCH', { visibility: 'public' }))).status, 200);
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 404);
  await patch(context(env, id, 'PATCH', { reviewStatus: 'confirmed' }));
  const published = await content(context(env, id, 'GET', undefined, false));
  assert.equal(published.status, 200); assert.match(published.headers.get('Cache-Control'), /no-store/);
  assert.equal(published.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await (await publicList({ env, request: request('/'), params: { experimentId: 'T01-001' } })).json()).media.length, 1);
  await patch(context(env, id, 'PATCH', { reviewStatus: 'rejected' }));
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 404);
  await patch(context(env, id, 'PATCH', { reviewStatus: 'confirmed', visibility: 'private' }));
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 404);
});

test('soft delete revokes bytes for public and admin; restore preserves policy', async () => {
  const env = fixture(); const { payload } = await put(env, { visibility: 'public', reviewStatus: 'confirmed' }); const id = payload.media.id;
  await remove(context(env, id, 'DELETE'));
  assert.equal((await content(context(env, id))).status, 404);
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 404);
  assert.equal((await action(restoreContext(env, id))).status, 200);
  assert.equal((await content(context(env, id, 'GET', undefined, false))).status, 200);
});

test('range, suffix, HEAD and invalid ranges support video-style retrieval', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  const partial = await content(context(env, id, 'GET', undefined, true, { Range: 'bytes=2-5' }));
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/10'); assert.equal(await partial.text(), '2345');
  assert.equal(await (await content(context(env, id, 'GET', undefined, true, { Range: 'bytes=-3' }))).text(), '789');
  for (const range of ['bytes=20-', 'bytes=-0', 'bytes=9-2', 'bytes=0-1,4-5', 'bad']) assert.equal((await content(context(env, id, 'GET', undefined, true, { Range: range }))).status, 416);
  const before = env.MEDIA_PRIVATE_BUCKET.reads;
  const head = await content(context(env, id, 'HEAD'));
  assert.equal(head.headers.get('Content-Length'), '10'); assert.equal(await head.text(), ''); assert.equal(env.MEDIA_PRIVATE_BUCKET.reads, before);
});

test('legacy public URLs are quarantined in list, direct content and metadata', async () => {
  const env = fixture(); const { payload } = await put(env, { visibility: 'public', reviewStatus: 'confirmed' }); const id = payload.media.id;
  env.DB.connection.prepare("UPDATE experiment_media SET storage_backend='legacy_public',src='https://public.invalid/old',thumbnail='https://public.invalid/thumb' WHERE id=?").run(id);
  const list = await (await publicList({ env, request: request('/'), params: { experimentId: 'T01-001' } })).json(); assert.equal(list.media.length, 0);
  const managed = await (await manage({ env, request: request('/api/media'), params: {} })).json(); assert.equal(managed.media[0].src, ''); assert.equal(managed.media[0].thumbnail, null);
  assert.equal((await content(context(env, id))).status, 404);
  assert.equal((await patch(context(env, id, 'PATCH', { visibility: 'public' }))).status, 409);
});

test('same bytes are idempotent within an experiment without overwriting metadata', async () => {
  const env = fixture(); const first = await put(env); const second = await put(env, { caption: '新说明', visibility: 'public', reviewStatus: 'confirmed' });
  assert.equal(second.response.status, 200); assert.equal(second.payload.media.id, first.payload.media.id);
  assert.equal(second.payload.media.caption, '原说明'); assert.equal(second.payload.media.visibility, 'private');
  assert.equal(env.DB.rows().length, 1); assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 1);
});

test('concurrent byte-identical uploads retain one canonical record and object', async () => {
  const env = fixture(); const results = await Promise.all([put(env), put(env), put(env)]);
  assert.equal(new Set(results.map((r) => r.payload.media.id)).size, 1);
  assert.equal(env.DB.rows().length, 1); assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 1);
  assert.equal(env.DB.rows('SELECT * FROM experiment_media_audit').length, 1);
});

test('cross-experiment duplicates own separate objects; purge cannot remove the other', async () => {
  const env = fixture(); const a = await put(env); const b = await put(env, { experimentId: 'T02-001' });
  assert.notEqual(a.payload.media.objectKey, b.payload.media.objectKey);
  await remove(context(env, a.payload.media.id, 'DELETE'));
  assert.equal((await action(purgeContext(env, a.payload.media.id))).status, 200);
  assert.equal(await (await content(context(env, b.payload.media.id))).text(), '0123456789');
});

test('audit failure rolls back metadata edits, deletion and restore', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  env.DB.failAudit = true;
  assert.equal((await patch(context(env, id, 'PATCH', { visibility: 'public', caption: 'changed' }))).status, 503);
  assert.equal(env.DB.rows()[0].caption, '原说明'); assert.equal(env.DB.rows()[0].visibility, 'private');
  assert.equal((await remove(context(env, id, 'DELETE'))).status, 503); assert.equal(env.DB.rows()[0].deleted_at, null);
  env.DB.failAudit = false; await remove(context(env, id, 'DELETE')); env.DB.failAudit = true;
  assert.equal((await action(restoreContext(env, id))).status, 503); assert.ok(env.DB.rows()[0].deleted_at);
});

test('missing audit schema fails closed even on upload', async () => {
  const env = fixture(); env.DB.connection.exec('DROP TABLE experiment_media_audit');
  assert.equal((await put(env)).response.status, 503); assert.equal(env.DB.rows().length, 0);
});

test('lost commit response never removes the committed bytes; retry finds canonical upload', async () => {
  const env = fixture(); env.DB.loseNextBatchResponse = true;
  assert.equal((await put(env)).response.status, 503);
  assert.equal(env.DB.rows().length, 1); assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 1);
  const retry = await put(env); assert.equal(retry.response.status, 200);
  assert.equal(await (await content(context(env, retry.payload.media.id))).text(), '0123456789');
});

test('purge requires explicit confirmation on POST and a soft-deleted record', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  assert.equal((await action(purgeContext(env, id))).status, 409);
  await remove(context(env, id, 'DELETE'));
  assert.equal((await action(purgeContext(env, id, false))).status, 400); assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 1);
  assert.match(optionsResponse().headers.get('Access-Control-Allow-Headers'), /X-Confirm-Purge/);
});

test('purge intent audit failure prevents physical deletion', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  await remove(context(env, id, 'DELETE')); env.DB.failAudit = true;
  assert.equal((await action(purgeContext(env, id))).status, 503);
  assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 1); assert.equal(env.DB.rows()[0].purge_state, 'active');
});

test('R2 failure leaves durable purge intent, blocks restore/duplicate, and supports retry', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  await remove(context(env, id, 'DELETE')); env.MEDIA_PRIVATE_BUCKET.failDelete = true;
  assert.equal((await action(purgeContext(env, id))).status, 502); assert.equal(env.DB.rows()[0].purge_state, 'purging');
  assert.equal((await action(restoreContext(env, id))).status, 409);
  assert.equal((await patch(context(env, id, 'PATCH', { caption: 'no' }))).status, 409);
  assert.equal((await put(env)).response.status, 409);
  env.MEDIA_PRIVATE_BUCKET.failDelete = false; assert.equal((await action(purgeContext(env, id))).status, 200);
  assert.equal(env.DB.rows().length, 0); assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 0);
});

test('final purge audit failure retains retryable row; replacement uses a new object key', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  await remove(context(env, id, 'DELETE')); env.DB.failPurgeAudit = true;
  assert.equal((await action(purgeContext(env, id))).status, 503); assert.equal(env.DB.rows()[0].purge_state, 'purging');
  assert.equal(env.MEDIA_PRIVATE_BUCKET.objects.size, 0);
  env.DB.failPurgeAudit = false; assert.equal((await action(purgeContext(env, id))).status, 200);
  const fresh = await put(env); assert.notEqual(fresh.payload.media.objectKey, payload.media.objectKey);
  assert.equal((await action(purgeContext(env, id))).status, 200);
  assert.equal((await content(context(env, fresh.payload.media.id))).status, 200);
});

test('invalid JSON, timestamp, external derivatives and unknown policy fail before mutation', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  for (const body of [null, [], { capturedAt: '2026-02-30T10:00' }, { capturedAt: '' }, { caption: null }, { visibility: 'unknown' }, { poster: 'https://public.invalid/private' }]) assert.equal((await patch(context(env, id, 'PATCH', body))).status, 400);
  assert.equal((await put(env, { capturedAt: '2026-13-01T10:00' })).response.status, 400);
  assert.equal((await put(env, { visibility: 'unknown' })).response.status, 400);
  assert.equal(env.DB.rows()[0].caption, '原说明');
  assert.equal(normalizeCapturedAt('2026-09-06T10:30'), '2026-09-06T10:30:00+08:00');
  assert.equal(normalizeCapturedAt('2026-09-06T02:30:00.000Z'), '2026-09-06T02:30:00.000Z');
  assert.throws(() => normalizeCapturedAt('2026-09-06T23:60'));
  assert.equal(mediaFromRow({}).reviewStatus, 'pending'); assert.equal(mediaFromRow({}).visibility, 'private');
});

test('standalone Worker routes content through authorization instead of assets fallback', async () => {
  const env = fixture(); const { payload } = await put(env);
  env.ASSETS = { fetch: async () => new Response('fallback', { status: 418 }) };
  const result = await worker.fetch(request(payload.media.src), env);
  assert.equal(result.status, 200); assert.equal(await result.text(), '0123456789');
  assert.equal((await worker.fetch(request(payload.media.src, 'GET', undefined, false), env)).status, 404);
});


test('lost final purge response can be retried as completed using durable audit', async () => {
  const env = fixture(); const { payload } = await put(env); const id = payload.media.id;
  await remove(context(env, id, 'DELETE')); env.DB.losePurgeResponse = true;
  assert.equal((await action(purgeContext(env, id))).status, 503);
  assert.equal(env.DB.rows().length, 0);
  const retried = await action(purgeContext(env, id));
  assert.equal(retried.status, 200); assert.equal((await retried.json()).alreadyPurged, true);
  assert.equal((await action(purgeContext(env, 'unknown'))).status, 404);
});


test('migration quarantines existing duplicate checksums without destroying historical records', async () => {
  const db = new D1(false);
  const insert = db.connection.prepare(`INSERT INTO experiment_media
    (id,experiment_id,kind,src,captured_at,caption,alt,visibility,review_status,object_key,mime_type,size_bytes,checksum,uploaded_at)
    VALUES (?,'T01-001','image',?,'2026-09-06T00:00:00Z','old','old','public','confirmed',?,'image/png',10,'same-checksum','2026-09-06T00:00:00Z')`);
  insert.run('old-1','https://public.invalid/one','one'); insert.run('old-2','https://public.invalid/two','two');
  db.connection.exec(readFileSync('migrations/0004_private_media.sql','utf8'));
  assert.equal(db.rows().length, 2);
  assert.ok(db.rows().every(r => r.storage_backend === 'legacy_public' && r.purge_state === 'active'));
  assert.equal(db.rows()[0].src,'https://public.invalid/one');
  const result = await publicList({ env: { DB: db }, request: request('/'), params: { experimentId: 'T01-001' } });
  assert.equal((await result.json()).media.length, 0);
});
