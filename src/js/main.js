'use strict';
/* ==========================================================================
   Приложение: состояние, перерисовка, команды, горячие клавиши, запуск.
   ========================================================================== */

const App = {
  doc: null, index: new Map(), sel: new Set(), hover: null, rooms: [], heat: null,
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
    App.rooms = Rooms.detect(App.doc.walls);
    Model.resetHistory();
    UI.init();
    Input.init(App.canvas);
    App.resize();
    new ResizeObserver(() => App.resize()).observe($('stage'));
    window.addEventListener('keydown', App.keydown);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { Input.space = false; if (Tools.cur !== 'pan') App.canvas.style.cursor = ''; } });
    window.addEventListener('beforeunload', () => IO.autosave());
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
    if (App._raf) return;
    App._raf = requestAnimationFrame(() => {
      App._raf = 0;
      try {
        Render.draw({ ctx: App.ctx, w: App.cw, h: App.ch, dpr: App.dpr, scale: View.scale, ox: View.ox, oy: View.oy, C: Theme.C, exporting: false, layers: App.doc.settings.layers });
      } catch (e) { console.error(e); }
    });
  },
  /** После фиксации изменения (история уже записана) */
  changed() {
    Model.reindex();
    Underlay.sync();
    App.rooms = Rooms.detect(App.doc.walls);
    if (App.heat) App.heat.stale = true;
    for (const id of [...App.sel]) if (id !== 'underlay' && !Model.get(id) && !App.rooms.some(r => r.id === id)) App.sel.delete(id);
    UI.refresh();
    App.redraw();
    App.saveSoon();
  },
  /** Во время перетаскивания: без истории */
  changedLive() {
    App.rooms = Rooms.detect(App.doc.walls);
    App.redraw();
  },
  selChanged() { App.hover = null; UI.showTab('props'); App.redraw(); },
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
    const map = new Map();
    const newIds = [];
    for (const c of COLLECTIONS) for (const o of data[c] || []) map.set(o.id, U.uid(c[0]));
    for (const c of COLLECTIONS) for (const src of data[c] || []) {
      const o = U.clone(src);
      o.id = map.get(src.id);
      if (c === 'openings') { if (!map.has(src.wall)) continue; o.wall = map.get(src.wall); }
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
  duplicate() {
    const ids = App.selIds();
    if (!ids.length) return;
    App.pasteData(App.collect(ids), 50, 50);
  },
  copy() {
    const ids = App.selIds();
    if (!ids.length) return;
    App.clipboard = { data: App.collect(ids), bbox: Model.bboxOf(ids) };
    UI.toast('Скопировано: ' + ids.length);
  },
  paste(at) {
    if (!App.clipboard) return;
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
    const ids = Model.allIds();
    const b = Model.contentBBox();
    if (!b) return;
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    Model.rotate(ids, c, deg);
    const u = App.doc.underlay;
    if (u) { const q = G.rotate(u, c, U.rad(deg)); u.x = q.x; u.y = q.y; u.rot = U.normDeg((u.rot || 0) + deg); }
    if (keepNorth) App.doc.north = U.normDeg(App.doc.north + deg);
    Model.commit();
    UI.toast(keepNorth ? `План повёрнут на ${deg}° вместе с компасом` : `План повёрнут на ${deg}° относительно сторон света`);
  },
  mirrorAll(axis) {
    const ids = Model.allIds();
    const b = Model.contentBBox();
    if (!b) return;
    Model.mirror(ids, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, axis);
    Model.commit();
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
  nudge(dx, dy) {
    const ids = App.selIds().filter(id => Model.coll(id) !== 'openings');
    const ops = App.selIds().filter(id => Model.coll(id) === 'openings');
    if (!ids.length && !ops.length) return;
    Model.translate(ids, dx, dy);
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
  fenceAround(a) {
    const d = App.doc.defaults.wall.fence;
    for (let i = 0; i < a.pts.length; i++) {
      const p = a.pts[i], q = a.pts[(i + 1) % a.pts.length];
      Model.add('walls', { kind: 'fence', th: d.th, h: d.h, a: { ...p }, b: { ...q } });
    }
    Model.commit();
    UI.toast('Забор построен. Ворота и калитку добавьте инструментом «Дверь» (тип «Ворота»).');
  },

  /* ---------------------------- горячие клавиши -------------------------- */
  keydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    const dlgOpen = document.querySelector('dialog[open]');
    if (e.key === 'F1') { e.preventDefault(); if (!dlgOpen) $('dlgHelp').showModal(); return; }
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
      if (code === 'KeyC') { App.copy(); return; }
      if (code === 'KeyV') { e.preventDefault(); App.paste(); return; }
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
    if (e.key === '+' || e.key === '=') { View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 1.25); return; }
    if (e.key === '-' || e.key === '_') { View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 0.8); return; }
    // по физическим клавишам — работает и в русской раскладке
    const toolKeys = { KeyP: 'road', KeyV: 'select', KeyH: 'pan', KeyW: 'wall', KeyQ: 'room', KeyD: 'door', KeyO: 'window', KeyB: 'area', KeyU: 'line', KeyN: 'dim', KeyM: 'measure', KeyT: 'text', KeyK: 'note' };
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
