// Render E2 briefs (both arms) with the prototype renderer on the app's public CSS, plus one blind A/B image per item.
import { chromium } from '/data/home/yale/work/claudecodeui/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const ROOT = '/data/home/yale/work/claudecodeui/';
const T = ROOT + 'tmp/cockpit-briefing/', OUT = ROOT + 'tmp/cockpit-redesign/';
const items = process.argv.slice(2).map(Number);
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 600, height: 900 } })).newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'load' }); await page.waitForTimeout(1200);
await page.evaluate(() => { document.body.innerHTML = '<div id="w" class="bg-background text-foreground" style="width:560px;padding:16px"></div>'; });
await page.addScriptTag({ path: '/tmp/cockpit-analysis/mock4x.js' });
const blind = {};
for (const k of items) {
  const shots = {};
  for (const arm of ['b1', 'b2']) {
    const f = `${T}e2-${arm}-${k}.json`; if (!fs.existsSync(f)) continue;
    const rec = JSON.parse(fs.readFileSync(f, 'utf8')); if (!rec.pass || !rec.doc) continue;
    await page.evaluate(([doc]) => { document.getElementById('w').innerHTML = window.__brief(doc, 'brief v0 · checker ✓'); document.querySelectorAll('[class*="text-["]').forEach((el) => { const m = /text-\[([\d.]+)px\]/.exec(el.getAttribute('class') || ''); if (m) el.style.fontSize = `${m[1]}px`; }); }, [rec.doc]);
    await page.waitForTimeout(150);
    const p = `${OUT}e2-${arm}-${k}.png`; await page.locator('#w').screenshot({ path: p }); shots[arm] = p;
  }
  if (shots.b1 && shots.b2) {
    const flip = Math.random() < 0.5; const [L, R] = flip ? ['b2', 'b1'] : ['b1', 'b2']; blind[k] = { A: L, B: R };
    const img = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    const cmp = await b.newPage({ viewport: { width: 1220, height: 900 } });
    await cmp.setContent(`<body style="margin:0;padding:12px;background:#f4f3ef;font-family:system-ui"><div style="display:flex;gap:16px;align-items:flex-start">${[['A', L], ['B', R]].map(([n, a]) => `<div><div style="font:700 16px system-ui;margin-bottom:6px">${n}</div><img src="${img(shots[a])}" style="width:592px;border:1px solid #ccc;border-radius:8px"/></div>`).join('')}</div></body>`);
    await cmp.screenshot({ path: `${OUT}e2-compare-${k}.png`, fullPage: true }); await cmp.close();
  }
}
fs.writeFileSync(T + 'e2-blind-key.json', JSON.stringify(blind, null, 1));
await b.close(); console.log('rendered', items.join(','));
