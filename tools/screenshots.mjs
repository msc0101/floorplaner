// Скриншоты для README: node tools/screenshots.mjs (нужен playwright; CHROMIUM — путь к браузеру, если не стандартный)
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
await page.goto('file://' + join(root, 'dist', 'floorplaner.html'));
await page.evaluate(() => { localStorage.clear(); Theme.set('light'); IO.loadDemo(); });
await page.waitForTimeout(500);
const shot = async (name) => { await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); await page.waitForTimeout(120); await page.screenshot({ path: join(out, name) }); };

await page.evaluate(() => View.fit(Model.contentBBox(), 30));
await shot('overview.png');

// дом крупно, выделен диван — видны ручки и расстояния до стен
await page.evaluate(() => { View.fit({ x0: 640, y0: 1140, x1: 1760, y1: 2160 }, 20); const s = App.doc.items.find(i => i.key === 'sofa3'); App.sel.clear(); App.sel.add(s.id); App.selChanged(); });
await shot('house.png');

// солнце: тени + карта освещённости
await page.evaluate(async () => { App.sel.clear(); App.selChanged(); UI.showTab('sun'); App.doc.settings.layers.shadows = true; await UI.runHeat(); View.fit(Model.contentBBox(), 30); });
await page.waitForTimeout(300);
await shot('sun.png');

// тёмная тема, площади
await page.evaluate(() => { App.doc.settings.layers.heat = false; App.doc.settings.layers.shadows = false; Theme.set('dark'); UI.showTab('summary'); View.fit({ x0: 300, y0: 900, x1: 2300, y1: 2600 }, 20); });
await shot('dark.png');

// инженерные сети и примечания
await page.evaluate(() => { Theme.set('light'); UI.showTab('layers'); View.fit({ x0: 1300, y0: 900, x1: 2500, y1: 2900 }, 20); });
await shot('networks.png');

// печать
await page.evaluate(() => { window.print = () => {}; IO.print({ paper: 'A4', orient: 'landscape', scale: 'fit', area: 'all', expl: true, spec: true, legend: true, grid: false }); });
await page.waitForTimeout(400);
await page.emulateMedia({ media: 'print' });
await page.setViewportSize({ width: 1123, height: 794 });
await page.screenshot({ path: join(out, 'print.png') });
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); localStorage.clear(); Theme.set('auto'); });
await browser.close();
console.log('screenshots →', out);
