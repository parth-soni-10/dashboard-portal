import { readFile } from 'node:fs/promises';
import { chromium } from '../../design-system/node_modules/@playwright/test/index.mjs';
import AxeBuilder from '../../design-system/node_modules/@axe-core/playwright/dist/index.mjs';
const base=process.env.PORTAL_BASE_URL||'http://127.0.0.1:4180/';
const browser=await chromium.launch({headless:true});
const results={base,viewports:[],consoleErrors:[],interactions:[]};
const manifest=JSON.parse(await readFile(new URL('../../design-system/coverage.manifest.json',import.meta.url),'utf8'));
const portalComponents=manifest.components.filter(component=>component.sites.includes('portal'));
try {
  for(const width of [375,768,1280]){
    const context=await browser.newContext({viewport:{width,height:900}}); const page=await context.newPage();
    await page.addInitScript(()=>localStorage.setItem('hub-theme','dark'));
    page.on('pageerror',e=>results.consoleErrors.push(e.message));
    page.on('console',m=>{if(/content security policy|refused to/i.test(m.text()))results.consoleErrors.push(m.text());});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.screenshot({path:`../docs/screenshots/portal/${width}.png`,fullPage:true});
    const missing=await page.request.get(base+'definitely-not-a-page');
    if(missing.status()!==404)throw new Error(`unknown path answered ${missing.status()} instead of 404`);
    if(!(await missing.text()).includes('Nothing at this address'))throw new Error('unknown path did not serve the project 404 page');
    await page.goto(base+'?q=visa',{waitUntil:'networkidle'}); if(await page.locator('#filter').inputValue()!=='visa'||await page.locator('#grid .row:not([hidden])').count()!==1)throw new Error('query URL contract failed');
    await page.locator('#filter').fill('visa'); await page.waitForTimeout(400);
    if(await page.locator('#grid .row:not([hidden])').count()!==1)throw new Error(`search mismatch at ${width}`);
    await page.locator('#filter').fill(''); await page.waitForTimeout(400);
    await page.locator('.filter-disclosure summary').click(); await page.locator('[data-category=RBI]').click();
    if(await page.locator('#grid .row:not([hidden])').count()!==1)throw new Error(`category mismatch at ${width}`);
    await page.locator('[data-category=all]').click();
    await page.locator('.filter-disclosure summary').click();
    await page.locator('#sort-select').selectOption('az');
    await page.locator('[data-view="grid"]').click();
    await page.locator('#freshness').fill('36'); await page.locator('[data-step="1"]');
    await page.locator('#glance-next').click();
    await page.locator('.row-menu').first().click(); if(await page.locator('.row-menu').first().getAttribute('aria-expanded')!=='true')throw new Error('row menu did not open'); await page.locator('.row-menu-items [data-row-action=pin]').first().click();
    await page.locator('.preview-btn[data-preview="content-tracker"]').click(); await page.locator('dialog[open]').waitFor(); if(!new URL(page.url()).hash.includes('preview-content-tracker'))throw new Error('preview hash contract failed'); await page.keyboard.press('Escape'); await page.locator('dialog[open]').waitFor({state:'detached'}); if(await page.locator('.preview-btn[data-preview="content-tracker"]').evaluate(el=>el!==document.activeElement))throw new Error('preview focus did not return');
    await page.locator('#clear-pins').click(); await page.locator('#undo-status button').click();
    await page.keyboard.press('/'); if(await page.locator('#filter').evaluate(el=>el!==document.activeElement))throw new Error('slash shortcut did not focus search');
    await page.locator('#show-wip').check(); if(await page.locator('#grid .row:not([hidden])').count()!==0)throw new Error('WIP filter should show no rows'); await page.locator('#show-wip').uncheck();
    await page.locator('#feedback-message').fill('test report'); await page.locator('#feedback-form button[type=submit]').click(); await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('Could not send')); 
    await page.locator('[data-status-tab="archive"]').click();
    await page.locator('#custom-name').fill('Test link');
    await page.locator('#custom-url').fill('https://example.com');
    await page.locator('#custom-category').fill('Test');
    await page.locator('#custom-link-form button[type=submit]').click();
    if(await page.locator('#custom-links li').count()!==1)throw new Error(`custom link did not save at ${width}`);
    await page.locator('#custom-links [data-delete-link]').click();
    const axeDark=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze(); await page.locator('#theme-toggle').click(); await page.waitForTimeout(400); const axeLight=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    await page.screenshot({path:`../docs/screenshots/portal/${width}-light.png`,fullPage:true});
    await page.emulateMedia({reducedMotion:'reduce'}); const reduced=await page.locator('.row').first().evaluate(el=>getComputedStyle(el).animationDuration); if(parseFloat(reduced)>0.0001)throw new Error(`reduced motion duration not collapsed: ${reduced}`);
    const counts={}; for(const component of portalComponents){const selector=`[data-component="${component.id}"]`,instances=page.locator(selector),count=await instances.count();counts[component.id]=count;if(count<component.minInstances)throw new Error(`${component.id}: expected ${component.minInstances}, found ${count}`);for(let i=0;i<count;i++){const root=instances.nth(i),focusable='button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]',isControl=await root.evaluate((el,s)=>el.matches(s),focusable),control=isControl?root:root.locator(focusable).first();if(!await control.count())throw new Error(`${component.id}: no keyboard path`);await control.focus();}}
    const sw=await page.evaluate(async()=>{if(!('serviceWorker' in navigator))return false;const reg=await navigator.serviceWorker.ready,keys=await caches.keys();return !!reg.active&&keys.length>0&&!!(await caches.match('/app.js'));});if(!sw)throw new Error('service worker is not active or has no precached app asset');
    results.viewports.push({width,axeSeriousDark:axeDark.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),axeSeriousLight:axeLight.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),reducedMotionDuration:reduced,components:counts,serviceWorker:sw});
    await context.close();
  }
} finally { await browser.close(); }
if(results.consoleErrors.length)throw new Error(JSON.stringify(results.consoleErrors));
console.log(JSON.stringify(results,null,2));
