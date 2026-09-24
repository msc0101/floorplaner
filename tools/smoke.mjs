// Смоук-тест в headless Chromium: грузит собранный файл, прогоняет основные сценарии, ловит ошибки.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

// require() учитывает NODE_PATH — можно использовать глобально установленный playwright
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || join(root, 'tmp-shots');
mkdirSync(shots, { recursive: true });
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + join(root, 'dist', 'floorplaner.html'));
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, '01-empty.png') });

// пример
await page.evaluate(() => IO.loadDemo());
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '02-demo.png') });
const info = await page.evaluate(() => ({ rooms: App.rooms.map(r => r.name + ' ' + (r.areaFloor / 1e4).toFixed(2)), walls: App.doc.walls.length, outlines: Rooms.outlines.length, sum: Rooms.summary() }));
console.log(JSON.stringify({ rooms: info.rooms, walls: info.walls, outlines: info.outlines, total: info.sum.total / 1e4, footprint: info.sum.footprint / 1e4, plot: info.sum.plotArea / 1e6 }));

// тёмная тема
await page.click('#themeSeg [data-theme="dark"]');
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, '03-dark.png') });
await page.click('#themeSeg [data-theme="light"]');

// рисование стены с вводом длины
const box = await page.locator('#canvas').boundingBox();
await page.keyboard.press('w');
await page.mouse.click(box.x + 200, box.y + 700);
await page.mouse.move(box.x + 400, box.y + 700);
await page.keyboard.type('350');
await page.keyboard.press('Enter');
await page.mouse.move(box.x + 400, box.y + 600);
await page.keyboard.type('200');
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
const walls2 = await page.evaluate(() => App.doc.walls.slice(-2).map(w => Math.round(Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y))));
console.log('typed walls', walls2);
// undo / redo
const before = await page.evaluate(() => App.doc.walls.length);
await page.keyboard.press('Control+z');
const afterUndo = await page.evaluate(() => App.doc.walls.length);
await page.keyboard.press('Control+y');
const afterRedo = await page.evaluate(() => App.doc.walls.length);
console.log('undo/redo', before, afterUndo, afterRedo);

// выделение объекта и панель свойств
await page.keyboard.press('v');
await page.evaluate(() => { const it = App.doc.items.find(i => i.key === 'bed160'); App.sel.clear(); App.sel.add(it.id); App.selChanged(); });
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, '04-select.png') });

// солнце и тени
await page.click('.tabs [data-tab="sun"]');
await page.evaluate(() => { App.doc.settings.layers.shadows = true; App.redraw(); });
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, '05-sun.png') });
await page.evaluate(() => UI.runHeat());
await page.waitForFunction(() => App.heat && !App.heat.stale, null, { timeout: 60000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, '06-heat.png') });
const ins = await page.evaluate(() => { const r = Sun.roomsInsolation(Sun.state().date); return [...r.entries()].map(([k, v]) => [App.rooms.find(x => x.id === k)?.name, v.cont.toFixed(1), v.total.toFixed(1)]); });
console.log('insolation', JSON.stringify(ins));

// вкладки
for (const t of ['layers', 'summary', 'project', 'props']) { await page.click(`.tabs [data-tab="${t}"]`); await page.waitForTimeout(100); await page.screenshot({ path: join(shots, `07-tab-${t}.png`) }); }

// инструменты: окно, дверь, трасса, зона, размер, рулетка, заметка, размещение
await page.evaluate(() => { App.doc.settings.layers.heat = false; App.doc.settings.layers.shadows = false; View.fit(Model.contentBBox()); });
for (const k of ['o', 'd', 'u', 'b', 'n', 'm', 'k', 'q', 't']) {
  await page.keyboard.press(k);
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.move(box.x + 520, box.y + 410);
  await page.waitForTimeout(50);
}
await page.keyboard.press('Escape');
await page.evaluate(() => Tools.set('place', { key: 'sofaL' }));
await page.mouse.move(box.x + 600, box.y + 300);
await page.mouse.click(box.x + 600, box.y + 300);
// заметка к объекту
await page.evaluate(() => { const it = App.doc.items.find(i => i.key === 'well'); const n = App.addNote(it.id); n.text = 'Проверить глубину'; Model.commit(); });
// поворот всего плана и группы
await page.evaluate(() => { App.rotateAll(30); App.selectAll(); App.rotateSel(-30); App.sel.clear(); });
// копирование
await page.evaluate(() => { const w = App.doc.walls.find(w => w.kind === 'ext'); App.sel.clear(); App.sel.add(w.id); App.duplicate(); });
// экспорт
await page.evaluate(() => { const r = IO.regionFor('all'); const { canvas } = IO.renderRegion(r, 1200, 900, {}); window.__png = canvas.toDataURL().length; });
// печать (без реального диалога)
await page.evaluate(() => { window.print = () => {}; IO.print({ paper: 'A4', orient: 'landscape', scale: 'fit', area: 'all', expl: true, spec: true, legend: true, grid: false }); });
await page.waitForTimeout(300);
await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: join(shots, '08-print.png'), fullPage: true });
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
// сохранение / загрузка
const rt = await page.evaluate(() => { const s = IO.serialize(); const d = Model.normalize(JSON.parse(s)); return [d.walls.length === App.doc.walls.length, d.items.length === App.doc.items.length, d.notes.length]; });
console.log('roundtrip', rt);
// мобильный
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, '09-mobile.png') });
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => { View.fit(Model.contentBBox()); });
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, '10-final.png') });

await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('OK');
