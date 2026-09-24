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
// новые возможности: этажи, крыша, 3D, IFC, DXF/SVG, смета, проверки, чертежи
const extra = await page.evaluate(() => {
  IO.loadDemo();
  const r = {};
  r.floors = App.doc.floors.length;
  r.roofArea = Math.round(Roof.params(App.doc.roofs[0]).area / 1e4);
  Model.setFloor(App.doc.floors[1].id); r.upperRooms = App.rooms.length; Model.setFloor(App.doc.floors[0].id);
  r.ifc = IFC.build().length > 1000;
  const reg = IO.regionFor('all');
  r.svg = Vector.svg(reg, 100, {}).includes('<svg');
  r.dxf = Vector.dxf(null, 100, { drawing: true }).length > 1000;
  r.estimate = Math.round(Estimate.totals(Estimate.rows()).total) > 0;
  r.checks = App.checks.results.length;
  r.autoDims = Drawing.autoDims(App.doc.floors[0].id).length;
  return r;
});
console.log('extra', JSON.stringify(extra));
await page.evaluate(() => View3D.toggle(true));
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '11-3d.png') });
const v3 = await page.evaluate(() => { const r = { tris: View3D.mesh.count / 3, shadow: View3D.shadowOK }; for (const k of ['s', 'n', 'e', 'w', 'top', 'eye']) View3D.view(k); View3D.opts.shadows = false; View3D.draw(); View3D.opts.shadows = true; return r; });
console.log('3d', JSON.stringify(v3));
if (!(v3.tris > 5000)) errors.push('3D: слишком мало геометрии');
await page.evaluate(() => View3D.toggle(false));
// поворот сетки: прямоугольная комната строится по осям сетки, сетка поворачивается вместе с планом
const gr = await page.evaluate(() => {
  const n0 = App.doc.walls.length;
  App.setGrid(30, { x: 0, y: 0 }); Tools.set('room');
  Tools.roomFinish({ x: 5000, y: 5000 }, G.add({ x: 5000, y: 5000 }, G.add(G.fromAngle(U.rad(30), 400), G.fromAngle(U.rad(120), 300))));
  const ang = App.doc.walls.slice(n0).map(w => Math.round(U.normDeg(U.deg(G.angle(w.a, w.b)))));
  App.rotateAll(10); const a1 = App.doc.settings.gridAngle; Model.undo(); Model.undo(); Model.undo(); Tools.set('select');
  return { ang, a1, back: App.doc.settings.gridAngle };
});
console.log('grid', JSON.stringify(gr));
if (gr.ang.join() !== '30,120,-150,-60' || gr.a1 !== 40 || gr.back !== 0) errors.push('Поворот сетки работает неверно: ' + JSON.stringify(gr));
// Enter в диалоге ввода = OK (раньше закрывал как «Отмена» — калибровка не срабатывала)
const pv = await page.evaluate(() => new Promise((res) => { UI.promptNumber('t', 'l', '1', (v) => res(v), () => res('cancel')); setTimeout(() => { $('dlgPromptInput').value = '7'; $('dlgPromptInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, 30); }));
console.log('prompt enter', pv);
if (pv !== 7) errors.push('Enter в диалоге ввода не подтверждает значение');
// смена материала стены → типовая толщина; таблица «Стены по типам» меняет нарисованные стены
const wm = await page.evaluate(() => {
  const w = App.doc.walls.find(x => x.kind === 'ext'), ins = w.ins || 0;
  App.setWallMat([w], 'brick'); const t1 = w.th - ins;
  App.setWallDefault('ext', 'th', 51, true); const t2 = w.th - ins;
  Model.undo(); Model.undo();
  return [t1, t2];
});
console.log('wall mat', wm);
if (wm[0] !== 38 && wm[0] !== 25 || wm[1] !== 51) errors.push('Толщина стен не меняется: ' + wm);
// помещения: перегородка, дотянутая до грани наружной стены (а не до оси), всё равно делит комнату;
// сдвиг стены тянет за собой примыкающие (T-стык) стены
const rm = await page.evaluate(() => {
  const f = App.doc.floors[0].id, S = 20000, add = (a, b, kind, th) => Model.add('walls', { kind, th, h: 270, mat: 'aerated', a, b, floor: f });
  const ids = [add({ x: S, y: S }, { x: S + 600, y: S }, 'ext', 40), add({ x: S + 600, y: S }, { x: S + 600, y: S + 400 }, 'ext', 40),
    add({ x: S + 600, y: S + 400 }, { x: S, y: S + 400 }, 'ext', 40), add({ x: S, y: S + 400 }, { x: S, y: S }, 'ext', 40)];
  const part = add({ x: S + 300, y: S + 20 }, { x: S + 300, y: S + 380 }, 'part', 10);   // до внутренних граней
  Model.commit();
  const inBox = () => App.rooms.filter(r => G.pointInPoly(r.label, [{ x: S, y: S }, { x: S + 600, y: S }, { x: S + 600, y: S + 400 }, { x: S, y: S + 400 }])).length;
  const n1 = inBox();
  Model.moveWalls([part.id], 50, 0); Model.commit();
  const n2 = inBox(), px = Model.get(part.id).a.x - S;
  Model.moveWalls([ids[1].id], 100, 0); Model.commit();
  const w0 = ids[0], w2 = ids[2];
  const r = { n1, n2, px, top: Math.round(w0.b.x - S), bottom: Math.round(w2.a.x - S) };
  for (let i = 0; i < 3; i++) Model.undo();
  return r;
});
console.log('rooms/move', JSON.stringify(rm));
if (rm.n1 !== 2 || rm.n2 !== 2 || rm.px !== 350 || rm.top !== 700 || rm.bottom !== 700) errors.push('Разбивка помещений / сдвиг стен: ' + JSON.stringify(rm));
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
