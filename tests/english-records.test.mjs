import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {parse} from 'yaml';
import {englishData, englishText, syncEnglishRecords} from '../scripts/sync-english-records.mjs';
import {dateIndex, parseRecordContract, presentProductionDay} from '../src/lib/record-days.ts';
import {currentGrowingRecord} from '../src/lib/public-records.ts';
const read = path => readFile(path, 'utf8');
const front = text => parse(text.split('---')[1]);

test('every public experiment and production batch has an up-to-date English counterpart',async()=>{
  assert.ok(await syncEnglishRecords({check:true}) >= 2);
  for (const [folder, excluded] of [['experiments','T01-001'],['trace-batches','PB-QDF01-20260824-01']]) {
    for (const file of await readdir(`src/content/${folder}`)) {
      const source=await read(`src/content/${folder}/${file}`),data=front(source);
      if (data.id===excluded) continue;
      const translated=front(await read(`src/content/${folder}-en/${file}`));
      assert.deepEqual(translated,englishData(data));
      assert.equal(translated.id,data.id);
      assert.doesNotMatch(JSON.stringify(translated),/[\u3400-\u9fff]/u);
    }
  }
});
test('English daily records retain all dates, IDs, counts, photos, times and measurements',async()=>{
  const zh={data:{id:'NURSERY-20261024-01'},body:await read('src/content/experiments/nursery-20261024-01.md')};
  const en={data:zh.data,body:await read('src/content/experiments-en/nursery-20261024-01.md')};
  const source=parseRecordContract(zh.body,zh.data.id),translated=parseRecordContract(en.body,en.data.id);
  assert.deepEqual(translated,englishData(source));
  assert.deepEqual(dateIndex(translated),dateIndex(source));
  assert.doesNotMatch(JSON.stringify(translated),/[\u3400-\u9fff]/u);
  for (const [i,day] of source.days.entries()) {
    const output=translated.days[i];
    assert.equal(output.date,day.date);
    assert.deepEqual(output.environment.map(e=>e.metrics.map(m=>[m.mean,m.unit])),day.environment.map(e=>e.metrics.map(m=>[m.mean,m.unit])));
    assert.deepEqual(output.batches.map(b=>[b.key,b.context.sowing,b.context.tray_holes,b.context.sown_seeds,b.records.map(r=>[r.id,r.when,r.images.map(i=>[i.id,i.date,i.src])])]),day.batches.map(b=>[b.key,b.context.sowing,b.context.tray_holes,b.context.sown_seeds,b.records.map(r=>[r.id,r.when,r.images.map(i=>[i.id,i.date,i.src])])]));
  }
  assert.equal(currentGrowingRecord(en,'en').phase,'Transplanted');
  assert.match(currentGrowingRecord(en,'en').summary,/6 November 2026/);
  assert.match(currentGrowingRecord(zh).summary,/11 月 6 日/);
  const nursery=presentProductionDay(translated.days[0],'en');
  assert.ok(nursery.nurseryOrigins.length);
  assert.doesNotMatch(JSON.stringify(nursery),/[\u3400-\u9fff]/u);
});
test('unknown source prose is reported instead of silently becoming Chinese fallback',()=>{
  assert.throws(()=>englishText('一条尚未翻译的新观察'),/Missing English record translation/);
  assert.equal(englishText('11月6日育苗观察'),'Growing observation, 6 November');
  assert.equal(englishData({value:49,unit:'%RH',sensor:'XQ-CTRL-01'}).value,49);
});
