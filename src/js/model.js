'use strict';
/* ==========================================================================
   Модель документа, индекс, история (undo/redo), трансформации.
   ========================================================================== */

const DOC_VERSION = 1;
const COLLECTIONS = ['areas', 'roads', 'walls', 'openings', 'items', 'lines', 'dims', 'texts', 'roomTags', 'notes'];

const Model = {
  newDoc() {
    return {
      app: 'floorplaner',
      version: DOC_VERSION,
      name: 'Новый проект',
      north: 0,                       // куда смотрит «север» — угол по часовой от верха экрана, °
      geo: { lat: 55.75, lon: 37.62, tz: 3, city: 'Москва' },
      settings: {
        units: 'm', grid: 10, snap: true, showWallDims: true, showItemDims: false,
        areaMode: 'floor',
        layers: Object.fromEntries(LAYERS.map(l => [l.id, !['heat', 'shadows'].includes(l.id)])),
      },
      defaults: {
        wall: U.clone(Object.fromEntries(Object.entries(WALL_KINDS).map(([k, v]) => [k, { th: v.th, h: v.h }]))),
      },
      areas: [], roads: [], walls: [], openings: [], items: [], lines: [], dims: [], texts: [], roomTags: [], notes: [],
      underlay: null,
    };
  },

  /** Приведение загруженного документа к актуальной схеме */
  normalize(raw) {
    const d = Model.newDoc();
    if (!raw || typeof raw !== 'object') return d;
    d.name = typeof raw.name === 'string' ? raw.name : d.name;
    d.north = U.isNum(raw.north) ? raw.north : 0;
    if (raw.geo) Object.assign(d.geo, raw.geo);
    if (raw.settings) {
      const L = Object.assign({}, d.settings.layers, raw.settings.layers || {});
      Object.assign(d.settings, raw.settings);
      d.settings.layers = L;
    }
    if (raw.defaults && raw.defaults.wall) for (const k of Object.keys(d.defaults.wall)) Object.assign(d.defaults.wall[k], raw.defaults.wall[k] || {});
    for (const c of COLLECTIONS) d[c] = Array.isArray(raw[c]) ? raw[c].filter(o => o && typeof o === 'object').map(o => ({ ...o, id: o.id || U.uid() })) : [];
    // валидация
    d.walls = d.walls.filter(w => w.a && w.b && U.isNum(w.a.x) && U.isNum(w.b.x));
    for (const w of d.walls) { w.kind = WALL_KINDS[w.kind] ? w.kind : 'ext'; w.th = U.isNum(w.th) ? w.th : WALL_KINDS[w.kind].th; w.h = U.isNum(w.h) ? w.h : WALL_KINDS[w.kind].h; }
    const wallIds = new Set(d.walls.map(w => w.id));
    d.openings = d.openings.filter(o => wallIds.has(o.wall));
    for (const o of d.openings) { const t = OPENING_TYPES[o.type] || OPENING_TYPES.door; o.type = OPENING_TYPES[o.type] ? o.type : 'door'; o.w = o.w || t.w; o.h = o.h || t.h; o.sill = o.sill ?? t.sill; o.side = o.side === -1 ? -1 : 1; o.hinge = o.hinge ? 1 : 0; }
    for (const it of d.items) { it.rot = it.rot || 0; const def = catItem(it.key); it.w = it.w || def.w; it.d = it.d || def.d; it.h = it.h ?? def.h; }
    d.lines = d.lines.filter(l => Array.isArray(l.pts) && l.pts.length >= 2);
    for (const l of d.lines) if (!LINE_KINDS[l.kind]) l.kind = 'water';
    d.areas = d.areas.filter(a => Array.isArray(a.pts) && a.pts.length >= 3);
    const isPt = (p) => p && U.isNum(p.x) && U.isNum(p.y);
    d.lines = d.lines.filter(l => l.pts.every(isPt));
    d.areas = d.areas.filter(a => a.pts.every(isPt));
    d.dims = d.dims.filter(o => isPt(o.a) && isPt(o.b));
    d.roads = d.roads.filter(r => Array.isArray(r.pts) && r.pts.length >= 2 && r.pts.every(isPt));
    for (const r of d.roads) { if (!ROAD_KINDS[r.kind]) r.kind = 'road'; r.width = U.isNum(r.width) && r.width > 0 ? r.width : ROAD_KINDS[r.kind].width; }
    d.texts = d.texts.filter(isPt);
    d.roomTags = d.roomTags.filter(isPt);
    d.items = d.items.filter(isPt);
    d.notes = d.notes.filter(n => n.target || isPt(n));
    for (const a of d.areas) if (!AREA_KINDS[a.kind]) a.kind = 'zone';
    if (raw.underlay && raw.underlay.src) d.underlay = Object.assign({ x: 0, y: 0, scale: 1, rot: 0, opacity: 0.5, visible: true, locked: true, front: false }, raw.underlay);
    return d;
  },

  /* ------------------------------ индекс --------------------------------- */
  reindex() {
    const m = new Map();
    for (const c of COLLECTIONS) for (const o of App.doc[c]) m.set(o.id, { o, c });
    App.index = m;
  },
  get(id) { const r = App.index.get(id); return r ? r.o : null; },
  coll(id) { const r = App.index.get(id); return r ? r.c : null; },

  add(coll, obj) {
    obj.id = obj.id || U.uid(coll[0]);
    App.doc[coll].push(obj);
    App.index.set(obj.id, { o: obj, c: coll });
    return obj;
  },
  remove(ids) {
    const set = new Set(ids);
    // вместе со стеной удаляются её проёмы
    for (const o of App.doc.openings) if (set.has(o.wall)) set.add(o.id);
    // примечания удалённых объектов остаются на месте, но «отвязываются»
    for (const n of App.doc.notes) if (n.target && set.has(n.target) && !set.has(n.id)) {
      const p = Model.notePos(n); n.x = p.x; n.y = p.y; delete n.target; delete n.dx; delete n.dy;
    }
    for (const c of COLLECTIONS) App.doc[c] = App.doc[c].filter(o => !set.has(o.id));
    for (const id of set) App.sel.delete(id);
    Model.reindex();
  },

  /* ------------------------------ история -------------------------------- */
  _undo: [], _redo: [], _srcCache: new Map(),
  snapshot() {
    const d = App.doc;
    if (d.underlay && d.underlay.src) Model._srcCache.set(d.underlay.id || 'u', d.underlay.src);
    return JSON.stringify(d, (k, v) => (k === 'src' ? undefined : v));
  },
  restore(snap) {
    const d = JSON.parse(snap);
    if (d.underlay) d.underlay.src = Model._srcCache.get(d.underlay.id || 'u') || null;
    if (d.underlay && !d.underlay.src) d.underlay = null;
    App.doc = d;
    // «underlay» и помещения — не объекты коллекций, их выделение сохраняем
    for (const id of [...App.sel]) if (id !== 'underlay' && !App.rooms.some(r => r.id === id) && !Model.findIn(d, id)) App.sel.delete(id);
    Model.reindex();
  },
  findIn(d, id) { for (const c of COLLECTIONS) if (d[c].some(o => o.id === id)) return true; return false; },
  resetHistory() { Model._undo = [Model.snapshot()]; Model._redo = []; },
  /** Зафиксировать изменение: снимок в историю + пересчёты */
  commit() {
    const s = Model.snapshot();
    if (Model._undo[Model._undo.length - 1] !== s) {
      Model._undo.push(s);
      if (Model._undo.length > 150) Model._undo.shift();
      Model._redo = [];
    }
    App.changed();
  },
  undo() {
    if (Model._undo.length < 2) return false;
    Model._redo.push(Model._undo.pop());
    Model.restore(Model._undo[Model._undo.length - 1]);
    App.changed();
    return true;
  },
  redo() {
    if (!Model._redo.length) return false;
    const s = Model._redo.pop();
    Model._undo.push(s);
    Model.restore(s);
    App.changed();
    return true;
  },

  /* ------------------------------ геометрия объектов --------------------- */
  /** Точка привязки примечания к объекту */
  anchorOf(id) {
    const o = Model.get(id), c = Model.coll(id);
    if (!o) return null;
    switch (c) {
      case 'walls': return G.mid(o.a, o.b);
      case 'items': case 'texts': case 'roomTags': return { x: o.x, y: o.y };
      case 'openings': { const g = Model.opGeom(o); return g ? g.c : null; }
      case 'roads':
      case 'lines': { const i = Math.floor((o.pts.length - 1) / 2); return G.mid(o.pts[i], o.pts[Math.min(i + 1, o.pts.length - 1)]); }
      case 'areas': return G.labelPoint(o.pts);
      case 'dims': return G.mid(o.a, o.b);
    }
    return null;
  },
  /** Контур дороги (для bbox/выделения): точки осевой, смещённые на половину ширины */
  roadOutline(r) {
    const out = [];
    const h = r.width / 2;
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
      const n = G.perp(G.unit(G.sub(b, a)));
      out.push(G.add(r.pts[i], G.mul(n, h)), G.sub(r.pts[i], G.mul(n, h)));
    }
    return out;
  },
  noteAnchor(n) { return n.target ? Model.anchorOf(n.target) : null; },
  notePos(n) {
    const a = Model.noteAnchor(n);
    return a ? { x: a.x + (n.dx || 0), y: a.y + (n.dy || 0) } : { x: n.x || 0, y: n.y || 0 };
  },
  wallLen: (w) => G.dist(w.a, w.b),
  wallDir: (w) => G.unit(G.sub(w.b, w.a)),
  wallRect(w, extra = 0) {
    const u = Model.wallDir(w), n = G.perp(u), h = w.th / 2 + extra;
    return [G.add(w.a, G.mul(n, h)), G.add(w.b, G.mul(n, h)), G.sub(w.b, G.mul(n, h)), G.sub(w.a, G.mul(n, h))];
  },
  /** Геометрия проёма: центр, направление, нормаль, края */
  opGeom(op) {
    const w = Model.get(op.wall);
    if (!w) return null;
    const L = Model.wallLen(w), u = Model.wallDir(w), n = G.perp(u);
    const width = Math.min(op.w, Math.max(L - 2, 10));
    const pos = U.clamp(op.pos, width / 2, Math.max(width / 2, L - width / 2));
    const c = G.add(w.a, G.mul(u, pos));
    return { w, L, u, n, pos, width, c, a: G.sub(c, G.mul(u, width / 2)), b: G.add(c, G.mul(u, width / 2)), th: w.th };
  },
  itemPts(it) { return G.rectPts(it.x, it.y, it.w, it.d, it.rot); },
  /** Опорные точки объекта (для bbox, поворота, привязки) */
  objPts(id) {
    const o = Model.get(id), c = Model.coll(id);
    if (!o) return [];
    switch (c) {
      case 'walls': return Model.wallRect(o);
      case 'items': return Model.itemPts(o);
      case 'lines': case 'areas': return o.pts;
      case 'roads': return Model.roadOutline(o);
      case 'dims': return [o.a, o.b];
      case 'texts': case 'roomTags': return [{ x: o.x, y: o.y }];
      case 'notes': return [Model.notePos(o)];
      case 'openings': { const g = Model.opGeom(o); return g ? [g.a, g.b] : []; }
    }
    return [];
  },
  bboxOf(ids) {
    let b = null;
    for (const id of ids) { const p = Model.objPts(id); if (p.length) b = G.bboxUnion(b, G.bbox(p)); }
    return b;
  },
  contentBBox() {
    const d = App.doc;
    let b = null;
    for (const c of COLLECTIONS) for (const o of d[c]) { const p = Model.objPts(o.id); if (p.length) b = G.bboxUnion(b, G.bbox(p)); }
    if (d.underlay && d.underlay.src && d.underlay.visible && Underlay.img) b = G.bboxUnion(b, G.bbox(Underlay.corners()));
    return b;
  },
  allIds() { const r = []; for (const c of COLLECTIONS) for (const o of App.doc[c]) if (c !== 'openings') r.push(o.id); return r; },

  /** Концы стен (кроме своих), совпадающие с точкой */
  wallEndsAt(p, excludeIds, tol = 1) {
    const out = [];
    for (const w of App.doc.walls) {
      if (excludeIds && excludeIds.has(w.id)) continue;
      if (G.dist(w.a, p) <= tol) out.push({ w, end: 'a' });
      if (G.dist(w.b, p) <= tol) out.push({ w, end: 'b' });
    }
    return out;
  },

  /* ------------------------------ трансформации -------------------------- */
  /** Сдвиг набора объектов. Концы стен, не входящих в набор, но примыкающих — тянутся следом. */
  translate(ids, dx, dy, opts = {}) {
    const set = new Set(ids);
    const mv = (p) => { p.x += dx; p.y += dy; };
    const movedPts = new Set();
    const wallIds = new Set(ids.filter(id => Model.coll(id) === 'walls'));
    for (const id of ids) {
      const o = Model.get(id), c = Model.coll(id);
      if (!o) continue;
      if (c === 'walls') {
        for (const end of ['a', 'b']) {
          if (movedPts.has(o[end])) continue;
          if (opts.stretch !== false) {
            for (const r of Model.wallEndsAt(o[end], wallIds, 0.5)) if (!movedPts.has(r.w[r.end])) { mv(r.w[r.end]); movedPts.add(r.w[r.end]); }
          }
          mv(o[end]); movedPts.add(o[end]);
        }
      } else if (c === 'items' || c === 'texts' || c === 'roomTags') { o.x += dx; o.y += dy; }
      else if (c === 'notes') {
        if (o.target && Model.get(o.target)) { if (!set.has(o.target)) { o.dx = (o.dx || 0) + dx; o.dy = (o.dy || 0) + dy; } }
        else { o.x = (o.x || 0) + dx; o.y = (o.y || 0) + dy; }
      }
      else if (c === 'lines' || c === 'areas' || c === 'roads') o.pts.forEach(mv);
      else if (c === 'dims') { mv(o.a); mv(o.b); }
    }
    return set;
  },
  rotate(ids, center, deg) {
    const a = U.rad(deg);
    const rp = (p) => { const q = G.rotate(p, center, a); p.x = q.x; p.y = q.y; };
    const done = new Set();
    for (const id of ids) {
      const o = Model.get(id), c = Model.coll(id);
      if (!o) continue;
      if (c === 'walls') { for (const e of ['a', 'b']) if (!done.has(o[e])) { rp(o[e]); done.add(o[e]); } }
      else if (c === 'items') { rp(o); o.rot = U.normDeg((o.rot || 0) + deg); }
      else if (c === 'texts') { rp(o); o.rot = U.normDeg((o.rot || 0) + deg); }
      else if (c === 'roomTags') rp(o);
      else if (c === 'notes') { if (!o.target) rp(o); }
      else if (c === 'lines' || c === 'areas' || c === 'roads') o.pts.forEach(rp);
      else if (c === 'dims') { rp(o.a); rp(o.b); }
    }
  },
  /** Зеркало относительно вертикальной (axis='x') или горизонтальной (axis='y') оси через center */
  mirror(ids, center, axis) {
    const mp = (p) => { if (axis === 'x') p.x = 2 * center.x - p.x; else p.y = 2 * center.y - p.y; };
    const done = new Set();
    const walls = new Set();
    for (const id of ids) {
      const o = Model.get(id), c = Model.coll(id);
      if (!o) continue;
      if (c === 'walls') { walls.add(o.id); for (const e of ['a', 'b']) if (!done.has(o[e])) { mp(o[e]); done.add(o[e]); } }
      else if (c === 'items') { mp(o); o.rot = U.normDeg(axis === 'x' ? -o.rot : 180 - o.rot); o.flip = !o.flip; }
      else if (c === 'texts' || c === 'roomTags') mp(o);
      else if (c === 'notes') { if (!o.target) mp(o); }
      else if (c === 'lines' || c === 'areas' || c === 'roads') o.pts.forEach(mp);
      else if (c === 'dims') { mp(o.a); mp(o.b); o.off = -(o.off || 0); }
    }
    for (const op of App.doc.openings) if (walls.has(op.wall)) op.side = -op.side;
  },
  /** Выбор + связанные проёмы не нужны: проёмы следуют за стеной автоматически */
  expandForTransform(ids) { return ids.filter(id => Model.coll(id) !== 'openings'); },

  /** Разделить стену точкой (по параметру t) — проёмы переносятся */
  splitWall(w, t) {
    const L = Model.wallLen(w);
    const p = G.add(w.a, G.mul(G.sub(w.b, w.a), t));
    const w2 = Model.add('walls', { kind: w.kind, th: w.th, h: w.h, a: { ...p }, b: { ...w.b } });
    w.b = { ...p };
    const cut = L * t;
    for (const op of App.doc.openings) if (op.wall === w.id && op.pos > cut) { op.wall = w2.id; op.pos -= cut; }
    return w2;
  },

  /** Ближайшая стена к точке */
  nearestWall(p, maxDist, filter) {
    let best = null, bd = maxDist;
    for (const w of App.doc.walls) {
      if (filter && !filter(w)) continue;
      const pr = G.proj(p, w.a, w.b);
      const d = pr.d - w.th / 2;
      if (d < bd) { bd = d; best = { w, pr, d }; }
    }
    return best;
  },
};

