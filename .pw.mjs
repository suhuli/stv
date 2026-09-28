import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('https://tv.181.cx/?nocache=' + Date.now(), { waitUntil: 'networkidle' });
// 关闭免责声明弹窗（若有）
for (const sel of ['#disclaimerModal button', 'button:has-text("我知道了")', 'button:has-text("同意")']) { const el = await p.$(sel); if (el) { await el.click().catch(()=>{}); } }
await p.click('#settingsButton, [onclick*="toggleSettings"]').catch(async()=>{ await p.evaluate(()=>toggleSettings()); });
await p.waitForTimeout(500);
const info = await p.evaluate(() => {
  const t = document.getElementById('aggregateToggle');
  const r = t.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
  const dot = t.parentElement.querySelector('.toggle-dot');
  return { checked: t.checked, rect: [r.x, r.y, r.width, r.height], topEl: top ? top.tagName + '#' + top.id + '.' + top.className.slice(0,40) : null, dotTransform: getComputedStyle(dot).transform, bg: getComputedStyle(t.parentElement.querySelector('.toggle-bg')).backgroundColor, panelHidden: document.getElementById('settingsPanel')?.className };
});
console.log('点击前:', JSON.stringify(info));
await p.screenshot({ path: '/home/user/shot-before.png' });
await p.click('#aggregateToggle', { force: false }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
await p.waitForTimeout(500);
const after = await p.evaluate(() => { const t = document.getElementById('aggregateToggle'); const dot = t.parentElement.querySelector('.toggle-dot'); return { checked: t.checked, storage: localStorage.getItem('aggregateResultsEnabled'), dotTransform: getComputedStyle(dot).transform }; });
console.log('点击后:', JSON.stringify(after));
await p.screenshot({ path: '/home/user/shot-after.png' });
console.log('页面错误:', errs);
await b.close();
