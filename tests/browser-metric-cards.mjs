// Measure actual text inside every built metric card; viewport overflow alone misses adjacent-cell overflow.
import assert from 'node:assert/strict';
import {readFile, readdir, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium} = await import(process.env.I18N_TEST_PLAYWRIGHT || 'playwright');
const root=resolve('dist'),files=[];
async function visit(folder) {
  for(const item of await readdir(folder,{withFileTypes:true})) {
    const path=resolve(folder,item.name);
    if(item.isDirectory()) await visit(path);
    else if(item.name.endsWith('.html')) files.push(path);
  }
}
await visit(root);
const browser=await chromium.launch({headless:true,...(process.env.I18N_TEST_BROWSER?{executablePath:process.env.I18N_TEST_BROWSER}:{})});
let pages=0,checks=0;
try {
  const context=await browser.newContext();await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  for(const file of files) {
    let html=await readFile(file,'utf8');
    if(!html.includes('class="metric-card')) continue;
    pages++;
    for(const match of html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g))
      html=html.replace(match[0],'<style>'+await readFile(resolve(root,match[1].replace(/^\//,'')),'utf8')+'</style>');
    for(const width of [320,390,699,700,768,1024,1050,1280,1440]) for(const colorScheme of ['light','dark']) {
      await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
      const overflow=await page.locator('.metric-card').evaluateAll(cards=>cards.flatMap(card=>{
        const rect=card.getBoundingClientRect(),style=getComputedStyle(card),bad=[];
        const left=rect.left+parseFloat(style.paddingLeft),right=rect.right-parseFloat(style.paddingRight);
        for(const node of card.querySelectorAll('span,small,strong')) {
          const range=document.createRange();range.selectNodeContents(node);
          for(const r of range.getClientRects()) if(r.left<left-1 || r.right>right+1 || r.bottom>rect.bottom+1)
            bad.push({text:node.textContent,left:r.left-left,right:r.right-right,bottom:r.bottom-rect.bottom});
          if(node.scrollWidth>node.clientWidth+1) bad.push({text:node.textContent,scroll:node.scrollWidth-node.clientWidth});
        }
        return bad;
      }));
      assert.deepEqual(overflow,[],`${file}/${width}/${colorScheme}: text crosses card boundary`);checks++;
      const stage=page.locator('.metric-card strong').filter({hasText:'Transplanted'});
      if(await stage.count()) assert.equal(await stage.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;}),1,'Transplanted stays on one line');
      if(process.env.I18N_TEST_OUTPUT && file.endsWith('/en/index.html') && width===1280 && colorScheme==='light') {
        await mkdir(process.env.I18N_TEST_OUTPUT,{recursive:true});
        await page.locator('.metric-grid').screenshot({path:resolve(process.env.I18N_TEST_OUTPUT,'english-metric-cards-fixed.png')});
      }
    }
  }
  assert.ok(pages>=4);console.log(JSON.stringify({pages,cardBoundaryChecks:checks,widths:'320–1440',themes:'light/dark',result:'passed'}));
  await context.close();
} finally {await browser.close();}