/* ------------------------------- подложка -------------------------------- */
const Underlay = {
  img: null, _src: null,
  sync() {
    const u = App.doc.underlay;
    if (!u || !u.src) { Underlay.img = null; Underlay._src = null; return; }
    if (Underlay._src === u.src) return;
    Underlay._src = u.src;
    const img = new Image();
    img.onload = () => { Underlay.img = img; App.redraw(); };
    img.src = u.src;
  },
  corners() {
    const u = App.doc.underlay, img = Underlay.img;
    if (!u || !img) return [];
    const w = img.naturalWidth * u.scale, h = img.naturalHeight * u.scale;
    return G.rectPts(u.x, u.y, w, h, u.rot || 0);
  },
  set(src, name) {
    const img = new Image();
    img.onload = () => {
      // по умолчанию: 1 пиксель картинки = 1 см, центр — в центре экрана
      const c = View.toWorld({ x: App.cw / 2, y: App.ch / 2 });
      const fitScale = Math.min(App.cw, App.ch) * 0.8 / View.scale / Math.max(img.naturalWidth, img.naturalHeight);
      App.doc.underlay = { id: U.uid('u'), src, name: name || '', x: c.x, y: c.y, scale: fitScale, rot: 0, opacity: 0.5, visible: true, locked: false, front: false };
      App.doc.settings.layers.underlay = true;
      Underlay.img = img; Underlay._src = src;
      Model.commit();
      UI.toast('Подложка загружена. Откалибруйте масштаб по известному размеру.');
      UI.showTab('layers');
    };
    img.onerror = () => UI.toast('Не удалось открыть изображение', 'err');
    img.src = src;
  },
};
