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
  // смета скрыта: ни кнопки, ни пункта меню, ни строки в отчёте, пока не нажали Ctrl+Alt+S
  r.estHidden = !document.querySelector('[data-act="estimate"]') && !Analysis.run().stats.some(x => /Смета/.test(x.title));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true }));
  r.estHotkey = $('dlgEstimate').open && Estimate.shown; $('dlgEstimate').close(); Estimate.shown = false;
  r.checks = App.checks.results.length;
  r.autoDims = Drawing.autoDims(App.doc.floors[0].id).length;
  return r;
});
console.log('extra', JSON.stringify(extra));
if (!extra.estHidden || !extra.estHotkey) errors.push('Смета: должна быть скрыта и открываться Ctrl+Alt+S: ' + JSON.stringify(extra));
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
  // подпись: по центру; перетаскивание мышью закрепляет её (fixed), клик без сдвига меток не плодит
  const room = App.rooms.find(x => G.pointInPoly(x.label, [{ x: S + 350, y: S }, { x: S + 700, y: S }, { x: S + 700, y: S + 400 }, { x: S + 350, y: S + 400 }]));
  r.labelCentered = !!room && Math.abs(room.label.x - G.labelPoint(room.floor).x) < 1;
  r.room = room ? room.id : null;
  for (let i = 0; i < 3; i++) Model.undo();
  return r;
});
console.log('rooms/move', JSON.stringify(rm));
if (!rm.labelCentered || rm.n1 !== 2 || rm.n2 !== 2 || rm.px !== 350 || rm.top !== 700 || rm.bottom !== 700) errors.push('Разбивка помещений / сдвиг стен: ' + JSON.stringify(rm));
// крыльцо / веранда / терраса и кухни: все варианты рисуются в плане и в 3D, исполнение меняется в свойствах
const pv3 = await page.evaluate(() => {
  const f = App.doc.floors[0].id, keys = [...CATALOG.find(c => c.id === 'porch').items.map(i => i.key), 'kitchenU', 'kitchenII', 'kitchenIsland', 'kitchenBar', 'kitchenPen', 'kitchenTall', 'tallUnit', 'barCounter', 'hood'];
  const made = keys.map((key, i) => { const d = catItem(key); return Model.add('items', { key, x: 30000 + i * 700, y: 30000, w: d.w, d: d.d, h: d.h, rot: 0, flip: false, floor: f }); });
  Model.commit();
  const v = made[2];
  App.sel.clear(); App.sel.add(v.id); App.selChanged();
  const sel = document.querySelector('#tab-props [data-field=encl]');
  sel.value = 'open'; sel.dispatchEvent(new Event('change'));
  const encl = Model.get(v.id).encl;
  View3D.build();
  const g = porchGeom(Model.get(made[0].id), 200, 150);
  // ступени и ограждение — на выбранных сторонах
  const p0 = Model.get(made[0].id); p0.stepSides = ['left', 'right']; p0.railSides = ['front'];
  const g2 = porchGeom(p0, p0.w, p0.d);
  const r = { n: made.length, encl, steps: g.steps, segs: g.segs.length, tris: View3D.build().P.length > 0, flights2: g2.flights.map(f => f.side).join(), segs2: g2.segs.map(s => s.side).join() };
  Model.undo(); Model.undo(); App.sel.clear(); App.selChanged();
  return r;
});
console.log('porch/kitchen', JSON.stringify(pv3));
if (pv3.encl !== 'open' || pv3.steps !== 4 || pv3.segs !== 4 || pv3.flights2 !== 'left,right' || pv3.segs2 !== 'front') errors.push('Веранда/крыльцо: ' + JSON.stringify(pv3));
// забор: инструмент из библиотеки с материалом, поиск по синонимам
const fz = await page.evaluate(() => {
  const m0 = App.doc.defaults.wall.fence.mat;
  Tools.set('fence', { mat: 'mesh', h: 150 }); const r = { v: Tools.vcur(), mat: App.doc.defaults.wall.fence.mat, rail: document.querySelector('.rail .tool.active')?.dataset.tool };
  Tools.set('wall'); r.back = Tools.opts.wallKind; Tools.set('select'); App.doc.defaults.wall.fence.mat = m0;
  $('libSearch').value = 'ограда'; UI.buildLibrary(); r.found = document.querySelectorAll('.lib-item').length; $('libSearch').value = ''; UI.buildLibrary();
  return r;
});
console.log('fence', JSON.stringify(fz));
if (fz.v !== 'fence' || fz.mat !== 'mesh' || fz.rail !== 'fence' || fz.back !== 'ext' || !(fz.found >= 9)) errors.push('Забор: ' + JSON.stringify(fz));
// группы: Ctrl+G, выделение всей группы, сдвиг с сохранением стыков, копия — новая группа, разгруппировать
const grp = await page.evaluate(() => {
  const f = App.doc.floors[0].id, S = 40000, d = { kind: 'ext', th: 30, h: 300, mat: 'aerated', floor: f };
  const box = [[S, S, S + 800, S], [S + 800, S, S + 800, S + 500], [S + 800, S + 500, S, S + 500], [S, S + 500, S, S]].map(([ax, ay, bx, by]) => Model.add('walls', { ...d, a: { x: ax, y: ay }, b: { x: bx, y: by } }));
  const p1 = Model.add('walls', { ...d, kind: 'part', th: 10, a: { x: S + 400, y: S }, b: { x: S + 400, y: S + 300 } });
  const p2 = Model.add('walls', { ...d, kind: 'part', th: 10, a: { x: S + 400, y: S + 300 }, b: { x: S + 800, y: S + 300 } });
  Model.commit();
  App.sel.clear(); App.sel.add(p1.id); App.sel.add(p2.id); App.group();
  const r = { members: Model.groupOf(p1.id).length, isGroup: !!App.selGroup() };
  App.sel.clear(); App.sel.add(p1.id); App.moveSel(100, 0);
  App.sel.clear(); for (const m of Model.groupOf(p1.id)) App.sel.add(m); App.moveSel(100, 0);
  r.p1x = Math.round(Model.get(p1.id).a.x - S); r.p2b = Math.round(Model.get(p2.id).b.x - S);
  App.duplicate(); r.groups = new Set(App.doc.walls.filter(w => w.grp).map(w => w.grp)).size;
  App.ungroup(); r.left = App.doc.walls.filter(w => w.grp).length;
  for (let i = 0; i < 6; i++) Model.undo();
  void box;
  return r;
});
console.log('groups', JSON.stringify(grp));
if (grp.members !== 2 || !grp.isGroup || grp.p1x !== 600 || grp.p2b !== 800 || grp.groups !== 2 || grp.left !== 2) errors.push('Группы: ' + JSON.stringify(grp));
// крыши построек: типы по умолчанию, выбор типа; асфальт без бордюров, бордюр у дороги, смета
const rf = await page.evaluate(() => {
  const f = App.doc.floors[0].id, put = (key, extra = {}) => { const d = catItem(key); return Model.add('items', { key, x: 50000, y: 50000, w: d.w, d: d.d, h: d.h, rot: 0, flip: false, floor: f, ...extra }); };
  const r = { def: ['garage1', 'carport', 'carportLean', 'greenhouse', 'woodshed'].map(k => bldRoof({ key: k }).type).join(',') };
  const a = put('carport2', { roofType: 'arch', roofMat: 'polycarb' }), b = put('shed', { roofType: 'shed', roofShed: 'left' });
  r.rect = JSON.stringify(bldRoofRect(Model.get(b.id), 300, 400));
  const z = Model.add('areas', { kind: 'asphalt', floor: f, pts: [{ x: 50000, y: 50000 }, { x: 51000, y: 50000 }, { x: 51000, y: 50500 }, { x: 50000, y: 50500 }] });
  const rd = Model.add('roads', { kind: 'road', width: 400, floor: f, pts: [{ x: 50000, y: 51000 }, { x: 52000, y: 51000 }], curb: false });
  Model.commit();
  r.tris = View3D.build().P.length > 0;
  r.asphalt = (Estimate.rows().find(x => x.key === 'site:asphalt') || {}).qty;
  r.curb = roadCurb(rd);
  // у крыльца/веранды — тот же выбор крыши; у пристроенной по умолчанию односкатная, без свеса со стороны дома
  r.porch = bldRoof({ key: 'porch' }).type + '/' + bldRoofRect({ key: 'porch' }, 200, 150).y + '/' + bldRoof({ key: 'terraceRoof' }).type;
  Model.undo(); void a; void z;
  return r;
});
console.log('roofs/asphalt', JSON.stringify(rf));
if (rf.def !== 'gable,flat,shed,gable,shed' || !rf.tris || !(rf.asphalt >= 50) || rf.curb !== false || !rf.rect.includes('"rot":-90') || rf.porch !== 'shed/12.5/gable') errors.push('Крыши построек / асфальт: ' + JSON.stringify(rf));
// погреб / смотровая яма: геометрия лестницы, 3D, спуск в открытую яму в прогулке
const pit = await page.evaluate(() => {
  const f = App.doc.floors[0].id, d = catItem('inspPit');
  const it = Model.add('items', { key: 'inspPit', x: 60000, y: 60000, w: d.w, d: d.d, h: 0, rot: 0, floor: f });
  const c = Model.add('items', { key: 'cellar', x: 61000, y: 60000, w: 200, d: 250, h: 0, rot: 0, floor: f, stairSide: 'left' });
  Model.commit();
  const g = pitGeom(it, it.w, it.d), g2 = pitGeom(c, c.w, c.d);
  const r = { n: g.n, depth: g.depth, L: Math.round(g.L), side2: g2.side, tris: View3D.build().P.length > 0 };
  Walk.level = 0; Walk._blk = null; Walk.foot = 0;
  r.bottom = Walk.top(it.x, it.y + it.d / 2 - 30); r.firstStep = Math.round(Walk.top(it.x, it.y - it.d / 2 + 12 + 5));
  Model.undo();
  return r;
});
console.log('pit', JSON.stringify(pit));
if (pit.n !== 9 || pit.depth !== 170 || pit.side2 !== 'left' || !pit.tris || pit.bottom !== -170 || pit.firstStep !== -19) errors.push('Погреб/яма: ' + JSON.stringify(pit));
// гараж «как дом»: стены с толщиной, внутри видно смотровую яму (выбор, 3D-пол с вырезом, прогулка)
const gar = await page.evaluate(() => {
  const f = App.doc.floors[0].id, X = 70000, Y = 70000;
  const g = Model.add('items', { key: 'garage2', x: X, y: Y, w: 650, d: 650, h: 320, rot: 0, floor: f });
  const pt = Model.add('items', { key: 'inspPit', x: X, y: Y - 50, w: 90, d: 400, h: 0, rot: 0, floor: f, cover: 'open' });
  Model.commit();
  const s = bldShell(g, g.w, g.d), r = { walls: s.walls.length, t: s.t, dw: s.ops[0].w };
  r.pick = Tools.hitTest({ x: X, y: Y - 50 }) === pt.id;
  const A = View3D.build(), P = A.P;
  let inHole = 0, floor = 0;
  const poly = G.rectPts(pt.x, pt.y, pt.w, pt.d, 0);
  for (let i = 0; i < P.length; i += 9) {
    if (![1, 4, 7].every(k => Math.abs(P[i + k] - 0.1) < 1e-6)) continue;
    const c = { x: (P[i] + P[i + 3] + P[i + 6]) / 3 * 100, y: (P[i + 2] + P[i + 5] + P[i + 8]) / 3 * 100 };
    if (Math.abs(c.x - X) < 300 && Math.abs(c.y - Y) < 300) { floor++; if (G.pointInPoly(c, poly)) inHole++; }
  }
  r.floor = floor > 0; r.inHole = inHole;
  Walk.level = 0; Walk._blk = null; Walk.foot = 0;
  r.inside = Walk.depth(X + 200, Y + 100) === 0; r.gate = Walk.depth(X, Y + 325) === 0; r.wall = Walk.depth(X - 320, Y) > 0;
  r.floorZ = Walk.top(X + 200, Y + 100); r.pitZ = Walk.top(X, Y + 100) < -100;
  // дверь инструментом в заднюю стену: проём добавляется в постройку, через него можно пройти
  Tools.set('door'); Tools.openingClick({}, { x: X + 150, y: Y - 320 }); Tools.set('select');
  r.ops = (g.ops || []).length; Walk._blk = null; r.backDoor = Walk.depth(X + 150, Y - 312) === 0 && Walk.depth(X - 150, Y - 312) > 0;
  Model.undo();
  Model.undo();
  return r;
});
console.log('garage', JSON.stringify(gar));
if (gar.walls !== 5 || gar.t !== 25 || gar.dw !== 300 || !gar.pick || !gar.floor || gar.inHole !== 0 || !gar.inside || !gar.gate || !gar.wall || gar.floorZ !== 10 || !gar.pitZ || gar.ops !== 2 || !gar.backDoor) errors.push('Гараж изнутри: ' + JSON.stringify(gar));
// смена типа стены меняет толщину на типовую для нового типа (материал и утеплитель учитываются)
const wkind = await page.evaluate(() => {
  const f = App.doc.floors[0].id, D = App.doc.defaults.wall;
  const w = Model.add('walls', { kind: 'ext', th: D.ext.th, h: 300, mat: D.ext.mat, a: { x: 90000, y: 0 }, b: { x: 90500, y: 0 }, floor: f });
  const w2 = Model.add('walls', { kind: 'ext', th: D.ext.th + 10, ins: 10, h: 300, mat: D.ext.mat, a: { x: 90000, y: 500 }, b: { x: 90500, y: 500 }, floor: f });
  Model.commit();
  App.setWallKind([w], 'part'); const r = { part: w.th === D.part.th, mat: w.mat };
  App.setWallKind([w2], 'int'); r.ins = w2.th === D.int.th + 10;
  App.setWallKind([w], 'fence'); r.fence = w.th === D.fence.th && w.h === D.fence.h;
  Model.undo(); Model.undo(); Model.undo(); Model.undo();
  return r;
});
console.log("wallKind", JSON.stringify(wkind));
if (!wkind.part || !wkind.ins || !wkind.fence) errors.push("Смена типа стены: " + JSON.stringify(wkind));
// наружная стена утолщается наружу: внутренняя грань и перегородки на месте, соседние стены подтягиваются
const grow = await page.evaluate(() => {
  const f = App.doc.floors[0].id, X = 120000, d = { kind: 'ext', th: 30, h: 300, mat: 'aerated', floor: f };
  const A = (ax, ay, bx, by, o = d) => Model.add('walls', { ...o, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  const top = A(X, 0, X + 300, 0), top2 = A(X + 300, 0, X + 600, 0), right = A(X + 600, 0, X + 600, 400);
  A(X + 600, 400, X, 400); const left = A(X, 400, X, 0);
  const part = A(X + 300, 0, X + 300, 400, { ...d, kind: 'part', th: 10 });
  Model.commit();
  const T = (id) => Model.get(id);
  UI.set(T(top.id), 'th', 50);
  const r = { top: T(top.id).a.y, top2: T(top2.id).b.y, th2: T(top2.id).th, left: T(left.id).b.y, right: T(right.id).a.y, part: T(part.id).a.y };
  UI.set(T(part.id), 'th', 20); r.partX = T(part.id).a.x;
  Model.undo(); Model.undo(); r.undo = T(top.id).a.y;
  Model.undo();
  return r;
});
console.log('grow', JSON.stringify(grow));
if (grow.top !== -10 || grow.top2 !== -10 || grow.th2 !== 50 || grow.left !== -10 || grow.right !== -10 || grow.part !== -10 || grow.partX !== 120300 || grow.undo !== 0) errors.push('Утолщение наружу: ' + JSON.stringify(grow));
// подсказки расстояний у выделенного объекта: по цифре можно задать точное расстояние до стены
await page.evaluate(() => {
  const f = App.doc.floors[0].id, X = 140000, d = { kind: 'ext', th: 20, h: 300, mat: 'aerated', floor: f };
  Model.add('walls', { ...d, a: { x: X, y: 0 }, b: { x: X, y: 500 } });
  const it = Model.add('items', { key: 'box', x: X + 200, y: 250, w: 100, d: 100, h: 50, rot: 0, floor: f });
  Model.commit(); App.sel.clear(); App.sel.add(it.id); App.selChanged(); View.fit({ x0: X - 100, y0: 0, x1: X + 400, y1: 500 }); App.redraw();
  window._gdId = it.id;
});
await page.waitForTimeout(150);
const gd = await page.evaluate(() => {
  const g = Render._guideHits.find(h => h.act.dir.x < -0.5), r = { len: g && Math.round(g.act.len) };
  if (g) { const o = UI.promptNumber; UI.promptNumber = (t, l, v, ok) => ok(45); Tools.guideEdit(g.act); UI.promptNumber = o; }
  r.x = Model.get(window._gdId).x;
  Model.undo(); Model.undo();
  return r;
});
console.log('guides', JSON.stringify(gd));
if (gd.len !== 140 || gd.x !== 140105) errors.push('Подсказки расстояний: ' + JSON.stringify(gd));
// сети в библиотеке; ЛЭП — опоры и ввод на стену; стены мансарды не выше ската крыши
const net = await page.evaluate(() => {
  const cat = CATALOG.find(c => c.id === 'networks'), r = { n: cat ? cat.items.length : 0 };
  IO.loadDemo();
  const ov = App.doc.lines.find(l => l.kind === 'overhead');
  const poles = overheadPoles(ov, App.doc.items, App.doc.walls);
  r.poles = poles.length; r.item = !!poles[0].item; r.wall = !!poles[poles.length - 1].wall;
  const rf = App.doc.roofs[0];
  r.zRidge = Math.round(Roof.zAt(rf, { x: rf.x, y: rf.y })); r.zOut = Roof.zAt(rf, { x: rf.x + rf.w, y: rf.y });
  // без предметов и проводов выше конька может быть только сама кровля
  const lines = App.doc.lines, o = { ...View3D.opts }; App.doc.lines = []; View3D.opts.items = false; View3D.opts.site = false; View3D.opts.roof = false;
  const P = View3D.build().P; App.doc.lines = lines; Object.assign(View3D.opts, o); View3D.dirty = true;
  let bad = 0;
  for (let i = 0; i < P.length; i += 3) { const z = P[i + 1] * 100, h = Roof.zAt(rf, { x: P[i] * 100, y: P[i + 2] * 100 }); if (h !== null && z > h + 1) bad++; }
  r.belowRoof = bad === 0; r.bad = bad;
  return r;
});
console.log('networks', JSON.stringify(net));
if (net.n !== 12 || net.poles !== 2 || !net.item || !net.wall || net.zRidge !== Math.round(440 + 510 * Math.tan(38 * Math.PI / 180)) || net.zOut !== null || !net.belowRoof) errors.push('Сети / ЛЭП / стены под крышей: ' + JSON.stringify(net));
// проём постройки: выделяется отдельно, удаляется Del; площадь постройки внутри — в сводке
const bop = await page.evaluate(() => {
  const f = App.doc.floors[0].id;
  const g = Model.add('items', { key: 'garage1', x: 150000, y: 0, w: 400, d: 600, h: 300, rot: 0, floor: f });
  Model.commit();
  const t = bldWallT(g), hit = Tools.bldOpAt(bldWorld(g, { x: 0, y: g.d / 2 - t / 2 }));
  const r = { hit: !!hit && hit.it === g && hit.idx === 0 };
  App.sel.clear(); App.sel.add(g.id); App.subSel = { id: g.id, idx: 0 }; App.selChanged();
  App.deleteSel();
  r.ops = bldOps(Model.get(g.id)).length; r.kept = !!Model.get(g.id); r.sub = App.subSel;
  r.inner = Math.round(bldInnerArea(g)); r.sum = Rooms.summary().outbInner >= r.inner;
  Model.undo(); Model.undo();
  return r;
});
console.log('bldop', JSON.stringify(bop));
if (!bop.hit || bop.ops !== 0 || !bop.kept || bop.sub !== null || bop.inner !== 350 * 550 || !bop.sum) errors.push('Проём постройки / площадь: ' + JSON.stringify(bop));
// нормы отступов: улица и сосед — разные нормы; курятник — 4 м до соседа; объекты вне участка не проверяются
const chk = await page.evaluate(() => {
  const f = App.doc.floors[0].id, X = 300000;
  Model.add('areas', { kind: 'plot', pts: [{ x: X, y: 0 }, { x: X + 2000, y: 0 }, { x: X + 2000, y: 3000 }, { x: X, y: 3000 }], floor: f });
  Model.add('roads', { kind: 'street', width: 600, pts: [{ x: X - 500, y: 3400 }, { x: X + 2500, y: 3400 }], floor: f });
  const coop = Model.add('items', { key: 'coop', x: X + 150 + 300, y: 1000, w: 300, d: 250, h: 250, rot: 0, floor: f });
  const shed = Model.add('items', { key: 'shed', x: X + 1000, y: 3000 - 200 - 300, w: 300, d: 400, h: 280, rot: 0, floor: f });
  const out = Model.add('items', { key: 'shed', x: X - 1000, y: 1000, w: 300, d: 400, h: 280, rot: 0, floor: f });
  Model.commit();
  const res = Checks.run().results, R = (id, rule) => res.find(r => r.a.id === id && r.rule.id === rule);
  const r = {
    edges: [0, 1, 2, 3].map(i => Checks.edgeType(App.doc.areas[App.doc.areas.length - 1], i)).join(','),
    coop4: R(coop.id, 'animals_neighbor') && Math.round(R(coop.id, 'animals_neighbor').d) === 300 && !R(coop.id, 'animals_neighbor').ok,
    coopNoDup: !R(coop.id, 'outb_neighbor'),
    shedStreet: R(shed.id, 'outb_street') && Math.round(R(shed.id, 'outb_street').d) === 300 && !R(shed.id, 'outb_street').ok,
    outside: !res.some(x => x.a.id === out.id && x.rule.b.startsWith('bound:')),
  };
  Model.get(shed.id).checkAs = 'none'; Model.commit(); r.none = !Checks.run().results.some(x => x.a.id === shed.id);
  Model.undo(); Model.undo();
  return r;
});
console.log('checks', JSON.stringify(chk));
if (chk.edges !== 'neighbor,neighbor,street,neighbor' || !chk.coop4 || !chk.coopNoDup || !chk.shedStreet || !chk.outside || !chk.none) errors.push('Нормы отступов: ' + JSON.stringify(chk));
// постройки: стены не ниже проёмов, уклон соблюдается, «без крыши»; отмостка; трассы сетей
const bld2 = await page.evaluate(() => {
  const f = App.doc.floors[0].id;
  const g = Model.add('items', { key: 'garage2', x: 160000, y: 0, w: 750, d: 650, h: 320, rot: 0, floor: f, roofType: 'shed' });
  Model.commit();
  const r = { wallH: Math.round(bldWallH(g)), rise: Math.round(bldRoofRise(g)) };
  const geo = View3D.roofGeom(g, 320, 150, bldWallH(g)); r.pitchKept = Math.abs(geo.pitch - 12) < 0.5;
  g.roofType = 'none'; r.none = bldRoofRise(g) === 0 && bldRoof(g).over === 0; delete g.roofType;
  App.doc.settings.blind = { w: 100 }; g.blind = 80; Model.commit();
  const bl = Model.blindAreas(), gb = bl.find(b => b.id === g.id);
  r.blind = !!gb && Math.round(gb.area) === Math.round((910 * 810) - 750 * 650) && Estimate.rows().some(x => x.key === 'site:blind');
  // канализация двумя кусками с зазором 30 см: одна трасса, 18 м без колодца — замечание
  Model.add('lines', { kind: 'sewer', pts: [{ x: 170000, y: 0 }, { x: 170800, y: 0 }], dia: 110, depth: 120, floor: f });
  Model.add('lines', { kind: 'sewer', pts: [{ x: 170830, y: 0 }, { x: 171800, y: 0 }], dia: 110, depth: 120, floor: f });
  Model.commit();
  const n = Checks.run().nets.filter(x => x.kind === 'sewer' && x.line.pts.some(p => p.x === 171800));
  r.route = n.length && /2 участка/.test(n[0].title) && n.some(x => x.ok === false && /без колодца/.test(x.text));
  Model.undo(); Model.undo(); Model.undo();
  return r;
});
console.log('bld2', JSON.stringify(bld2));
if (bld2.wallH !== 235 || !bld2.pitchKept || !bld2.none || !bld2.blind || !bld2.route) errors.push('Постройки / отмостка / трассы: ' + JSON.stringify(bld2));
// анализ проекта: статистика и нарушения одним отчётом
const an = await page.evaluate(() => {
  IO.loadDemo();
  const R = Analysis.run(), t = Analysis.text();
  Analysis.open(); const shown = $('dlgAnalysis').open && $('anBody').textContent.length > 200; $('dlgAnalysis').close();
  return { stats: R.stats.map(s => s.title).join(','), rooms: R.rooms.length, issues: R.issues.length, text: /ЗАМЕЧАНИЯ/.test(t) && /Общая площадь помещений/.test(t), shown, btn: !!$('btnAnalyze') };
});
console.log('analysis', JSON.stringify(an));
if (!/Участок/.test(an.stats) || !/Дом/.test(an.stats) || !an.rooms || !an.text || !an.shown || !an.btn) errors.push('Анализ проекта: ' + JSON.stringify(an));
// вентиляция, печи, водопровод: в примере всё по норме; убрали дымоход и вентблок — замечания; мелкий водопровод — нарушение
const vent = await page.evaluate(() => {
  IO.loadDemo();
  const r = {}, iss = () => Analysis.run().issues;
  r.clean = !iss().some(i => /Вентиляция|Печь/.test(i.group));
  const ch = App.doc.items.find(i => i.key === 'chimney'), st = Checks.stack(ch);
  r.auto = !!st && st.e + Checks.stackH(ch) >= st.need;
  ch.autoH = false; ch.h = 200; Model.commit();
  r.low = iss().some(i => i.group === 'Печь' && /поднять/.test(i.text));
  App.doc.items = App.doc.items.filter(i => i.key !== 'chimney' && !(i.key === 'ventShaft2' && i.y > 2000)); Model.reindex(); Model.commit();
  const t = iss();
  r.noFlue = t.some(i => /нет дымохода/.test(i.text)); r.noExh = t.some(i => /Кухня: нет вытяжки/.test(i.text));
  const w = App.doc.lines.find(l => l.kind === 'water'); w.depth = 120; Model.commit();
  r.shallow = Checks.run().nets.some(n => n.kind === 'water' && n.ok === false && /промерзание/.test(n.text));
  w.heated = true; Model.commit();
  r.heated = !Checks.run().nets.some(n => n.kind === 'water' && n.ok === false);
  return r;
});
console.log('vent', JSON.stringify(vent));
if (Object.values(vent).some(v => !v)) errors.push('Вентиляция / печи / водопровод: ' + JSON.stringify(vent));
// веранда у дома: скат от карниза дома, предметы — на её полу; прогулка «призраком» — полёт без стен и тяжести
const porch = await page.evaluate(() => {
  IO.loadDemo();
  const r = {}, c = catItem('veranda');
  const v = Model.add('items', { key: 'veranda', x: 1200, y: 2100 + c.d / 2 + 20, w: c.w, d: c.d, h: c.h, rot: 0, floor: App.doc.floors[0].id });
  const t = Model.add('items', { key: 'pingpong', x: 1200, y: v.y, w: 274, d: 153, h: 76, rot: 0, floor: v.floor });
  Model.commit();
  const z0 = Math.max(porchOpt(v).ph, 10), rg = View3D.roofGeom(v, Math.max(v.h, z0 + 260), z0 + 210), j = View3D.porchJoin(v, rg, z0);
  r.join = !!j && j.joined && j.eave >= z0 + 214 && j.roofZ({ x: 0, y: -v.d / 2 }) > j.eave && Math.abs(j.roofZ({ x: 0, y: v.d / 2 - 7 }) - j.eave) < j.rise * 0.2;
  r.deck = Math.abs(View3D.deckZ(t) - (z0 + 0.3)) < 0.01;
  // гараж вплотную к дому, скат высокой стороной к дому: край — под кровлей дома, без свеса с этой стороны
  const gd = catItem('garage1'), gar = Model.add('items', { key: 'garage1', x: 1000, y: 1200 - 20 - gd.d / 2, w: gd.w, d: gd.d, h: gd.h, rot: 0, roofType: 'shed', roofShed: 'front', floor: v.floor });
  Model.commit();
  const g0 = View3D.roofGeom(gar, gar.h, 150, bldWallH(gar)), gj = View3D.leanJoin(gar, g0, { world: (q) => G.toWorld(q, gar.x, gar.y, 0), eave: g0.eave });
  const edge = { x: gar.x, y: gar.y + gd.d / 2 }, hz = Math.max(...App.doc.roofs.map(rf => Roof.zAt(rf, edge) ?? -1));
  r.garage = !!gj && gj.r.d < g0.r.d && Math.abs(gj.roofZ({ x: 0, y: gd.d / 2 }) - (hz - 3)) < 2;
  View3D.toggle(true);
  Walk.start(true); r.ghost = Walk.on && Walk.ghost;
  const x0 = Walk.x, f0 = Walk.foot; Walk.pitch = 0.5; Walk.keys.add('KeyW'); Walk.update(0.5); Walk.keys.clear();
  r.fly = Walk.x !== x0 && Walk.foot > f0;
  Walk.setGhost(false); r.walk = !Walk.ghost; Walk.stop(); View3D.toggle(false);
  return r;
});
console.log('porch', JSON.stringify(porch));
if (Object.values(porch).some(v => !v)) errors.push('Веранда / призрак: ' + JSON.stringify(porch));
// ворота: зона отката откатных, разрыв забора под воротами; надземный газ над проездом
const gt = await page.evaluate(() => {
  const f = App.doc.floors[0].id, X = 400000;
  const fence = Model.add('walls', { kind: 'fence', th: 5, h: 180, mat: 'profile', a: { x: X, y: 0 }, b: { x: X + 2000, y: 0 }, floor: f });
  const gate = Model.add('items', { key: 'gate', x: X + 600, y: 0, w: 400, d: 20, h: 200, rot: 0, floor: f });
  Model.add('items', { key: 'wicket', x: X + 1000, y: 0, w: 100, d: 10, h: 200, rot: 0, floor: f });
  Model.add('areas', { kind: 'asphalt', pts: [{ x: X, y: 100 }, { x: X + 500, y: 100 }, { x: X + 500, y: 600 }, { x: X, y: 600 }], floor: f });
  Model.add('lines', { kind: 'gasAir', pts: [{ x: X - 100, y: 300 }, { x: X + 700, y: 300 }], dia: 32, depth: 0, height: 270, floor: f });
  Model.commit();
  const R = Analysis.run(), r = {};
  r.zone = R.issues.some(i => i.group === 'Ворота' && /Калитка/.test(i.text));
  r.spans = Model.fenceSpans(Model.get(fence.id)).length;
  r.gasDrive = R.issues.some(i => i.group === 'Сети' && /над проездом/.test(i.text));
  Model.get(gate.id).slide = 'left'; Model.commit();
  r.zoneLeft = !Analysis.run().issues.some(i => i.group === 'Ворота' && /Калитка/.test(i.text));
  Model.undo(); Model.undo();
  return r;
});
console.log('gates', JSON.stringify(gt));
if (!gt.zone || gt.spans !== 3 || !gt.gasDrive || !gt.zoneLeft) errors.push('Ворота / газ: ' + JSON.stringify(gt));
// заголовок вкладки — имя открытого файла
const ttl = await page.evaluate(() => { const f0 = App.fileName; IO.setFile('Дача.json'); const t = document.title; IO.setFile(f0); return t; });
console.log('title', ttl);
if (!ttl.startsWith('Дача.json')) errors.push('Заголовок вкладки: ' + ttl);
// буфер между вкладками: копия пишется в общее хранилище и читается обратно
const clip = await page.evaluate(() => {
  App.sel.clear(); for (const w of App.V.walls.slice(0, 2)) App.sel.add(w.id);
  App.copy({ silent: true }); const stored = App.parseClip(localStorage.getItem(App.CLIP_KEY));
  App.clipboard = null; const loaded = App.clipLoad();
  App.sel.clear();
  return { stored: !!stored && stored.data.walls.length === 2, loaded: !!loaded, n: loaded && loaded.n };
});
console.log('clipboard', JSON.stringify(clip));
if (!clip.stored || !clip.loaded || clip.n !== 2) errors.push('Буфер между вкладками: ' + JSON.stringify(clip));
// прогулка в 3D: WASD, столкновения со стенами, подъём по лестнице на мансарду, Esc
const wk = await page.evaluate(() => {
  IO.loadDemo(); View3D.toggle(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  const r = { on: Walk.on };
  const sim = (keys, sec) => { Walk.keys = new Set(keys); for (let t = 0; t < sec; t += 0.05) Walk.update(0.05); Walk.keys.clear(); };
  const face = (dx, dy) => { Walk.yaw = Math.atan2(-dx, -dy); };
  const it = App.doc.items.find(i => catItem(i.key).shape === 'stairs');
  Walk.level = 0; Walk._blk = null; Walk.x = it.x - 140; Walk.y = it.y + it.d / 2 - 25; Walk.foot = 0; Walk.vy = 0;
  face(1, 0); sim(['KeyW'], 0.8); face(0, -1); sim(['KeyW'], 3);
  r.level = Walk.level; r.foot = Math.round(Walk.foot);
  face(0, -1); const y0 = Walk.y; sim(['KeyW'], 2); r.wallStop = Math.round(y0 - Walk.y) < 30;
  View3D.draw();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  r.off = !Walk.on; r.still3d = View3D.active;
  View3D.toggle(false);
  return r;
});
console.log('walk', JSON.stringify(wk));
if (!wk.on || wk.level !== 1 || wk.foot !== 300 || !wk.wallStop || !wk.off || !wk.still3d) errors.push('Прогулка: ' + JSON.stringify(wk));
// инженерные системы: слои, связи трасс с приборами, листы печати по системам, ночь и камеры в 3D
const sy = await page.evaluate(() => {
  const r = {};
  const id = (p) => Model.add('items', p).id;
  const s1 = id({ key: 'socket2', x: 5000, y: 5000, h: 30, w: 15, d: 4, rot: 0 });
  const l = Model.add('lines', { kind: 'power', pts: [{ x: 4800, y: 4900 }, { x: 5000, y: 4900 }, { x: 5000, y: 5000 }], depth: 0, section: 'ВВГнг-LS 3×1,5', breaker: 'C25', label: 'Тест' });
  Model.commit();
  r.sys = sysOf(Model.get(s1)) === 'power' && sysOfLine(l) === 'power';
  Model.translate([s1], 40, 0);
  r.follow = l.pts[2].x === 5040 && l.pts[1].x === 5040 && l.pts[0].x === 4800;
  r.breaker = Analysis.run().issues.some(x => x.group === 'Электрика' && /Тест: автомат C25/.test(x.text));
  App.doc.settings.sys = { power: false }; App.redraw(); App.doc.settings.sys = {};
  const cam = Model.add('items', { key: 'cctvCam', x: 5200, y: 5200, h: 280, w: 10, d: 22, rot: 0 });
  Model.commit();
  r.cctv = !!Analysis.cctv(App.doc, App.floorData);
  View3D.toggle(true); View3D.opts.night = true; View3D.setCamView(cam.id); View3D.draw(); r.night = View3D.lights !== undefined && !!View3D.camView;
  View3D.setCamView(null); View3D.opts.night = false; View3D.toggle(false);
  UI.fillPrintSys();
  IO.print({ ...UI.printOpts(), paper: 'A4', orient: 'landscape', drawing: true, sysSheets: true, preview: true });
  r.sheets = document.querySelectorAll('#pvBody .sheet').length;
  $('pvClose').click();
  Model.remove([s1, l.id, cam.id]); Model.commit();
  return r;
});
console.log('systems', JSON.stringify(sy));
if (!sy.sys || !sy.follow || !sy.breaker || !sy.cctv || !sy.night || !(sy.sheets >= 3)) errors.push('Инженерные системы: ' + JSON.stringify(sy));
// комплект для строителей, разрез, 3D-режимы, подключения, отделка
const kit = await page.evaluate(() => {
  const r = {};
  const sink = Model.add('items', { key: 'sink', x: 5600, y: 5600, w: 60, d: 45, h: 85, rot: 0 });
  Model.commit();
  r.links = Analysis.run().issues.some(x => x.group === 'Подключения' && x.id === sink.id);
  Model.remove([sink.id]); Model.commit();
  const specs = Sheets.list();
  r.kinds = [...new Set(specs.map(s => s.kind))].join(',');
  Sheets.preview({ paper: 'A3' });
  r.sheets = document.querySelectorAll('#pvBody .sheet').length;
  r.auto = [...document.querySelectorAll('#pvBody .sheet')].every(el => !el._layout || el._layout.N > 0);
  $('pvClose').click();
  r.q = Finish.quantities().rooms.length;
  View3D.toggle(true);
  for (const m of ['roofFrame', 'masonry', 'found', 'all']) { View3D.opts.mode = m; View3D.dirty = true; View3D.draw(); }
  View3D.opts.clip = { dir: 'u', k: 0.5 }; View3D.draw(); r.clip = View3D.clipPlane()[3] < 1e8; View3D.opts.clip = null;
  // подсказка в 3D: луч из центра экрана попадает в объект, всплывающее описание заполнено
  const cv = $('canvas3d'), hit = View3D.pickAt(cv.clientWidth / 2, cv.clientHeight / 2);
  View3D.tip3d(hit && hit.id, 100, 100); r.tip = !!hit && !$('tip3d').hidden && $('tip3d').textContent.length > 3; View3D.tip3d(null);
  View3D.toggle(false);
  // варочная панель — по центру модуля, сдвиг на модуль к мойке; трап — с канализацией
  const K0 = kitchenLayout('kitchenI', 380, 60, {}), K1 = kitchenLayout('kitchenI', 380, 60, { hobShift: 1 });
  r.hob = Math.abs(K0.hob.x - (190 - 380 / 12)) < 0.5 && Math.abs(K0.hob.x - K1.hob.x - 380 / 6) < 0.5;
  r.drain = itemLinks({ key: 'floorDrain' }).some(x => x[1].includes('sewer'));
  // 3D: свои переключатели систем и режимы крыши
  View3D.toggle(true);
  const cnt = () => { View3D.dirty = true; View3D.build(); return View3D.arrays.P.length; };
  const all = cnt(); View3D.opts.sys3d = { power: false, lowvolt: false }; const less = cnt(); View3D.opts.sys3d = {};
  View3D.opts.roofView = 'none'; View3D.opts.roof = false; const nor = cnt(); View3D.opts.roofView = 'frame'; View3D.opts.roof = true; cnt(); View3D.opts.roofView = 'full'; cnt();
  r.sys3d = less <= all && nor < all;
  View3D.toggle(false);
  r.mounts = typeof Analysis.mounts === 'function';
  // ответвления трасс: распаечная коробка на тройнике кабеля одной группы; излом — не соединение
  { const a = { id: 't1', kind: 'power', label: 'Гр.1', pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }, b = { id: 't2', kind: 'power', label: 'Гр.1', pts: [{ x: 100, y: 0 }, { x: 100, y: 80 }] }, c = { id: 't3', kind: 'power', label: 'Гр.2', pts: [{ x: 150, y: 0 }, { x: 150, y: -60 }] };
    const T = Render.lineTees([a, b, c]); r.tees = T.length === 1 && T[0].box; }
  // хранение в гараже: предметы есть в каталоге и строятся в 3D
  r.storage = ['garageRack', 'workbench', 'tireRack', 'wallShelf', 'ceilRack'].every(k => catItem(k) && catItem(k).key === k);
  // мансарда: крыша над вторым этажом — жилой объём, разрез с плитой перекрытия и коленом, потолок под скатом
  { const rf = App.doc.roofs[0], f2 = App.doc.floors[1];
    if (rf && f2) {
      const save = rf.floor; rf.floor = f2.id;
      try {
        const L = Roof.living(rf), M = Detail.model(), c = Roof.ceilAt({ x: rf.x, y: rf.y }, f2.id);
        Detail.render({ detail: 'section' }, 800, 600, 50, 2); Detail.render({ detail: 'roofNode' }, 800, 600, 10, 2);
        r.mansard = !!L && !!M.mz && M.lv.wallTop === L.e - 25 && M.lv.plate > L.e && c != null && c <= L.ceil;
      } catch (e) { r.mansard = 'err: ' + e.message; } finally { rf.floor = save; }
    } else r.mansard = true;
  }
  return r;
});
console.log('kit', JSON.stringify(kit));
if (!kit.links || !/plan/.test(kit.kinds) || !/detail/.test(kit.kinds) || !(kit.sheets >= 5) || !kit.auto || !kit.clip || !kit.tip || !kit.hob || !kit.drain || !kit.sys3d || !kit.mounts || !kit.tees || !kit.storage || kit.mansard !== true) errors.push('Комплект / 3D-режимы: ' + JSON.stringify(kit));
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
