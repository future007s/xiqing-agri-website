import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sortExperimentsNewestFirst} from '../src/lib/experiments.ts';
const entry = (slug) => ({id:slug, data:{id:slug.startsWith('nursery')?'NURSERY-20261024-01':'STRAWBERRY-20261110-01',startDate:slug.startsWith('nursery')?'2026-10-24':'2026-11-10'},body:readFileSync(`src/content/experiments/${slug}.md`,'utf8')});
test('discovery sorts by real latest record instead of experiment start date',()=>{
 const nursery=entry('nursery-20261024-01'), strawberry=entry('strawberry-20261110-01');
 assert.deepEqual([strawberry,nursery].sort(sortExperimentsNewestFirst).map(x=>x.id),[nursery.id,strawberry.id]);
});
test('cards distinguish start date from latest record in both languages',()=>{
 const source=readFileSync('src/components/ExperimentCard.astro','utf8');
 for(const label of ['开始日期','最新记录','Started','Latest record']) assert.ok(source.includes(label));
});
test('strawberry detail links to ongoing shared-tower observations in both languages',()=>{
 for(const prefix of ['', 'en/']){
 const source=readFileSync(`src/pages/${prefix}experiments/[slug].astro`,'utf8');
 assert.ok(source.includes(`href="/${prefix}experiments/nursery-20261024-01"`));
 }
});
