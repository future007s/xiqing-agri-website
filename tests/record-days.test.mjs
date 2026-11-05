import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacentDates, dateIndex, isDay, parseRecordContract, presentProductionDay, readDay, readIndex} from '../src/lib/record-days.ts';
import {availableRecordDate, calendarArrowDate, monthDays, shiftMonth} from '../src/lib/record-calendar.ts';

test('calendar enables exact indexed days, including gaps inside date bounds',()=>{
  const dates=['2026-10-24','2026-10-26'];
  const cells=monthDays('2026-10',dates);
  assert.deepEqual(cells.filter(cell=>cell.enabled).map(cell=>cell.date),dates);
  assert.equal(cells.find(cell=>cell.date==='2026-10-25').enabled,false);
  assert.equal(cells.find(cell=>cell.date==='2026-10-27').enabled,false);
  assert.equal(monthDays('2026-11',dates).some(cell=>cell.enabled),false);
});
test('keyboard skips disabled gaps and cannot select unavailable future dates',()=>{
  const dates=['2026-10-24','2026-10-26','2026-11-02'];
  assert.equal(calendarArrowDate(dates,'2026-10-24','ArrowRight'),'2026-10-26');
  assert.equal(calendarArrowDate(dates,'2026-10-26','ArrowLeft'),'2026-10-24');
  assert.equal(calendarArrowDate(dates,'2026-10-25','ArrowRight'),null);
  assert.equal(calendarArrowDate(dates,'2026-11-02','ArrowRight'),null);
  assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(shiftMonth('2027-01',-1),'2026-12');
});
test('unsupported URL dates resolve to a real indexed day; empty index stays empty',()=>{
  const dates=['2026-10-24','2026-10-26'];
  assert.deepEqual(availableRecordDate(dates,'2026-10-25'),{date:'2026-10-26',unavailable:true});
  assert.deepEqual(availableRecordDate(dates,'2099-12-31'),{date:'2026-10-26',unavailable:true});
  assert.deepEqual(availableRecordDate(dates,'not-a-date'),{date:'2026-10-26',unavailable:true});
  assert.deepEqual(availableRecordDate(dates,'2026-10-24'),{date:'2026-10-24',unavailable:false});
  assert.deepEqual(availableRecordDate([],null),{date:null,unavailable:false});
});

const id = 'DAY-TEST';
const day = date => ({schema_version:1, experiment_id:id, date, batches:[], environment:[]});
const wrap = value => '<!-- xiqing-record-days:v1\n'+JSON.stringify(value)+'\nxiqing-record-days:v1 -->';
const contract = {schema_version:1, projection_version:4, experiment_id:id, days:[day('2026-10-24'),day('2026-10-25')]};

test('date index is lightweight, ordered, and defaults to latest',()=>{
  assert.deepEqual(dateIndex(parseRecordContract(wrap(contract), id)), {
    schema_version:1,experiment_id:id,latest:'2026-10-25',dates:['2026-10-24','2026-10-25']});
  assert.equal(parseRecordContract('ordinary Markdown',id),null);
  assert.equal(isDay('2026-02-31'),false);
  assert.equal(isDay('2026-10-25T00:00:00Z'),false);
});
test('empty, single day, gap, and future dates have explicit boundaries',()=>{
  assert.deepEqual(adjacentDates([], '2026-10-24'),{previous:null,next:null});
  assert.deepEqual(adjacentDates(['2026-10-24'],'2026-10-24'),{previous:null,next:null});
  assert.deepEqual(adjacentDates(['2026-10-24','2026-11-01'],'2026-10-26'),{previous:'2026-10-24',next:'2026-11-01'});
  assert.equal(readIndex({schema_version:1,experiment_id:id,latest:null,dates:[]},id).latest,null);
});
test('damaged contract fails closed rather than rendering all Markdown',()=>{
  assert.throws(()=>parseRecordContract('<!-- xiqing-record-days:v1\n{}',id));
  assert.throws(()=>parseRecordContract(wrap({...contract,projection_version:3}),id));
  assert.throws(()=>parseRecordContract(wrap(contract), 'OTHER'));
  assert.throws(()=>parseRecordContract(wrap({...contract,days:contract.days.toReversed()}),id));
});
test('wrong-day or cross-experiment payload cannot be displayed',()=>{
  assert.throws(()=>readDay(day('2026-10-24'),id,'2026-10-25'));
  assert.throws(()=>readDay(day('2026-10-25'),'OTHER','2026-10-25'));
});
test('no-photo/no-environment day is valid; photos require exact matching day',()=>{
  assert.deepEqual(readDay(day('2026-10-24'),id,'2026-10-24').environment,[]);
  const payload=day('2026-10-24');
  payload.batches=[{key:'black',label:'黑色海绵批次',context:{crop:'生菜',material:'黑色海绵',phase:'育苗中',sowing:{precision:'day',value:'2026-10-15'},tray_holes:100,sown_seeds:100},records:[{id:'one',date:'2026-10-24',kind:'daily',title:'观察',fields:[],images:[{id:'image',date:'2026-10-25',src:'/media/record-sync/'+'a'.repeat(64)+'.jpg',alt:'观察'}]}]}];
  assert.throws(()=>readDay(payload,id,'2026-10-24'));
  payload.batches[0].records[0].images[0].date='2026-10-24';
  assert.equal(readDay(payload,id,'2026-10-24').batches[0].context.sown_seeds,100);
});

test('one production-day view preserves two nursery sources without merging dates or seed counts',()=>{
  const payload=day('2026-10-24');
  payload.batches=[['a','2026-10-15',100,'approximate_day'],['b','2026-10-22',200,'day']].map(([key,date,n,precision])=>({
    key,label:key,context:{crop:'生菜',material:key,phase:'育苗中，尚未移苗',sowing:{precision,value:date},tray_holes:n,sown_seeds:n},records:[]
  }));
  const before=structuredClone(payload), view=presentProductionDay(payload);
  assert.deepEqual(view.crops,['生菜']);assert.deepEqual(view.phases,['育苗中，尚未移苗']);
  assert.deepEqual(view.nurseryOrigins,['约2026-10-15播种 · 100孔 · 100粒','2026-10-22播种 · 200孔 · 200粒']);
  assert.deepEqual(payload,before);
});

test('transplanted day keeps the reported correction and does not carry nursery totals into the batch view',()=>{
  const payload=day('2026-11-05');
  const daily={id:'count-review',date:payload.date,kind:'daily',title:'观察',fields:[{label:'数量口径',value:'同批49株；11月4日原报39株，11月5日更正'}],images:[]};
  payload.batches=[{key:'origin',label:'原始育苗来源',context:{crop:'生菜',material:'原始材料',phase:'已移栽',sowing:{precision:'day',value:'2026-10-15'},tray_holes:100,sown_seeds:100},records:[daily]}];
  const view=presentProductionDay(payload);
  assert.deepEqual(view.phases,['已移栽']);assert.deepEqual(view.nurseryOrigins,[]);
  assert.deepEqual(view.records[0].fields,daily.fields);assert.equal(view.records.length,1);
});
