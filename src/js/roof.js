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
  // min — минимальный уклон, ° (СП 17.13330.2017 табл. 4.1 и инструкции производителей)
  metaltile: { name: 'Металлочерепица', color: '#8e3b30', min: 14 },
  profile:   { name: 'Профнастил', color: '#5d6d7c', min: 8 },
  seam:      { name: 'Фальцевая кровля', color: '#6f7780', min: 7 },
  soft:      { name: 'Гибкая черепица', color: '#6b4b3e', min: 12 },
  ceramic:   { name: 'Керамическая черепица', color: '#b0583c', min: 22 },
  ondulin:   { name: 'Ондулин', color: '#4f5e45', min: 6 },
  slate:     { name: 'Шифер', color: '#8f9397', min: 14 },
  membrane:  { name: 'Мембрана / наплавляемая (плоская)', color: '#4a4f57', min: 0 },
  polycarb:  { name: 'Сотовый поликарбонат', color: '#cfe3ec', glass: true, min: 5 },
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
  /** Высота низа кровли над точкой плана p (см) или null, если точка не под крышей */
  zAt(r, p) {
    const q = G.toLocal(p, r.x, r.y, r.rot || 0), W = r.w / 2, D = r.d / 2;
    if (Math.abs(q.x) > W + 0.01 || Math.abs(q.y) > D + 0.01) return null;
    const b = r.base || 0, t = Math.tan(U.rad(U.clamp(r.pitch || 0, 0, 75)));
    if (r.type === 'flat') return b;
    if (r.type === 'gable') return b + t * Math.max(0, D - Math.abs(q.y));
    if (r.type === 'shed') return b + t * Math.max(0, D - q.y);
    return b + t * Math.max(0, Math.min(W - Math.abs(q.x), D - Math.abs(q.y)));
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

  /* ------------------------ стропильная система -------------------------- */
  /** Опоры крыши: пролёт между осями наружных стен поперёк конька (по дому под крышей), см */
  support(r) {
    const fd = (App.floorData || []).find(f => f.floor.id === r.floor) || (App.floorData || [])[0];
    const pts = fd ? fd.outlines.flatMap(o => o.outer) : [];
    const loc = pts.map(p => G.toLocal(p, r.x, r.y, r.rot || 0)).filter(q => Math.abs(q.x) <= r.w / 2 + 1 && Math.abs(q.y) <= r.d / 2 + 1);
    if (!loc.length) return { v0: -r.d / 2 + 50, v1: r.d / 2 - 50, u0: -r.w / 2 + 50, u1: r.w / 2 - 50, th: 40 };
    const th = Math.max(20, ...App.doc.walls.filter(w => w.kind === 'ext' && (w.floor || App.doc.floors[0].id) === (fd ? fd.floor.id : w.floor)).map(w => w.th));
    const b = G.bbox(loc.map(q => ({ x: q.x, y: q.y })));
    return { v0: b.y0 + th / 2, v1: b.y1 - th / 2, u0: b.x0 + th / 2, u1: b.x1 - th / 2, th, outer: b };
  },
  /** Расчёт стропильной системы (упрощённо по СП 20.13330.2016 и СП 64.13330.2017): схема, сечения, шаг,
   *  проверка по прочности и прогибу, обрешётка по материалу кровли, объёмы пиломатериала */
  frame(r) {
    if (!r || r.type === 'flat') return null;
    const cl = Climate.get(), S = Roof.support(r), P = Roof.params(r), a = P.angle;
    const span = (r.type === 'shed' ? S.v1 - S.v0 : S.v1 - S.v0) / 100;           // м между осями стен
    const half = r.type === 'shed' ? span : span / 2;
    const mu = U.clamp((60 - U.deg(a)) / 30, 0, 1), Sg = cl.snowKpa, s0 = mu * Sg, sD = s0 * 1.4;   // снег: нормативный и расчётный
    const heavy = ['ceramic', 'slate'].includes(r.mat);
    const gRoof = heavy ? 0.65 : r.mat === 'soft' ? 0.35 : 0.25;                    // кровля + основание, кПа
    const gD = gRoof * 1.2 / Math.cos(a);
    const step = 0.6;
    // схема: до 6,5 м — наслонные стропила с затяжкой (потолочная балка), больше — заводские фермы на МЗП
    const truss = span > 6.5;
    const L = truss ? half / 2 : half;                                            // горизонтальный пролёт верхнего пояса / стропила между опорами
    const q = (gD + sD) * step;                                                   // кН/м по горизонтальной проекции
    const SECT = [[50, 150], [50, 200], [50, 250], [75, 200], [75, 250], [100, 250]];
    const R = 13, E = 10000;                                                       // МПа: изгиб (сосна 2 сорт с коэфф. условий), модуль упругости
    let pick = null;
    for (const [b, h] of SECT) {
      const W = b * h * h / 6 / 1e9, I = b * h ** 3 / 12 / 1e12;                  // м³, м⁴
      const M = q * L * L / 8;                                                    // кН·м
      const sig = M / W / 1000;                                                   // МПа
      const Ln = L / Math.cos(a), qn = (gRoof / Math.cos(a) + s0) * step * Math.cos(a);
      const f = 5 * qn * Ln ** 4 / (384 * E * 1000 * I) * 1000;                   // мм
      const fmax = Ln * 1000 / 200;
      if (sig <= R && f <= fmax) { pick = { b, h, sig, f, fmax, M }; break; }
    }
    pick = pick || { b: 100, h: 250, sig: NaN, f: NaN, fmax: NaN };
    const len = r.w / 100, n = Math.floor((S.u1 - S.u0) / 100 / step) + 1 + (r.type === 'hip' ? 0 : 0);
    const rafterL = (r.type === 'shed' ? r.d : r.d / 2) / 100 / Math.cos(a);        // со свесом, м
    const nRaft = r.type === 'shed' ? n : 2 * n;
    const BAT = { metaltile: ['25×100 шаг 350 (по шагу волны)', 0.35], profile: ['25×100 шаг 500', 0.5], seam: ['сплошная 25×100 с зазором 20 мм', 0.12], soft: ['сплошной настил OSB-3 12 мм по обрешётке 25×100 шаг 300', 0.3], ceramic: ['50×50 шаг 320–340', 0.33], ondulin: ['40×50 шаг 610', 0.6], slate: ['50×50 шаг 500', 0.5], polycarb: ['прогоны по расчёту', 0.6] }[r.mat] || ['25×100 шаг 350', 0.35];
    const slope = P.area / 1e4;
    const batM = slope / BAT[1];
    const woodV = (truss ? n * (2 * rafterL + span * 1.05 + span * 0.9) : nRaft * rafterL + n * span) * pick.b * pick.h / 1e6
      + batM * 0.025 * 0.1 + slope / step * 0.05 * 0.05 + 2 * len * 0.15 * 0.15;
    return {
      scheme: truss ? 'truss' : 'rafter', name: truss ? 'Фермы деревянные заводские на МЗП (W-образные), опора — наружные стены' : 'Наслонные стропила с затяжкой (потолочная балка), опора — мауэрлат и коньковый прогон',
      span, half, L, pitch: U.deg(a), step, n, nRaft, rafterL, b: pick.b, h: pick.h, sig: pick.sig, f: pick.f, fmax: pick.fmax, R,
      snow: { district: cl.snow, Sg, mu, s0, sD }, gRoof, q, len, slope, bat: BAT[0], batStep: BAT[1], batM, counter: slope / step, osb: r.mat === 'soft' ? slope : 0,
      membrane: slope * 1.15, mauerlat: 2 * len, anchors: Math.ceil(2 * len) + 2, woodV, S,
      attic: { ins: 200, vent: (S.v1 - S.v0) * (S.u1 - S.u0) / 1e4 / 300 },
    };
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
