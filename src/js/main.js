'use strict';
/* ==========================================================================
   Приложение: состояние, перерисовка, команды, горячие клавиши, запуск.
   ========================================================================== */

const App = {
  doc: null, index: new Map(), sel: new Set(), hover: null, rooms: [], heat: null, floor: 'f1', V: null, floorData: null,
  canvas: null, ctx: null, cw: 800, ch: 600, dpr: 1,
  clipboard: null, lastEvent: null, autosaveNote: '', _rotKeepNorth: false,
  _raf: 0,

  init() {
    Theme.init();
    App.canvas = $('canvas');
    App.ctx = App.canvas.getContext('2d');
    const saved = IO.loadAutosave();
    App.doc = saved || Model.newDoc();
    Model.reindex();
    Underlay.sync();
    Rooms.detectAll();
    Model.resetHistory();
    UI.init();
    Input.init(App.canvas);
    App.resize();
    new ResizeObserver(() => App.resize()).observe($('stage'));
    window.addEventListener('keydown', App.keydown);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { Input.space = false; if (Tools.cur !== 'pan') App.canvas.style.cursor = ''; } });
    window.addEventListener('beforeunload', () => IO.autosave());
    // буфер обмена между вкладками и окнами: системный буфер (copy/paste) + общее хранилище вкладок
    const typingIn = (t) => t && (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable);
    document.addEventListener('copy', (e) => {
      if (typingIn(e.target) || !App._copyArmed || !App.clipboard) return;
      App._copyArmed = false;
      e.clipboardData.setData('text/plain', App.clipText()); e.preventDefault();
    });
    document.addEventListener('paste', (e) => {
      if (typingIn(e.target) || document.querySelector('dialog[open]')) return;
      const c = App.parseClip(e.clipboardData && e.clipboardData.getData('text/plain'));
      e.preventDefault();
      App._pasteHandled = true;
      if (c && (!App.clipboard || c.t >= (App.clipboard.t || 0))) App.clipboard = c;
      App.paste();
    });
    window.addEventListener('storage', (e) => { if (e.key === App.CLIP_KEY) App.clipLoad(); });
    Tools.set('select', { force: true });
    if (!App.isEmpty()) View.fit(Model.contentBBox()); else View.fit({ x0: -600, y0: -400, x1: 1400, y1: 1000 });
    UI.refresh();
    App.redraw();
  },
  isEmpty() { return COLLECTIONS.every(c => !App.doc[c].length) && !App.doc.underlay; },
  resize() {
    const r = $('stage').getBoundingClientRect();
    App.dpr = window.devicePixelRatio || 1;
    App.cw = Math.max(50, r.width); App.ch = Math.max(50, r.height);
    App.canvas.width = Math.round(App.cw * App.dpr); App.canvas.height = Math.round(App.ch * App.dpr);
    App.canvas.style.width = App.cw + 'px'; App.canvas.style.height = App.ch + 'px';
    App.redraw();
  },
  redraw() {
    if (View3D.active) View3D.redraw();
    if (App._raf) return;
    App._raf = requestAnimationFrame(() => {
      App._raf = 0;
      try {
        Render.draw({ ctx: App.ctx, w: App.cw, h: App.ch, dpr: App.dpr, scale: View.scale, ox: View.ox, oy: View.oy, C: Theme.C, exporting: false, layers: App.doc.settings.layers });
      } catch (e) { console.error(e); }
    });
  },
  /** После фиксации изменения (история уже записана) */
  changed(viewOnly) {
    Model.reindex();
    Underlay.sync();
    Rooms.detectAll();
    try { Checks.run(); } catch (e) { console.error(e); }
    if (App.heat && !viewOnly) App.heat.stale = true;
    for (const id of [...App.sel]) if (id !== 'underlay' && !Model.get(id) && !App.rooms.some(r => r.id === id)) App.sel.delete(id);
    UI.refresh();
    App.redraw();
    App.saveSoon();
  },
  /** Во время перетаскивания: без истории */
  changedLive() {
    App.V = Model.viewOf(App.floor);
    App.rooms = Rooms.detect(App.V.walls, App.V.roomTags);
    App.redraw();
  },
  /** Выбран объект — показываем его свойства; сняли выделение — остаёмся на текущей вкладке */
  selChanged() { App.hover = null; if (App.sel.size) UI.showTab('props'); else UI.refresh(); App.redraw(); },
  saveSoon: U.debounce(() => IO.autosave(), 700),

  undo() { if (Tools.st && Object.keys(Tools.st).length) Tools.cancel(true); if (Model.undo()) UI.toast('Отменено'); },
  redo() { if (Model.redo()) UI.toast('Повторено'); },

  /* ------------------------------ команды -------------------------------- */
  selIds() { return [...App.sel].filter(id => Model.get(id)); },
  deleteSel() {
    const ids = App.selIds();
    const rooms = [...App.sel].filter(id => Tools.isRoom(id));
    // удаление «помещения» — удаляем только метку
    for (const r of rooms) { const room = App.rooms.find(x => x.id === r); if (room && room.tag) ids.push(room.tag.id); }
    if (App.sel.has('underlay')) { App.doc.underlay = null; App.sel.delete('underlay'); }
    if (!ids.length && !rooms.length) { Model.commit(); return; }
    Model.remove(ids);
    App.sel.clear();
    Model.commit();
    App.selChanged();
  },
  /** Копия набора объектов (стены — вместе с проёмами, примечания — вместе с объектами) */
  collect(ids) {
    const set = new Set(ids);
    for (const o of App.doc.openings) if (set.has(o.wall)) set.add(o.id);
    for (const n of App.doc.notes) if (n.target && set.has(n.target)) set.add(n.id);
    const out = {};
    for (const id of set) { const c = Model.coll(id); if (!c) continue; (out[c] = out[c] || []).push(U.clone(Model.get(id))); }
    return out;
  },
  pasteData(data, dx, dy) {
    const map = new Map(), gmap = new Map();
    const newIds = [];
    for (const c of COLLECTIONS) for (const o of data[c] || []) map.set(o.id, U.uid(c[0]));
    for (const c of COLLECTIONS) for (const src of data[c] || []) {
      const o = U.clone(src);
      o.id = map.get(src.id);
      if (o.grp) { if (!gmap.has(o.grp)) gmap.set(o.grp, U.uid('g')); o.grp = gmap.get(o.grp); }   // копия группы — новая группа
      if (c === 'openings') { if (!map.has(src.wall)) continue; o.wall = map.get(src.wall); }
      else o.floor = App.floor;   // вставка — на текущий этаж
      if (c === 'notes' && o.target) { if (map.has(o.target)) o.target = map.get(o.target); else { const p = Model.notePos(src); delete o.target; o.x = p.x; o.y = p.y; } }
      Model.add(c, o);
      if (c !== 'openings' && !(c === 'notes' && o.target)) newIds.push(o.id);
    }
    Model.translate(newIds, dx, dy, { stretch: false });
    App.sel.clear();
    for (const id of newIds) App.sel.add(id);
    Model.commit();
    App.selChanged();
  },
  /** Выделение целиком: если выделены все объекты одной группы — её id, иначе null */
  selGroup() {
    const ids = App.selIds();
    if (ids.length < 2) return null;
    const g = Model.get(ids[0]).grp;
    if (!g || !ids.every(id => Model.get(id).grp === g)) return null;
    return Model.groupOf(ids[0]).length === ids.length ? g : null;
  },
  /** Сгруппировать выделенное (Ctrl+G): дальше клик по любому объекту выделяет всю группу */
  group() {
    const ids = App.selIds().filter(id => Model.coll(id) !== 'openings');
    if (ids.length < 2) { UI.toast('Выделите несколько объектов (Shift+клик или рамкой), затем «Сгруппировать»'); return; }
    const g = U.uid('g');
    for (const id of ids) Model.get(id).grp = g;
    Model.commit(); App.selChanged();
    const walls = ids.filter(id => Model.coll(id) === 'walls').length;
    UI.toast(`Группа: ${walls === ids.length ? walls + ' стен' : ids.length + ' объектов'}. Клик — вся группа, Alt+клик — один объект. Ctrl+Shift+G — разгруппировать`);
  },
  ungroup() {
    const ids = App.selIds();
    const gs = new Set(ids.map(id => Model.get(id).grp).filter(Boolean));
    if (!gs.size) { UI.toast('В выделении нет групп'); return; }
    for (const c of COLLECTIONS) for (const o of App.doc[c]) if (o.grp && gs.has(o.grp)) delete o.grp;
    Model.commit(); App.selChanged();
    UI.toast(gs.size > 1 ? `Разгруппировано групп: ${gs.size}` : 'Группа разгруппирована, объекты остались выделенными');
  },
  /** Сдвиг выделения на (dx, dy): у стен — с сохранением стыков */
  moveSel(dx, dy) {
    const ids = App.selIds().filter(id => Model.coll(id) !== 'openings' && !Model.get(id).locked);
    if (!ids.length || (!dx && !dy)) return;
    if (ids.every(id => Model.coll(id) === 'walls')) Model.moveWalls(ids, dx, dy); else Model.translate(ids, dx, dy);
    Model.commit();
  },
  /** Повернуть выделение на произвольный угол вокруг его центра */
  rotateSelBy(deg) { if (deg) App.rotateSel(deg); },
  duplicate() {
    const ids = App.selIds();
    if (!ids.length) return;
    App.pasteData(App.collect(ids), 50, 50);
  },
  CLIP_KEY: 'floorplaner:clipboard',
  /** Копировать выделенное: в память, в общее хранилище вкладок и (по Ctrl+C / через API) в системный буфер */
  copy(opts = {}) {
    const ids = App.selIds();
    if (!ids.length) return;
    App.clipboard = { app: 'floorplaner-clipboard', v: 1, t: Date.now(), data: App.collect(ids), bbox: Model.bboxOf(ids), n: ids.length };
    try { localStorage.setItem(App.CLIP_KEY, JSON.stringify(App.clipboard)); } catch (e) { /* хранилище недоступно */ }
    App._copyArmed = true;                  // событие copy от Ctrl+C положит данные в системный буфер
    if (!opts.keyboard && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(App.clipText()).catch(() => {});
    if (!opts.silent) UI.toast(`Скопировано: ${ids.length}. Вставить можно и в другой вкладке (Ctrl+V)`);
  },
  /** Вырезать: скопировать и удалить */
  cut() { if (!App.selIds().length) return; App.copy({ keyboard: true, silent: true }); const n = App.selIds().length; App.deleteSel(); UI.toast(`Вырезано: ${n}. Вставьте здесь или в другой вкладке (Ctrl+V)`); },
  clipText() { return JSON.stringify(App.clipboard); },
  parseClip(txt) {
    if (!txt || txt.length < 20 || txt[0] !== '{') return null;
    try { const c = JSON.parse(txt); return c && c.app === 'floorplaner-clipboard' && c.data ? c : null; } catch (e) { return null; }
  },
  /** Подхватить скопированное в другой вкладке (если оно новее) */
  clipLoad() {
    let c = null;
    try { c = App.parseClip(localStorage.getItem(App.CLIP_KEY)); } catch (e) { /* хранилище недоступно */ }
    if (c && (!App.clipboard || (c.t || 0) > (App.clipboard.t || 0))) App.clipboard = c;
    return App.clipboard;
  },
  paste(at) {
    App.clipLoad();
    if (!App.clipboard) { UI.toast('Буфер пуст: выделите объекты и нажмите Ctrl+C (здесь или в другой вкладке)'); return; }
    const b = App.clipboard.bbox;
    const target = at || View.toWorld(Tools.mouse);
    let dx = 50, dy = 50;
    if (b && target) { dx = target.x - (b.x0 + b.x1) / 2; dy = target.y - (b.y0 + b.y1) / 2; }
    const g = Tools.gridStep();
    App.pasteData(App.clipboard.data, U.round(dx, g), U.round(dy, g));
  },
  rotateSel(deg) {
    const ids = Model.expandForTransform(App.selIds());
    if (!ids.length) { App.rotateAll(deg); return; }
    const b = Model.bboxOf(ids);
    Model.rotate(ids, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, deg);
    Model.commit();
  },
  mirrorSel(axis) {
    const ids = Model.expandForTransform(App.selIds());
    if (!ids.length) return;
    const b = Model.bboxOf(ids);
    Model.mirror(ids, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, axis);
    Model.commit();
  },
  /** Повернуть весь план. keepNorth=true — вместе со стрелкой севера (ориентация сохраняется) */
  rotateAll(deg, keepNorth) {
    keepNorth = keepNorth || App._rotKeepNorth;
    const ids = Model.allIds(true);
    const b = Model.contentBBox();
    if (!b) return;
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    Model.rotate(ids, c, deg);
    const u = App.doc.underlay;
    if (u) { const q = G.rotate(u, c, U.rad(deg)); u.x = q.x; u.y = q.y; u.rot = U.normDeg((u.rot || 0) + deg); }
    if (keepNorth) App.doc.north = U.normDeg(App.doc.north + deg);
    // сетка поворачивается вместе с планом
    const s = App.doc.settings;
    s.gridOrigin = G.rotate(s.gridOrigin || { x: 0, y: 0 }, c, U.rad(deg));
    s.gridAngle = App.gridMod(s.gridAngle + deg);
    Model.commit();
    UI.toast(keepNorth ? `План повёрнут на ${deg}° вместе с компасом` : `План повёрнут на ${deg}° относительно сторон света`);
  },
  mirrorAll(axis) {
    const ids = Model.allIds(true);
    const b = Model.contentBBox();
    if (!b) return;
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    Model.mirror(ids, c, axis);
    const s = App.doc.settings, o = { ...(s.gridOrigin || { x: 0, y: 0 }) };
    if (axis === 'x') o.x = 2 * c.x - o.x; else o.y = 2 * c.y - o.y;
    s.gridOrigin = o; s.gridAngle = App.gridMod(-s.gridAngle);
    Model.commit();
  },
  /** Ближайшая типовая толщина материала (без утеплителя) или null, если текущая уже типовая */
  typicalTh(kind, mat, core) {
    const M = materialsFor(kind)[mat];
    if (!M || !M.ths || !M.ths.length || M.ths.some(t => Math.abs(t - core) < 0.01)) return null;
    return M.ths.reduce((b, t) => (Math.abs(t - core) < Math.abs(b - core) ? t : b), M.ths[0]);
  },
  /** Сменить материал стен. Если толщина не типовая для нового материала — ставим ближайшую типовую
   *  (газобетон 40 → кирпич 38), утеплитель сохраняется */
  setWallMat(walls, mat) {
    let n = 0, last = null;
    for (const w of walls) {
      if (!materialsFor(w.kind)[mat]) continue;
      w.mat = mat;
      const ins = w.ins || 0, t = App.typicalTh(w.kind, mat, w.th - ins);
      if (t !== null) { w.th = t + ins; n++; last = t; }
    }
    Model.commit();
    if (n) UI.toast(`Толщина ${n > 1 ? n + ' стен' : 'стены'} → ${last} см — типовая для «${materialsFor(walls[0].kind)[mat].name}»`);
  },
  /** Параметр стен по умолчанию для вида kind; applyExisting — применить и к уже нарисованным стенам этого вида */
  setWallDefault(kind, key, val, applyExisting) {
    const dd = App.doc.defaults.wall[kind];
    dd[key] = val;
    if (key === 'mat') { const t = App.typicalTh(kind, val, dd.th); if (t !== null) dd.th = t; }
    let n = 0;
    if (applyExisting) for (const w of App.doc.walls) {
      if (w.kind !== kind) continue;
      n++;
      if (key === 'h') w.h = dd.h;
      else { w.mat = dd.mat; w.th = dd.th + (w.ins || 0); }
    }
    Model.commit();
    if (n) UI.toast(`Обновлено стен: ${n} (Ctrl+Z — отменить)`);
  },
  /** Угол сетки приводится к [0; 90): сетка симметрична относительно поворота на 90° */
  gridMod(a) { a = ((a % 90) + 90) % 90; a = Math.round(a * 1000) / 1000; return a >= 90 - 1e-6 ? 0 : a; },
  setGrid(angle, origin) {
    const s = App.doc.settings;
    s.gridAngle = App.gridMod(angle || 0);
    if (origin) s.gridOrigin = { x: origin.x, y: origin.y };
    Model.commit();
  },
  /** Повернуть сетку по выделенному объекту: стене, краю зоны/дороги, предмету, крыше */
  gridToSel(id) {
    id = id || App.selIds()[0];
    const o = id && Model.get(id), c = id && Model.coll(id);
    let ang = null, org = null;
    const longest = (pts, closed) => {
      let best = null;
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length], L = G.dist(a, b); if (!best || L > best.L) best = { a, b, L }; }
      return best;
    };
    if (!o) { UI.toast('Выделите стену, зону, дорогу, предмет или крышу — сетка встанет по ним'); return; }
    if (c === 'walls' || c === 'dims') { ang = U.deg(G.angle(o.a, o.b)); org = o.a; }
    else if ((c === 'areas' || c === 'roads' || c === 'lines') && o.pts.length >= 2) { const e = longest(o.pts, c === 'areas'); ang = U.deg(G.angle(e.a, e.b)); org = e.a; }
    else if (U.isNum(o.rot)) { ang = o.rot; org = { x: o.x, y: o.y }; }
    if (ang === null) { UI.toast('У этого объекта нет направления для сетки'); return; }
    App.setGrid(ang, org);
    UI.toast(`Сетка повёрнута на ${App.doc.settings.gridAngle}° — по выделенному`);
  },
  selectAll() {
    App.sel.clear();
    for (const id of Model.allIds()) App.sel.add(id);
    App.selChanged();
  },
  clearAll() {
    for (const c of COLLECTIONS) App.doc[c] = [];
    App.doc.underlay = null;
    App.sel.clear(); App.heat = null;
    Model.reindex();
    Model.commit();
  },
  /** Выравнивание выделенных объектов по краю/центру общей рамки */
  align(mode) {
    const ids = Model.expandForTransform(App.selIds()).filter(id => !Model.get(id).locked);
    if (ids.length < 2) return;
    const all = Model.bboxOf(ids);
    for (const id of ids) {
      const b = Model.bboxOf([id]);
      let dx = 0, dy = 0;
      if (mode === 'left') dx = all.x0 - b.x0;
      if (mode === 'right') dx = all.x1 - b.x1;
      if (mode === 'cx') dx = (all.x0 + all.x1) / 2 - (b.x0 + b.x1) / 2;
      if (mode === 'top') dy = all.y0 - b.y0;
      if (mode === 'bottom') dy = all.y1 - b.y1;
      if (mode === 'cy') dy = (all.y0 + all.y1) / 2 - (b.y0 + b.y1) / 2;
      Model.translate([id], dx, dy, { stretch: false });
    }
    Model.commit();
  },
  nudge(dx, dy) {
    const ids = App.selIds().filter(id => Model.coll(id) !== 'openings' && !Model.get(id).locked);
    const ops = App.selIds().filter(id => Model.coll(id) === 'openings');
    if (!ids.length && !ops.length) return;
    Tools.fixTags(ids);
    if (ids.length && ids.every(id => Model.coll(id) === 'walls')) Model.moveWalls(ids, dx, dy);
    else Model.translate(ids, dx, dy);
    for (const id of ops) { const op = Model.get(id); const g = Model.opGeom(op); if (g) op.pos = U.clamp(op.pos + G.dot({ x: dx, y: dy }, g.u), op.w / 2, g.L - op.w / 2); }
    Model.commit();
  },
  addNote(targetId, at) {
    const px = 1 / View.scale;
    let n;
    if (targetId && Model.get(targetId)) n = { target: targetId, dx: 40 * px, dy: -46 * px, text: '' };
    else {
      const p = at || View.toWorld({ x: App.cw / 2, y: App.ch / 2 });
      n = { x: p.x, y: p.y, text: '' };
    }
    const obj = Model.add('notes', n);
    Model.commit();
    return obj;
  },
  /* ------------------------------- этажи --------------------------------- */
  /** Отметки этажей: каждый следующий — над предыдущим */
  relevel() {
    const fl = App.doc.floors;
    for (let i = 1; i < fl.length; i++) fl[i].elev = fl[i - 1].elev + fl[i - 1].h;
  },
  addFloor(copyWalls) {
    const fl = App.doc.floors, top = fl[fl.length - 1];
    const f = { id: U.uid('f'), name: `${fl.length + 1} этаж`, elev: top.elev + top.h, h: top.h };
    fl.push(f);
    if (copyWalls) {
      for (const w of App.doc.walls) if (w.floor === top.id && w.kind === 'ext') {
        const c = U.clone(w); delete c.id; c.floor = f.id;
        Model.add('walls', c);
      }
    }
    App.floor = f.id;
    App.sel.clear();
    Model.commit();
    UI.toast(`${f.name} добавлен` + (copyWalls ? ' с наружными стенами нижнего этажа' : ''));
  },
  deleteFloor(fid) {
    const fl = App.doc.floors;
    if (fl.length < 2) return;
    const f = fl.find(x => x.id === fid);
    const V = Model.viewOf(fid);
    const n = COLLECTIONS.filter(c => c !== 'roofs').reduce((s, c) => s + V[c].length, 0);
    if (n && !confirm(`Удалить «${f.name}» и все его объекты (${n})? Можно отменить через Ctrl+Z.`)) return;
    Model.remove(COLLECTIONS.filter(c => c !== 'openings' && c !== 'roofs').flatMap(c => V[c].map(o => o.id)));
    App.doc.floors = fl.filter(x => x.id !== fid);
    for (const r of App.doc.roofs) if (r.floor === fid) r.floor = App.doc.floors[App.doc.floors.length - 1].id;
    App.relevel();
    if (App.floor === fid) App.floor = App.doc.floors[0].id;
    Model.commit();
  },
  /** Новая крыша (по умолчанию двускатная 30°, над верхом стен текущего этажа) */
  addRoof(rect) {
    const r = Model.add('roofs', { type: 'gable', pitch: 30, mat: 'metaltile', base: Roof.autoBase(App.floor), ...rect });
    App.sel.clear(); App.sel.add(r.id);
    Model.commit(); App.selChanged();
    UI.toast(`Крыша: ${U.fmtArea(Roof.params(r).area)} кровли`);
    return r;
  },
  /** Крыша по наружному контуру стен текущего этажа */
  roofFromOutline(overhang = 50) {
    const outl = Rooms.outlines;
    if (!outl.length) { UI.toast('Нет замкнутого контура наружных стен на этом этаже', 'err'); return; }
    const pts = outl.flatMap(o => o.outer);
    const rect = Roof.fromOutline(pts, overhang);
    if (rect) { Tools.set('select'); App.addRoof(rect); }
  },
  createPlot(w, d) {
    if (!(w > 0 && d > 0)) return;
    const c = View.toWorld({ x: App.cw / 2, y: App.ch / 2 });
    const x0 = U.round(c.x - w / 2, 10), y0 = U.round(c.y - d / 2, 10);
    const a = Model.add('areas', { kind: 'plot', name: 'Участок', pts: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + d }, { x: x0, y: y0 + d }] });
    App.sel.clear(); App.sel.add(a.id);
    Model.commit();
    View.fit(Model.contentBBox());
    UI.toast(`Участок ${(w / 100).toFixed(1)}×${(d / 100).toFixed(1)} м = ${(w * d / 1e6).toFixed(2)} сот.`);
  },
  /** Забор по границе участка: выделенного или единственного */
  fenceAroundPlot() {
    const plots = App.V.areas.filter(a => a.kind === 'plot');
    const sel = plots.find(a => App.sel.has(a.id));
    const a = sel || (plots.length === 1 ? plots[0] : null);
    if (!a) { UI.toast(plots.length ? 'Выделите границу участка, вдоль которой ставить забор' : 'Сначала нарисуйте границу участка: инструмент «Зона» → «Граница участка»', 'err'); return; }
    App.fenceAround(a);
  },
  fenceAround(a) {
    const d = App.doc.defaults.wall.fence;
    for (let i = 0; i < a.pts.length; i++) {
      const p = a.pts[i], q = a.pts[(i + 1) % a.pts.length];
      Model.add('walls', { kind: 'fence', th: d.th, h: d.h, mat: d.mat, a: { ...p }, b: { ...q } });
    }
    Model.commit();
    UI.toast('Забор построен. Ворота и калитку добавьте инструментом «Дверь» (тип «Ворота»).');
  },

  /* ---------------------------- горячие клавиши -------------------------- */
  keydown(e) {
    UI.hideTip();   // удаление, отмена, масштаб, 3D — подсказка устаревает
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    const dlgOpen = document.querySelector('dialog[open]');
    if (e.key === 'F1') { e.preventDefault(); if (!dlgOpen) $('dlgHelp').showModal(); return; }
    if (View3D.active && !dlgOpen && !typing) {
      if (!(e.ctrlKey || e.metaKey) && Walk.key(e, true)) { e.preventDefault(); return; }   // прогулка: WASD, стрелки…
      if (e.key === 'Escape' || e.code === 'Digit3') { View3D.toggle(false); e.preventDefault(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;       // в 3D — только сочетания с Ctrl (отмена, сохранение, печать…)
    }
    if (dlgOpen || typing) {
      if (typing && e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const code = e.code;
    if (mod) {
      if (code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); App.undo(); return; }
      if ((code === 'KeyZ' && e.shiftKey) || code === 'KeyY') { e.preventDefault(); App.redo(); return; }
      if (code === 'KeyS') { e.preventDefault(); IO.saveJSON(); return; }
      if (code === 'KeyO') { e.preventDefault(); $('fileJson').click(); return; }
      if (code === 'KeyP') { e.preventDefault(); $('dlgPrint').showModal(); return; }
      if (code === 'KeyD') { e.preventDefault(); App.duplicate(); return; }
      if (code === 'KeyG') { e.preventDefault(); if (e.shiftKey) App.ungroup(); else App.group(); return; }
      // Ctrl+C / Ctrl+V: без preventDefault — браузер пошлёт события copy/paste (системный буфер обмена);
      // если paste не пришёл (нет доступа к буферу), вставим из общего хранилища вкладок
      if (code === 'KeyC') { App.copy({ keyboard: true }); return; }
      if (code === 'KeyX') { App.cut(); return; }
      if (code === 'KeyV') { App._pasteHandled = false; setTimeout(() => { if (!App._pasteHandled) App.paste(); }, 80); return; }
      if (code === 'KeyX') { App.copy(); App.deleteSel(); return; }
      if (code === 'KeyA') { e.preventDefault(); App.selectAll(); return; }
      if (code === 'KeyN' && e.altKey) { e.preventDefault(); UI.action('new'); return; }
      return;
    }
    if (Tools.key(e)) return;
    if (code === 'Space') { Input.space = true; App.canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    if (e.key === '?' || (code === 'Slash' && e.shiftKey)) { $('dlgHelp').showModal(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); App.deleteSel(); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
      App.nudge(d[0], d[1]); return;
    }
    if (e.key === '!' || (code === 'Digit1' && e.shiftKey)) { View.fit(Model.contentBBox()); return; }
    if (code === 'Digit3' && !e.shiftKey) { View3D.toggle(true); return; }
    if (e.key === '+' || e.key === '=') { View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 1.25); return; }
    if (e.key === '-' || e.key === '_') { View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 0.8); return; }
    // по физическим клавишам — работает и в русской раскладке
    const toolKeys = { KeyJ: 'roof', KeyP: 'road', KeyV: 'select', KeyH: 'pan', KeyW: 'wall', KeyQ: 'room', KeyD: 'door', KeyO: 'window', KeyB: 'area', KeyU: 'line', KeyN: 'dim', KeyM: 'measure', KeyT: 'text', KeyK: 'note', KeyF: 'fence' };
    if (toolKeys[code]) { Tools.set(toolKeys[code]); return; }
    if (code === 'KeyR' || code === 'BracketLeft' || code === 'BracketRight') {
      // без выделения клавиши не поворачивают весь план (это легко сделать случайно)
      if (!App.selIds().length) { UI.toast('Выделите, что повернуть. Весь план — в панели «Свойства» без выделения.'); return; }
      App.rotateSel(code === 'KeyR' ? (e.shiftKey ? -90 : 90) : code === 'BracketLeft' ? -15 : 15); return;
    }
    if (code === 'KeyG') { $('btnGrid').click(); return; }
    if (code === 'KeyS') { $('btnSnap').click(); return; }
    void k;
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
