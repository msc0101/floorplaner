'use strict';
/* ==========================================================================
   Крыши: прямоугольные в плане (с поворотом) — двускатная, вальмовая,
   односкатная, плоская. Геометрия для плана, 3D, теней и расчёта кровли.
   Локальные оси: u — вдоль ширины w (конёк двускатной идёт вдоль u),
   v — вдоль глубины d; у односкатной высокая сторона — «спинка» (−d/2).
   ========================================================================== */

const ROOF_TYPES = {
  gable: { name: 'Двускатная' },
  hip:   { name: 'Вальмовая (четырёхскатная)' },
  shed:  { name: 'Односкатная' },
  flat:  { name: 'Плоская' },
};
const ROOF_MATERIALS = {
  metaltile: { name: 'Металлочерепица', color: '#8e3b30' },
  profile:   { name: 'Профнастил', color: '#5d6d7c' },
  seam:      { name: 'Фальцевая кровля', color: '#6f7780' },
  soft:      { name: 'Гибкая черепица', color: '#6b4b3e' },
  ceramic:   { name: 'Керамическая черепица', color: '#b0583c' },
  ondulin:   { name: 'Ондулин', color: '#4f5e45' },
  slate:     { name: 'Шифер', color: '#8f9397' },
  membrane:  { name: 'Мембрана / наплавляемая (плоская)', color: '#4a4f57' },
  polycarb:  { name: 'Сотовый поликарбонат', color: '#cfe3ec', glass: true },
};

