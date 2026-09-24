'use strict';
/* ==========================================================================
   Чертежи: автоматические размерные цепочки по фасадам (проёмы/простенки
   и габарит), листы по этажам со штампом (упрощённо по ГОСТ 21.101).
   ========================================================================== */

const Drawing = {
  /** Размерные цепочки для этажа: [{a, b, off}] (как объекты размеров) */
  autoDims(fid, gap1 = 90, gap2 = 160) {
    const fd = (App.floorData || []).find(x => x.floor.id === fid);
    if (!fd || !fd.outlines.length) return [];
    const pts = fd.outlines.flatMap(o => o.outer);
    const rect = Roof.fromOutline(pts, 0);
    if (!rect) return [];
    // оси здания: u — вдоль длинной стороны, v — поперёк
    const ang = U.rad(rect.rot);
    const u = { x: Math.cos(ang), y: Math.sin(ang) }, v = G.perp(u);
    const S = (p) => G.dot(p, u), T = (p) => G.dot(p, v);
    const P = (s, t) => G.add(G.mul(u, s), G.mul(v, t));
    const ss = pts.map(S), ts = pts.map(T);
    const s0 = Math.min(...ss), s1 = Math.max(...ss), t0 = Math.min(...ts), t1 = Math.max(...ts);
    const tc = (t0 + t1) / 2, sc = (s0 + s1) / 2;
    const V = Model.viewOf(fid);
    const walls = V.walls.filter(w => w.kind === 'ext');
    const sides = { top: [], bottom: [], left: [], right: [] };
    for (const w of walls) {
      const dir = Model.wallDir(w);
      const alongU = Math.abs(G.dot(dir, u)) > 0.985, alongV = Math.abs(G.dot(dir, v)) > 0.985;
      if (!alongU && !alongV) continue;
      const rectW = Model.wallRect(w);
      const m = G.mid(w.a, w.b);
      const side = alongU ? (T(m) < tc ? 'top' : 'bottom') : (S(m) < sc ? 'left' : 'right');
      const coord = alongU ? S : T;
      const list = sides[side];
      for (const q of rectW) list.push(coord(q));
      for (const op of V.openings) if (op.wall === w.id) { const g = Model.opGeom(op); if (g) list.push(coord(g.a), coord(g.b)); }
    }
    const dims = [];
    const chain = (vals, lo, hi, mk) => {
      const xs = [...new Set(vals.filter(x => x >= lo - 1 && x <= hi + 1).map(x => Math.round(x)))].sort((a, b) => a - b);
      const merged = [];
      for (const x of xs) if (!merged.length || x - merged[merged.length - 1] > 2) merged.push(x);
      if (merged.length < 2) return;
      for (let i = 0; i < merged.length - 1; i++) dims.push(mk(merged[i], merged[i + 1]));
    };
    // сверху/снизу — вдоль u, слева/справа — вдоль v
    chain(sides.top, s0, s1, (a, b) => ({ a: P(a, t0), b: P(b, t0), off: -gap1 }));
    chain(sides.bottom, s0, s1, (a, b) => ({ a: P(a, t1), b: P(b, t1), off: gap1 }));
    chain(sides.left, t0, t1, (a, b) => ({ a: P(s0, a), b: P(s0, b), off: gap1 }));
    chain(sides.right, t0, t1, (a, b) => ({ a: P(s1, a), b: P(s1, b), off: -gap1 }));
    // габариты
    dims.push({ a: P(s0, t0), b: P(s1, t0), off: -gap2 }, { a: P(s0, t1), b: P(s1, t1), off: gap2 });
    dims.push({ a: P(s0, t0), b: P(s0, t1), off: gap2 }, { a: P(s1, t0), b: P(s1, t1), off: -gap2 });
    return dims.filter(d => G.dist(d.a, d.b) > 3);
  },
  /** Выполнить fn с временными авторазмерами на текущем виде этажа */
  withAutoDims(fid, fn) {
    const extra = Drawing.autoDims(fid).map((d, i) => ({ ...d, id: '_auto' + i, auto: true }));
    const saveDims = App.V.dims;
    App.V.dims = saveDims.concat(extra);
    try { return fn(); } finally { App.V.dims = saveDims; }
  },
  /** Выполнить fn на другом этаже (без записи в историю) */
  onFloor(fid, fn) {
    const saveF = App.floor, saveV = App.V, saveR = App.rooms, saveO = Rooms.outlines;
    App.floor = fid; App.V = Model.viewOf(fid);
    const fd = (App.floorData || []).find(x => x.floor.id === fid);
    if (fd) { App.rooms = fd.rooms; Rooms.outlines = fd.outlines; }
    try { return fn(); } finally { App.floor = saveF; App.V = saveV; App.rooms = saveR; Rooms.outlines = saveO; }
  },
  /** Проставить авторазмеры на текущем этаже как обычные (редактируемые) размеры */
  addToPlan() {
    const ds = Drawing.autoDims(App.floor);
    if (!ds.length) { UI.toast('Нужен замкнутый контур наружных стен на этом этаже', 'err'); return; }
    for (const d of ds) Model.add('dims', { a: { ...d.a }, b: { ...d.b }, off: d.off });
    Model.commit();
    UI.toast(`Проставлено размеров: ${ds.length}`);
  },
  /** Область листа для этажа: контур здания + размеры + участок (для первого этажа — всё) */
  regionFor(fid, all) {
    if (all) return IO.regionFor('all');
    const fd = (App.floorData || []).find(x => x.floor.id === fid);
    let b = null;
    if (fd) for (const o of fd.outlines) b = G.bboxUnion(b, G.bbox(o.outer));
    const V = Model.viewOf(fid);
    for (const w of V.walls) if (w.kind !== 'fence') b = G.bboxUnion(b, G.bbox([w.a, w.b]));
    if (!G.bboxValid(b)) return IO.regionFor('all');
    const pad = 300;
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  },
  sheetTitle(f) {
    const m = /^(\d+)\s*этаж$/i.exec(f.name.trim());
    return m ? `План ${m[1]}-го этажа` : `План: ${f.name}`;
  },

  /* ---- штамп в векторе (SVG/DXF): x, y, мм на листе → единицы чертежа ---- */
  vectorTitleBlock(ctx, x, y, k, info) {
    // k — единиц чертежа на 1 мм листа; штамп 185×40 мм
    const W = 185 * k, H = 40 * k;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5 * k;
    ctx.strokeRect(x - W, y - H, W, H);
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    line(x - W, y - H + 10 * k, x, y - H + 10 * k);
    line(x - W, y - H + 25 * k, x, y - H + 25 * k);
    line(x - 50 * k, y - H + 25 * k, x - 50 * k, y);
    line(x - 25 * k, y - H + 25 * k, x - 25 * k, y);
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const t = (s, tx, ty, size, bold) => { ctx.font = `${bold ? '600 ' : ''}${size * k}px Arial`; ctx.fillText(s, tx, ty); };
    t(info.project, x - W + 3 * k, y - H + 5 * k, 4.2, true);
    t(info.sheet, x - W + 3 * k, y - H + 17.5 * k, 5, true);
    t(info.note || '', x - W + 3 * k, y - H + 32.5 * k, 3, false);
    ctx.textAlign = 'center';
    t('Масштаб', x - 37.5 * k, y - H + 29 * k, 2.5); t(info.scale, x - 37.5 * k, y - H + 35 * k, 3.5, true);
    t('Лист', x - 12.5 * k, y - H + 29 * k, 2.5); t(info.page, x - 12.5 * k, y - H + 35 * k, 3.5, true);
    ctx.restore();
  },
};
