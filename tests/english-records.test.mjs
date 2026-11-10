import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {parse} from 'yaml';
import {englishData, englishText, syncEnglishRecords} from '../scripts/sync-english-records.mjs';
import {dateIndex, parseRecordContract, presentProductionDay} from '../src/lib/record-days.ts';
import {currentGrowingRecord} from '../src/lib/public-records.ts';
const read = path => readFile(path, 'utf8');
const front = text => parse(text.split('---')[1]);
const entryForContract = contract => ({data:{id:contract.experiment_id},
  body:`<!-- xiqing-record-days:v1\n${JSON.stringify(contract)}\nxiqing-record-days:v1 -->`});

test('purchased strawberries have a separate dated record without fabricated nursery or survival figures',async()=>{
  const id='STRAWBERRY-20261110-01';
  const zh=await read('src/content/experiments/strawberry-20261110-01.md');
  const en=await read('src/content/experiments-en/strawberry-20261110-01.md');
  const contract=parseRecordContract(zh,id);
  assert.deepEqual(parseRecordContract(en,id),englishData(contract));
  assert.equal(front(zh).plant,'草莓');
  assert.equal(front(zh).cultivar,null);
  assert.equal(front(zh).survivalRate,undefined);
  assert.equal(front(zh).yieldKg,undefined);
  assert.equal(contract.days.length,1);
  assert.equal(contract.days[0].date,'2026-11-10');
  assert.equal(contract.days[0].environment.length,0);
  const batch=contract.days[0].batches[0];
  assert.equal(batch.context.crop,'草莓');
  assert.equal(batch.context.sowing.value,null);
  assert.equal(batch.context.sown_seeds,null);
  assert.equal(batch.context.tray_holes,null);
  assert.equal(batch.records[0].images.length,4);
  assert.match(batch.records[0].fields.find(f=>f.label==='数量口径').value,/20株.*当日报告.*不作为成活统计/);
  assert.doesNotMatch(JSON.stringify(contract),/66株|49株/);
});

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
  // These are historical facts, not requirements for every later camera record.
  const countDay=source.days.find(day=>day.date==='2026-11-09');
  const translatedCountDay=translated.days.find(day=>day.date==='2026-11-09');
  assert.ok(countDay,'The 9 November count report must remain in history');
  assert.ok(translatedCountDay,'The translated count report must remain in history');
  const historicalZh=currentGrowingRecord(entryForContract({...source,days:[countDay]}));
  const historicalEn=currentGrowingRecord(entryForContract({...translated,days:[translatedCountDay]}),'en');
  assert.equal(historicalEn.phase,'Transplanted');
  assert.match(historicalEn.summary,/current transplanted count is 66 plants/);
  assert.match(historicalZh.summary,/当前移栽数量为66株/);
  assert.equal(currentGrowingRecord(zh).date,dateIndex(source).latest);
  assert.equal(currentGrowingRecord(en,'en').date,dateIndex(translated).latest);
  assert.ok(source.days.some(d=>d.date==='2026-11-06'));
  const batch=front(await read('src/content/trace-batches/pb-qdf01-20261104-01.md'));
  const countReport=batch.productionRecords.find(r=>r.id==='B20261104-01-COUNT-REPORT-20261109');
  assert.equal(countReport.at,'2026-11-09');
  assert.match(countReport.summary,/当前移栽数量为66株/);
  const latestCountReport=batch.productionRecords.filter(r=>r.type==='count_report'||r.type==='count_correction')
    .sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
  if (latestCountReport.id===countReport.id) assert.equal(batch.declaredMemberCount,66);
  assert.match(batch.productionRecords.find(r=>r.id==='B20261104-01-COUNT-CORRECTION-20261105').summary,/更正为49株/);
  const nursery=presentProductionDay(translated.days[0],'en');
  assert.ok(nursery.nurseryOrigins.length);
  assert.doesNotMatch(JSON.stringify(nursery),/[\u3400-\u9fff]/u);
});
test('a later camera-only day becomes current without inheriting a historical plant count',async()=>{
  for (const [folder,locale,label,summary] of [
    ['experiments','zh','可见范围与变化','合成测试：仅记录摄像头可见画面'],
    ['experiments-en','en','Visible condition and changes','Synthetic test: camera view only'],
  ]) {
    const id='NURSERY-20261024-01';
    const contract=parseRecordContract(await read(`src/content/${folder}/nursery-20261024-01.md`),id);
    const original=JSON.stringify(contract);
    const date=new Date(`${contract.days.at(-1).date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate()+1);
    const nextDate=date.toISOString().slice(0,10);
    const futureDay=structuredClone(contract.days.at(-1));
    futureDay.date=nextDate;
    futureDay.environment=[];
    futureDay.batches=[{...futureDay.batches[0],records:[{
      id:`synthetic-camera-${nextDate}`,date:nextDate,kind:'daily',title:'Camera',
      when:{precision:'day',value:nextDate},fields:[{label,value:summary}],images:[],
    }]}];
    const future={...contract,days:[...contract.days,futureDay]};
    const entry=entryForContract(future);
    const parsed=parseRecordContract(entry.body,id);
    assert.deepEqual(parsed.days.slice(0,-1),contract.days);
    assert.equal(dateIndex(parsed).latest,nextDate);
    assert.deepEqual(currentGrowingRecord(entry,locale),{
      date:nextDate,phase:futureDay.batches[0].context.phase,summary,
    });
    assert.doesNotMatch(currentGrowingRecord(entry,locale).summary,/66/);
    assert.equal(JSON.stringify(contract),original,'Historical source is not mutated');
  }
});

test('unknown source prose is reported instead of silently becoming Chinese fallback',()=>{
  assert.throws(()=>englishText('一条尚未翻译的新观察'),/Missing English record translation/);
  assert.equal(englishText('11月6日育苗观察'),'Growing observation, 6 November');
  assert.equal(englishData({value:49,unit:'%RH',sensor:'XQ-CTRL-01'}).value,49);
});

test('batch count reports have Chinese and English display labels',async()=>{
  const layout=await read('src/layouts/TraceBatchLayout.astro');
  assert.match(layout,/count_report: 'Count report'/);
  assert.match(layout,/count_report: '数量报告'/);
});