const Roof = {
  /** Высота подъёма ската и параметры */
  params(r) {
    const p = U.rad(r.type === 'flat' ? 0 : U.clamp(r.pitch || 0, 0, 75));
    const t = Math.tan(p);
    let rise = 0;
    if (r.type === 'gable') rise = (r.d / 2) * t;
    else if (r.type === 'hip') rise = (Math.min(r.w, r.d) / 2) * t;
    else if (r.type === 'shed') rise = r.d * t;
    const area = r.type === 'flat' ? r.w * r.d : r.w * r.d / Math.cos(p);
    const ridge = r.type === 'gable' ? r.w : r.type === 'hip' ? Math.abs(r.w - r.d) : 0;
    const rafter = r.type === 'gable' ? (r.d / 2) / Math.cos(p) : r.type === 'hip' ? (Math.min(r.w, r.d) / 2) / Math.cos(p) : r.type === 'shed' ? r.d / Math.cos(p) : 0;
    const eaves = r.type === 'gable' ? 2 * r.w : r.type === 'shed' ? r.w : 2 * (r.w + r.d);
    const rakes = r.type === 'gable' ? 4 * rafter : r.type === 'shed' ? 2 * rafter : 0;
    const hipLen = r.type === 'hip' ? 4 * Math.hypot(Math.min(r.w, r.d) / 2, Math.min(r.w, r.d) / 2, rise) : 0;
    return { angle: p, rise, area, ridge, rafter, eaves, rakes, hipLen, top: (r.base || 0) + (r.type === 'flat' ? 20 : rise) };
  },
  /** Грани в локальных координатах: массив полигонов [{u, v, z}] (z — от основания) */
  facesLocal(r) {
    const { rise } = Roof.params(r);
    const W = r.w / 2, D = r.d / 2;
    const P = (u, v, z) => ({ u, v, z });
    if (r.type === 'flat') {
      const z = 20;
      return [[P(-W, -D, z), P(W, -D, z), P(W, D, z), P(-W, D, z)]];
    }
    if (r.type === 'gable') return [
      [P(-W, D, 0), P(W, D, 0), P(W, 0, rise), P(-W, 0, rise)],
      [P(W, -D, 0), P(-W, -D, 0), P(-W, 0, rise), P(W, 0, rise)],
      [P(-W, -D, 0), P(-W, D, 0), P(-W, 0, rise)],
      [P(W, D, 0), P(W, -D, 0), P(W, 0, rise)],
    ];
    if (r.type === 'shed') return [
      [P(-W, D, 0), P(W, D, 0), P(W, -D, rise), P(-W, -D, rise)],
      [P(-W, -D, 0), P(-W, D, 0), P(-W, -D, rise)],
      [P(W, D, 0), P(W, -D, 0), P(W, -D, rise)],
      [P(W, -D, 0), P(-W, -D, 0), P(-W, -D, rise), P(W, -D, rise)],
    ];
    // вальмовая: конёк вдоль длинной стороны
    if (r.w >= r.d) {
      const a = W - D;
      return [
        [P(-W, D, 0), P(W, D, 0), P(a, 0, rise), P(-a, 0, rise)],
        [P(W, -D, 0), P(-W, -D, 0), P(-a, 0, rise), P(a, 0, rise)],
        [P(-W, -D, 0), P(-W, D, 0), P(-a, 0, rise)],
        [P(W, D, 0), P(W, -D, 0), P(a, 0, rise)],
      ];
    }
    const b = D - W;
    return [
      [P(W, D, 0), P(W, -D, 0), P(0, -b, rise), P(0, b, rise)],
      [P(-W, -D, 0), P(-W, D, 0), P(0, b, rise), P(0, -b, rise)],
      [P(-W, D, 0), P(W, D, 0), P(0, b, rise)],
      [P(W, -D, 0), P(-W, -D, 0), P(0, -b, rise)],
    ];
  },
  toWorld(r, q) { const p = G.toWorld({ x: q.u, y: q.v }, r.x, r.y, r.rot || 0); return { x: p.x, y: p.y, z: (r.base || 0) + q.z }; },
  faces(r) { return Roof.facesLocal(r).map(f => f.map(q => Roof.toWorld(r, q))); },
  /** Линии на плане: контур, коньки, рёбра */
  planLines(r) {
    const W = r.w / 2, D = r.d / 2;
    const w = (u, v) => G.toWorld({ x: u, y: v }, r.x, r.y, r.rot || 0);
    const lines = [];
    if (r.type === 'gable') lines.push([w(-W, 0), w(W, 0)]);
    if (r.type === 'hip') {
      if (r.w >= r.d) { const a = W - D; lines.push([w(-a, 0), w(a, 0)], [w(-W, -D), w(-a, 0)], [w(-W, D), w(-a, 0)], [w(W, -D), w(a, 0)], [w(W, D), w(a, 0)]); }
      else { const b = D - W; lines.push([w(0, -b), w(0, b)], [w(-W, -D), w(0, -b)], [w(W, -D), w(0, -b)], [w(-W, D), w(0, b)], [w(W, D), w(0, b)]); }
    }
    return lines;
  },
  /** Стрелки уклона: [откуда, куда] в плане */
  slopeArrows(r) {
    const W = r.w / 2, D = r.d / 2;
    const w = (u, v) => G.toWorld({ x: u, y: v }, r.x, r.y, r.rot || 0);
    if (r.type === 'gable') return [[w(0, -D * 0.2), w(0, -D * 0.7)], [w(0, D * 0.2), w(0, D * 0.7)]];
    if (r.type === 'shed') return [[w(0, -D * 0.4), w(0, D * 0.4)]];
    if (r.type === 'hip') return r.w >= r.d
      ? [[w(0, -D * 0.2), w(0, -D * 0.7)], [w(0, D * 0.2), w(0, D * 0.7)], [w(-W + D * 0.5, 0), w(-W + D * 0.15, 0)], [w(W - D * 0.5, 0), w(W - D * 0.15, 0)]]
      : [[w(-W * 0.2, 0), w(-W * 0.7, 0)], [w(W * 0.2, 0), w(W * 0.7, 0)], [w(0, -D + W * 0.5), w(0, -D + W * 0.15)], [w(0, D - W * 0.5), w(0, D - W * 0.15)]];
    return [];
  },
  /** Объект-тень: выпуклый многогранник (вершины с высотами) */
  caster(r) {
    const verts = [];
    for (const f of Roof.faces(r)) for (const p of f) verts.push(p);
    // низ кровли на уровне основания (свесы) — даёт тень «от карниза»
    return { id: r.id, verts };
  },
  /** Крыша по контуру: минимальный ориентированный прямоугольник + свес */
  fromOutline(pts, overhang = 50) {
    const hull = G.hull(pts);
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const ang = G.angle(a, b);
      const loc = hull.map(p => G.rotate(p, { x: 0, y: 0 }, -ang));
      const bb = G.bbox(loc);
      const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
      if (!best || area < best.area - 1e-6) best = { area, ang, bb };
    }
    if (!best) return null;
    const { ang, bb } = best;
    let w = bb.x1 - bb.x0 + overhang * 2, d = bb.y1 - bb.y0 + overhang * 2;
    const c = G.rotate({ x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }, { x: 0, y: 0 }, ang);
    let rot = U.deg(ang);
    if (d > w) { [w, d] = [d, w]; rot += 90; }     // конёк — вдоль длинной стороны
    return { x: c.x, y: c.y, w: Math.round(w), d: Math.round(d), rot: U.normDeg(Math.round(rot * 10) / 10) };
  },
  /** Отметка основания крыши по умолчанию: верх стен этажа */
  autoBase(floorId) {
    const f = App.doc.floors.find(x => x.id === floorId) || App.doc.floors[App.doc.floors.length - 1];
    const walls = App.doc.walls.filter(w => w.floor === f.id && w.kind !== 'fence');
    const h = walls.length ? Math.max(...walls.map(w => w.h)) : f.h;
    return f.elev + h;
  },

  /* ------------------------------ план ----------------------------------- */
  draw(env, r) {
    const { ctx, px, C } = env;
    const M = ROOF_MATERIALS[r.mat] || ROOF_MATERIALS.metaltile;
    const pts = G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0);
    ctx.save();
    ctx.globalAlpha = env.ghost ? 0.35 : 1;
    // лёгкая заливка цветом кровли, чтобы крыша читалась, но план под ней был виден
    Render.polyPath(ctx, pts);
    ctx.fillStyle = M.color + (App.doc.settings.roofFill === false ? '00' : '1c'); ctx.fill();
    ctx.setLineDash([10 * px, 5 * px]);
    ctx.strokeStyle = M.color; ctx.lineWidth = 1.6 * px; ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.3 * px;
    for (const [a, b] of Roof.planLines(r)) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    if (r.type !== 'flat') for (const [a, b] of Roof.slopeArrows(r)) {
      const u = G.unit(G.sub(b, a)), n = G.perp(u), s = 7 * px;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.moveTo(b.x - u.x * s + n.x * s * 0.6, b.y - u.y * s + n.y * s * 0.6); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - u.x * s - n.x * s * 0.6, b.y - u.y * s - n.y * s * 0.6);
      ctx.stroke();
    }
    ctx.restore();
    if (!env.ghost) {
      const P = Roof.params(r);
      const lp = r.type === 'gable' || r.type === 'hip' ? G.toWorld({ x: 0, y: r.d * 0.3 }, r.x, r.y, r.rot || 0) : { x: r.x, y: r.y };
      Render.label(env, [`Кровля ${U.fmtArea(P.area)}`, r.type === 'flat' ? 'плоская' : `${Math.round(r.pitch)}° · конёк +${U.fmtLen(P.top)}`], lp, 0,
        { size: 11, bold: true, color: M.color, color2: C.muted, prio: 5 });
    }
  },
};
