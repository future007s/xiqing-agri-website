// Real built markup/CSS only; no production requests, login or field controls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const {chromium} = await import(process.env.THEME_TEST_PLAYWRIGHT || 'playwright');
const root = resolve('dist');
const luminance = color => {
  const channels = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {
    const n = v/255; return n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4;
  });
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
};
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
const browser = await chromium.launch({headless:true,
  ...(process.env.THEME_TEST_BROWSER ? {executablePath:process.env.THEME_TEST_BROWSER} : {})});
try {
  for (const pathname of ['index.html','en/index.html','about/index.html','en/about/index.html',
                          'experiments/index.html','en/experiments/index.html']) {
    const html = readFileSync(resolve(root,pathname),'utf8').replace(
      /<link\b[^>]*href="([^\"]+\.css)"[^>]*>/g,
      (tag,href) => '<style>'+readFileSync(resolve(root,href.replace(/^\//,'')),'utf8')+'</style>');
    for (const width of [1440,390]) {
      const context = await browser.newContext({colorScheme:'light',viewport:{width,height:900}});
      await context.route('**/*',route=>route.abort());
      const page = await context.newPage();
      await page.setContent(html);
      for (const theme of ['light','dark','light']) {
        await page.emulateMedia({colorScheme:theme});
        const actual = await page.locator('.site-footer').evaluate(footer => {
          const style = getComputedStyle(footer);
          const rgb = e => getComputedStyle(e).color;
          return {background:style.backgroundColor,foreground:style.color,
            secondary:[...footer.querySelectorAll('.footer-label,.site-footer__meta,.site-footer__contact-note')].map(rgb),
            link:rgb(footer.querySelector('a')),width:footer.getBoundingClientRect().width,
            documentWidth:document.documentElement.clientWidth,scrollWidth:footer.scrollWidth};
        });
        assert.equal(actual.background,theme==='dark'?'rgb(17, 26, 33)':'rgb(23, 25, 21)',`${pathname}/${width}/${theme}`);
        assert.equal(actual.foreground,theme==='dark'?'rgb(234, 240, 244)':'rgb(250, 249, 245)');
        for (const color of [actual.foreground,actual.link,...actual.secondary])
          assert.ok(contrast(color,actual.background)>=4.5,`${pathname}/${theme}: text contrast`);
        assert.ok(actual.scrollWidth <= actual.width+1 && actual.width <= actual.documentWidth+1,'footer must fit viewport');
        if (process.env.THEME_TEST_OUTPUT && pathname==='index.html')
          await page.locator('.site-footer').screenshot({path:resolve(process.env.THEME_TEST_OUTPUT,`footer-${theme}-${width}.png`)});
      }
      await context.close();
    }
  }
  console.log('页脚主题浏览器验证通过：中英文首页/关于/实验记录，桌面/手机，浅→深→浅无刷新切换，文字对比度和宽度。');
} finally {await browser.close();}
