// Audit built pages and local fixtures only. No production, uploads or control requests.
import assert from 'node:assert/strict';
import {readFile, readdir, stat, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, sep} from 'node:path';
const {chromium} = await import(process.env.I18N_TEST_PLAYWRIGHT || 'playwright');
const root = resolve('dist');
const paths = [];
async function visit(folder) {
  for (const file of await readdir(folder,{withFileTypes:true})) {
    const path=resolve(folder,file.name);
    if (file.isDirectory()) await visit(path);
    else if (file.name.endsWith('.html')) paths.push('/'+path.slice(root.length+1).replace(/index\.html$/,''));
  }
}
await visit(root);
const server = createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let path=resolve(root,'.'+pathname);
    if (path !== root && !path.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
    if ((await stat(path)).isDirectory()) path=resolve(path,'index.html');
    const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.jpg')?'image/jpeg':path.endsWith('.svg')?'image/svg+xml':'text/html';
    res.writeHead(200,{'Content-Type':type});res.end(await readFile(path));
  } catch {res.writeHead(404,{'Content-Type':'text/html'});res.end(await readFile(resolve(root,'404.html')));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.I18N_TEST_BROWSER?{executablePath:process.env.I18N_TEST_BROWSER}:{})});
const audit = async(page,label) => {
  const found=await page.evaluate(()=>{
    const han=/[\u3400-\u9fff]/u, values=[];
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walk.nextNode()) {
      const node=walk.currentNode, parent=node.parentElement;
      if (!parent || parent.closest('script,style,.wordmark,.language-switch')) continue;
      if (han.test(node.textContent)) values.push(node.textContent.trim());
    }
    for (const e of document.querySelectorAll('*')) for (const a of ['title','alt','aria-label','placeholder','content']) {
      if(e.closest('.wordmark')) continue;
      const value=e.getAttribute(a);if(value && han.test(value)) values.push(`${a}: ${value}`);
    }
    return values;
  });
  assert.deepEqual(found,[],`${label}: untranslated visitor text`);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
};
let audits=0;
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const englishPaths=paths.filter(path=>path.startsWith('/en/'));
  assert.ok(englishPaths.length>=10);
  for (const path of englishPaths) {
    await page.goto(base+path); await page.waitForLoadState('networkidle');
    if (path.includes('/experiments/nursery-')) await page.waitForSelector('[data-record-day]');
    await audit(page,path);audits++;
    for (const href of await page.locator('a[href]').evaluateAll(links=>links.filter(e=>!e.classList.contains('language-switch')).map(e=>e.getAttribute('href')))) {
      if (!href.startsWith('/') || href.startsWith('//') || /\.(jpg|png|mp4)$/.test(href)) continue;
      assert.ok(href.startsWith('/en'),`${path} links back to Chinese: ${href}`);
      assert.equal((await context.request.get(base+href)).status(),200,`${path}: ${href}`);
    }
    const alternate=await page.locator('.language-switch').getAttribute('href');
    const alternatePage=await context.newPage();await alternatePage.goto(base+alternate);
    const reverse=await alternatePage.locator('.language-switch').getAttribute('href');
    assert.equal(reverse.replace(/\/$/,''),path.replace(/\/$/,''),`${path}: language switch must keep the same page`);
    await alternatePage.close();
  }
  const experiment='/en/experiments/nursery-20261024-01/';
  const index=await (await context.request.get(base+'/en/record-days/nursery-20261024-01/index.json')).json();
  for (const date of index.dates) {
    await page.goto(base+experiment+'?date='+date);await page.waitForSelector(`[data-record-day="${date}"]`);
    await audit(page,date);audits++;
  }
  await page.locator('[data-calendar-trigger]').click();
  await page.waitForSelector('dialog[open]');await audit(page,'open calendar');
  assert.match(await page.locator('[data-calendar-month]').innerText(),/November 2026/);
  await page.locator('[data-calendar-previous]').click();
  await page.locator('[data-calendar-day="2026-10-24"]').click();
  await page.waitForSelector('[data-record-day="2026-10-24"]');await audit(page,'calendar selection');
  await page.locator('[data-record-next]').click();await page.waitForSelector('[data-record-day="2026-10-25"]');
  await page.goBack();await page.waitForSelector('[data-record-day="2026-10-24"]');
  await page.goto(base+experiment+'?date=2099-01-01');await page.waitForSelector(`[data-record-day="${index.latest}"]`);
  assert.match(await page.locator('[data-record-status]').innerText(),/Showing an available record date/);
  // Exercise failed/empty responses without contacting a service.
  await page.route(`**/en/record-days/*/${index.latest}.json`,route=>route.fulfill({status:503,body:'{}'}));
  await page.reload();await page.waitForSelector('[data-record-retry]:not([hidden])');await audit(page,'load failure');
  await page.unroute(`**/en/record-days/*/${index.latest}.json`);
  await page.locator('[data-record-retry]').click();await page.waitForSelector('[data-record-day]');
  await page.route('**/en/record-days/*/index.json',route=>route.fulfill({json:{schema_version:1,experiment_id:'NURSERY-20261024-01',latest:null,dates:[]}}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('[data-record-status]')?.textContent==='No records');await audit(page,'no records');
  await page.unroute('**/en/record-days/*/index.json');
  // API replies in the existing service may be Chinese; English tool pages translate the errors.
  await page.route('**/api/media',route=>route.fulfill({status:401,json:{error:'管理口令无效。'}}));
  await page.goto(base+'/en/media-manage/');await page.locator('#manage-token').fill('local-test');
  await page.locator('#media-manage-auth button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#manage-status')?.textContent==='Invalid management token.');await audit(page,'media authentication error');
  await page.unroute('**/api/media');
  await page.route('**/api/media',route=>route.fulfill({json:{media:[
    {id:'LOCAL-MEDIA',caption:'Local test image',alt:'Local test image',kind:'image',at:'2026-11-06T12:00:00Z',reviewStatus:'confirmed',visibility:'public',storageBackend:'private_r2',purgeState:'active'},
    {id:'LOCAL-DELETED',caption:'Deleted test image',alt:'Deleted test image',kind:'image',at:'2026-11-06T12:00:00Z',reviewStatus:'pending',visibility:'private',storageBackend:'private_r2',purgeState:'active',deletedAt:'2026-11-07T12:00:00Z'}
  ]}}));
  await page.locator('#media-manage-auth button[type=submit]').click();await page.waitForSelector('.management-card');await audit(page,'loaded media management');
  await page.unroute('**/api/media');
  await page.route('**/api/media/upload',route=>route.fulfill({status:401,json:{error:'上传口令无效。'}}));
  await page.goto(base+'/en/media-upload/');await page.locator('#experiment-id').fill('LOCAL-TEST');
  await page.locator('#caption').fill('Local test');await page.locator('#media-alt').fill('Local test image');
  await page.locator('#media-file').setInputFiles({name:'local.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await page.locator('#media-upload-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#upload-status')?.textContent==='Invalid upload token.');await audit(page,'upload API error');
  await page.unroute('**/api/media/upload');
  // Check mobile/light/dark layouts for all pages, and opened calendars for both themes.
  for(const width of [390,1440]) for(const colorScheme of ['light','dark']) {
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme});
    for(const path of englishPaths) {
      await page.goto(base+path);await page.waitForLoadState('networkidle');await audit(page,`${path}/${width}/${colorScheme}`);audits++;
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
      assert.ok(fits,`${path}/${width}/${colorScheme}: horizontal overflow`);
    }
    await page.goto(base+experiment);await page.waitForSelector('[data-record-day]');await page.locator('[data-calendar-trigger]').click();await audit(page,'calendar '+colorScheme);
    await page.locator('[data-calendar-close]').click();
    if(process.env.I18N_TEST_OUTPUT) {
      await mkdir(process.env.I18N_TEST_OUTPUT,{recursive:true});
      for(const [name,path] of [['experiment',experiment],['batch','/en/trace/pb-qdf01-20261104-01/'],['home','/en/']]) {
        await page.goto(base+path);await page.waitForLoadState('networkidle');
        await page.screenshot({path:resolve(process.env.I18N_TEST_OUTPUT,`${name}-${width}-${colorScheme}.png`),fullPage:true});
      }
    }
  }
  assert.deepEqual(pageErrors,[],'browser errors');
  console.log(JSON.stringify({pages:englishPaths.length,datedRecords:index.dates.length,audits,languagePairs:'passed',calendar:'passed',failureAndEmpty:'passed',mobileAndThemes:'passed'}));
  await context.close();
} finally {await browser.close();await new Promise(done=>server.close(done));}
