'use strict';
/* ==========================================================================
   Инструменты и ввод: привязки, выделение, ручки, рисование.
   ========================================================================== */

const TOOL_INFO = {
  select:  { name: 'Выделение', key: 'V', hint: 'Клик — выбрать, Shift — добавить, рамка — выбор нескольких. Тяните объект, ручки — размер и поворот. ПКМ — меню.' },
  pan:     { name: 'Рука', key: 'H', hint: 'Перетаскивайте план. Колесо — масштаб.' },
  wall:    { name: 'Стена', key: 'W', hint: 'Клик — начало, клики — следующие углы. Введите длину с клавиатуры (например 350 или 3.5м) и Enter. Shift — шаг 15°. Esc / ПКМ / двойной клик — завершить.' },
  room:    { name: 'Комната', key: 'Q', hint: 'Тяните прямоугольник по осям стен. Или клик и введите размеры «400x300» + Enter.' },
  roof:    { name: 'Крыша', key: 'J', hint: 'Протяните прямоугольник крыши (со свесами) или нажмите «По контуру дома» вверху. Конёк — вдоль длинной стороны; тип, уклон и высота — в свойствах.' },
  door:    { name: 'Дверь', key: 'D', hint: 'Наведите на стену и кликните. Сторона курсора = сторона открывания. Потом поменяйте петли/сторону в свойствах.' },
  window:  { name: 'Окно', key: 'O', hint: 'Наведите на стену и кликните. Размеры и подоконник — в панели вверху или в свойствах.' },
  road:    { name: 'Дорога', key: 'P', hint: 'Клики — осевая линия улицы, дороги или тропинки. Ширина и вид — в панели сверху. Enter / двойной клик — готово. Название — в свойствах.' },
  line:    { name: 'Трасса', key: 'U', hint: 'Клики — точки трассы (трубы/кабеля). Привязка к приборам и стенам. Enter / двойной клик — готово, Backspace — убрать точку.' },
  area:    { name: 'Участок / зона', key: 'B', hint: 'Клики — вершины, клик в первую — замкнуть. Enter — замкнуть. В режиме «Прямоугольник» — тяните или введите «2000x3000».' },
  dim:     { name: 'Размер', key: 'N', hint: 'Клик — первая точка, клик — вторая, затем отведите размерную линию и кликните.' },
  measure: { name: 'Рулетка', key: 'M', hint: 'Клики — точки замера: длины, сумма, азимут, площадь. Esc — сброс.' },
  text:    { name: 'Надпись', key: 'T', hint: 'Клик — поставить надпись. Текст — в свойствах.' },
  note:    { name: 'Примечание', key: 'K', hint: 'Кликните по объекту (стене, предмету, трассе, помещению) — примечание привяжется к нему и будет следовать за ним. Клик по пустому месту — свободное примечание.' },
  place:   { name: 'Размещение', key: '', hint: 'Клик — поставить. R — повернуть на 90°, Shift+клик — ставить ещё, Alt — без прилипания к стене. Esc — отмена.' },
  calib:   { name: 'Калибровка подложки', key: '', hint: 'Кликните две точки на подложке с известным расстоянием между ними.' },
};

/* Предметы, которые «прилипают» спинкой к стене при перетаскивании */
const WALL_MOUNT = new Set(['socket', 'socket2', 'socketP', 'switch', 'switch2', 'wallLamp', 'panel', 'radiator', 'sink', 'toilet', 'bidet', 'urinal', 'vanity',
  'washer', 'kitchenI', 'kitchenL', 'counter', 'upper', 'ksink', 'wardrobe', 'fridge', 'fridge2', 'stove', 'bath', 'bathCorner', 'shelf', 'tv', 'fireplace', 'fireplaceCorner', 'cabinet', 'piano', 'boiler']);

