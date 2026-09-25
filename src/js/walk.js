'use strict';
/* ==========================================================================
   Прогулка в 3D от первого лица (как в CS): WASD — ходьба и шаг вбок,
   ↑/↓ — вперёд/назад, ←/→ — поворот, мышь (ЛКМ) — осмотреться, Shift — бегом,
   Space — прыжок, C — присесть, PgUp/PgDn — этаж выше/ниже, N — сквозь стены.
   Стены, окна, заборы и высокая мебель не пускают; двери, арки, калитки — проходы.
   По ступеням крыльца и лестнице можно подняться. Единицы — см (план), высоты — см.
   ========================================================================== */

const Walk = {
  on: false,
  x: 0, y: 0,          // положение на плане, см
  foot: 0,             // высота ступней над нулём, см
  vy: 0,               // вертикальная скорость, см/с
  yaw: 0, pitch: 0,    // yaw — как у орбитальной камеры: взгляд (−sin, −cos) в плоскости плана
  level: 0,            // индекс этажа, по стенам которого считаются столкновения
  noclip: false,
  crouch: false,
  keys: new Set(),
  R: 22,               // «радиус» человека
  EYE: 165, STEP: 40,  // высота глаз, наибольшая ступенька
  _blk: null, _raf: 0, _t: 0,

  MOVE_CODES: new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyC']),

  /* ------------------------------ вход / выход ----------------------------- */
  start() {
    if (Walk.on) return;
    const c = View3D.cam;
    // «спускаемся» из орбитальной камеры туда, где она была, смотрим в ту же сторону
    const ex = (c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw)) * 100, ez = (c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)) * 100;
    const b = View3D.bounds || { x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
    Walk.x = U.clamp(ex, b.x0 - 800, b.x1 + 800); Walk.y = U.clamp(ez, b.y0 - 800, b.y1 + 800);
    Walk.yaw = c.yaw; Walk.pitch = 0;
    Walk.level = Math.max(0, Model.floorIdx(App.floor));
    Walk._saved = { ...c };
    Walk._blk = null;
    Walk.foot = Walk.top(Walk.x, Walk.y) ?? Walk.elev(Walk.level);
    Walk.vy = 0; Walk.crouch = false;
    Walk.on = true;
    // фокус с кнопок — иначе пробел «нажмёт» кнопку
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    document.body.classList.add('walking');
    UI.render3dPanel();
    Walk.hud();
    View3D.redraw();
  },
  stop() {
    if (!Walk.on) return;
    Walk.on = false; Walk.keys.clear();
    document.body.classList.remove('walking');
    if (Walk._saved) Object.assign(View3D.cam, Walk._saved);
    UI.render3dPanel();
    View3D.redraw();
  },
  hud() {
    const h = $('walkHud');
    if (!h) return;
    const f = App.doc.floors[Walk.level];
    h.textContent = `${f ? f.name : ''}${Walk.noclip ? ' · сквозь стены' : ''}${Walk.crouch ? ' · присел' : ''}  —  WASD ходить · ←→ поворот · мышь осмотреться · Shift бегом · Space прыжок · C присесть · PgUp/PgDn этаж · N сквозь стены · Esc выход`;
  },

  /* ------------------------------- клавиши -------------------------------- */
  /** true — клавиша обработана */
  key(e, down) {
    if (!View3D.active) return false;
    const code = e.code;
    if (down && !Walk.on && Walk.MOVE_CODES.has(code) && !['ShiftLeft', 'ShiftRight', 'Space', 'KeyC'].includes(code)) Walk.start();
    if (!Walk.on) return false;
    if (down) {
      if (code === 'Escape') { Walk.stop(); return true; }
      if (code === 'KeyN') { Walk.noclip = !Walk.noclip; Walk.hud(); return true; }
      if (code === 'PageUp' || code === 'PageDown') { Walk.setLevel(Walk.level + (code === 'PageUp' ? 1 : -1)); return true; }
      if (code === 'Space' && Walk.onGround()) Walk.vy = 360;
      if (code === 'KeyC') { Walk.crouch = !Walk.crouch; Walk.hud(); }
    }
    if (!Walk.MOVE_CODES.has(code)) return false;
    if (down) Walk.keys.add(code); else Walk.keys.delete(code);
    Walk.loop();
    return true;
  },
  setLevel(i) {
    const fl = App.doc.floors;
    if (i < 0 || i >= fl.length) return;
    Walk.level = i; Walk._blk = null;
    Walk.foot = Walk.top(Walk.x, Walk.y) ?? Walk.elev(i); Walk.vy = 0;
    Walk.hud(); View3D.redraw();
  },

  /* ------------------------------ геометрия ------------------------------- */
  elev(i) { const f = App.doc.floors[i]; return f ? f.elev : 0; },
  floorH(i) { const fl = App.doc.floors; return fl[i + 1] ? fl[i + 1].elev - fl[i].elev : (fl[i] ? fl[i].h : 300); },
  itemsOf(i) { const f = App.doc.floors[i]; return f ? App.doc.items.filter(it => (it.floor || App.doc.floors[0].id) === f.id) : []; },
  /** Высота верхней поверхности под точкой (пол этажа, лестница, крыльцо) или null, если под ногами дыра */
  top(x, y) {
    const i = Walk.level, E = Walk.elev(i), p = { x, y };
    const inRect = (it) => { const q = G.toLocal(p, it.x, it.y, it.rot || 0); return Math.abs(q.x) <= it.w / 2 && Math.abs(q.y) <= it.d / 2 ? q : null; };
    const cand = [];
    let hole = false;
    // лестница снизу: в этом месте перекрытия нет, поверхность — ступени нижнего марша
    if (i > 0) for (const it of Walk.itemsOf(i - 1)) {
      const sh = catItem(it.key).shape;
      if (sh !== 'stairs' && sh !== 'stairsL') continue;
      const q = inRect(it); if (!q) continue;
      hole = true; cand.push(Walk.elev(i - 1) + (it.d / 2 - q.y) / it.d * Walk.floorH(i - 1));
    }
    // открытая яма (и погреб с погребницей): внутри — дно или ступени
    for (const it of Walk.itemsOf(i)) {
      if (catItem(it.key).shape !== 'pit') continue;
      const g = pitGeom(it, it.w, it.d);
      if (g.cover === 'hatch') continue;
      const q = G.toLocal(p, it.x, it.y, it.rot || 0);
      if (Math.abs(q.x) > g.iw / 2 || Math.abs(q.y) > g.id / 2) continue;
      let z = E - g.depth;
      if (g.flight && g.stair === 'stairs') {
        const s = G.dot(G.sub(q, g.edge), g.dir), a = Math.abs(G.dot(G.sub(q, g.edge), g.across));
        if (s >= 0 && s <= g.L && a <= g.sw / 2) z = E - (Math.floor(s / g.tread) + 1) * g.rise;
      }
      return z;
    }
    if (!hole) cand.push(E);
    for (const it of Walk.itemsOf(i)) {
      const def = catItem(it.key), sh = def.shape;
      if (sh === 'stairs' || sh === 'stairsL') { const q = inRect(it); if (q) cand.push(E + (it.d / 2 - q.y) / it.d * Walk.floorH(i)); continue; }
      if (BLD_HOLLOW.has(sh)) { if (inRect(it)) cand.push(E + View3D.BLD_FLOOR); continue; }   // пол гаража/сарая
      if (sh !== 'veranda') continue;
      const g = porchGeom(it, it.w, it.d), q0 = G.toLocal(p, it.x, it.y, it.rot || 0);
      const ph = Math.max(g.o.ph, 10);
      if (Math.abs(q0.x) <= it.w / 2 && Math.abs(q0.y) <= it.d / 2) { cand.push(E + ph); continue; }
      for (const f of g.flights) {
        const along = G.dot(G.sub(q0, f.a), f.u), out = G.dot(G.sub(q0, f.a), f.out);
        if (along < 0 || along > f.sw || out <= 0 || out > (g.steps - 1) * g.tread) continue;
        cand.push(E + g.o.ph - Math.ceil(out / g.tread) * g.rise);
      }
    }
    return cand.length ? Math.max(...cand) : null;
  },
  /** Препятствия этажа: сплошные куски стен и заборов, окна, мебель и постройки (в плане) */
  blockers() {
    if (Walk._blk && Walk._blk.level === Walk.level) return Walk._blk.list;
    const f = App.doc.floors[Walk.level], list = [];
    if (f) Drawing.onFloor(f.id, () => {
      const cache = Render.endCache();
      for (const w of App.V.walls) {
        for (const poly of Render.wallPieces(w, cache)) list.push({ poly, h: w.h || 300 });
        // окна — не проход
        for (const op of App.V.openings) {
          if (op.wall !== w.id || (OPENING_TYPES[op.type] || {}).cat === 'door') continue;
          const g = Model.opGeom(op); if (!g) continue;
          const n = G.mul(g.n, g.th / 2);
          list.push({ poly: [G.add(g.a, n), G.add(g.b, n), G.sub(g.b, n), G.sub(g.a, n)], h: w.h || 300 });
        }
      }
      const skip = new Set(['rug', 'veranda', 'deck', 'stairs', 'stairsL', 'parking', 'pool', 'upper', 'hood', 'gardenbed', 'flowerbed', 'filterfield', 'ground', 'playground', 'bush']);
      for (const it of App.V.items) {
        const def = catItem(it.key), sh = def.shape;
        if (def.sym || skip.has(sh)) continue;
        if (sh === 'tree' || sh === 'conifer') { list.push({ poly: G.rectPts(it.x, it.y, 30, 30, 0), h: 1000 }); continue; }
        if (!(it.h >= 40)) continue;
        // гараж, сарай, баня — только стены: внутрь можно зайти через ворота/дверь
        if (BLD_HOLLOW.has(sh)) {
          const s = bldShell(it, it.w, it.d), W = (x, y) => bldWorld(it, { x, y });
          const rects = s.walls.concat(s.ops.filter(o => o.cat === 'window').map(o => o.rect));   // окна — не проход
          for (const r of rects) list.push({ poly: [W(r.x0, r.y0), W(r.x1, r.y0), W(r.x1, r.y1), W(r.x0, r.y1)], h: it.h });
          continue;
        }
        list.push({ poly: Model.itemPts(it), h: it.h });
      }
      // ограждение/остекление/стены крыльца и веранды (кроме проходов к ступеням)
      for (const it of App.V.items) {
        if (catItem(it.key).shape !== 'veranda') continue;
        const g = porchGeom(it, it.w, it.d);
        if (g.o.encl === 'open') continue;
        const W = (q) => G.toWorld(q, it.x, it.y, it.rot || 0), base = Math.max(g.o.ph, 10);
        for (const s of g.segs) list.push({ poly: [W(s.a), W(s.b), W(G.add(s.b, G.mul(s.n, 8))), W(G.add(s.a, G.mul(s.n, 8)))], h: base + 100, from: base });
      }
    });
    for (const b of list) { const xs = b.poly.map(p => p.x), ys = b.poly.map(p => p.y); b.bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    Walk._blk = { level: Walk.level, list };
    return list;
  },
  /** Насколько человек «влез» в препятствия в точке (x, y), см; 0 — свободно */
  depth(x, y) {
    if (Walk.noclip) return 0;
    const r = Walk.R, p = { x, y }, E = Walk.elev(Walk.level), footRel = Walk.foot - E;
    let worst = 0;
    for (const b of Walk.blockers()) {
      if (x < b.bb[0] - r || x > b.bb[2] + r || y < b.bb[1] - r || y > b.bb[3] + r) continue;
      if (b.h <= footRel + Walk.STEP) continue;                     // низкое — перешагнём
      if (b.from !== undefined && footRel + 60 < b.from) continue;  // перила крыльца, когда мы внизу у площадки
      const P = b.poly;
      let dm = Infinity;
      for (let k = 0; k < P.length; k++) dm = Math.min(dm, G.distSeg(p, P[k], P[(k + 1) % P.length]));
      const d = G.pointInPoly(p, P) ? r + dm : r - dm;
      if (d > worst) worst = d;
    }
    return worst;
  },
  hits(x, y) { return Walk.depth(x, y) > 0; },
  onGround() { const t = Walk.top(Walk.x, Walk.y); return t !== null && Walk.foot <= t + 1; },
  /** Можно ли встать в точку: нет препятствий и не слишком высокая ступень */
  canStand(x, y) {
    // из препятствия (например, после смены этажа) можно только выбираться, но не углубляться
    const d = Walk.depth(x, y);
    if (d > 0 && d > Walk.depth(Walk.x, Walk.y) + 0.01) return false;
    const t = Walk.top(x, y);
    return Walk.noclip || t === null || t <= Walk.foot + Walk.STEP;
  },

  /* -------------------------------- цикл ---------------------------------- */
  loop() {
    if (Walk._raf) return;
    Walk._t = performance.now();
    const tick = (now) => {
      Walk._raf = 0;
      if (!Walk.on || !View3D.active) return;
      const dt = Math.min(0.1, (now - Walk._t) / 1000); Walk._t = now;
      const moving = Walk.update(dt);
      View3D.draw();
      if (moving) Walk._raf = requestAnimationFrame(tick);
    };
    Walk._raf = requestAnimationFrame(tick);
  },
  /** Шаг симуляции; true — есть движение (нужен следующий кадр) */
  update(dt) {
    const k = Walk.keys, has = (c) => k.has(c);
    // поворот
    const turn = (has('ArrowLeft') || has('KeyQ') ? 1 : 0) - (has('ArrowRight') || has('KeyE') ? 1 : 0);
    Walk.yaw += turn * 1.9 * dt;
    // перемещение в плоскости: вперёд (−sin, −cos), вправо (cos, −sin)
    const fwd = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    const side = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    const run = has('ShiftLeft') || has('ShiftRight');
    const speed = (Walk.crouch ? 90 : run ? 420 : 170) * (Walk.noclip && run ? 2.5 : 1);
    let mx = 0, my = 0;
    if (fwd || side) {
      const s = Math.sin(Walk.yaw), c = Math.cos(Walk.yaw), L = Math.hypot(fwd, side);
      mx = (-s * fwd + c * side) / L * speed * dt; my = (-c * fwd - s * side) / L * speed * dt;
      // со скольжением вдоль стен
      if (Walk.canStand(Walk.x + mx, Walk.y + my)) { Walk.x += mx; Walk.y += my; }
      else if (Walk.canStand(Walk.x + mx, Walk.y)) Walk.x += mx;
      else if (Walk.canStand(Walk.x, Walk.y + my)) Walk.y += my;
    }
    // вертикаль: ступени, прыжок, падение, переход между этажами
    const top = Walk.top(Walk.x, Walk.y);
    const ground = top ?? (Walk.elev(Walk.level) - 1000);
    if (Walk.vy > 0 || Walk.foot > ground + 0.5) {
      Walk.vy -= 980 * dt; Walk.foot += Walk.vy * dt;
      if (Walk.foot <= ground) { Walk.foot = ground; Walk.vy = 0; }
    } else Walk.foot = ground;
    const fl = App.doc.floors, i = Walk.level;
    if (fl[i + 1] && Walk.foot >= fl[i + 1].elev - 5) { Walk.level = i + 1; Walk._blk = null; Walk.hud(); }
    else if (i > 0 && Walk.foot < Walk.elev(i) - 20) { Walk.level = i - 1; Walk._blk = null; Walk.hud(); }
    return !!(turn || fwd || side || Walk.vy !== 0 || Walk.foot > ground + 0.5);
  },
  /** Камера: глаз и точка взгляда (м), для View3D.draw */
  camera() {
    const eyeH = Walk.crouch ? 105 : Walk.EYE;
    const e = [Walk.x / 100, (Walk.foot + eyeH) / 100, Walk.y / 100];
    const cp = Math.cos(Walk.pitch);
    return { eye: e, at: [e[0] - Math.sin(Walk.yaw) * cp, e[1] + Math.sin(Walk.pitch), e[2] - Math.cos(Walk.yaw) * cp], fov: 1.15 };
  },
  /** Осмотреться мышью */
  look(dx, dy) {
    Walk.yaw -= dx * 0.004;
    Walk.pitch = U.clamp(Walk.pitch - dy * 0.004, -1.35, 1.35);
    View3D.redraw();
  },
  /** Вызывается при перестройке модели: препятствия пересчитать */
  invalidate() { Walk._blk = null; },
};
