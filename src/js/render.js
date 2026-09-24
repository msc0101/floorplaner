'use strict';
/* ==========================================================================
   Темы, вид (масштаб/панорама) и отрисовка плана на Canvas 2D.
   ========================================================================== */

const Theme = {
  light: {
    bg: '#f6f7f9', paper: '#ffffff', gridMinor: 'rgba(40,60,90,.07)', gridMajor: 'rgba(40,60,90,.16)', gridAxis: 'rgba(40,60,90,.28)',
    ink: '#23272f', inkSoft: '#5b6371', muted: '#6b7482', itemFill: '#ffffff', hatch: 'rgba(60,70,90,.22)',
    wallExt: '#3d4452', wallInt: '#6c7483', wallPart: '#9aa2b0', wallStroke: '#15181e', fence: '#6b5a44',
    opening: '#ffffff', glass: 'rgba(140,200,240,.35)', accent: '#2f6fed', accentSoft: 'rgba(47,111,237,.12)',
    dim: '#b4232f', text: '#1f2430', tree: 'rgba(110,175,80,.45)', conifer: 'rgba(50,120,80,.5)', trunk: '#7a5230',
    soil: 'rgba(140,100,60,.25)', flower: 'rgba(230,120,170,.25)', water: 'rgba(80,160,235,.4)',
    shadow: 'rgba(30,40,80,.30)', roomText: '#1f2430', labelBg: 'rgba(255,255,255,.88)', handle: '#ffffff', halo: 'rgba(246,247,249,.85)', note: '#d98a00', noteBg: 'rgba(255,248,225,.96)',
    roomFill: ['rgba(79,140,255,.10)', 'rgba(95,200,160,.12)', 'rgba(255,180,84,.13)', 'rgba(214,95,190,.10)', 'rgba(140,210,90,.12)', 'rgba(90,200,220,.12)', 'rgba(240,120,120,.10)', 'rgba(170,140,255,.12)'],
  },
  dark: {
    bg: '#12161c', paper: '#171c23', gridMinor: 'rgba(200,215,235,.05)', gridMajor: 'rgba(200,215,235,.11)', gridAxis: 'rgba(200,215,235,.22)',
    ink: '#d9e0ea', inkSoft: '#9aa6b6', muted: '#8a96a8', itemFill: '#1e252e', hatch: 'rgba(200,210,230,.16)',
    wallExt: '#aab4c3', wallInt: '#7f8a9a', wallPart: '#5f6979', wallStroke: '#e6ebf2', fence: '#b89b72',
    opening: '#171c23', glass: 'rgba(110,180,240,.25)', accent: '#5b93ff', accentSoft: 'rgba(91,147,255,.16)',
    dim: '#ff7b86', text: '#e6ebf2', tree: 'rgba(110,175,80,.35)', conifer: 'rgba(60,140,90,.45)', trunk: '#a57a50',
    soil: 'rgba(160,120,80,.25)', flower: 'rgba(230,120,170,.22)', water: 'rgba(80,160,235,.35)',
    shadow: 'rgba(0,0,0,.42)', roomText: '#e6ebf2', labelBg: 'rgba(23,28,35,.88)', handle: '#171c23', halo: 'rgba(18,22,28,.85)', note: '#f0a830', noteBg: 'rgba(48,40,22,.95)',
    roomFill: ['rgba(79,140,255,.13)', 'rgba(95,200,160,.13)', 'rgba(255,180,84,.12)', 'rgba(214,95,190,.12)', 'rgba(140,210,90,.12)', 'rgba(90,200,220,.12)', 'rgba(240,120,120,.12)', 'rgba(170,140,255,.13)'],
  },
  mode: 'auto',
  C: null,
  init() {
    try { Theme.mode = localStorage.getItem('fp:theme') || 'auto'; } catch (e) { /* нет доступа */ }
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', () => Theme.mode === 'auto' && Theme.apply());
    Theme.apply();
  },
  isDark() {
    if (Theme.mode === 'dark') return true;
    if (Theme.mode === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  },
  set(mode) {
    Theme.mode = mode;
    try { localStorage.setItem('fp:theme', mode); } catch (e) { /* нет доступа */ }
    Theme.apply();
  },
  apply() {
    const dark = Theme.isDark();
    Theme.C = dark ? Theme.dark : Theme.light;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (typeof App !== 'undefined' && App.ctx) App.redraw();
    if (typeof UI !== 'undefined' && UI.syncTheme) UI.syncTheme();
  },
};

/* ------------------------------- вид ------------------------------------ */
const View = {
  ox: -500, oy: -400, scale: 0.6,          // scale — экранных px на 1 см
  MIN: 0.02, MAX: 12,
  toScreen(p) { return { x: (p.x - View.ox) * View.scale, y: (p.y - View.oy) * View.scale }; },
  toWorld(p) { return { x: p.x / View.scale + View.ox, y: p.y / View.scale + View.oy }; },
  zoomAt(sp, factor) {
    const w = View.toWorld(sp);
    View.scale = U.clamp(View.scale * factor, View.MIN, View.MAX);
    View.ox = w.x - sp.x / View.scale; View.oy = w.y - sp.y / View.scale;
    App.redraw(); UI.updateZoom();
  },
  fit(b, pad = 60) {
    if (!G.bboxValid(b)) b = { x0: -500, y0: -400, x1: 500, y1: 400 };
    const w = Math.max(b.x1 - b.x0, 100), h = Math.max(b.y1 - b.y0, 100);
    View.scale = U.clamp(Math.min((App.cw - pad * 2) / w, (App.ch - pad * 2) / h), View.MIN, View.MAX);
    View.ox = (b.x0 + b.x1) / 2 - App.cw / 2 / View.scale;
    View.oy = (b.y0 + b.y1) / 2 - App.ch / 2 / View.scale;
    App.redraw(); UI.updateZoom();
  },
};

/* ------------------------------ отрисовка ------------------------------- */
const Render = {
  /** env: { ctx, w, h, dpr, scale, ox, oy, C, exporting, layers } */
  draw(env) {
    const { ctx, C } = env;
    const L = env.layers;
    // fs — множитель «экранных» размеров (шрифты, линии) для экспорта/печати
    env.fs = env.fs || 1;
    const px = env.fs / env.scale;
    env.px = px;
    ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    ctx.fillStyle = env.exporting ? '#ffffff' : C.bg;
    ctx.fillRect(0, 0, env.w, env.h);
    const k = env.dpr * env.scale;
    ctx.setTransform(k, 0, 0, k, -env.ox * k, -env.oy * k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    env.labels = [];
    env.immediate = false;
    Render._blk = null;
    env.view = { x0: env.ox, y0: env.oy, x1: env.ox + env.w / env.scale, y1: env.oy + env.h / env.scale };

    // имена слоёв — для векторного экспорта (SVG/DXF)
    const lay = (n) => { if (ctx.setLayer) ctx.setLayer(n); };
    lay('GRID');
    if (L.grid && (!env.exporting || env.printGrid)) Render.grid(env);
    const u = App.doc.underlay;
    lay('UNDERLAY');
    if (L.underlay && u && u.visible && !u.front) Render.underlay(env);
    // нижний этаж — бледной подсказкой, чтобы стены совпадали
    const fi = Model.floorIdx(App.floor);
    if (fi > 0 && L.lower !== false) Render.ghostFloor(env, App.doc.floors[fi - 1].id);
    lay('SITE');
    if (L.site) { Render.areas(env); lay('ROADS'); Render.roads(env); }
    if (L.heat && App.heat && !ctx.isVector) Render.heat(env);
    lay('ROOMS');
    if (L.rooms) Render.roomFills(env);
    if (L.shadows && !ctx.isVector) Render.shadows(env);
    lay('ITEMS');
    const items = App.V.items.filter(it => L[catItem(it.key).layer] !== false);
    const isGround = (it) => { const d = catItem(it.key); return !d.sym && (it.h <= 20 || d.shape === 'rug') && !['tree', 'conifer', 'bush'].includes(d.shape); };
    const isCanopy = (it) => ['tree', 'conifer', 'bush', 'hedge'].includes(catItem(it.key).shape);
    for (const it of items) if (isGround(it)) Render.item(env, it);
    lay('WALLS');
    if (L.walls) Render.walls(env);
    lay('ITEMS');
    for (const it of items) if (!isGround(it) && !isCanopy(it) && !catItem(it.key).sym) Render.item(env, it);
    for (const it of items) if (isCanopy(it)) Render.item(env, it);
    // лестницы с нижнего этажа приходят на этот — показываем проём
    if (fi > 0) for (const it of App.doc.items) if (it.floor === App.doc.floors[fi - 1].id && ['stairs', 'stairsL'].includes(catItem(it.key).shape)) Render.stairsFromBelow(env, it);
    lay('NETWORKS');
    Render.lines(env);
    lay('ITEMS');
    for (const it of items) if (catItem(it.key).sym) Render.item(env, it);
    lay('ROOF');
    if (L.roof !== false) for (const r of App.V.roofs) { env.ghost = r.floor !== App.floor; Roof.draw(env, r); env.ghost = false; }
    lay('CHECKS');
    if (L.checks !== false && typeof Checks !== 'undefined') Checks.draw(env);
    lay('DIMS');
    if (L.walls && App.doc.settings.showWallDims) Render.wallDims(env);
    if (L.dims) { Render.dims(env); lay('TEXT'); Render.texts(env); }
    if (L.rooms) Render.roomLabels(env);
    lay('UNDERLAY');
    if (L.underlay && u && u.visible && u.front) Render.underlay(env);
    env.reserved = [];
    lay('NOTES');
    if (L.notes !== false) Render.notes(env);
    lay('LABELS');
    Render.flushLabels(env);
    env.immediate = true;
    if (!env.exporting) {
      Render.selection(env);
      Tools.drawOverlay(ctx, env);
      ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
      Render.compass(env);
      Render.scaleBar(env);
      if (L.heat && App.heat) Render.heatLegend(env);
    }
  },

  ghostFloor(env, fid) {
    const { ctx } = env;
    const saveV = App.V, saveRooms = App.rooms;
    App.V = Model.viewOf(fid);
    App.rooms = (App.floorData || []).find(x => x.floor.id === fid)?.rooms || [];
    env.noLabels = true; env.ghost = true;
    ctx.save();
    ctx.globalAlpha = 0.3;
    try {
      if (env.layers.site) { Render.areas(env); Render.roads(env); }
      for (const it of App.V.items) if (!catItem(it.key).sym && env.layers[catItem(it.key).layer] !== false) Render.item(env, it);
      Render.walls(env);
    } finally {
      ctx.restore();
      env.noLabels = false; env.ghost = false;
      App.V = saveV; App.rooms = saveRooms;
    }
  },
  stairsFromBelow(env, it) {
    const { ctx, px, C } = env;
    ctx.save();
    ctx.globalAlpha = 0.6;
    Render.item(env, it);
    ctx.restore();
    Render.polyPath(ctx, Model.itemPts(it));
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.restore();
    Render.label(env, 'Лестница ↓ (проём)', { x: it.x, y: it.y }, 0, { size: 11, bold: true, color: C.accent, bg: true, prio: 7 });
  },
  grid(env) {
    const { ctx, C, px } = env;
    const steps = [1, 5, 10, 50, 100, 500, 1000, 5000];
    let minor = steps.find(s => s * env.scale >= 9) || 5000;
    const major = minor < 100 ? 100 : minor * 10;
    // сетка может быть повёрнута (угол и начало — в настройках): рисуем в её системе координат
    const gf = Tools.gridFrame();
    const w = env.view;
    const cs = [{ x: w.x0, y: w.y0 }, { x: w.x1, y: w.y0 }, { x: w.x1, y: w.y1 }, { x: w.x0, y: w.y1 }].map(Tools.gL);
    const v = { x0: Math.min(...cs.map(p => p.x)), x1: Math.max(...cs.map(p => p.x)), y0: Math.min(...cs.map(p => p.y)), y1: Math.max(...cs.map(p => p.y)) };
    ctx.save();
    ctx.translate(gf.o.x, gf.o.y); ctx.rotate(U.rad(gf.a));
    const draw = (step, color) => {
      ctx.beginPath();
      for (let x = Math.floor(v.x0 / step) * step; x <= v.x1; x += step) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
      for (let y = Math.floor(v.y0 / step) * step; y <= v.y1; y += step) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
      ctx.strokeStyle = color; ctx.lineWidth = px; ctx.stroke();
    };
    if (minor !== major) draw(minor, C.gridMinor);
    draw(major, C.gridMajor);
    ctx.beginPath(); ctx.moveTo(0, v.y0); ctx.lineTo(0, v.y1); ctx.moveTo(v.x0, 0); ctx.lineTo(v.x1, 0);
    ctx.strokeStyle = C.gridAxis; ctx.lineWidth = px; ctx.stroke();
    ctx.restore();
  },

  underlay(env) {
    const u = App.doc.underlay, img = Underlay.img;
    if (!img) return;
    const { ctx } = env;
    ctx.save();
    ctx.globalAlpha = U.clamp(u.opacity, 0.02, 1);
    ctx.translate(u.x, u.y); ctx.rotate(U.rad(u.rot || 0));
    const w = img.naturalWidth * u.scale, h = img.naturalHeight * u.scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  },

  polyPath(ctx, pts, close = true) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
  },

  areas(env) {
    const { ctx, px, C } = env;
    const order = (a) => (a.kind === 'plot' ? 0 : 1);
    const list = [...App.V.areas].sort((a, b) => order(a) - order(b));
    for (const a of list) {
      const k = AREA_KINDS[a.kind];
      Render.polyPath(ctx, a.pts);
      ctx.fillStyle = a.color || k.fill; ctx.fill();
      if (k.hatch) {
        ctx.save(); ctx.clip();
        ctx.beginPath();
        const b = G.bbox(a.pts), s = 30;
        for (let x = b.x0 - (b.y1 - b.y0); x < b.x1; x += s) { ctx.moveTo(x, b.y0); ctx.lineTo(x + (b.y1 - b.y0), b.y1); }
        ctx.strokeStyle = C.hatch; ctx.lineWidth = px; ctx.stroke();
        ctx.restore();
      }
      Render.polyPath(ctx, a.pts);
      ctx.setLineDash(k.dash.map(d => d * px));
      ctx.strokeStyle = k.stroke; ctx.lineWidth = (a.kind === 'plot' ? 2.2 : 1.4) * px; ctx.stroke();
      ctx.setLineDash([]);
      if (a.kind === 'plot') {
        // длины сторон
        for (let i = 0; i < a.pts.length; i++) {
          const p = a.pts[i], q = a.pts[(i + 1) % a.pts.length];
          const L = G.dist(p, q);
          if (L * env.scale < 50) continue;
          const c = G.polyCentroid(a.pts), m = G.mid(p, q);
          let n = G.perp(G.unit(G.sub(q, p)));
          if (G.dot(n, G.sub(m, c)) < 0) n = G.mul(n, -1);
          Render.label(env, U.fmtLen(L), G.add(m, G.mul(n, 12 * px)), G.angle(p, q), { color: k.stroke, size: 11, prio: 3,
            alts: [G.add(G.add(m, G.mul(n, 12 * px)), G.mul(G.unit(G.sub(q, p)), 60 * px)), G.add(G.add(m, G.mul(n, 12 * px)), G.mul(G.unit(G.sub(q, p)), -60 * px)), G.add(m, G.mul(n, 28 * px))] });
        }
        for (const p of a.pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2); ctx.fillStyle = k.stroke; ctx.fill(); }
      }
      // подпись площади
      const ar = Math.abs(G.polyArea(a.pts));
      const lp = G.labelPoint(a.pts);
      const bb = G.bbox(a.pts);
      if ((bb.x1 - bb.x0) * env.scale > 70) {
        const title = a.name || k.name;
        const areaTxt = a.kind === 'plot' ? `${(ar / 1e6).toFixed(2)} сот. · ${(ar / 1e4).toFixed(1)} м²` : U.fmtArea(ar);
        const blk = Render._blk || (Render._blk = Render._itemBlockers());
        const smaller = App.V.areas.filter(o => o !== a && Math.abs(G.polyArea(o.pts)) < ar);
        const blocked = (p) => App.rooms.some(r => G.pointInPoly(p, r.axis)) || Render._inBlk(p, blk) || smaller.some(o => G.pointInPoly(p, o.pts))
          || App.V.walls.some(w => w.kind !== 'fence' && G.distSeg(p, w.a, w.b) < w.th / 2 + 30);
        const spots = Render.freeSpots(a.pts, lp, blocked);
        const main = spots.length ? spots[0] : lp;
        Render.label(env, [title, areaTxt], main, 0, { color: k.stroke, size: 12, bold: true, prio: a.kind === 'plot' ? 8 : 4, alts: spots.slice(1), must: a.kind === 'plot' });
      }
    }
  },

  roads(env) {
    const { ctx, px } = env;
    const dark = !env.exporting && Theme.isDark();
    const path = (r) => { ctx.beginPath(); ctx.moveTo(r.pts[0].x, r.pts[0].y); for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].x, r.pts[i].y); };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    // 1) бордюры (чуть шире), 2) покрытие — так соседние дороги сливаются без швов
    for (const r of App.V.roads) { const k = ROAD_KINDS[r.kind]; path(r); ctx.strokeStyle = k.edge; ctx.lineWidth = r.width + 3 * px; ctx.stroke(); }
    for (const r of App.V.roads) {
      const k = ROAD_KINDS[r.kind];
      path(r); ctx.strokeStyle = dark ? k.fillDark : k.fill; ctx.lineWidth = r.width; ctx.stroke();
      if (k.center && r.width * env.scale > 14) {
        path(r); ctx.setLineDash([300, 300]); ctx.strokeStyle = dark ? 'rgba(255,255,255,.55)' : '#ffffff'; ctx.lineWidth = Math.max(12, 1.4 * px); ctx.stroke(); ctx.setLineDash([]);
      }
      if (k.dots && r.width * env.scale > 10) {
        path(r); ctx.setLineDash([2 * px, 9 * px]); ctx.strokeStyle = k.edge; ctx.lineWidth = r.width * 0.7; ctx.stroke(); ctx.setLineDash([]);
      }
      if (k.tiles && r.width * env.scale > 10) {
        path(r); ctx.setLineDash([1.2 * px, 40]); ctx.strokeStyle = k.edge; ctx.lineWidth = r.width; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    ctx.restore();
    // подписи вдоль самого длинного участка
    for (const r of App.V.roads) {
      const k = ROAD_KINDS[r.kind];
      let best = 0, bi = 0;
      for (let i = 0; i < r.pts.length - 1; i++) { const L = G.dist(r.pts[i], r.pts[i + 1]); if (L > best) { best = L; bi = i; } }
      if (best * env.scale < 60) continue;
      const a = r.pts[bi], b = r.pts[bi + 1];
      const total = G.polyPerimeter(r.pts, false);
      // подписываем только названные дороги (безымянные — без лишнего шума)
      const txt = r.name || (App.sel.has(r.id) ? k.name : '');
      if (!txt) continue;
      const u = G.unit(G.sub(b, a));
      const inside = r.width * env.scale > 16;
      const m = G.mid(a, b);
      const pos = inside ? m : G.add(m, G.mul(G.perp(u), r.width / 2 + 10 * px));
      const alts = [0.25, 0.75].map(f => { const q = G.add(a, G.mul(G.sub(b, a), f)); return inside ? q : G.add(q, G.mul(G.perp(u), r.width / 2 + 10 * px)); });
      Render.label(env, r.name && total * env.scale > 200 && r.showLen ? `${txt} · ${U.fmtLen(total)}` : txt, pos, G.angle(a, b),
        { size: U.clamp(r.width * env.scale * 0.45, 10, 15), bold: !!r.name, color: dark ? '#e8ecf2' : '#2b3038', halo: !inside, prio: 6, alts });
    }
  },
  heat(env) {
    const h = App.heat, { ctx } = env;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = h.stale ? 0.45 : 0.9;
    ctx.drawImage(h.canvas, h.x0, h.y0, h.nx * h.cell, h.ny * h.cell);
    ctx.restore();
  },
  heatLegend(env) {
    const h = App.heat, { ctx, C } = env;
    const x = 16, y = env.h - 92, w = 200;
    ctx.fillStyle = C.labelBg; ctx.strokeStyle = C.gridMajor; ctx.lineWidth = 1;
    Painters.rr(ctx, x - 8, y - 22, w + 16, 50, 8); ctx.fill(); ctx.stroke();
    const grd = ctx.createLinearGradient(x, 0, x + w, 0);
    for (let i = 0; i <= 10; i++) { const [r, g, b] = Sun.heatColor(i / 10); grd.addColorStop(i / 10, `rgb(${r},${g},${b})`); }
    ctx.fillStyle = grd; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = C.text; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText('Прямое солнце, ч/день' + (h.stale ? ' · устарело' : ''), x, y - 8);
    ctx.textBaseline = 'top';
    ctx.fillText('0', x, y + 13);
    ctx.textAlign = 'right'; ctx.fillText(h.daylight.toFixed(1), x + w, y + 13);
    ctx.textAlign = 'center'; ctx.fillText((h.daylight / 2).toFixed(1), x + w / 2, y + 13);
  },

  /** Свободные точки внутри полигона для подписи: не на мебели/постройках/помещениях */
  freeSpots(poly, prefer, blocked, n = 6) {
    const b = G.bbox(poly), res = [];
    const K = 8;
    for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) {
      const p = { x: b.x0 + (b.x1 - b.x0) * (0.06 + 0.88 * i / K), y: b.y0 + (b.y1 - b.y0) * (0.06 + 0.88 * j / K) };
      if (G.pointInPoly(p, poly) && !blocked(p)) res.push(p);
    }
    res.sort((a, c) => G.dist2(a, prefer) - G.dist2(c, prefer));
    return res.slice(0, n);
  },
  _itemBlockers() {
    return App.V.items.filter(it => { const d = catItem(it.key); return d.shape !== 'rug' && (it.h > 0 || d.sym); })
      .map(it => { const s = Tools.itemDrawSize(it); const pts = G.rectPts(it.x, it.y, s.w + 10, s.d + 10, it.rot); return { pts, bb: G.bbox(pts) }; });
  },
  _inBlk(p, list) { return list.some(o => p.x >= o.bb.x0 && p.x <= o.bb.x1 && p.y >= o.bb.y0 && p.y <= o.bb.y1 && G.pointInPoly(p, o.pts)); },
  roomFills(env) {
    const { ctx } = env;
    App.rooms.forEach((r, i) => {
      Render.polyPath(ctx, r.floor);
      ctx.fillStyle = r.tag && r.tag.color ? r.tag.color : Theme.C.roomFill[i % Theme.C.roomFill.length];
      ctx.fill();
    });
  },
  roomLabels(env) {
    const { px } = env;
    for (const r of App.rooms) {
      const b = G.bbox(r.floor);
      const wpx = (b.x1 - b.x0) * env.scale;
      if (wpx < 50) continue;
      const sel = App.sel.has(r.id);
      const size = U.clamp(wpx / 12, 10, 14);
      const blk = Render._blk || (Render._blk = Render._itemBlockers());
      // метка, поставленная пользователем (перетаскиванием), — главная позиция
      const spots = r.tag && r.tag.fixed ? [] : Render.freeSpots(r.floor, r.label, (p) => Render._inBlk(p, blk));
      const main = r.tag && r.tag.fixed ? r.label : (Render._inBlk(r.label, blk) && spots.length ? spots[0] : r.label);
      Render.label(env, [r.name, U.fmtArea(Rooms.area(r))], main, 0, { size, bold: true, color: sel ? Theme.C.accent : Theme.C.roomText, color2: Theme.C.muted, prio: 9, alts: spots, must: true });
    }
  },

  shadows(env) {
    const pos = Sun.current();
    if (pos.alt <= 0.5) return;
    // рисуем тени в отдельный слой, чтобы перекрытия не «темнели»
    const { ctx } = env;
    const off = Render._off || (Render._off = document.createElement('canvas'));
    const W = Math.ceil(env.w * env.dpr), H = Math.ceil(env.h * env.dpr);
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    const oc = off.getContext('2d');
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, W, H);
    const k = env.dpr * env.scale;
    oc.setTransform(k, 0, 0, k, -env.ox * k, -env.oy * k);
    oc.fillStyle = '#000';
    Sun.pathShadows(oc, Sun.casters(), pos, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // окрашиваем маску в цвет тени
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = Theme.C.shadow; oc.fillRect(0, 0, W, H);
    oc.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  },

  /* ------------------------------- стены --------------------------------- */
  /** Точки торца стены (end: 'a'|'b'). Возвращает {p, m} — точки на стороне +n и −n (n = perp(a→b)). */
  wallEnd(w, end, cache) {
    const P = w[end];
    const u = Model.wallDir(w);
    const dOut = end === 'a' ? u : G.mul(u, -1);          // направление «от узла» вдоль стены
    const nOut = G.perp(dOut);
    const t = w.th / 2;
    const others = cache.ends(P, w.id);
    let plus, minus;                                       // относительно nOut
    if (others.length === 1) {
      const o = others[0].w;
      const od = others[0].end === 'a' ? Model.wallDir(o) : G.mul(Model.wallDir(o), -1);
      const on = G.perp(od), ot = o.th / 2;
      const i1 = G.lineInter(G.add(P, G.mul(nOut, t)), G.add(G.add(P, G.mul(nOut, t)), dOut), G.sub(P, G.mul(on, ot)), G.sub(G.sub(P, G.mul(on, ot)), od));
      const i2 = G.lineInter(G.sub(P, G.mul(nOut, t)), G.sub(G.sub(P, G.mul(nOut, t)), G.mul(dOut, -1)), G.add(P, G.mul(on, ot)), G.add(G.add(P, G.mul(on, ot)), od));
      const lim = Math.max(t, ot) * 4;
      if (i1 && i2 && G.dist(i1, P) < lim && G.dist(i2, P) < lim) { plus = i1; minus = i2; }
    } else if (others.length >= 2) {
      const ext = Math.max(...others.map(o => o.w.th)) / 2;
      plus = G.sub(G.add(P, G.mul(nOut, t)), G.mul(dOut, ext));
      minus = G.sub(G.sub(P, G.mul(nOut, t)), G.mul(dOut, ext));
    }
    if (!plus) { plus = G.add(P, G.mul(nOut, t)); minus = G.sub(P, G.mul(nOut, t)); }
    // приводим к системе n = perp(a→b)
    return end === 'a' ? { p: plus, m: minus } : { p: minus, m: plus };
  },
  endCache() {
    const walls = App.V.walls.filter(w => w.kind !== 'fence');
    const map = new Map();
    const key = (p) => Math.round(p.x) + ',' + Math.round(p.y);
    for (const w of walls) for (const e of ['a', 'b']) {
      const k = key(w[e]);
      (map.get(k) || map.set(k, []).get(k)).push({ w, end: e });
    }
    return {
      ends(P, id) {
        const res = [];
        const gx = Math.round(P.x), gy = Math.round(P.y);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const l = map.get((gx + dx) + ',' + (gy + dy));
          if (l) for (const r of l) if (r.w.id !== id && G.dist(r.w[r.end], P) <= 1.2 && !res.includes(r)) res.push(r);
        }
        return res;
      },
    };
  },
  /** Полигоны сплошных участков стены (с вырезами под проёмы) */
  wallPieces(w, cache) {
    const L = Model.wallLen(w);
    if (L < 0.5) return [];
    const u = Model.wallDir(w), n = G.perp(u), t = w.th / 2;
    const ea = Render.wallEnd(w, 'a', cache), eb = Render.wallEnd(w, 'b', cache);
    const ops = App.V.openings.filter(o => o.wall === w.id).map(o => Model.opGeom(o)).filter(Boolean)
      .map(g => [g.pos - g.width / 2, g.pos + g.width / 2]).sort((a, b) => a[0] - b[0]);
    const cuts = [];
    let s = 0;
    for (const [a, b] of ops) { if (a > s) cuts.push([s, a]); s = Math.max(s, b); }
    if (s < L) cuts.push([s, L]);
    return cuts.filter(([a, b]) => b - a > 0.1).map(([s0, s1]) => {
      const A = G.add(w.a, G.mul(u, s0)), B = G.add(w.a, G.mul(u, s1));
      const sp = s0 <= 0.01 ? ea.p : G.add(A, G.mul(n, t)), sm = s0 <= 0.01 ? ea.m : G.sub(A, G.mul(n, t));
      const ep = s1 >= L - 0.01 ? eb.p : G.add(B, G.mul(n, t)), em = s1 >= L - 0.01 ? eb.m : G.sub(B, G.mul(n, t));
      return [sp, ep, em, sm];
    });
  },
  /* ------------------------ штриховки материалов ------------------------ */
  _tiles: new Map(),
  /** Плитка штриховки 12×12 «экранных» px; рисуется с плотностью d (px устройства на экранный px) */
  matTile(key, dark, d) {
    const ck = key + (dark ? ':d:' : ':l:') + d;
    if (Render._tiles.has(ck)) return Render._tiles.get(ck);
    const M = key === 'insulation' ? { color: '#f7e89a', dark: '#6e6534', pat: 'ins' } : WALL_MATERIALS[key];
    if (!M) return null;
    const S = 12, cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(1, Math.round(S * d));
    const c = cv.getContext('2d');
    c.scale(cv.width / S, cv.height / S);
    c.fillStyle = dark ? M.dark : M.color; c.fillRect(0, 0, S, S);
    const ink = dark ? 'rgba(255,255,255,.5)' : 'rgba(35,38,45,.6)';
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 0.8; c.lineCap = 'round';
    const L = (pts) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke(); };
    const dot = (x, y, r = 0.75) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
    const diag = (step) => { for (let k = -S; k <= 2 * S; k += step) L([k, 0, k - S, S]); };
    switch (M.pat) {
      case 'diag': diag(6); break;
      case 'diag2': diag(4); break;
      case 'grid': diag(6); for (let k = -S; k <= 2 * S; k += 6) L([k - S, 0, k, S]); break;
      case 'dots': dot(3, 3); dot(9, 9); break;
      case 'dots2': dot(2, 2); dot(8, 5); dot(5, 10); break;
      case 'dots3': diag(12); dot(3, 8); dot(8, 3); dot(10, 10, 0.6); break;
      case 'concrete': diag(12); c.beginPath(); c.moveTo(3, 3); c.lineTo(5.5, 3); c.lineTo(4.2, 5.2); c.closePath(); c.fill(); dot(9, 8); dot(7.5, 2.5, 0.6); dot(2.5, 9.5, 0.6); break;
      case 'circles': c.beginPath(); c.arc(3.5, 3.5, 1.6, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(9, 9, 1.3, 0, Math.PI * 2); c.stroke(); break;
      case 'dash': L([1, 2, 4, 3]); L([7, 7, 10, 6]); L([2, 9, 3, 11]); L([8, 1, 9, 3.5]); break;
      case 'wood': c.beginPath(); c.moveTo(0, 3); c.quadraticCurveTo(3, 1, 6, 3); c.quadraticCurveTo(9, 5, 12, 3); c.moveTo(0, 9); c.quadraticCurveTo(3, 7, 6, 9); c.quadraticCurveTo(9, 11, 12, 9); c.stroke(); break;
      case 'zigzag': case 'ins': L([0, 9, 3, 3, 6, 9, 9, 3, 12, 9]); break;
      case 'gkl': L([5, 6, 7, 6]); L([6, 5, 6, 7]); break;
      case 'hlines': L([0, 4, 12, 4]); L([0, 10, 12, 10]); break;
      case 'stone': L([0, 4, 5, 2, 12, 5]); L([0, 10, 4, 12]); L([5, 12, 7, 7, 12, 9]); L([7, 7, 5, 2]); break;
    }
    cv.__color = dark ? M.dark : M.color;   // запасной цвет для векторного экспорта
    Render._tiles.set(ck, cv);
    return cv;
  },
  /** Заливка-штриховка материала для текущего env (плитка привязана к экранным пикселям) */
  matFill(env, key) {
    const dark = !env.exporting && Theme.isDark();
    const d = env.dpr * (env.fs || 1);
    const tile = Render.matTile(key, dark, d);
    if (!tile) return null;
    const pat = env.ctx.createPattern(tile, 'repeat');
    const k = 1 / (env.scale * env.dpr);
    if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    return pat;
  },
  walls(env) {
    const { ctx, px, C } = env;
    const cache = Render.endCache();
    const solid = App.V.walls.filter(w => w.kind !== 'fence');
    const pieces = solid.map(w => ({ w, polys: Render.wallPieces(w, cache) }));
    // 1) контур
    ctx.strokeStyle = C.wallStroke; ctx.lineWidth = 2.4 * px; ctx.lineJoin = 'miter';
    for (const { polys } of pieces) for (const poly of polys) { Render.polyPath(ctx, poly); ctx.stroke(); }
    // 2) заливка: издалека — сплошной цвет по типу стены, вблизи — штриховка материала
    const fills = new Map();
    for (const { w, polys } of pieces) {
      const detailed = App.doc.settings.wallHatch !== false && w.th * env.scale / (env.fs || 1) >= 6 && WALL_MATERIALS[w.mat];
      let fill = w.kind === 'ext' ? C.wallExt : w.kind === 'int' ? C.wallInt : C.wallPart;
      if (detailed) { if (!fills.has(w.mat)) fills.set(w.mat, Render.matFill(env, w.mat)); fill = fills.get(w.mat) || fill; }
      ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = 0.6 * px;
      for (const poly of polys) { Render.polyPath(ctx, poly); ctx.fill(); if (!detailed) ctx.stroke(); }
      // утеплитель — полоса с наружной стороны
      if (w.ins > 0 && w.kind !== 'fence') {
        const u = Model.wallDir(w), n = G.perp(u), m = G.mid(w.a, w.b);
        const outSide = Rooms.at(G.add(m, G.mul(n, w.th / 2 + 15))) && !Rooms.at(G.sub(m, G.mul(n, w.th / 2 + 15))) ? -1 : 1;
        const ins = Math.min(w.ins, w.th);
        ctx.fillStyle = detailed ? (Render.matFill(env, 'insulation') || '#f7e89a') : (Theme.isDark() && !env.exporting ? '#6e6534' : '#f2dc6a');
        for (const [sp, ep, em, sm] of polys) {
          const band = outSide > 0 ? [sp, ep, G.sub(ep, G.mul(n, ins)), G.sub(sp, G.mul(n, ins))] : [sm, em, G.add(em, G.mul(n, ins)), G.add(sm, G.mul(n, ins))];
          Render.polyPath(ctx, band); ctx.fill();
        }
        // граница утеплителя
        ctx.strokeStyle = C.wallStroke; ctx.lineWidth = 0.7 * px;
        for (const [sp, ep, em, sm] of polys) {
          const [a, b] = outSide > 0 ? [G.sub(sp, G.mul(n, ins)), G.sub(ep, G.mul(n, ins))] : [G.add(sm, G.mul(n, ins)), G.add(em, G.mul(n, ins))];
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.lineJoin = 'round';
    // заборы
    if (env.layers.fence !== false) for (const w of App.V.walls) if (w.kind === 'fence') Render.fence(env, w);
    // проёмы
    for (const op of App.V.openings) Render.opening(env, op);
  },
  fence(env, w) {
    const { ctx, px } = env;
    const L = Model.wallLen(w), u = Model.wallDir(w);
    const M = FENCE_MATERIALS[w.mat] || FENCE_MATERIALS.profile;
    ctx.strokeStyle = M.color; ctx.lineWidth = Math.max(1.8 * px, w.th); ctx.lineCap = M.dash.length ? 'butt' : 'round';
    ctx.setLineDash(M.dash.map(v => v * px * 2));
    ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    const step = w.mat === 'brickF' ? 300 : 250;
    ctx.fillStyle = M.color;
    const cnt = Math.max(1, Math.round(L / step));
    const s = Math.max(8, w.th * 2);
    for (let i = 0; i <= cnt; i++) {
      const p = G.add(w.a, G.mul(u, L * i / cnt));
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    // проёмы (калитки/ворота) в заборе
    for (const op of App.V.openings) if (op.wall === w.id) {
      const g = Model.opGeom(op);
      ctx.strokeStyle = env.exporting ? '#fff' : env.C.bg; ctx.lineWidth = w.th + 4 * px;
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.stroke();
    }
  },
  opening(env, op) {
    const g = Model.opGeom(op);
    if (!g) return;
    const { ctx, px, C } = env;
    const t = g.th / 2, type = op.type, side = op.side || 1;
    const fenceWall = g.w.kind === 'fence';
    const N = G.mul(g.n, side);                 // сторона открывания
    const P = (s, k) => G.add(G.add(g.a, G.mul(g.u, s)), G.mul(g.n, k));   // s вдоль, k поперёк
    const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const W = g.width;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2 * px;
    if (!fenceWall) { seg(P(0, -t), P(0, t)); seg(P(W, -t), P(W, t)); }
    const cat = OPENING_TYPES[type].cat;
    if (cat === 'window') {
      Render.polyPath(ctx, [P(0, -t), P(W, -t), P(W, t), P(0, t)]);
      ctx.fillStyle = C.opening; ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.glass;
      Render.polyPath(ctx, [P(0, -Math.min(4, t * .3)), P(W, -Math.min(4, t * .3)), P(W, Math.min(4, t * .3)), P(0, Math.min(4, t * .3))]);
      ctx.fill();
      ctx.lineWidth = 0.9 * px;
      seg(P(0, -Math.min(4, t * .3)), P(W, -Math.min(4, t * .3)));
      seg(P(0, Math.min(4, t * .3)), P(W, Math.min(4, t * .3)));
      const leaves = type === 'win1' ? 1 : type === 'win3' ? 3 : type === 'winfix' ? 1 : type === 'balcony' ? 1 : 2;
      for (let i = 1; i < leaves; i++) seg(P(W * i / leaves, -t), P(W * i / leaves, t));
      // открывание створок (штрих)
      if (type !== 'winfix' && App.doc.settings.showSwing !== false) {
        ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = 0.8 * px; ctx.strokeStyle = C.inkSoft;
        const sash = (s0, s1) => {          // петли в s0, створка до s1
          const H = G.add(P(s0, 0), G.mul(N, t));
          const len = Math.abs(s1 - s0);
          const tip = G.add(H, G.mul(N, len));
          seg(H, tip);
          const a0 = Math.atan2(N.y, N.x), end = G.add(P(s1, 0), G.mul(N, t));
          const a1 = Math.atan2(end.y - H.y, end.x - H.x);
          let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          ctx.beginPath(); ctx.arc(H.x, H.y, len, a0, a0 + d, d < 0); ctx.stroke();
        };
        const h = op.hinge ? 1 : 0;
        if (type === 'win1' || type === 'balcony') h ? sash(W, 0) : sash(0, W);
        else if (type === 'win2') { sash(0, W / 2); sash(W, W / 2); }
        else if (type === 'win3') { sash(0, W / 3); sash(W, W * 2 / 3); }
        ctx.setLineDash([]);
      }
      return;
    }
    // двери
    if (!fenceWall) {
      ctx.fillStyle = env.exporting ? '#fff' : C.bg;
      ctx.globalAlpha = 0;          // проём пустой: пол виден
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.3 * px; ctx.strokeStyle = C.ink;
    const leaf = (s0, s1) => {
      const H = G.add(P(s0, 0), G.mul(N, fenceWall ? 0 : t));
      const len = Math.abs(s1 - s0);
      const tip = G.add(H, G.mul(N, len));
      // полотно
      const dirS = G.unit(G.sub(P(s1, 0), P(s0, 0)));
      const thk = Math.min(4, len * 0.06);
      Render.polyPath(ctx, [H, tip, G.add(tip, G.mul(dirS, thk)), G.add(H, G.mul(dirS, thk))]);
      ctx.fillStyle = C.itemFill; ctx.fill(); ctx.stroke();
      // дуга
      const a0 = Math.atan2(N.y, N.x), end = G.add(P(s1, 0), G.mul(N, fenceWall ? 0 : t));
      const a1 = Math.atan2(end.y - H.y, end.x - H.x);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.save(); ctx.lineWidth = 0.8 * px; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(H.x, H.y, len, a0, a0 + d, d < 0); ctx.stroke(); ctx.restore();
    };
    const h = op.hinge ? 1 : 0;
    if (type === 'door') h ? leaf(W, 0) : leaf(0, W);
    else if (type === 'door2') { leaf(0, W / 2); leaf(W, W / 2); }
    else if (type === 'door15') { const k = W * 2 / 3; if (h) { leaf(W, W - k); leaf(0, W - k); } else { leaf(0, k); leaf(W, k); } }
    else if (type === 'slide') {
      ctx.fillStyle = C.itemFill;
      const k = Math.min(3, t * 0.5);
      Render.polyPath(ctx, [P(0, side * k - 1.5), P(W * 0.55, side * k - 1.5), P(W * 0.55, side * k + 1.5), P(0, side * k + 1.5)]); ctx.fill(); ctx.stroke();
      Render.polyPath(ctx, [P(W * 0.45, -side * k - 1.5), P(W, -side * k - 1.5), P(W, -side * k + 1.5), P(W * 0.45, -side * k + 1.5)]); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 0.8 * px;
      const y = side * (t + 8);
      seg(P(W * 0.2, y), P(W * 0.8, y));
      seg(P(W * 0.8 - 6, y - 4), P(W * 0.8, y)); seg(P(W * 0.8 - 6, y + 4), P(W * 0.8, y));
    } else if (type === 'arch') {
      ctx.setLineDash([6 * px, 4 * px]); ctx.lineWidth = 0.9 * px;
      seg(P(0, -t), P(W, -t)); seg(P(0, t), P(W, t));
      ctx.setLineDash([]);
    } else if (type === 'gate') {
      ctx.setLineDash([10 * px, 5 * px]); ctx.lineWidth = 1 * px;
      Render.polyPath(ctx, [P(0, side * t), P(W, side * t), P(W, side * (t + Math.min(W, 60))), P(0, side * (t + Math.min(W, 60)))]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 2 * px; seg(P(0, 0), P(W, 0));
    }
  },
  wallDims(env) {
    const { px, C } = env;
    for (const w of App.V.walls) {
      const L = Model.wallLen(w);
      if (L * env.scale < 60 || w.kind === 'fence') continue;
      const u = Model.wallDir(w), n = G.perp(u), m = G.mid(w.a, w.b);
      const off = w.th / 2 + 9 * px;
      let side = 1;
      const pOut = G.add(m, G.mul(n, w.th / 2 + 20));
      if (Rooms.at(pOut) && !Rooms.at(G.sub(m, G.mul(n, w.th / 2 + 20)))) side = -1;
      const u2 = G.mul(u, Math.min(L * 0.3, 60 * px));
      const base = G.add(m, G.mul(n, side * off));
      Render.label(env, U.fmtLen(L), base, G.angle(w.a, w.b), { size: 10.5, color: C.muted, prio: 5, alts: [G.add(base, u2), G.sub(base, u2), G.add(m, G.mul(n, -side * off))] });
    }
  },

  /* ------------------------------ предметы ------------------------------- */
  item(env, it) {
    const { ctx, px, C } = env;
    const def = catItem(it.key);
    const painter = Painters.S[def.shape] || Painters.S.labelbox;
    let w = it.w, d = it.d;
    if (def.sym) { const k = Math.max(1, def.sym / Math.max(w, d)); w *= k; d *= k; }
    ctx.save();
    ctx.translate(it.x, it.y); ctx.rotate(U.rad(it.rot || 0));
    if (it.flip) ctx.scale(-1, 1);
    ctx.fillStyle = it.color || C.itemFill; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([]);
    const P = { ctx, px, C, it, def, upright: true, rotRad: U.rad(it.rot || 0), flip: !!it.flip, symMul: 1 };
    try { painter(P, w, d); } catch (e) { console.warn('painter', def.shape, e); }
    ctx.restore();
    if (it.label && !['building', 'garage', 'canopy', 'canopyLean', 'gazebo', 'greenhouse', 'labelbox', 'deck', 'veranda'].includes(def.shape) && Math.min(w, d) * env.scale > 30) {
      Render.label(env, it.label, { x: it.x, y: it.y }, 0, { size: 11, bg: true, prio: 6 });
    }
    if (App.doc.settings.showItemDims && !def.sym && Math.max(w, d) * env.scale > 45) {
      Render.label(env, `${Math.round(it.w)}×${Math.round(it.d)}`, { x: it.x, y: it.y + 10 * px }, 0, { size: 9.5, color: C.muted, prio: 1 });
    }
  },

  /* ---------------------------- инженерные трассы ------------------------ */
  lines(env) {
    const { ctx, px } = env;
    const L = env.layers;
    for (const l of App.V.lines) {
      const k = LINE_KINDS[l.kind];
      if (L[k.layer] === false) continue;
      const color = l.color || k.color;
      ctx.strokeStyle = color; ctx.lineWidth = 2.4 * px; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash(k.dash.map(v => v * px));
      Render.polyPath(ctx, l.pts, false); ctx.stroke();
      ctx.setLineDash([]); ctx.lineCap = 'butt';
      // стрелки направления (канализация/дренаж — уклон)
      const arrows = l.kind === 'sewer' || l.kind === 'drain' || l.flow;
      for (let i = 0; i < l.pts.length - 1; i++) {
        const a = l.pts[i], b = l.pts[i + 1];
        const segL = G.dist(a, b) * env.scale;
        if (segL < 70) continue;
        const m = G.mid(a, b);
        if (arrows) {
          const u = G.unit(G.sub(b, a)), n = G.perp(u);
          const q = G.add(m, G.mul(u, 18 * px));
          ctx.beginPath();
          ctx.moveTo(q.x - u.x * 8 * px + n.x * 4 * px, q.y - u.y * 8 * px + n.y * 4 * px);
          ctx.lineTo(q.x, q.y);
          ctx.lineTo(q.x - u.x * 8 * px - n.x * 4 * px, q.y - u.y * 8 * px - n.y * 4 * px);
          ctx.lineWidth = 1.6 * px; ctx.stroke();
        }
        const du = G.mul(G.unit(G.sub(b, a)), Math.min(G.dist(a, b) * 0.3, 50 * px));
        Render.label(env, l.label || k.code, m, 0, { size: 10, bold: true, color, bg: true, pad: 2, border: color, prio: 2, alts: [G.add(m, du), G.sub(m, du)] });
      }
      for (const p of l.pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * px, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    }
  },

  /* ------------------------------- размеры ------------------------------- */
  dimLine(env, a, b, off, text, color) {
    const { ctx, px } = env;
    const u = G.unit(G.sub(b, a)), n = G.perp(u);
    const A = G.add(a, G.mul(n, off)), B = G.add(b, G.mul(n, off));
    const ext = Math.sign(off || 1) * 5 * px;
    ctx.strokeStyle = color; ctx.lineWidth = 0.9 * px;
    ctx.beginPath();
    if (Math.abs(off) > 0.1) {
      ctx.moveTo(a.x + n.x * Math.sign(off) * 3 * px, a.y + n.y * Math.sign(off) * 3 * px); ctx.lineTo(A.x + n.x * ext, A.y + n.y * ext);
      ctx.moveTo(b.x + n.x * Math.sign(off) * 3 * px, b.y + n.y * Math.sign(off) * 3 * px); ctx.lineTo(B.x + n.x * ext, B.y + n.y * ext);
    }
    ctx.moveTo(A.x - u.x * 6 * px, A.y - u.y * 6 * px); ctx.lineTo(B.x + u.x * 6 * px, B.y + u.y * 6 * px);
    // засечки 45°
    const d = G.mul(G.unit(G.add(u, n)), 5 * px);
    ctx.moveTo(A.x - d.x, A.y - d.y); ctx.lineTo(A.x + d.x, A.y + d.y);
    ctx.moveTo(B.x - d.x, B.y - d.y); ctx.lineTo(B.x + d.x, B.y + d.y);
    ctx.stroke();
    const m = G.mid(A, B);
    let ang = G.angle(a, b);
    const du = G.mul(u, Math.min(G.dist(a, b) * 0.3, 50 * px));
    Render.label(env, text ?? U.fmtLen(G.dist(a, b)), m, ang, { size: 11, color, bg: true, pad: 2, prio: 7, alts: [G.add(m, du), G.sub(m, du), G.add(m, G.mul(n, (off >= 0 ? 12 : -12) * px))] });
  },
  dims(env) {
    for (const d of App.V.dims) Render.dimLine(env, d.a, d.b, d.off || 0, d.text || null, Theme.C.dim);
  },
  texts(env) {
    const { ctx, px, C } = env;
    for (const t of App.V.texts) {
      const size = t.size || 30;
      ctx.save();
      ctx.translate(t.x, t.y); ctx.rotate(U.rad(t.rot || 0));
      ctx.font = `${t.bold ? 600 : 400} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = t.color || C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = String(t.text || '').split('\n');
      lines.forEach((s, i) => ctx.fillText(s, 0, (i - (lines.length - 1) / 2) * size * 1.2));
      ctx.restore();
      void px;
    }
  },

  /** Подпись в мировых координатах с экранным размером шрифта.
      Обычные подписи попадают в очередь и размещаются без наложений (по приоритету);
      в режиме env.immediate (выделение, инструменты) — рисуются сразу. */
  label(env, text, p, ang = 0, o = {}) {
    if (!text || (Array.isArray(text) && !text.length) || env.noLabels) return;
    if (env.immediate || o.force || !env.labels) { Render._drawLabel(env, text, p, ang, o, Render._labelBox(env, text, p, ang, o)); return; }
    env.labels.push({ text, p, ang, o, prio: o.prio ?? 1, seq: env.labels.length });
  },
  _norm(ang) { let a = ang; while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; return a; },
  _font(o) { return `${o.bold ? '600 ' : ''}${o.size || 11}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; },
  /** Экранный прямоугольник подписи (ось-выровненный после поворота) + размеры */
  _labelBox(env, text, p, ang, o) {
    const ctx = env.ctx;
    const lines = Array.isArray(text) ? text : [text];
    const size = o.size || 11, lh = size * 1.25;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let w = 0;
    lines.forEach((t, i) => {
      ctx.font = Render._font({ ...o, bold: o.bold && i === 0, size: i === 0 ? size : (o.size2 || size - 1) });
      w = Math.max(w, ctx.measureText(t).width);
    });
    ctx.restore();
    const pad = o.pad ?? (o.bg ? 3 : 1);
    const W = w + pad * 2 + 2, H = lh * lines.length + pad * 2 - (lh - size);
    const a = Render._norm(ang);
    const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    const fs = env.fs || 1;
    const bw = (W * c + H * sn) * fs, bh = (W * sn + H * c) * fs;
    const sx = (p.x - env.ox) * env.scale, sy = (p.y - env.oy) * env.scale;
    return { x0: sx - bw / 2, y0: sy - bh / 2, x1: sx + bw / 2, y1: sy + bh / 2, W, H, lines, size, lh };
  },
  _drawLabel(env, text, p, ang, o, box) {
    const { ctx, px, C } = env;
    const { lines, size, lh, W, H } = box;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Render._norm(ang));
    ctx.scale(px, px);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.bg) {
      ctx.fillStyle = env.exporting ? 'rgba(255,255,255,.92)' : C.labelBg;
      Painters.rr(ctx, -W / 2, -H / 2, W, H, 3); ctx.fill();
      if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 1; ctx.stroke(); }
    } else if (o.halo !== false) {
      ctx.strokeStyle = env.exporting ? 'rgba(255,255,255,.9)' : C.halo; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    }
    const y0 = -((lines.length - 1) * lh) / 2;
    lines.forEach((t, i) => {
      ctx.font = Render._font({ ...o, bold: o.bold && i === 0, size: i === 0 ? size : (o.size2 || size - 1) });
      if (!o.bg && o.halo !== false) ctx.strokeText(t, 0, y0 + i * lh + 0.5);
      ctx.fillStyle = i === 0 ? (o.color || C.text) : (o.color2 || o.color || C.text);
      ctx.fillText(t, 0, y0 + i * lh + 0.5);
    });
    ctx.restore();
  },
  /** Размещение накопленных подписей: по приоритету, без пересечений */
  flushLabels(env) {
    const list = env.labels;
    env.labels = null;
    if (!list || !list.length) return;
    list.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
    const placed = (env.reserved || []).slice();
    const hit = (b) => placed.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    const W = env.w, H = env.h;
    for (const L of list) {
      const cands = [L.p].concat(L.o.alts || []);
      let done = false;
      for (const p of cands) {
        const b = Render._labelBox(env, L.text, p, L.ang, L.o);
        if (b.x1 < 0 || b.y1 < 0 || b.x0 > W || b.y0 > H) { done = true; break; }   // вне экрана
        const m = { x0: b.x0 - 2, y0: b.y0 - 1, x1: b.x1 + 2, y1: b.y1 + 1 };
        if (!hit(m)) { placed.push(m); Render._drawLabel(env, L.text, p, L.ang, L.o, b); done = true; break; }
      }
      if (!done && L.o.must) { const b = Render._labelBox(env, L.text, L.p, L.ang, L.o); placed.push(b); Render._drawLabel(env, L.text, L.p, L.ang, L.o, b); }
    }
  },

  /* ---------------------------- примечания ------------------------------ */
  _noteRects: [],
  noteLines(text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 30 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
      if (lines.length >= 3) break;
    }
    if (cur && lines.length < 3) lines.push(cur);
    if (lines.length === 3 && words.join(' ').length > lines.join(' ').length) lines[2] = lines[2].replace(/.{0,2}$/, '…');
    return lines.length ? lines : ['(пусто)'];
  },
  notes(env) {
    const { ctx, C } = env;
    const rects = [];
    const notes = App.V.notes;
    const f = env.fs || 1;
    ctx.save();
    ctx.setTransform(env.dpr * f, 0, 0, env.dpr * f, 0, 0);
    notes.forEach((n, i) => {
      const P = Model.notePos(n), A = Model.noteAnchor(n);
      const sp = { x: (P.x - env.ox) * env.scale / f, y: (P.y - env.oy) * env.scale / f };
      const color = n.done ? C.muted : (n.color || C.note);
      const lines = Render.noteLines(n.text);
      ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      const tw = Math.max(...lines.map(s => ctx.measureText(s).width));
      const W = tw + 34, H = lines.length * 15 + 10;
      const r = { x0: sp.x - 10, y0: sp.y - H / 2, x1: sp.x - 10 + W, y1: sp.y + H / 2 };
      if (A) {
        const sa = { x: (A.x - env.ox) * env.scale / f, y: (A.y - env.oy) * env.scale / f };
        ctx.strokeStyle = color; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sa.x, sa.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      const sel = App.sel.has(n.id);
      ctx.fillStyle = env.exporting ? '#fffbe8' : C.noteBg;
      ctx.strokeStyle = sel && !env.exporting ? C.accent : color; ctx.lineWidth = sel ? 2 : 1.2;
      Painters.rr(ctx, r.x0, r.y0, W, H, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(r.x0 + 12, sp.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), r.x0 + 12, sp.y + 0.5);
      ctx.fillStyle = n.done ? C.muted : C.text; ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'left';
      lines.forEach((s, k) => ctx.fillText(s, r.x0 + 25, sp.y + (k - (lines.length - 1) / 2) * 15 + 0.5));
      if (n.done) { ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x0 + 25, sp.y); ctx.lineTo(r.x0 + 25 + tw, sp.y); ctx.stroke(); }
      rects.push({ id: n.id, r });
      env.reserved && env.reserved.push({ x0: (r.x0 - 2) * f, y0: (r.y0 - 2) * f, x1: (r.x1 + 2) * f, y1: (r.y1 + 2) * f });
    });
    ctx.restore();
    if (!env.exporting) Render._noteRects = rects;
  },

  /* ---------------------------- выделение -------------------------------- */
  selection(env) {
    const { ctx, px, C } = env;
    ctx.save();
    const hl = (id, strong) => {
      const o = Model.get(id), c = Model.coll(id);
      if (!o) return;
      ctx.strokeStyle = C.accent; ctx.lineWidth = (strong ? 2 : 1.4) * px;
      ctx.setLineDash(strong ? [] : [5 * px, 4 * px]);
      if (c === 'walls') { Render.polyPath(ctx, Model.wallRect(o, 2 * px)); ctx.fillStyle = C.accentSoft; ctx.fill(); ctx.stroke(); }
      else if (c === 'items') {
        const def = catItem(o.key);
        let w = o.w, d = o.d;
        if (def.sym) { const k = Math.max(1, def.sym / Math.max(w, d)); w *= k; d *= k; }
        Render.polyPath(ctx, G.rectPts(o.x, o.y, w + 4 * px, d + 4 * px, o.rot)); ctx.stroke();
      }
      else if (c === 'roofs') { Render.polyPath(ctx, G.rectPts(o.x, o.y, o.w + 4 * px, o.d + 4 * px, o.rot || 0)); ctx.stroke(); }
      else if (c === 'lines') { ctx.lineWidth = 6 * px; ctx.strokeStyle = C.accentSoft; ctx.setLineDash([]); Render.polyPath(ctx, o.pts, false); ctx.stroke(); }
      else if (c === 'areas') { Render.polyPath(ctx, o.pts); ctx.lineWidth = 2.5 * px; ctx.stroke(); }
      else if (c === 'openings') { const g = Model.opGeom(o); if (g) { Render.polyPath(ctx, [G.add(g.a, G.mul(g.n, g.th / 2 + 3 * px)), G.add(g.b, G.mul(g.n, g.th / 2 + 3 * px)), G.sub(g.b, G.mul(g.n, g.th / 2 + 3 * px)), G.sub(g.a, G.mul(g.n, g.th / 2 + 3 * px))]); ctx.fillStyle = C.accentSoft; ctx.fill(); ctx.stroke(); } }
      else if (c === 'dims') { ctx.lineWidth = 5 * px; ctx.strokeStyle = C.accentSoft; ctx.setLineDash([]); const n = G.perp(G.unit(G.sub(o.b, o.a))); const A = G.add(o.a, G.mul(n, o.off || 0)), B = G.add(o.b, G.mul(n, o.off || 0)); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); }
      else if (c === 'texts' || c === 'roomTags') { ctx.beginPath(); ctx.arc(o.x, o.y, 10 * px, 0, Math.PI * 2); ctx.stroke(); }
    };
    if (App.hover && !App.sel.has(App.hover)) hl(App.hover, false);
    for (const id of App.sel) hl(id, true);
    // помещение
    for (const r of App.rooms) if (App.sel.has(r.id) || App.hover === r.id) {
      Render.polyPath(ctx, r.floor); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = C.accent; ctx.lineWidth = 2 * px; ctx.stroke();
    }
    ctx.setLineDash([]);
    // подложка
    const u = App.doc.underlay;
    if (App.sel.has('underlay') && u && Underlay.img) { Render.polyPath(ctx, Underlay.corners()); ctx.strokeStyle = C.accent; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 5 * px]); ctx.stroke(); ctx.setLineDash([]); }
    // направляющие расстояний до стен
    if (App.sel.size === 1 && App.doc.settings.showGuides !== false) {
      const id = [...App.sel][0];
      if (Model.coll(id) === 'items') Render.itemGuides(env, Model.get(id));
      if (Model.coll(id) === 'openings') Render.openingGuides(env, Model.get(id));
    }
    // ручки
    for (const h of Tools.handles()) Render.handle(env, h);
    ctx.restore();
  },
  handle(env, h) {
    const { ctx, px, C } = env;
    const s = (h.kind === 'rotate' ? 6 : 4.5) * px;
    ctx.lineWidth = 1.4 * px; ctx.strokeStyle = C.accent; ctx.fillStyle = C.handle;
    if (h.kind === 'rotate') {
      if (h.from) { ctx.setLineDash([3 * px, 3 * px]); ctx.beginPath(); ctx.moveTo(h.from.x, h.from.y); ctx.lineTo(h.p.x, h.p.y); ctx.stroke(); ctx.setLineDash([]); }
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, s * 0.5, -Math.PI * 0.9, Math.PI * 0.4); ctx.stroke();
    } else if (h.kind === 'vertex' || h.kind === 'end') {
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(h.p.x - s, h.p.y - s, s * 2, s * 2); ctx.strokeRect(h.p.x - s, h.p.y - s, s * 2, s * 2);
    }
  },
  /** Грани стен как отрезки — для измерения расстояний */
  wallFaces() {
    const segs = [];
    for (const w of App.V.walls) {
      if (w.kind === 'fence') continue;
      const r = Model.wallRect(w);
      for (let i = 0; i < 4; i++) segs.push([r[i], r[(i + 1) % 4], w.id]);
    }
    return segs;
  },
  rayHit(p, dir, segs, maxT = 3000, exclude) {
    let best = maxT, hit = null;
    for (const [a, b, id] of segs) {
      if (exclude && exclude === id) continue;
      const t = G.raySeg(p, dir, a, b);
      if (t !== null && t < best) { best = t; hit = G.add(p, G.mul(dir, t)); }
    }
    return hit ? { t: best, p: hit } : null;
  },
  itemGuides(env, it) {
    if (catItem(it.key).layer === 'siteobj' && it.w > 250) return;
    const segs = Render.wallFaces();
    const dirs = [[1, 0, it.w / 2], [-1, 0, it.w / 2], [0, 1, it.d / 2], [0, -1, it.d / 2]];
    for (const [dx, dy, half] of dirs) {
      const dir = G.toWorld({ x: dx, y: dy }, 0, 0, it.rot);
      const start = G.add(it, G.mul(dir, half));
      const h = Render.rayHit(start, dir, segs, 800);
      if (h && h.t > 0.5) Render.guide(env, start, h.p, h.t);
    }
  },
  openingGuides(env, op) {
    const g = Model.opGeom(op);
    if (!g) return;
    const segs = Render.wallFaces();
    for (const [pt, dir, rem] of [[g.a, G.mul(g.u, -1), g.pos - g.width / 2], [g.b, g.u, g.L - g.pos - g.width / 2]]) {
      const h = Render.rayHit(pt, dir, segs, rem + 0.01, g.w.id);
      const end = h ? h.p : G.add(pt, G.mul(dir, rem));
      const d = h ? h.t : rem;
      if (d > 0.5) Render.guide(env, pt, end, d, G.mul(g.n, g.th / 2 + 14 * env.px));
    }
  },
  guide(env, a, b, len, offset) {
    const { ctx, px, C } = env;
    if (offset) { a = G.add(a, offset); b = G.add(b, offset); }
    ctx.save();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1 * px; ctx.setLineDash([4 * px, 3 * px]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 2 * px, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill(); }
    ctx.restore();
    if (G.dist(a, b) * env.scale > 24) Render.label(env, U.fmtLen(len), G.mid(a, b), G.angle(a, b), { size: 10.5, color: C.accent, bg: true, pad: 2 });
  },

  /* ------------------------ экранные элементы ---------------------------- */
  compassRect() { return { x: App.cw - 70, y: 70, r: 40 }; },
  compass(env) {
    const { ctx, C } = env;
    const { x, y, r } = Render.compassRect();
    const a = U.rad(App.doc.north);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = C.labelBg; ctx.strokeStyle = C.gridAxis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // солнце
    if (env.layers.shadows || env.layers.heat) {
      const s = Sun.current();
      const sa = U.rad(App.doc.north + s.az);
      const up = s.alt > 0;
      ctx.save(); ctx.rotate(sa);
      ctx.strokeStyle = up ? '#f0a020' : C.muted; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r + 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = up ? '#f7b733' : C.muted;
      ctx.beginPath(); ctx.arc(0, -r + 1, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.rotate(a);
    ctx.fillStyle = '#d33a3a';
    ctx.beginPath(); ctx.moveTo(0, -r + 8); ctx.lineTo(7, 0); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.inkSoft;
    ctx.beginPath(); ctx.moveTo(0, r - 8); ctx.lineTo(7, 0); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labels = [['С', 0], ['В', 90], ['Ю', 180], ['З', 270]];
    for (const [t, d] of labels) {
      const aa = U.rad(d);
      ctx.save(); ctx.translate(Math.sin(aa) * (r + 9), -Math.cos(aa) * (r + 9)); ctx.rotate(-a);
      ctx.fillStyle = t === 'С' ? '#d33a3a' : C.text; ctx.fillText(t, 0, 0); ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = C.muted; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('С: ' + (Math.round(App.doc.north * 10) / 10) + '°', x, y + r + 22);
  },
  scaleBar(env) {
    const { ctx, C } = env;
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const len = nice.find(n => n * env.scale >= 80) || 20000;
    const w = len * env.scale, x = 16, y = env.h - 22;
    ctx.fillStyle = C.labelBg; Painters.rr(ctx, x - 6, y - 20, w + 12, 30, 6); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y - 3); ctx.stroke();
    ctx.fillStyle = C.text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(len >= 100 ? (len / 100) + ' м' : len + ' см', x + w / 2, y - 7);
  },
};
