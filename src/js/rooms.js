'use strict';
/* ==========================================================================
   Поиск помещений: планарный граф по осям стен (без заборов) → замкнутые грани.
   Разбивка по пересечениям и T-стыкам, слияние узлов, обход «самый правый поворот».
   ========================================================================== */

const Rooms = {
  EPS_MERGE: 1.5,   // см
  EPS_PERP: 1.5,

  outlines: [],
  detect(allWalls) {
    const walls = allWalls.filter(w => w.kind !== 'fence' && G.dist(w.a, w.b) > 1);
    Rooms.outlines = [];
    if (!walls.length) return [];
    const at = (w, t) => ({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t });
    const splits = walls.map(() => new Set([0, 1]));
    for (let i = 0; i < walls.length; i++) {
      const A = walls[i];
      for (let j = i + 1; j < walls.length; j++) {
        const B = walls[j];
        const hit = G.segInter(A.a, A.b, B.a, B.b);
        if (hit) { splits[i].add(U.clamp(hit.t, 0, 1)); splits[j].add(U.clamp(hit.u, 0, 1)); }
      }
      for (let j = 0; j < walls.length; j++) {
        if (i === j) continue;
        for (const p of [walls[j].a, walls[j].b]) {
          const pr = G.proj(p, A.a, A.b);
          if (pr.d <= this.EPS_PERP && pr.t > 1e-4 && pr.t < 1 - 1e-4) splits[i].add(pr.t);
        }
      }
    }
    const nodes = [];
    const grid = new Map();
    const cell = this.EPS_MERGE * 2;
    const addNode = (p) => {
      const gx = Math.round(p.x / cell), gy = Math.round(p.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get((gx + dx) + ',' + (gy + dy));
        if (arr) for (const idx of arr) if (G.dist2(nodes[idx], p) <= (this.EPS_MERGE * 2) ** 2) return idx;
      }
      nodes.push({ x: p.x, y: p.y });
      const k = gx + ',' + gy;
      (grid.get(k) || grid.set(k, []).get(k)).push(nodes.length - 1);
      return nodes.length - 1;
    };
    const adj = new Map();
    const addHalf = (f, t) => {
      if (f === t) return;
      let l = adj.get(f);
      if (!l) adj.set(f, l = []);
      if (!l.some(e => e.to === t)) l.push({ to: t, angle: Math.atan2(nodes[t].y - nodes[f].y, nodes[t].x - nodes[f].x) });
    };
    for (let i = 0; i < walls.length; i++) {
      const ts = [...splits[i]].sort((a, b) => a - b);
      const ids = ts.map(t => addNode(at(walls[i], t)));
      for (let k = 0; k < ids.length - 1; k++) {
        if (ids[k] === ids[k + 1]) continue;
        addHalf(ids[k], ids[k + 1]); addHalf(ids[k + 1], ids[k]);
      }
    }
    const next = (from, to) => {
      const list = adj.get(to);
      if (!list) return null;
      const aIn = Math.atan2(nodes[from].y - nodes[to].y, nodes[from].x - nodes[to].x);
      let best = null, bd = Infinity;
      for (const e of list) {
        let diff = e.angle - aIn;
        while (diff <= 1e-9) diff += Math.PI * 2;
        if (diff < bd) { bd = diff; best = e; }
      }
      return best ? { from: to, to: best.to } : null;
    };
    const used = new Set();
    const faces = [], outers = [];
    for (const [from, list] of adj) {
      for (const e of list) {
        const k0 = from + '>' + e.to;
        if (used.has(k0)) continue;
        const local = new Set(), poly = [];
        let cur = { from, to: e.to }, guard = 0, ok = false;
        while (guard++ < 20000) {
          const k = cur.from + '>' + cur.to;
          if (local.has(k) || used.has(k)) break;
          local.add(k); poly.push(nodes[cur.from]);
          const n = next(cur.from, cur.to);
          if (!n) break;
          cur = n;
          if (cur.from === from && cur.to === e.to) { ok = true; break; }
        }
        for (const k of local) used.add(k);
        if (!ok || poly.length < 3) continue;
        // при таком обходе ограниченные грани идут против часовой (площадь < 0 в y-вниз),
        // внешний контур компоненты — по часовой (площадь > 0)
        const area = -G.polyArea(poly);
        if (area < 0) { if (-area >= 2500) outers.push(poly); continue; }   // внешний контур здания
        if (area < 2500) continue;   // < 0.25 м² — мусор
        faces.push(poly.reverse());
      }
    }
    // Контуры застройки: внешние грани, вынесенные наружу на половину толщины стен
    Rooms.outlines = outers.map(o => {
      const pts = o;
      const thAt = (k) => {
        const p = pts[k], q = pts[(k + 1) % pts.length], m = G.mid(p, q);
        let best = 0, bd = 4;
        for (const w of walls) { const d = G.distSeg(m, w.a, w.b); if (d < bd) { bd = d; best = w.th; } }
        return -best / 2;
      };
      const out = G.inset(pts, thAt);
      return { axis: pts, outer: out, area: Math.abs(G.polyArea(out)), areaAxis: Math.abs(G.polyArea(pts)) };
    });
    // Помещение: осевой контур + контур «по полу» (за вычетом половины толщины стен)
    const rooms = faces.map((pts, i) => {
      const thAt = (k) => {
        const p = pts[k], q = pts[(k + 1) % pts.length], m = G.mid(p, q);
        let best = 0, bd = 4;
        for (const w of walls) { const d = G.distSeg(m, w.a, w.b); if (d < bd) { bd = d; best = w.th; } }
        return best / 2;
      };
      const floor = G.inset(pts, thAt);
      const fa = Math.abs(G.polyArea(floor));
      const ok = fa > 0 && fa < Math.abs(G.polyArea(pts));
      return {
        idx: i,
        axis: pts,
        floor: ok ? floor : pts,
        areaAxis: Math.abs(G.polyArea(pts)),
        areaFloor: ok ? fa : Math.abs(G.polyArea(pts)),
        perimFloor: G.polyPerimeter(ok ? floor : pts),
        label: G.labelPoint(ok ? floor : pts),
      };
    });
    // Вложенные грани (двор внутри контура) — удаляем внешние дубликаты не нужно: обход правым поворотом даёт только минимальные грани.
    rooms.sort((a, b) => b.areaAxis - a.areaAxis);
    // Назначаем имена по «якорям» (roomTags)
    const tags = App.doc.roomTags;
    const usedTags = new Set();
    // Сначала от меньших помещений к большим — чтобы якорь попал в самое вложенное
    const bySize = [...rooms].sort((a, b) => a.areaAxis - b.areaAxis);
    for (const r of bySize) {
      const t = tags.find(t => !usedTags.has(t.id) && G.pointInPoly(t, r.axis));
      if (t) { usedTags.add(t.id); r.tag = t; r.name = t.name; r.label = { x: t.x, y: t.y }; }
    }
    let n = 1;
    for (const r of rooms) { r.id = r.tag ? r.tag.id : 'room' + n; if (!r.name) r.name = 'Помещение ' + n; n++; }
    return rooms;
  },

  area(r) { return App.doc.settings.areaMode === 'axis' ? r.areaAxis : r.areaFloor; },
  /** Сводка площадей: помещения, здание, участок, зоны */
  summary() {
    const rooms = App.rooms;
    const total = rooms.reduce((s, r) => s + r.areaFloor, 0);
    const living = rooms.filter(r => r.tag && r.tag.living).reduce((s, r) => s + r.areaFloor, 0);
    const axis = rooms.reduce((s, r) => s + r.areaAxis, 0);
    const footprint = Rooms.outlines.reduce((s, o) => s + o.area, 0);
    // постройки на участке (предметы-постройки)
    const outb = App.doc.items.filter(it => ['building', 'garage', 'canopy', 'canopyLean', 'gazebo', 'greenhouse', 'pool', 'deck'].includes(catItem(it.key).shape));
    const outbArea = outb.reduce((s, it) => s + it.w * it.d, 0);
    const plots = App.doc.areas.filter(a => a.kind === 'plot');
    const plotArea = plots.reduce((s, a) => s + Math.abs(G.polyArea(a.pts)), 0);
    const zones = {};
    for (const a of App.doc.areas) if (a.kind !== 'plot') {
      const z = zones[a.kind] || (zones[a.kind] = { name: AREA_KINDS[a.kind].name, area: 0, count: 0 });
      z.area += Math.abs(G.polyArea(a.pts)); z.count++;
    }
    for (const r of App.doc.roads) {
      const z = zones['road:' + r.kind] || (zones['road:' + r.kind] = { name: ROAD_KINDS[r.kind].name, area: 0, count: 0 });
      z.area += G.polyPerimeter(r.pts, false) * r.width; z.count++;
    }
    const built = footprint + outb.filter(it => catItem(it.key).shape !== 'deck' && catItem(it.key).shape !== 'pool').reduce((s, it) => s + it.w * it.d, 0);
    return { total, living, axis, footprint, outb, outbArea, plotArea, zones, built, free: plotArea ? plotArea - built : 0 };
  },
  at(p) {
    let best = null;
    for (const r of App.rooms) if (G.pointInPoly(p, r.axis) && (!best || r.areaAxis < best.areaAxis)) best = r;
    return best;
  },
  /** Окна помещения со сторонами света */
  windowsOf(room) {
    const res = [];
    for (const op of App.doc.openings) {
      const t = OPENING_TYPES[op.type];
      if (!t || t.cat !== 'window') continue;
      const info = Sun.windowInfo(op);
      if (info && info.room === room) res.push({ op, info });
    }
    return res;
  },
};