const Tools = {
  cur: 'select',
  st: {},             // состояние текущей операции
  opts: {             // параметры инструментов (панель сверху)
    wallKind: 'ext', doorType: 'door', doorW: 80, doorH: 210, winType: 'win2', winW: 120, winH: 140, winSill: 85,
    lineKind: 'water', roadKind: 'road', roadW: 400, areaKind: 'plot', areaRect: false, placeKey: null, placeRot: 0,
  },
  input: '',          // набор длины с клавиатуры
  mouse: { x: 0, y: 0 }, mouseW: { x: 0, y: 0 },
  snapInfo: null, guides: [],

  set(name, opt = {}) {
    if (Tools.cur === name && !opt.force && name !== 'place') return;
    UI.hideTip();
    Tools.cancel(true);
    Tools.cur = name;
    Tools.st = {};
    Tools.input = '';
    if (name === 'place') { Tools.opts.placeKey = opt.key; Tools.opts.placeRot = Math.round(Tools.gridFrame().a * 10) / 10; }
    if (name !== 'select') App.hover = null;
    UI.syncTool();
    App.redraw();
  },
  cancel(silent) {
    const st = Tools.st;
    if (Tools.cur === 'line' && st.pts && st.pts.length >= 2 && !silent) Tools.finishLine();
    else if (Tools.cur === 'area' && st.pts && st.pts.length >= 3 && !silent) Tools.finishArea();
    Tools.st = {};
    Tools.input = '';
    UI.setInput('');
    App.redraw();
  },

  /* ------------------------------ привязки ------------------------------- */
  tol() { return 9 / View.scale; },
  gridStep() { return App.doc.settings.grid || 5; },
  /** Система координат сетки: угол a (°) и начало o. Прямоугольники и «ортогонально» — по её осям */
  gridFrame() { const s = App.doc.settings; return { a: s.gridAngle || 0, o: s.gridOrigin || { x: 0, y: 0 } }; },
  gL(p) { const f = Tools.gridFrame(); return f.a ? G.toLocal(p, f.o.x, f.o.y, f.a) : { x: p.x - f.o.x, y: p.y - f.o.y }; },
  gW(p) { const f = Tools.gridFrame(); return f.a ? G.toWorld(p, f.o.x, f.o.y, f.a) : { x: p.x + f.o.x, y: p.y + f.o.y }; },
  /** Прямоугольник по диагонали a–b, стороны параллельны осям сетки */
  gridRect(a, b) {
    const la = Tools.gL(a), lb = Tools.gL(b);
    const x0 = Math.min(la.x, lb.x), x1 = Math.max(la.x, lb.x), y0 = Math.min(la.y, lb.y), y1 = Math.max(la.y, lb.y);
    const pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map(Tools.gW);
    return { pts, w: x1 - x0, h: y1 - y0, c: Tools.gW({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }), rot: Tools.gridFrame().a };
  },
  /** Привязка точки. o: {from, exclude:Set, items:bool, faces:bool, onWall:bool, noGrid} */
  snap(p, e, o = {}) {
    Tools.snapInfo = null; Tools.guides = [];
    if (e && e.altKey) return { ...p };
    const tol = Tools.tol();
    const doSnap = App.doc.settings.snap;
    let best = null, bd = tol;
    const cand = (q, kind) => { const d = G.dist(p, q); if (d < bd) { bd = d; best = { p: { x: q.x, y: q.y }, kind }; } };
    const ex = o.exclude || new Set();
    for (const w of App.V.walls) {
      if (ex.has(w.id)) continue;
      cand(w.a, 'угол стены'); cand(w.b, 'угол стены');
      if (o.faces) for (const q of Model.wallRect(w)) cand(q, 'угол грани');
    }
    for (const l of App.V.lines) if (!ex.has(l.id)) for (const q of l.pts) cand(q, 'точка трассы');
    for (const a of App.V.areas) if (!ex.has(a.id)) for (const q of a.pts) cand(q, 'вершина');
    for (const r of App.V.roads) if (!ex.has(r.id)) for (const q of r.pts) cand(q, 'точка дороги');
    for (const d of App.V.dims) if (!ex.has(d.id)) { cand(d.a, 'точка'); cand(d.b, 'точка'); }
    if (o.items) for (const it of App.V.items) if (!ex.has(it.id)) cand(it, catItem(it.key).name);
    if (o.extra) for (const q of o.extra) cand(q, 'точка');
    if (best) { Tools.snapInfo = best; return best.p; }
    // на стене (ось или грань)
    if (o.onWall !== false) {
      for (const w of App.V.walls) {
        if (ex.has(w.id)) continue;
        const pr = G.proj(p, w.a, w.b);
        if (pr.d < tol && pr.t > 0 && pr.t < 1) { Tools.snapInfo = { p: pr.q, kind: 'на оси стены' }; return pr.q; }
        if (o.faces) {
          const r = Model.wallRect(w);
          for (const [a, b] of [[r[0], r[1]], [r[2], r[3]]]) {
            const q = G.proj(p, a, b);
            if (q.d < tol && q.t > 0 && q.t < 1) { Tools.snapInfo = { p: q.q, kind: 'на грани стены' }; return q.q; }
          }
        }
      }
      if (o.lines) for (const l of App.V.lines) {
        if (ex.has(l.id)) continue;
        for (let i = 0; i < l.pts.length - 1; i++) {
          const pr = G.proj(p, l.pts[i], l.pts[i + 1]);
          if (pr.d < tol) { Tools.snapInfo = { p: pr.q, kind: 'на трассе' }; return pr.q; }
        }
      }
    }
    let q = { ...p };
    // угол от предыдущей точки
    if (o.from) {
      // углы считаются от осей сетки (сетку можно повернуть)
      const ga = Tools.gridFrame().a;
      const ang = G.angle(o.from, p), L = G.dist(o.from, p);
      const stepA = e && e.shiftKey ? 15 : 45;
      const rel = U.deg(ang) - ga;
      const snapped = Math.round(rel / stepA) * stepA;
      if ((e && e.shiftKey) || Math.abs(U.normDeg(rel - snapped)) < 4) {
        const len = doSnap ? U.round(L, Math.min(Tools.gridStep(), 5)) : L;
        q = G.add(o.from, G.fromAngle(U.rad(snapped + ga), len));
        const sn = ((snapped % 360) + 360) % 360;
        Tools.snapInfo = { p: q, kind: sn % 90 === 0 ? (ga ? 'по сетке' : 'ортогонально') : sn + '°' };
        return q;
      }
    }
    // выравнивание по осям сетки с существующими углами (в системе координат сетки)
    const al = [];
    for (const w of App.V.walls) if (!ex.has(w.id)) al.push(w.a, w.b);
    if (o.from) al.push(o.from);
    const lp = Tools.gL(p);
    let ax = null, ay = null;
    for (const v of al) {
      const lv = Tools.gL(v);
      if (Math.abs(lv.x - lp.x) < tol && (!ax || Math.abs(lv.x - lp.x) < Math.abs(ax.l.x - lp.x))) ax = { v, l: lv };
      if (Math.abs(lv.y - lp.y) < tol && (!ay || Math.abs(lv.y - lp.y) < Math.abs(ay.l.y - lp.y))) ay = { v, l: lv };
    }
    let lq = { ...lp };
    if (doSnap && !o.noGrid) { const g = Tools.gridStep(); lq = { x: U.round(lp.x, g), y: U.round(lp.y, g) }; }
    if (ax) lq.x = ax.l.x;
    if (ay) lq.y = ay.l.y;
    q = Tools.gW(lq);
    if (ax) Tools.guides.push([ax.v, Tools.gW({ x: ax.l.x, y: lq.y })]);
    if (ay) Tools.guides.push([ay.v, Tools.gW({ x: lq.x, y: ay.l.y })]);
    return q;
  },

  /* ------------------------------ хит-тест ------------------------------- */
  layerOn(id) { return App.doc.settings.layers[id] !== false; },
  itemDrawSize(it) { const def = catItem(it.key); let w = it.w, d = it.d; if (def.sym) { const k = Math.max(1, def.sym / Math.max(w, d)); w *= k; d *= k; } return { w, d }; },
  hitTest(p, opts = {}) {
    const tol = Tools.tol();
    const L = App.doc.settings.layers;
    // примечания (экранные прямоугольники)
    if (L.notes !== false && !opts.noNotes) {
      const sp = View.toScreen(p);
      for (let i = Render._noteRects.length - 1; i >= 0; i--) {
        const { id, r } = Render._noteRects[i];
        if (sp.x >= r.x0 && sp.x <= r.x1 && sp.y >= r.y0 && sp.y <= r.y1 && Model.get(id)) return id;
      }
    }
    // проёмы
    if (L.walls) for (const op of App.V.openings) {
      const g = Model.opGeom(op); if (!g) continue;
      const pr = G.proj(p, g.a, g.b);
      if (pr.t >= -0.02 && pr.t <= 1.02 && pr.perp <= g.th / 2 + tol) return op.id;
    }
    // точка внутри тела стены — стена приоритетнее прилегающей мебели
    const inWall = L.walls && App.V.walls.some(w => G.proj(p, w.a, w.b).d <= w.th / 2 && G.proj(p, w.a, w.b).t >= 0 && G.proj(p, w.a, w.b).t <= 1);
    // предметы: наименьший содержащий
    let bestIt = null, bestA = Infinity;
    for (const it of App.V.items) {
      if (L[catItem(it.key).layer] === false) continue;
      const { w, d } = Tools.itemDrawSize(it);
      const lp = G.toLocal(p, it.x, it.y, it.rot);
      const t = catItem(it.key).sym ? tol : inWall ? -0.5 : tol * 0.4;
      if (Math.abs(lp.x) <= w / 2 + t && Math.abs(lp.y) <= d / 2 + t) {
        const a = w * d;
        if (a < bestA) { bestA = a; bestIt = it; }
      }
    }
    const bigItem = bestIt && bestA > 150 * 150 * 4;   // крупные постройки — ниже стен
    if (bestIt && !bigItem) return bestIt.id;
    if (L.dims) {
      for (const d of App.V.dims) {
        const n = G.perp(G.unit(G.sub(d.b, d.a)));
        const A = G.add(d.a, G.mul(n, d.off || 0)), B = G.add(d.b, G.mul(n, d.off || 0));
        if (G.distSeg(p, A, B) < tol) return d.id;
      }
      for (const t of App.V.texts) {
        const s = t.size || 30, len = String(t.text || '').length * s * 0.3 + s / 2;
        const lp = G.toLocal(p, t.x, t.y, t.rot || 0);
        if (Math.abs(lp.x) < len + tol && Math.abs(lp.y) < s * 0.7 + tol) return t.id;
      }
    }
    for (const l of App.V.lines) {
      if (L[LINE_KINDS[l.kind].layer] === false) continue;
      for (let i = 0; i < l.pts.length - 1; i++) if (G.distSeg(p, l.pts[i], l.pts[i + 1]) < tol) return l.id;
    }
    if (L.walls) for (const w of App.V.walls) {
      const pr = G.proj(p, w.a, w.b);
      if (pr.d <= w.th / 2 + tol * 0.5) return w.id;
    }
    if (bestIt) return bestIt.id;
    if (L.roof !== false) for (const r of App.V.roofs) {
      if (r.floor !== App.floor) continue;
      const pts = G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0);
      for (let i = 0; i < 4; i++) if (G.distSeg(p, pts[i], pts[(i + 1) % 4]) < tol) return r.id;
      for (const [a, b] of Roof.planLines(r)) if (G.distSeg(p, a, b) < tol) return r.id;
    }
    if (L.site) for (let k = App.V.roads.length - 1; k >= 0; k--) {
      const r = App.V.roads[k];
      for (let i = 0; i < r.pts.length - 1; i++) if (G.distSeg(p, r.pts[i], r.pts[i + 1]) <= r.width / 2 + tol * 0.3) return r.id;
    }
    if (L.site) {
      // зоны (кроме границы участка) — по попаданию внутрь; участок — по контуру
      let bestA2 = Infinity, bestArea = null;
      for (const a of App.V.areas) {
        const n = a.pts.length;
        for (let i = 0; i < n; i++) if (G.distSeg(p, a.pts[i], a.pts[(i + 1) % n]) < tol) return a.id;
        if (a.kind !== 'plot' && G.pointInPoly(p, a.pts)) { const ar = Math.abs(G.polyArea(a.pts)); if (ar < bestA2) { bestA2 = ar; bestArea = a; } }
      }
      if (bestArea && !opts.noAreas) {
        const r = L.rooms ? Rooms.at(p) : null;
        if (!r || Math.abs(G.polyArea(r.axis)) > bestA2) return bestArea.id;
      }
    }
    if (L.rooms && !opts.noRooms) { const r = Rooms.at(p); if (r) return r.id; }
    const u = App.doc.underlay;
    if (u && !u.locked && u.visible && L.underlay && Underlay.img && G.pointInPoly(p, Underlay.corners())) return 'underlay';
    return null;
  },
  isRoom(id) { return typeof id === 'string' && App.rooms.some(r => r.id === id); },

  /* ------------------------------- ручки --------------------------------- */
  handles() {
    if (Tools.cur !== 'select' || (Tools.st.mode && Tools.st.mode !== 'handle')) return Tools.cur === 'select' && Tools.st.mode === 'handle' ? Tools._handlesCache || [] : [];
    const ids = [...App.sel].filter(id => Model.get(id));
    const hs = [];
    const px = 1 / View.scale;
    if (ids.length === 1) {
      const id = ids[0], o = Model.get(id), c = Model.coll(id);
      if (c === 'walls') { hs.push({ kind: 'end', p: o.a, key: 'a', id }, { kind: 'end', p: o.b, key: 'b', id }); }
      else if (c === 'lines' || c === 'areas' || c === 'roads') {
        o.pts.forEach((p, i) => hs.push({ kind: 'vertex', p, idx: i, id }));
        Tools.pushRotate(hs, ids);
      }
      else if (c === 'openings') { const g = Model.opGeom(o); if (g) hs.push({ kind: 'owidth', p: g.a, key: 'a', id }, { kind: 'owidth', p: g.b, key: 'b', id }); }
      else if (c === 'dims') { const n = G.perp(G.unit(G.sub(o.b, o.a))); hs.push({ kind: 'end', p: o.a, key: 'a', id }, { kind: 'end', p: o.b, key: 'b', id }, { kind: 'doff', p: G.add(G.mid(o.a, o.b), G.mul(n, o.off || 0)), id }); }
      else if (c === 'items' || c === 'roofs') {
        const def = c === 'items' ? catItem(o.key) : {};
        const { w, d } = c === 'items' ? Tools.itemDrawSize(o) : o;
        if (!def.sym) {
          const map = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
          for (const [k, [sx, sy]] of Object.entries(map)) hs.push({ kind: 'resize', key: k, sx, sy, p: G.toWorld({ x: sx * o.w / 2, y: sy * o.d / 2 }, o.x, o.y, o.rot), id });
        }
        const top = G.toWorld({ x: 0, y: -d / 2 }, o.x, o.y, o.rot);
        hs.push({ kind: 'rotate', p: G.toWorld({ x: 0, y: -d / 2 - 26 * px }, o.x, o.y, o.rot), from: top, center: { x: o.x, y: o.y }, id });
      }
      else if (c === 'texts') Tools.pushRotate(hs, ids);
    } else if (ids.length > 1) Tools.pushRotate(hs, ids);
    if (App.sel.has('underlay') && App.doc.underlay && Underlay.img) {
      const cs = Underlay.corners(), u = App.doc.underlay;
      cs.forEach((p, i) => hs.push({ kind: 'uscale', p, idx: i }));
      const topMid = G.mid(cs[0], cs[1]);
      const dir = G.unit(G.sub(topMid, u));
      hs.push({ kind: 'urotate', p: G.add(topMid, G.mul(dir, 26 * px)), from: topMid, center: { x: u.x, y: u.y } });
      hs[hs.length - 1].kind = 'rotate'; hs[hs.length - 1].underlay = true;
    }
    Tools._handlesCache = hs;
    return hs;
  },
  pushRotate(hs, ids) {
    const b = Model.bboxOf(Model.expandForTransform(ids));
    if (!b) return;
    const px = 1 / View.scale;
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    hs.push({ kind: 'rotate', p: { x: c.x, y: b.y0 - 28 * px }, from: { x: c.x, y: b.y0 }, center: c, group: true });
  },
  handleAt(sp) {
    for (const h of Tools.handles()) {
      if (h.id && Model.get(h.id) && Model.get(h.id).locked) continue;
      const s = View.toScreen(h.p);
      if (Math.hypot(s.x - sp.x, s.y - sp.y) <= 8) return h;
    }
    return null;
  },

  /* ------------------------ сохранение/восстановление -------------------- */
  saveObjs(ids) { const m = new Map(); for (const id of ids) { const o = Model.get(id); if (o) m.set(id, U.clone(o)); } return m; },
  restoreObjs(m) { for (const [id, snap] of m) { const o = Model.get(id); if (o) { for (const k of Object.keys(o)) if (!(k in snap)) delete o[k]; Object.assign(o, U.clone(snap)); } } },

  /* ---------------------------- события мыши ----------------------------- */
  down(e, sp, p) {
    Tools.mouse = sp; Tools.mouseW = p;
    const t = Tools.cur;
    if (e.button === 2) { Tools.rightClick(e, sp, p); return; }
    if (t === 'select') return Tools.selDown(e, sp, p);
    if (t === 'wall') return Tools.wallClick(e, p);
    if (t === 'room' || t === 'roof') return Tools.roomDown(e, p);
    if (t === 'door' || t === 'window') return Tools.openingClick(e, p);
    if (t === 'line' || t === 'road') return Tools.lineClick(e, p);
    if (t === 'area') return Tools.areaDown(e, p);
    if (t === 'dim') return Tools.dimClick(e, p);
    if (t === 'measure') return Tools.measureClick(e, p);
    if (t === 'text') return Tools.textClick(e, p);
    if (t === 'note') return Tools.noteClick(e, p);
    if (t === 'place') return Tools.placeClick(e, p);
    if (t === 'calib') return Tools.calibClick(e, p);
  },
  move(e, sp, p) {
    Tools.mouse = sp; Tools.mouseW = p;
    const t = Tools.cur;
    if (t === 'select') Tools.selMove(e, sp, p);
    else if ((t === 'room' || t === 'roof') && Tools.st.a) Tools.st.b = Tools.snap(p, e, {});
    else if (t === 'area' && Tools.st.rect && Tools.st.a) Tools.st.b = Tools.snap(p, e, {});
    else Tools.st.cursor = p;
    App.redraw();
    UI.status(p);
  },
  up(e, sp, p) {
    const t = Tools.cur;
    if (t === 'select') Tools.selUp(e, sp, p);
    else if ((t === 'room' || t === 'roof') && Tools.st.a && Tools.st.dragged) Tools.roomFinish(Tools.st.a, Tools.snap(p, e, {}));
    else if (t === 'area' && Tools.st.rect && Tools.st.a && Tools.st.dragged) Tools.areaRectFinish(Tools.st.a, Tools.snap(p, e, {}));
    App.redraw();
  },
  dbl(e, sp, p) {
    const t = Tools.cur;
    if (t === 'wall') { Tools.st = {}; App.redraw(); return; }
    if (t === 'line' || t === 'road') { Tools.finishLine(); return; }
    if (t === 'area') { Tools.finishArea(); return; }
    if (t === 'measure') { Tools.st = {}; App.redraw(); return; }
    if (t === 'select') {
      const id = Tools.hitTest(p);
      const c = Model.coll(id);
      if (c === 'lines' || c === 'areas' || c === 'roads') Tools.editVertex(Model.get(id), p, c === 'areas');
      else if (Tools.isRoom(id)) UI.focusField('roomName');
      else if (c === 'texts') UI.focusField('text');
    }
  },
  rightClick(e, sp, p) {
    const t = Tools.cur;
    if (t === 'wall' && Tools.st.last) { Tools.st = {}; App.redraw(); return; }
    if ((t === 'line' || t === 'road') && Tools.st.pts) { Tools.finishLine(); return; }
    if (t === 'area' && Tools.st.pts) { Tools.finishArea(); return; }
    if (t === 'measure' || t === 'dim' || t === 'room' || t === 'roof') { Tools.st = {}; App.redraw(); return; }
    if (t === 'place') { Tools.set('select'); return; }
    if (t !== 'select') { Tools.set('select'); }
    const id = Tools.hitTest(p);
    if (id && !App.sel.has(id)) { App.sel.clear(); App.sel.add(id); App.selChanged(); }
    UI.contextMenu(sp, p, id);
  },

  /* ------------------------------ выделение ------------------------------ */
  selDown(e, sp, p) {
    const h = Tools.handleAt(sp);
    if (h) { Tools.beginHandle(h, p, e); return; }
    // компас: вращение стрелки севера
    const cr = Render.compassRect();
    if (Math.hypot(sp.x - cr.x, sp.y - cr.y) <= cr.r) { Tools.st = { mode: 'north', start: sp }; return; }
    const id = Tools.hitTest(p);
    const room = Tools.isRoom(id);
    if (!id || room || (Model.coll(id) === 'areas' && Model.get(id).kind === 'plot' && !App.sel.has(id))) {
      Tools.st = { mode: 'box', start: p, sp, id, shift: e.shiftKey, moved: false };
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (App.sel.has(id)) { Tools.st = { mode: 'toggle', id }; return; }
      App.sel.add(id);
    } else if (!App.sel.has(id)) { App.sel.clear(); App.sel.add(id); }
    App.selChanged();
    const ids = [...App.sel].filter(x => (Model.get(x) && !Model.get(x).locked) || x === 'underlay');
    const c = Model.coll(id);
    if (Model.get(id) && Model.get(id).locked) { Tools.st = {}; return; }   // закреплённый объект не двигается
    if (c === 'openings' && ids.length === 1) { Tools.st = { mode: 'opening', id, start: p, moved: false, orig: Tools.saveObjs([id]) }; return; }
    Tools.st = { mode: 'move', ids, start: p, last: p, moved: false, orig: null, grab: id };
  },
  selMove(e, sp, p) {
    const st = Tools.st;
    if (!st.mode) {
      const id = Tools.hitTest(p);
      const hh = Tools.handleAt(sp);
      if (App.hover !== id) { App.hover = id; }
      UI.hoverTip(hh || (e.buttons & 1) ? null : id, sp);
      App.canvas.style.cursor = hh ? (hh.kind === 'rotate' ? 'grab' : 'pointer') : id && !Tools.isRoom(id) ? 'move' : 'default';
      return;
    }
    if (st.mode === 'north') {
      const cr = Render.compassRect();
      const a = U.deg(Math.atan2(sp.x - cr.x, -(sp.y - cr.y)));
      App.doc.north = e.shiftKey ? U.round(U.normDeg(a), 15) : Math.round(U.normDeg(a));
      st.moved = true; UI.syncSun(); return;
    }
    if (st.mode === 'box') { st.cur = p; st.moved = st.moved || G.dist(View.toScreen(st.start), sp) > 3; return; }
    if (st.mode === 'toggle') return;
    if (st.mode === 'handle') return Tools.dragHandle(e, p);
    if (st.mode === 'opening') {
      if (!st.moved && G.dist(View.toScreen(st.start), sp) < 3) return;
      st.moved = true;
      const op = Model.get(st.id);
      const hit = Model.nearestWall(p, 40 / View.scale);
      if (hit) {
        op.wall = hit.w.id;
        const L = Model.wallLen(hit.w);
        let pos = hit.pr.t * L;
        if (App.doc.settings.snap && !e.altKey) pos = U.round(pos, 5);
        op.pos = U.clamp(pos, op.w / 2, L - op.w / 2);
      }
      App.changedLive();
      return;
    }
    if (st.mode === 'move') {
      if (!st.moved && G.dist(View.toScreen(st.start), sp) < 3) return;
      if (!st.moved) { st.moved = true; st.orig = Tools.saveObjs(Tools.movableIds(st.ids)); st.origU = App.doc.underlay ? { x: App.doc.underlay.x, y: App.doc.underlay.y } : null; st.origAll = Model.snapshot(); }
      let dx = p.x - st.start.x, dy = p.y - st.start.y;
      const ids = Model.expandForTransform(st.ids).filter(id => id !== 'underlay');
      // одиночная стена — скольжение поперёк себя
      if (ids.length === 1 && Model.coll(ids[0]) === 'walls' && !e.shiftKey) {
        const w = Model.get(ids[0]); const n = G.perp(Model.wallDir(w));
        const k = dx * n.x + dy * n.y; dx = n.x * k; dy = n.y * k;
      }
      // привязка: сетка по сдвигу (Alt — без привязки)
      if (App.doc.settings.snap && !e.altKey) {
        const g = Tools.gridStep();
        if (ids.length === 1 && Model.coll(ids[0]) === 'walls') {
          const w0 = st.orig.get(ids[0]); const n = G.perp(G.unit(G.sub(w0.b, w0.a)));
          const k = U.round(dx * n.x + dy * n.y, g); dx = n.x * k; dy = n.y * k;
        } else { dx = U.round(dx, g); dy = U.round(dy, g); }
      }
      // восстановить исходное и применить полный сдвиг
      Model.restore(st.origAll);
      Model.translate(ids, dx, dy);
      if (App.sel.has('underlay') && st.origU) { App.doc.underlay.x = st.origU.x + dx; App.doc.underlay.y = st.origU.y + dy; }
      // прилипание настенных предметов
      if (ids.length === 1 && Model.coll(ids[0]) === 'items' && !e.altKey) {
        const it = Model.get(ids[0]);
        if (WALL_MOUNT.has(catItem(it.key).shape)) { const s = Tools.wallSnapItem(it, it, false); if (s) Object.assign(it, s); }
      }
      st.dx = dx; st.dy = dy;
      App.changedLive();
    }
  },
  selUp(e, sp, p) {
    const st = Tools.st;
    Tools.st = {};
    if (st.mode === 'north') { if (st.moved) Model.commit(); return; }
    if (st.mode === 'box') {
      if (!st.moved) {
        App.sel.clear();
        if (st.id) App.sel.add(st.id);
        App.selChanged();
        return;
      }
      const b = { x0: Math.min(st.start.x, p.x), y0: Math.min(st.start.y, p.y), x1: Math.max(st.start.x, p.x), y1: Math.max(st.start.y, p.y) };
      const crossing = p.x < st.start.x;
      if (!st.shift) App.sel.clear();
      for (const id of Model.allIds()) {
        const o = Model.get(id), c = Model.coll(id);
        if (c === 'items' && !Tools.layerOn(catItem(o.key).layer)) continue;
        if (c === 'lines' && !Tools.layerOn(LINE_KINDS[o.kind].layer)) continue;
        if ((c === 'areas' || c === 'roads') && !Tools.layerOn('site')) continue;
        if (c === 'walls' && !Tools.layerOn('walls')) continue;
        if ((c === 'dims' || c === 'texts') && !Tools.layerOn('dims')) continue;
        const pts = Model.objPts(id);
        if (!pts.length) continue;
        const bb = G.bbox(pts);
        const inside = bb.x0 >= b.x0 && bb.x1 <= b.x1 && bb.y0 >= b.y0 && bb.y1 <= b.y1;
        const cross = !(bb.x1 < b.x0 || bb.x0 > b.x1 || bb.y1 < b.y0 || bb.y0 > b.y1);
        if (inside || (crossing && cross)) App.sel.add(id);
      }
      App.selChanged();
      return;
    }
    if (st.mode === 'toggle') { App.sel.delete(st.id); App.selChanged(); return; }
    if (st.mode === 'handle' || st.mode === 'opening' || st.mode === 'move') {
      if (st.moved) Model.commit();
    }
  },
  movableIds(ids) { return ids.filter(id => Model.get(id)); },

  /* ----------------------------- ручки: drag ----------------------------- */
  beginHandle(h, p, e) {
    const st = { mode: 'handle', h, start: p, moved: false, origAll: Model.snapshot() };
    if (h.kind === 'end' && Model.coll(h.id) === 'walls') {
      const w = Model.get(h.id);
      st.attached = Model.wallEndsAt(w[h.key], new Set([w.id]), 0.5).map(r => ({ id: r.w.id, end: r.end }));
    }
    if (h.kind === 'rotate') {
      st.a0 = Math.atan2(p.y - h.center.y, p.x - h.center.x);
      st.ids = h.underlay ? [] : Model.expandForTransform([...App.sel].filter(id => Model.get(id) && !Model.get(id).locked));
      if (h.underlay) st.u0 = { ...App.doc.underlay };
    }
    if (h.kind === 'uscale') st.u0 = { ...App.doc.underlay };
    Tools.st = st;
    void e;
  },
  dragHandle(e, p) {
    const st = Tools.st, h = st.h;
    st.moved = true;
    Model.restore(st.origAll);
    if (h.underlay || h.kind === 'uscale') {
      const u = App.doc.underlay;
      if (h.kind === 'uscale') {
        const d0 = G.dist(st.start, st.u0), d1 = G.dist(p, st.u0);
        u.scale = st.u0.scale * (d1 / (d0 || 1));
      } else {
        let da = U.deg(Math.atan2(p.y - h.center.y, p.x - h.center.x) - st.a0);
        if (e.shiftKey) da = U.round(da, 15); else da = Math.round(da * 2) / 2;
        u.rot = U.normDeg(st.u0.rot + da);
        st.angle = da;
      }
      App.redraw(); return;
    }
    if (h.kind === 'rotate') {
      let da = U.deg(Math.atan2(p.y - h.center.y, p.x - h.center.x) - st.a0);
      da = U.normDeg(da);
      if (e.shiftKey) da = U.round(da, 15); else if (!e.altKey) da = Math.round(da);
      st.angle = da;
      const ids = h.group ? st.ids : [h.id];
      Model.rotate(ids, h.center, da);
      App.changedLive(); return;
    }
    const o = Model.get(h.id), c = Model.coll(h.id);
    if (!o) return;
    if (h.kind === 'end' && c === 'walls') {
      const other = h.key === 'a' ? o.b : o.a;
      const ex = new Set([o.id, ...(st.attached || []).map(a => a.id)]);
      const q = Tools.snap(p, e, { from: other, exclude: ex });
      o[h.key].x = q.x; o[h.key].y = q.y;
      for (const a of st.attached || []) { const w = Model.get(a.id); if (w) { w[a.end].x = q.x; w[a.end].y = q.y; } }
    } else if (h.kind === 'end' && c === 'dims') {
      const q = Tools.snap(p, e, { faces: true, exclude: new Set([o.id]) });
      o[h.key].x = q.x; o[h.key].y = q.y;
    } else if (h.kind === 'doff') {
      const n = G.perp(G.unit(G.sub(o.b, o.a)));
      o.off = Math.round(G.dot(G.sub(p, o.a), n));
    } else if (h.kind === 'vertex') {
      const prev = o.pts[h.idx - 1] || (c === 'areas' ? o.pts[o.pts.length - 1] : null);
      const q = Tools.snap(p, e, { from: prev, exclude: new Set([o.id]), items: c === 'lines', faces: true });
      o.pts[h.idx].x = q.x; o.pts[h.idx].y = q.y;
    } else if (h.kind === 'owidth') {
      const g = Model.opGeom(o);
      const s = G.dot(G.sub(p, g.w.a), g.u);
      const fixed = h.key === 'a' ? g.pos + g.width / 2 : g.pos - g.width / 2;
      let nw = Math.abs(fixed - s);
      if (!e.altKey) nw = U.round(nw, 5);
      nw = U.clamp(nw, 30, g.L);
      o.w = nw;
      o.pos = h.key === 'a' ? fixed - nw / 2 : fixed + nw / 2;
    } else if (h.kind === 'resize') {
      const lp = G.toLocal(p, o.x, o.y, o.rot);
      const orig = JSON.parse(st.origAll);
      const oo = orig[c].find(x => x.id === o.id);
      const hw = oo.w / 2, hd = oo.d / 2;
      // зафиксированная противоположная сторона
      const fx = -h.sx * hw, fy = -h.sy * hd;
      let nw = h.sx ? Math.abs(lp.x - fx) : oo.w;
      let nd = h.sy ? Math.abs(lp.y - fy) : oo.d;
      if (!e.altKey && App.doc.settings.snap) { nw = U.round(nw, 1); nd = U.round(nd, 1); }
      if (e.shiftKey && h.sx && h.sy) { const k = Math.max(nw / oo.w, nd / oo.d); nw = oo.w * k; nd = oo.d * k; }
      nw = Math.max(nw, 5); nd = Math.max(nd, 5);
      const cx = h.sx ? fx + h.sx * nw / 2 : 0, cy = h.sy ? fy + h.sy * nd / 2 : 0;
      const wc = G.toWorld({ x: cx, y: cy }, oo.x, oo.y, oo.rot);
      o.w = nw; o.d = nd; o.x = wc.x; o.y = wc.y;
    }
    App.changedLive();
  },

  /** Вставка/удаление вершины двойным кликом */
  editVertex(o, p, closed) {
    const tol = Tools.tol();
    const idx = o.pts.findIndex(q => G.dist(q, p) < tol);
    if (idx >= 0) {
      if (o.pts.length > (closed ? 3 : 2)) { o.pts.splice(idx, 1); if (o.edges) o.edges.splice(idx, 1); Model.commit(); UI.toast('Точка удалена'); }
      return;
    }
    const n = o.pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = o.pts[i], b = o.pts[(i + 1) % n];
      const pr = G.proj(p, a, b);
      if (pr.d < tol) { o.pts.splice(i + 1, 0, { x: pr.q.x, y: pr.q.y }); if (o.edges) o.edges.splice(i + 1, 0, o.edges[i] || 'auto'); Model.commit(); UI.toast('Точка добавлена'); return; }
    }
  },

  /* -------------------------------- стены -------------------------------- */
  wallDefaults() { const k = Tools.opts.wallKind; return { kind: k, ...App.doc.defaults.wall[k] }; },
  wallClick(e, p) {
    const st = Tools.st;
    const q = Tools.snap(p, e, { from: st.last });
    if (!st.last) { st.last = q; st.first = q; st.count = 0; App.redraw(); return; }
    Tools.addWall(st.last, q);
  },
  addWall(a, b) {
    const st = Tools.st;
    if (G.dist(a, b) < 1) return;
    Model.add('walls', { ...Tools.wallDefaults(), a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    st.count = (st.count || 0) + 1;
    Model.commit();
    if (st.first && G.dist(b, st.first) < 0.5 && st.count > 1) { Tools.st = {}; UI.toast('Контур замкнут'); }
    else st.last = { x: b.x, y: b.y };
    Tools.input = ''; UI.setInput('');
    App.redraw();
  },
  /** Ввод длины/размеров с клавиатуры */
  typedInput(s) {
    const t = Tools.cur, st = Tools.st;
    if ((t === 'wall' && st.last) || ((t === 'line' || t === 'road') && st.pts) || (t === 'area' && st.pts && !Tools.opts.areaRect) || (t === 'measure' && st.pts)) {
      const L = U.parseLen(s);
      if (!(L > 0)) { UI.toast('Не понял длину: ' + s, 'err'); return; }
      const from = t === 'wall' ? st.last : st.pts[st.pts.length - 1];
      const cur = st.cursor || G.add(from, { x: 1, y: 0 });
      let dir = G.unit(G.sub(cur, from));
      if (!Number.isFinite(dir.x) || G.dist(cur, from) < 0.01) dir = { x: 1, y: 0 };
      // берём угол как у предпросмотра (с привязкой)
      const sp = Tools.snap(cur, null, { from });
      if (G.dist(sp, from) > 0.01) dir = G.unit(G.sub(sp, from));
      const q = G.add(from, G.mul(dir, L));
      if (t === 'wall') Tools.addWall(from, q);
      else { st.pts.push(q); Tools.input = ''; UI.setInput(''); App.redraw(); }
      return;
    }
    if ((t === 'room' || t === 'roof' || (t === 'area' && Tools.opts.areaRect)) && st.a) {
      const m = s.toLowerCase().replace(/\s+/g, ' ').split(/[x×х*; ]+/).filter(Boolean);
      if (m.length !== 2) { UI.toast('Введите размеры как 400x300', 'err'); return; }
      const W = U.parseLen(m[0]), H = U.parseLen(m[1]);
      if (!(W > 0 && H > 0)) { UI.toast('Не понял размеры', 'err'); return; }
      const la = Tools.gL(st.a), b = Tools.gW({ x: la.x + W, y: la.y + H });
      if (t === 'room' || t === 'roof') Tools.roomFinish(st.a, b); else Tools.areaRectFinish(st.a, b);
      return;
    }
    UI.toast('Сначала укажите начальную точку на плане');
  },

  roomDown(e, p) {
    const st = Tools.st;
    const q = Tools.snap(p, e, {});
    if (!st.a) { Tools.st = { a: q, b: q, dragged: false }; App.redraw(); return; }
    Tools.roomFinish(st.a, q);
  },
  roomFinish(a, b) {
    const R = Tools.gridRect(a, b);
    if (R.w < 20 || R.h < 20) { Tools.st = {}; App.redraw(); return; }
    if (Tools.cur === 'roof') {
      let w = R.w, d = R.h, rot = R.rot;
      if (d > w) { [w, d] = [d, w]; rot += 90; }
      Tools.st = {};
      App.addRoof({ x: R.c.x, y: R.c.y, w, d, rot: U.normDeg(rot) });
      return;
    }
    const c = R.pts;
    const d = Tools.wallDefaults();
    for (let i = 0; i < 4; i++) Model.add('walls', { ...d, a: { ...c[i] }, b: { ...c[(i + 1) % 4] } });
    Tools.st = {};
    Model.commit();
    UI.toast(`Комната ${U.fmtLen(R.w)} × ${U.fmtLen(R.h)} (по осям)`);
  },

  /* ------------------------------- проёмы -------------------------------- */
  openingPreview(p) {
    const isDoor = Tools.cur === 'door';
    const o = Tools.opts;
    const type = isDoor ? o.doorType : o.winType;
    const width = isDoor ? o.doorW : o.winW;
    const hit = Model.nearestWall(p, 50 / View.scale);
    if (!hit) return null;
    const w = hit.w, L = Model.wallLen(w);
    if (L < width + 2) return { w, bad: true };
    let pos = hit.pr.t * L;
    if (App.doc.settings.snap) pos = U.round(pos, 5);
    pos = U.clamp(pos, width / 2, L - width / 2);
    const n = G.perp(Model.wallDir(w));
    const side = G.dot(G.sub(p, hit.pr.q), n) >= 0 ? 1 : -1;
    const hinge = hit.pr.t * L < pos ? 0 : 1;
    return {
      w, op: {
        id: '_preview', wall: w.id, type, pos, w: width, side, hinge: isDoor ? hinge : 0,
        h: isDoor ? o.doorH : o.winH, sill: isDoor ? 0 : (OPENING_TYPES[type].sill === 0 ? 0 : o.winSill),
      },
    };
  },
  openingClick(e, p) {
    const pv = Tools.openingPreview(p);
    if (!pv) { UI.toast('Кликните по стене'); return; }
    if (pv.bad) { UI.toast('Стена короче проёма', 'err'); return; }
    const op = { ...pv.op }; delete op.id;
    // пересечение с существующими проёмами
    const g0 = [op.pos - op.w / 2, op.pos + op.w / 2];
    for (const o2 of App.V.openings) if (o2.wall === op.wall) {
      if (o2.pos + o2.w / 2 > g0[0] && o2.pos - o2.w / 2 < g0[1]) { UI.toast('Здесь уже есть проём', 'err'); return; }
    }
    const obj = Model.add('openings', op);
    App.sel.clear(); App.sel.add(obj.id);
    Model.commit(); App.selChanged();
  },

  /* ------------------------------- трассы -------------------------------- */
  lineClick(e, p) {
    const st = Tools.st;
    const from = st.pts ? st.pts[st.pts.length - 1] : null;
    const road = Tools.cur === 'road';
    const q = Tools.snap(p, e, { from, items: !road, lines: !road });
    if (!st.pts) { Tools.st = { pts: [q] }; App.redraw(); return; }
    if (G.dist(q, from) < 0.5) return;
    st.pts.push(q);
    App.redraw();
  },
  finishLine() {
    const st = Tools.st;
    if (Tools.cur === 'road' && st.pts && st.pts.length >= 2) {
      const r = Model.add('roads', { kind: Tools.opts.roadKind, width: Tools.opts.roadW, pts: st.pts.map(p => ({ x: p.x, y: p.y })), name: '' });
      Model.commit();
      App.sel.clear(); App.sel.add(r.id); App.selChanged();
      UI.toast(`${ROAD_KINDS[r.kind].name}: ${U.fmtLen(G.polyPerimeter(r.pts, false))}. Название — в свойствах.`);
      UI.focusField('roadName');
    } else if (st.pts && st.pts.length >= 2) {
      const k = LINE_KINDS[Tools.opts.lineKind];
      const l = Model.add('lines', { kind: Tools.opts.lineKind, pts: st.pts.map(p => ({ x: p.x, y: p.y })), dia: k.dia, depth: k.depth, section: k.section || '' });
      Model.commit();
      App.sel.clear(); App.sel.add(l.id); App.selChanged();
      UI.toast(`${k.name}: ${U.fmtLen(G.polyPerimeter(l.pts, false))}`);
    }
    Tools.st = {}; Tools.input = ''; UI.setInput('');
    App.redraw();
  },

  /* ---------------------------- участок/зоны ----------------------------- */
  areaDown(e, p) {
    const st = Tools.st;
    if (Tools.opts.areaRect) {
      const q = Tools.snap(p, e, {});
      if (!st.a) { Tools.st = { rect: true, a: q, b: q, dragged: false }; return; }
      Tools.areaRectFinish(st.a, q); return;
    }
    const from = st.pts ? st.pts[st.pts.length - 1] : null;
    const q = Tools.snap(p, e, { from });
    if (!st.pts) { Tools.st = { pts: [q] }; App.redraw(); return; }
    if (st.pts.length >= 3 && G.dist(View.toScreen(q), View.toScreen(st.pts[0])) < 10) { Tools.finishArea(); return; }
    if (G.dist(q, from) < 0.5) return;
    st.pts.push(q);
    App.redraw();
  },
  areaRectFinish(a, b) {
    Tools.st = {};
    const R = Tools.gridRect(a, b);
    if (R.w < 20 || R.h < 20) { App.redraw(); return; }
    Tools.addArea(R.pts);
  },
  finishArea() {
    const st = Tools.st;
    if (st.pts && st.pts.length >= 3) Tools.addArea(st.pts);
    else if (st.pts) UI.toast('Нужно минимум 3 точки', 'err');
    Tools.st = {}; Tools.input = ''; UI.setInput('');
    App.redraw();
  },
  addArea(pts) {
    const kind = Tools.opts.areaKind;
    // по часовой (положительная площадь в y-вниз)
    if (G.polyArea(pts) < 0) pts = [...pts].reverse();
    const a = Model.add('areas', { kind, pts: pts.map(p => ({ x: p.x, y: p.y })), name: '' });
    Model.commit();
    App.sel.clear(); App.sel.add(a.id); App.selChanged();
    const ar = Math.abs(G.polyArea(a.pts));
    UI.toast(`${AREA_KINDS[kind].name}: ${(ar / 1e4).toFixed(1)} м²${kind === 'plot' ? ' (' + (ar / 1e6).toFixed(2) + ' сот.)' : ''}`);
  },

  /* ------------------------------- размеры ------------------------------- */
  dimClick(e, p) {
    const st = Tools.st;
    if (!st.a) { Tools.st = { a: Tools.snap(p, e, { faces: true }) }; return; }
    if (!st.b) { const b = Tools.snap(p, e, { faces: true, from: st.a }); if (G.dist(b, st.a) < 1) return; st.b = b; return; }
    const n = G.perp(G.unit(G.sub(st.b, st.a)));
    const off = Math.round(G.dot(G.sub(p, st.a), n));
    Model.add('dims', { a: { ...st.a }, b: { ...st.b }, off });
    Tools.st = {};
    Model.commit();
  },
  measureClick(e, p) {
    const st = Tools.st;
    const from = st.pts ? st.pts[st.pts.length - 1] : null;
    const q = Tools.snap(p, e, { faces: true, from, items: true });
    if (!st.pts || st.done) { Tools.st = { pts: [q] }; return; }
    if (st.pts.length >= 3 && G.dist(View.toScreen(q), View.toScreen(st.pts[0])) < 10) { st.pts.push({ ...st.pts[0] }); st.done = true; return; }
    st.pts.push(q);
  },
  textClick(e, p) {
    const t = Model.add('texts', { x: p.x, y: p.y, text: 'Надпись', size: 30, rot: 0 });
    Model.commit();
    Tools.set('select');
    App.sel.clear(); App.sel.add(t.id); App.selChanged();
    UI.focusField('text');
  },

  noteClick(e, p) {
    let id = Tools.hitTest(p, { noNotes: true });
    if (Tools.isRoom(id)) {
      const r = App.rooms.find(x => x.id === id);
      id = r.tag ? r.tag.id : Model.add('roomTags', { x: r.label.x, y: r.label.y, name: r.name }).id;
    }
    if (id === 'underlay') id = null;
    const n = App.addNote(id, p);
    Tools.set('select');
    App.sel.clear(); App.sel.add(n.id); App.selChanged();
    UI.focusField('note');
  },

  /* ----------------------------- размещение ------------------------------ */
  /** Прилипание предмета спинкой к ближайшей грани стены */
  wallSnapItem(p, it, rotate = true) {
    let best = null, bd = Infinity;
    const lim = Math.max(it.d / 2, 10) + 30 / View.scale;
    for (const w of App.V.walls) {
      if (w.kind === 'fence') continue;
      const pr = G.proj(p, w.a, w.b);
      if (pr.t < 0 || pr.t > 1) continue;
      const n = G.perp(Model.wallDir(w));
      const sd = G.dot(G.sub(p, pr.q), n);
      const gap = Math.abs(sd) - w.th / 2;
      if (gap < lim && gap < bd) { bd = gap; best = { w, pr, n, s: sd >= 0 ? 1 : -1 }; }
    }
    if (!best) return null;
    const { w, pr, n, s } = best;
    const toWall = G.mul(n, -s);
    let rot = U.deg(Math.atan2(toWall.x, -toWall.y));
    if (!rotate) {
      // оставляем текущий поворот, если спинка уже к стене
      const cur = G.toWorld({ x: 0, y: -1 }, 0, 0, it.rot || 0);
      if (G.dot(cur, toWall) < 0.95) return null;
      rot = it.rot;
    }
    const c = G.add(pr.q, G.mul(n, s * (w.th / 2 + it.d / 2)));
    return { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, rot: U.normDeg(rot) };
  },
  placePreview(p, e) {
    const def = catItem(Tools.opts.placeKey);
    if (!def) return null;
    const it = { id: '_preview', key: def.key, x: p.x, y: p.y, w: def.w, d: def.d, h: def.h, rot: Tools.opts.placeRot, flip: false };
    if (App.doc.settings.snap && !(e && e.altKey)) { const g = Tools.gridStep(); it.x = U.round(p.x, g); it.y = U.round(p.y, g); }
    if (!(e && e.altKey) && def.layer !== 'siteobj' && !['pole', 'lightpole'].includes(def.shape)) {
      const s = Tools.wallSnapItem(p, it, true);
      if (s) Object.assign(it, s);
    }
    return it;
  },
  placeClick(e, p) {
    const it = Tools.placePreview(p, e);
    if (!it) return;
    delete it.id;
    const def = catItem(it.key);
    if (def.label) it.label = undefined;
    const obj = Model.add('items', it);
    Model.commit();
    if (!e.shiftKey) { Tools.set('select'); App.sel.clear(); App.sel.add(obj.id); App.selChanged(); }
  },

  /* ------------------------------ калибровка ----------------------------- */
  calibClick(e, p) {
    const st = Tools.st;
    if (!st.a) { Tools.st = { a: p }; return; }
    const b = p;
    const d = G.dist(st.a, b);
    if (d < 1) return;
    const a = st.a;
    Tools.st = { a, b };
    App.redraw();
    // число без единиц — метры; можно и «600 см», «6000 мм»
    const parse = (s) => (/^\s*-?\d*[.,]?\d+\s*$/.test(s) ? U.num(s, NaN) * 100 : U.parseLen(s));
    UI.promptNumber('Калибровка подложки', 'Реальное расстояние между отмеченными точками (м, или «600 см»):', (d / 100).toFixed(2), (real) => {
      if (!(real > 0)) { UI.toast('Расстояние должно быть больше нуля', 'err'); Tools.set('select'); return; }
      const u = App.doc.underlay, k = real / d;
      u.scale *= k;
      u.x = a.x + (u.x - a.x) * k; u.y = a.y + (u.y - a.y) * k;
      Model.commit();
      UI.toast(`Масштаб подложки: 1 px = ${(u.scale * 10).toFixed(2)} мм`);
      Tools.set('select');
    }, () => Tools.set('select'), parse);
  },

  /* ------------------------------ клавиатура ----------------------------- */
  key(e) {
    const t = Tools.cur, st = Tools.st;
    const drawing = ((t === 'wall' && st.last) || ((t === 'line' || t === 'road') && st.pts) || (t === 'area' && (st.pts || st.a)) || ((t === 'room' || t === 'roof') && st.a) || (t === 'measure' && st.pts));
    if (drawing && /^[0-9.,xх×*мmсcм ]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !(e.key === ' ' && !Tools.input)) {
      Tools.input += e.key; UI.setInput(Tools.input); e.preventDefault(); return true;
    }
    if (drawing && e.key === 'Backspace') {
      if (Tools.input) { Tools.input = Tools.input.slice(0, -1); UI.setInput(Tools.input); }
      else if (t === 'line' || t === 'road' || t === 'area' || t === 'measure') { st.pts.pop(); if (!st.pts.length) Tools.st = {}; App.redraw(); }
      e.preventDefault(); return true;
    }
    if (e.key === 'Enter') {
      if (Tools.input) { Tools.typedInput(Tools.input); e.preventDefault(); return true; }
      if (t === 'line' || t === 'road') { Tools.finishLine(); return true; }
      if (t === 'area') { Tools.finishArea(); return true; }
      if (t === 'wall') { Tools.st = {}; App.redraw(); return true; }
    }
    if (e.key === 'Escape') {
      if (Tools.input) { Tools.input = ''; UI.setInput(''); return true; }
      if ((t === 'line' || t === 'road') && st.pts) { Tools.finishLine(); return true; }
      if (t === 'area' && st.pts) { Tools.finishArea(); return true; }
      if (Object.keys(st).length) { Tools.st = {}; App.redraw(); return true; }
      if (t !== 'select') { Tools.set('select'); return true; }
      if (App.sel.size) { App.sel.clear(); App.selChanged(); return true; }
    }
    if (t === 'place' && (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К')) {
      Tools.opts.placeRot = U.normDeg(Tools.opts.placeRot + (e.shiftKey ? -90 : 90)); App.redraw(); return true;
    }
    return false;
  },

  /* ------------------------------ оверлей -------------------------------- */
  drawOverlay(ctx, env) {
    const { px, C } = env;
    const t = Tools.cur, st = Tools.st;
    const cur = Tools.mouseW;
    const dot = (p, color = C.accent, r = 3.5) => { ctx.beginPath(); ctx.arc(p.x, p.y, r * px, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
    const seg = (a, b, dash) => { ctx.setLineDash(dash ? dash.map(v => v * px) : []); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
    ctx.save();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5 * px;
    const e = App.lastEvent;
    const lenLabel = (a, b) => Render.label(env, U.fmtLen(G.dist(a, b)) + (Tools.input ? '' : ''), G.add(G.mid(a, b), G.mul(G.perp(G.unit(G.sub(b, a))), -14 * px)), G.angle(a, b), { size: 11, bold: true, color: C.accent, bg: true, pad: 2 });
    if (t === 'wall') {
      const q = Tools.snap(cur, e, { from: st.last });
      if (st.last) {
        const d = Tools.wallDefaults();
        const pv = { a: st.last, b: q, th: d.th };
        if (G.dist(pv.a, pv.b) > 0.5) {
          Render.polyPath(ctx, Model.wallRect(pv)); ctx.fillStyle = C.accentSoft; ctx.fill(); ctx.stroke();
          lenLabel(st.last, q);
          const ang = U.normDeg(-U.deg(G.angle(st.last, q)));
          Render.label(env, Math.round(ang) + '°', G.add(q, { x: 16 * px, y: 16 * px }), 0, { size: 10, color: C.muted, bg: true, pad: 2 });
        }
      }
      Tools.drawSnapMark(env, q);
    } else if (t === 'roof') {
      const q = st.a ? st.b : Tools.snap(cur, e, {});
      if (st.a && st.b) {
        const r = Tools.gridRect(st.a, st.b).pts;
        Render.polyPath(ctx, r); ctx.fillStyle = C.accentSoft; ctx.fill(); ctx.setLineDash([8 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([]);
        lenLabel(r[0], r[1]); lenLabel(r[1], r[2]);
      }
      Tools.drawSnapMark(env, q);
    } else if (t === 'room') {
      const q = st.a ? st.b : Tools.snap(cur, e, {});
      if (st.a && st.b) {
        const a = st.a, b = st.b;
        const R = Tools.gridRect(a, b), r = R.pts;
        const th = Tools.wallDefaults().th;
        ctx.lineWidth = th; ctx.strokeStyle = C.accentSoft; Render.polyPath(ctx, r); ctx.stroke();
        ctx.lineWidth = 1.2 * px; ctx.strokeStyle = C.accent; Render.polyPath(ctx, r); ctx.stroke();
        lenLabel(r[0], r[1]); lenLabel(r[1], r[2]);
        const inner = { w: R.w - th, h: R.h - th };
        if (inner.w > 0 && inner.h > 0) Render.label(env, `внутри ${U.fmtLen(inner.w)} × ${U.fmtLen(inner.h)} = ${U.fmtArea(inner.w * inner.h)}`, G.mid(a, b), 0, { size: 11, color: C.accent, bg: true });
      }
      Tools.drawSnapMark(env, q);
    } else if (t === 'door' || t === 'window') {
      const pv = Tools.openingPreview(cur);
      if (pv && pv.op) {
        const tmp = pv.op;
        App.V.openings.push(tmp);
        ctx.globalAlpha = 0.8;
        Render.opening(env, tmp);
        ctx.globalAlpha = 1;
        App.V.openings.pop();
        const g = Model.opGeom(tmp);
        if (g) {
          Render.polyPath(ctx, [G.add(g.a, G.mul(g.n, g.th / 2)), G.add(g.b, G.mul(g.n, g.th / 2)), G.sub(g.b, G.mul(g.n, g.th / 2)), G.sub(g.a, G.mul(g.n, g.th / 2))]);
          ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5 * px; ctx.stroke();
          Render.openingGuides(env, tmp);
        }
      } else if (pv && pv.bad) {
        Render.polyPath(ctx, Model.wallRect(pv.w)); ctx.strokeStyle = C.dim; ctx.stroke();
      }
    } else if (t === 'road') {
      const pts = st.pts || [];
      const last = pts[pts.length - 1];
      const q = Tools.snap(cur, e, { from: last });
      const all = pts.concat([q]);
      if (all.length >= 2) {
        ctx.lineJoin = 'round';
        Render.polyPath(ctx, all, false); ctx.strokeStyle = C.accentSoft; ctx.lineWidth = Tools.opts.roadW; ctx.stroke();
        Render.polyPath(ctx, all, false); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5 * px; ctx.setLineDash([8 * px, 5 * px]); ctx.stroke(); ctx.setLineDash([]);
        for (let i = 0; i < all.length - 1; i++) lenLabel(all[i], all[i + 1]);
      }
      Tools.drawSnapMark(env, q);
    } else if (t === 'line' || t === 'area' || t === 'measure') {
      const color = t === 'line' ? LINE_KINDS[Tools.opts.lineKind].color : t === 'area' ? AREA_KINDS[Tools.opts.areaKind].stroke : C.dim;
      ctx.strokeStyle = color;
      if (t === 'area' && Tools.opts.areaRect) {
        if (st.a && st.b) {
          const R = Tools.gridRect(st.a, st.b), r = R.pts;
          Render.polyPath(ctx, r); ctx.stroke(); lenLabel(r[0], r[1]); lenLabel(r[1], r[2]);
          const ar = R.w * R.h;
          Render.label(env, `${(ar / 1e4).toFixed(1)} м² · ${(ar / 1e6).toFixed(2)} сот.`, G.mid(st.a, st.b), 0, { size: 12, bold: true, color, bg: true });
        }
        Tools.drawSnapMark(env, st.a ? st.b : Tools.snap(cur, e, {}));
      } else {
        const pts = st.pts || [];
        const last = pts[pts.length - 1];
        const q = st.done ? null : Tools.snap(cur, e, { from: last, items: t !== 'area', faces: t !== 'line', lines: t === 'line' });
        const all = q ? pts.concat([q]) : pts;
        if (all.length >= 2) {
          ctx.lineWidth = 2 * px;
          if (t === 'measure') ctx.setLineDash([6 * px, 4 * px]);
          Render.polyPath(ctx, all, t === 'area' && all.length >= 3);
          ctx.stroke(); ctx.setLineDash([]);
          if (t === 'area' && all.length >= 3) { ctx.fillStyle = AREA_KINDS[Tools.opts.areaKind].fill; ctx.fill(); }
          for (let i = 0; i < all.length - 1; i++) lenLabel(all[i], all[i + 1]);
        }
        for (const p of pts) dot(p, color);
        if (pts.length) {
          const total = G.polyPerimeter(all, false);
          const lines = [];
          if (t !== 'area' && all.length > 2) lines.push('Сумма: ' + U.fmtLen(total));
          if (t === 'measure' && all.length >= 2) {
            const a = all[all.length - 2], b = all[all.length - 1];
            lines.push('Азимут: ' + Math.round(Sun.bearingOf(G.sub(b, a))) + '° (' + U.compass16(Sun.bearingOf(G.sub(b, a))) + ')');
          }
          if ((t === 'measure' || t === 'area') && all.length >= 3) lines.push('Площадь: ' + U.fmtArea(Math.abs(G.polyArea(all))));
          const anchor = all[all.length - 1];
          lines.forEach((s, i) => Render.label(env, s, G.add(anchor, { x: 20 * px, y: (22 + i * 17) * px }), 0, { size: 11, bold: i === 0, color, bg: true, pad: 3 }));
        }
        if (q) Tools.drawSnapMark(env, q);
      }
    } else if (t === 'dim') {
      const q = Tools.snap(cur, e, { faces: true, from: st.a && !st.b ? st.a : null });
      if (st.a && !st.b) { seg(st.a, q, [4, 3]); lenLabel(st.a, q); }
      if (st.a && st.b) {
        const n = G.perp(G.unit(G.sub(st.b, st.a)));
        Render.dimLine(env, st.a, st.b, G.dot(G.sub(cur, st.a), n), null, C.dim);
      }
      Tools.drawSnapMark(env, q);
    } else if (t === 'place') {
      const it = Tools.placePreview(cur, e);
      if (it) {
        ctx.globalAlpha = 0.75; Render.item(env, it); ctx.globalAlpha = 1;
        Render.polyPath(ctx, G.rectPts(it.x, it.y, Tools.itemDrawSize(it).w, Tools.itemDrawSize(it).d, it.rot)); ctx.strokeStyle = C.accent; ctx.setLineDash([4 * px, 3 * px]); ctx.stroke(); ctx.setLineDash([]);
        Render.itemGuides(env, it);
      }
    } else if (t === 'calib') {
      if (st.a) { dot(st.a, C.dim, 5); const b = st.b || cur; ctx.strokeStyle = C.dim; seg(st.a, b, [6, 4]); dot(b, C.dim, 5); lenLabel(st.a, b); }
    } else if (t === 'select' && st.mode === 'box' && st.moved && st.cur) {
      const a = st.start, b = st.cur;
      const crossing = b.x < a.x;
      ctx.fillStyle = C.accentSoft; ctx.setLineDash(crossing ? [5 * px, 4 * px] : []);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
    } else if (t === 'select' && st.mode === 'handle') {
      const h = st.h;
      if (h.kind === 'rotate' && st.angle !== undefined) Render.label(env, (st.angle > 0 ? '+' : '') + st.angle + '°', G.add(h.center, { x: 0, y: -40 * px }), 0, { size: 12, bold: true, color: C.accent, bg: true });
      if (h.kind === 'end' && Model.coll(h.id) === 'walls') { const w = Model.get(h.id); if (w) { lenLabel(w.a, w.b); Tools.drawSnapMark(env, w[h.key]); } }
      if (h.kind === 'vertex') Tools.drawSnapMark(env, Model.get(h.id)?.pts[h.idx]);
      if (h.kind === 'resize') { const it = Model.get(h.id); if (it) Render.label(env, `${Math.round(it.w)} × ${Math.round(it.d)} см`, G.add(it, { x: 0, y: 0 }), 0, { size: 12, bold: true, color: C.accent, bg: true }); }
    } else if (t === 'select' && st.mode === 'move' && st.moved && st.dx !== undefined) {
      Render.label(env, `Δ ${U.fmtLen(Math.hypot(st.dx, st.dy))}`, G.add(cur, { x: 18 * px, y: 22 * px }), 0, { size: 11, color: C.accent, bg: true });
    }
    // направляющие выравнивания
    if (Tools.guides.length && t !== 'select') {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 0.8 * px;
      for (const [a, b] of Tools.guides) seg(a, b, [3, 4]);
    }
    if (Tools.input) Render.label(env, '⌨ ' + Tools.input + ' ↵', G.add(cur, { x: 22 * px, y: -20 * px }), 0, { size: 13, bold: true, color: C.accent, bg: true, pad: 4, border: C.accent });
    ctx.restore();
  },
  drawSnapMark(env, q) {
    if (!q) return;
    const { ctx, px, C } = env;
    const s = Tools.snapInfo;
    ctx.save();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.4 * px;
    if (s && s.kind !== 'ортогонально' && !/°$/.test(s.kind)) {
      ctx.strokeRect(q.x - 5 * px, q.y - 5 * px, 10 * px, 10 * px);
      Render.label(env, s.kind, G.add(q, { x: 0, y: 16 * px }), 0, { size: 10, color: C.accent, bg: true, pad: 2 });
    } else {
      ctx.beginPath(); ctx.moveTo(q.x - 6 * px, q.y); ctx.lineTo(q.x + 6 * px, q.y); ctx.moveTo(q.x, q.y - 6 * px); ctx.lineTo(q.x, q.y + 6 * px); ctx.stroke();
    }
    ctx.restore();
  },
};

/* ============================ ВВОД (указатель) =========================== */
const Input = {
  pointers: new Map(),
  pan: null, pinch: null, space: false, rightDown: null,
  init(cv) {
    cv.addEventListener('pointerdown', Input.down);
    cv.addEventListener('pointermove', Input.move);
    cv.addEventListener('pointerup', Input.up);
    cv.addEventListener('pointercancel', Input.up);
    cv.addEventListener('pointerleave', () => { UI.hideTip(); if (!Input.pointers.size) { App.hover = null; App.redraw(); } });
    cv.addEventListener('dblclick', (e) => { const sp = Input.sp(e); Tools.dbl(e, sp, View.toWorld(sp)); });
    cv.addEventListener('wheel', Input.wheel, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  sp(e) { const r = App.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
  down(e) {
    UI.hideMenu(); UI.hideTip();
    // снять фокус с полей панели, чтобы она обновилась под новое выделение
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    App.canvas.setPointerCapture(e.pointerId);
    const sp = Input.sp(e);
    Input.pointers.set(e.pointerId, sp);
    App.lastEvent = e;
    if (Input.pointers.size === 2) {
      // жест: отменяем текущую операцию, начинаем щипок
      if (Tools.st.mode) { if (Tools.st.origAll) Model.restore(Tools.st.origAll); Tools.st = {}; }
      const [a, b] = [...Input.pointers.values()];
      Input.pinch = { d: G.dist(a, b), c: G.mid(a, b) };
      return;
    }
    if (e.button === 1 || (e.button === 0 && (Input.space || Tools.cur === 'pan'))) {
      Input.pan = { sp, ox: View.ox, oy: View.oy };
      App.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button === 2) { Input.rightDown = { sp, ox: View.ox, oy: View.oy, moved: false, e }; return; }
    Tools.down(e, sp, View.toWorld(sp));
  },
  move(e) {
    const sp = Input.sp(e);
    App.lastEvent = e;
    if (Input.pointers.has(e.pointerId)) Input.pointers.set(e.pointerId, sp);
    if (Input.pinch && Input.pointers.size === 2) {
      const [a, b] = [...Input.pointers.values()];
      const d = G.dist(a, b), c = G.mid(a, b);
      View.ox -= (c.x - Input.pinch.c.x) / View.scale; View.oy -= (c.y - Input.pinch.c.y) / View.scale;
      if (Input.pinch.d > 10) View.zoomAt(c, d / Input.pinch.d);
      Input.pinch = { d, c };
      App.redraw();
      return;
    }
    if (Input.pan) {
      View.ox = Input.pan.ox - (sp.x - Input.pan.sp.x) / View.scale;
      View.oy = Input.pan.oy - (sp.y - Input.pan.sp.y) / View.scale;
      App.redraw(); return;
    }
    if (Input.rightDown) {
      const r = Input.rightDown;
      if (r.moved || G.dist(sp, r.sp) > 4) {
        r.moved = true;
        View.ox = r.ox - (sp.x - r.sp.x) / View.scale; View.oy = r.oy - (sp.y - r.sp.y) / View.scale;
        App.canvas.style.cursor = 'grabbing';
        App.redraw(); return;
      }
    }
    Tools.move(e, sp, View.toWorld(sp));
  },
  up(e) {
    const sp = Input.sp(e);
    Input.pointers.delete(e.pointerId);
    if (Input.pinch) { if (Input.pointers.size < 2) Input.pinch = null; return; }
    if (Input.pan) { Input.pan = null; App.canvas.style.cursor = ''; return; }
    if (Input.rightDown) {
      const r = Input.rightDown; Input.rightDown = null;
      App.canvas.style.cursor = '';
      if (!r.moved) Tools.down(r.e, r.sp, View.toWorld(r.sp));
      return;
    }
    // протяжка прямоугольника (комната/зона) завершается отпусканием кнопки
    if ((Tools.cur === 'room' || Tools.cur === 'roof' || (Tools.cur === 'area' && Tools.st.rect)) && Tools.st.a) Tools.st.dragged = G.dist(View.toScreen(Tools.st.a), sp) > 8;
    Tools.up(e, sp, View.toWorld(sp));
  },
  wheel(e) {
    e.preventDefault();
    UI.hideTip();
    const sp = Input.sp(e);
    if (e.shiftKey && !e.ctrlKey) { View.ox += (e.deltaY || e.deltaX) / View.scale; App.redraw(); return; }
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    View.zoomAt(sp, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
  },
};
