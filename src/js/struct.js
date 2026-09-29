'use strict';
/* ==========================================================================
   Конструкции: автоматический расчёт фундамента (нагрузки → ширина подошвы,
   глубина заложения по промерзанию и пучинистости грунта, тип, армирование,
   объёмы) и кладки стен с армированием по материалу. Упрощённо, по СП 22.13330,
   СП 20.13330, СП 63.13330, СП 15.13330, СП 339.13330 — для эскиза и сметы;
   рабочий проект фундамента — по инженерно-геологическим изысканиям.
   ========================================================================== */

/* Грунты основания: R0 — расчётное сопротивление, кПа (СП 22.13330 прил. Б, ориентировочно); heave — пучинистый */
const SOILS = {
  sand:      { name: 'Песок средней крупности, крупный', R0: 400, heave: false },
  sandFine:  { name: 'Песок мелкий, пылеватый', R0: 300, heave: true },
  sandyLoam: { name: 'Супесь', R0: 250, heave: true },
  loam:      { name: 'Суглинок', R0: 220, heave: true },
  clay:      { name: 'Глина', R0: 250, heave: true },
  peat:      { name: 'Торф, насыпной, ил (слабый)', R0: 50, heave: true, weak: true },
};
const FOUND_TYPES = { auto: 'Подобрать автоматически', strip: 'Ленточный монолитный', mzlf: 'Мелкозаглублённый утеплённый (МЗЛФ)', slab: 'Утеплённая плита (УШП)', pile: 'Свайно-винтовой / буронабивной с ростверком' };
/* Плотность кладки, кН/м³ (с раствором и влажностью) */
const WALL_GAMMA = { aerated: 6, foam: 7, ceramic: 8.5, brick: 18, silicate: 19, concrete: 25, claybl: 12, cinder: 14, arbolit: 7, timber: 5.5, frame: 2, sip: 1.5, gkl: 1.5, pgp: 12, stone: 22 };
/* Кладка: сколько рядов между армированными, чем армировать, нужен ли армопояс */
const WALL_REINF = {
  aerated:  { every: 4, how: '2 стержня Ø8 А500 в штробах (стена ≥ 30 см — две штробы); первый ряд — на выравнивающий раствор по гидроизоляции', ring: true, src: 'СП 339.13330.2017; СТО НААГ 3.1-2013' },
  foam:     { every: 4, how: '2 стержня Ø8 А500 в штробах; первый ряд — по гидроизоляции', ring: true, src: 'СП 339.13330.2017' },
  arbolit:  { every: 4, how: 'кладочная сетка или 2 стержня Ø8 в швах', ring: true, src: 'ГОСТ 19222-2019; рекомендации производителей' },
  ceramic:  { every: 5, how: 'кладочная сетка из композита или Вр-I Ø4 в швах, обязательно — у углов и под окнами', ring: true, src: 'СП 15.13330.2020 п. 9.x; рекомендации производителей' },
  brick:    { every: 5, how: 'кладочная сетка Вр-I Ø4 ячейка 50×50 через 5 рядов (у углов и простенков)', ring: false, src: 'СП 15.13330.2020 п. 9.33' },
  silicate: { every: 5, how: 'кладочная сетка Вр-I Ø4 через 5 рядов', ring: false, src: 'СП 15.13330.2020' },
  claybl:   { every: 3, how: 'кладочная сетка или 2 стержня Ø6–8 через 3 ряда', ring: true, src: 'СП 15.13330.2020' },
  cinder:   { every: 3, how: 'кладочная сетка через 3 ряда', ring: true, src: 'СП 15.13330.2020' },
  stone:    { every: 4, how: 'кладочная сетка через 4 ряда, перевязка', ring: true, src: 'СП 15.13330.2020' },
  concrete: { every: 0, how: 'рабочее армирование монолита по расчёту (две сетки Ø10–12 шаг 200)', ring: false, src: 'СП 63.13330.2018' },
  timber:   { every: 0, how: 'не армируется: нагели через 1–1,5 м, межвенцовый утеплитель, запас на усадку над проёмами', ring: false, src: 'СП 64.13330.2017' },
  frame:    { every: 0, how: 'не армируется: жёсткость — раскосы или ОСП, крепёж по СП 64', ring: false, src: 'СП 64.13330.2017; СП 31-105-2002' },
  sip:      { every: 0, how: 'не армируется: соединение панелей брусом, герметизация стыков', ring: false, src: 'СП 31-105-2002' },
};
const REBAR_KG = { 6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.21 };

const Struct = {
  opt() {
    const s = App.doc.settings;
    return Object.assign({ soil: 'loam', gwl: 300, type: 'auto', plinth: 40 }, s.found || {});
  },
  set(k, v) { App.doc.settings.found = { ...(App.doc.settings.found || {}), [k]: v }; },
  /** Несущие стены этажа: наружные и внутренние несущие (перегородки — на стяжке) */
  bearing(fid) { return App.doc.walls.filter(w => (w.floor === fid) && (w.kind === 'ext' || w.kind === 'int')); },
  /** Расчёт фундамента дома: нагрузки, ширина, глубина, тип, армирование, объёмы */
  foundation() {
    const d = App.doc, o = Struct.opt(), f1 = d.floors[0], cl = Climate.get(), S = SOILS[o.soil] || SOILS.loam;
    const walls = Struct.bearing(f1.id);
    if (!walls.length) return null;
    const Lext = walls.filter(w => w.kind === 'ext').reduce((a, w) => a + Model.wallLen(w), 0) / 100, Lint = walls.filter(w => w.kind === 'int').reduce((a, w) => a + Model.wallLen(w), 0) / 100, L = Lext + Lint;
    const fd = (App.floorData || [])[0], area = fd ? fd.outlines.reduce((a, x) => a + x.area, 0) / 1e4 : 0;
    // нагрузки, кН: стены всех этажей над основанием, крыша со снегом, перекрытия
    let Gw = 0;
    for (const w of d.walls) if (w.kind === 'ext' || w.kind === 'int') Gw += (WALL_GAMMA[w.mat] || 10) * (w.th / 100) * (w.h / 100) * Model.wallLen(w) / 100;
    const roofA = d.roofs.reduce((a, r) => a + Roof.params(r).area / 1e4, 0) || area * 1.25;
    const roofDead = d.roofs.some(r => ['ceramic', 'slate'].includes(r.mat)) ? 0.8 : 0.5;
    const pitch = d.roofs.length ? Math.max(...d.roofs.map(r => r.type === 'flat' ? 0 : r.pitch || 0)) : 30;
    const mu = U.clamp((60 - pitch) / 30, 0, 1), snow = 0.7 * cl.snowKpa * mu;
    const Groof = roofA * (roofDead + snow);
    const Gceil = area * d.floors.length * (1.5 + 1.5);                     // перекрытия (балки, утеплитель, пол) + полезная 1,5 кПа
    const qn = (Gw + Groof + Gceil) / Math.max(L, 1);                       // кН/м по несущим стенам (без веса фундамента)
    const q = qn * 1.2;                                                     // с коэффициентом надёжности по нагрузке
    // глубина: пучинистые грунты — не меньше расчётного промерзания (дом отапливаемый, пол по грунту — kh 0,6)
    const dfn = Climate.frost() / 100, df = +(0.6 * dfn).toFixed(2);
    const high = o.gwl / 100 < df + 2;                                      // вода близко — пучение сильнее
    let type = o.type !== 'auto' ? o.type : S.weak ? 'pile' : S.heave && o.gwl < 150 ? 'slab' : S.heave && o.gwl < df * 100 + 50 ? 'mzlf' : 'strip';
    let depth = type === 'strip' ? (S.heave ? Math.max(df, 0.5) : 0.5) : type === 'mzlf' ? 0.5 : type === 'slab' ? 0.35 : 0;
    if (U.isNum(o.depth)) depth = o.depth / 100;
    // ширина подошвы: q / (R − γ·d); не меньше стены + 10 см и не меньше 30 см
    const thMax = Math.max(...walls.filter(w => w.kind === 'ext').map(w => w.th)) / 100;
    const H = depth + o.plinth / 100;                                        // высота ленты с цоколем
    const R = S.R0 * (type === 'mzlf' ? 0.9 : 1);
    let b = q / Math.max(30, R - 20 * H);
    b = Math.max(b, thMax + 0.1, 0.3);
    b = Math.ceil(b * 20) / 20;
    if (U.isNum(o.width)) b = o.width / 100;
    const p = (q + 24 * b * H) / b;                                          // давление под подошвой, кПа
    // объёмы и армирование (ленты)
    const out = { soil: S, soilKey: o.soil, gwl: o.gwl, type, depth, width: b, H, qn, q, p, R, df, dfn, L, Lext, Lint, area, Gw, Groof, Gceil, snow, high, plinth: o.plinth };
    if (type === 'strip' || type === 'mzlf') {
      out.concrete = L * b * H;
      const n = b <= 0.4 ? 2 : 3;                                            // стержней в ряду
      out.bars = `2 ряда по ${n} стержня Ø12 А500 (низ и верх), хомуты Ø8 А240 шаг 300`;
      out.rebar = (L * 2 * n * 1.1) * REBAR_KG[12] + (L / 0.3) * (2 * (b + H) - 0.2) * REBAR_KG[8];
      out.sand = L * (b + 0.4) * 0.2;
      out.xps = type === 'mzlf' ? L * (H + 1.2) : L * H;                     // утепление боковой грани (+ юбка у МЗЛФ)
    } else if (type === 'slab') {
      const A = area + Lext * 0.6;
      out.concrete = A * 0.1 + Lext * 0.3 * 0.2 + Lint * 0.3 * 0.2;         // плита 100 мм + рёбра 300×200
      out.bars = 'плита — сетка Ø8 шаг 200; рёбра — 4 Ø12 А500, хомуты Ø8 шаг 300';
      out.rebar = A * 2 * 5 * REBAR_KG[8] + L * 4 * 1.1 * REBAR_KG[12];
      out.sand = A * 0.3; out.xps = A + Lext * 1.2;
    } else {
      const piles = Math.ceil(L / 2.5) + 4;
      out.piles = piles; out.concrete = L * 0.4 * 0.4;                       // ростверк 400×400
      out.bars = `ростверк — 4 Ø12 А500, хомуты Ø8 шаг 300; сваи Ø108–133 длиной ${Math.max(2.5, dfn + 1).toFixed(1)} м через 2–2,5 м`;
      out.rebar = L * 4 * 1.1 * REBAR_KG[12] + (L / 0.3) * 1.4 * REBAR_KG[8];
      out.sand = 0; out.xps = L * 0.5;
    }
    return out;
  },
  /** Кладка и армирование: по каждой паре «материал, толщина» наружных и несущих стен */
  masonry() {
    const d = App.doc, rows = new Map();
    for (const w of d.walls) {
      if (w.kind === 'fence') continue;
      const R = WALL_REINF[w.mat] || { every: 0, how: '', ring: false, src: '' }, M = WALL_MATERIALS[w.mat] || {};
      const k = w.mat + ':' + w.th, L = Model.wallLen(w) / 100;
      const r = rows.get(k) || rows.set(k, { mat: w.mat, name: M.name || w.mat, th: w.th, len: 0, lenBear: 0, h: 0, rule: R, ops: 0, opLen: 0 }).get(k);
      r.len += L; r.h = Math.max(r.h, w.h / 100);
      if (w.kind === 'ext' || w.kind === 'int') r.lenBear += L;
      for (const o of d.openings) if (o.wall === w.id) { r.ops++; r.opLen += (o.w + 50) / 100; }   // перемычка: проём + 2 × 25 см опирания
    }
    for (const r of rows.values()) {
      const bh = (WALL_MATERIALS[r.mat] || {}).block ? WALL_MATERIALS[r.mat].block[1] / 100 : (r.mat === 'brick' || r.mat === 'silicate') ? 0.077 : 0.25;
      r.courses = Math.round(r.h / bh);
      r.reinfRows = r.rule.every ? 1 + Math.floor((r.courses - 1) / r.rule.every) : 0;
      const bars = r.th >= 30 ? 4 : 2;                                          // две штробы по 2 стержня у толстых стен
      r.rebar = r.rule.every ? r.len * r.reinfRows * bars * 1.05 * REBAR_KG[8] : 0;
      r.ring = r.rule.ring && r.lenBear ? { vol: r.lenBear * (r.th / 100) * 0.25, rebar: r.lenBear * 4 * 1.1 * REBAR_KG[12] } : null;
    }
    return [...rows.values()];
  },
  /** Замечания для «Анализа» (и автопроверки) */
  issues(add, m) {
    const F = Struct.foundation();
    if (!F) return;
    const o = Struct.opt(), fix = (k, v) => () => Struct.set(k, v);
    if (F.p > F.R * 1.001) add('bad', 'Фундамент', `давление под подошвой ${F.p.toFixed(0)} кПа больше расчётного сопротивления грунта ${F.R.toFixed(0)} кПа — расширьте подошву`, 'СП 22.13330.2016 п. 5.6', null, null, U.isNum(o.width) ? fix('width', undefined) : null);
    if (F.soil.heave && (F.type === 'strip') && F.depth < F.df - 0.005) add('bad', 'Фундамент', `глубина заложения ${m(F.depth * 100)} меньше расчётного промерзания ${m(F.df * 100)} на пучинистом грунте — фундамент будет выпирать`, 'СП 22.13330.2016 п. 5.5.3, табл. 5.3', null, null, fix('depth', undefined));
    if (F.soil.heave && F.type === 'strip' && F.high) add('warn', 'Фундамент', `грунтовые воды на ${m(o.gwl)} — ближе промерзания + 2 м: для ленты нужны дренаж и утепление отмостки, либо МЗЛФ / УШП`, 'СП 22.13330.2016 п. 5.5.4; СП 104.13330', null, null, fix('type', 'mzlf'));
    if (F.soil.weak && F.type !== 'pile') add('bad', 'Фундамент', 'слабый грунт (торф, насыпной, ил) — нужен свайный фундамент до плотного слоя или замена грунта', 'СП 22.13330.2016 п. 6.4; СП 24.13330', null, null, fix('type', 'pile'));
    if (!App.doc.settings.found) add('info', 'Фундамент', `грунт не указан — считаем «${F.soil.name.toLowerCase()}», уровень грунтовых вод ${m(o.gwl)}. Уточните на вкладке «Проект» → «Конструкции» (по изысканиям или соседям)`, 'СП 47.13330 (изыскания)');
    // ячеистые блоки: опирание перемычек и армопояс под крышу
    for (const w of App.doc.walls) {
      const R = WALL_REINF[w.mat];
      if (!R || !R.ring || w.kind !== 'ext') continue;
      for (const op of App.doc.openings.filter(x => x.wall === w.id && x.w > 150)) add('info', 'Конструкции', `${OPENING_TYPES[op.type].name} ${m(op.w)} в стене «${(WALL_MATERIALS[w.mat] || {}).name}»: перемычка — из U-блоков с армированием 2–4 Ø12 или готовая, опирание ≥ 25 см; ряд под окном — армировать с заходом 0,9 м в стороны`, R.src, G.mid(w.a, w.b), op.id);
    }
  },
  /** Слой «Кладка»: по стенам — материал и армирование, над проёмами несущих стен — перемычки с опиранием 25 см */
  drawMasonry(env) {
    const { ctx, px } = env, col = '#b45309';
    ctx.save();
    for (const w of App.V.walls) {
      if (w.kind === 'fence') continue;
      const R = WALL_REINF[w.mat], M = WALL_MATERIALS[w.mat] || {}, L = Model.wallLen(w);
      if (L < 60) continue;
      const u = G.unit(G.sub(w.b, w.a)), n = G.perp(u), ang = Math.atan2(u.y, u.x), up = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
      const txt = `${(M.name || w.mat).split(' (')[0]} ${Math.round(w.th)} см` + (R ? (R.every ? ` · армир. 1-й и каждый ${R.every}-й ряд` : '') + (R.ring && (w.kind === 'ext' || w.kind === 'int') ? ' · армопояс' : '') : '');
      Render.label(env, txt, G.add(G.mid(w.a, w.b), G.mul(n, w.th / 2 + 14 * px)), up, { size: 9.5, color: col, bg: true, pad: 1.5, prio: 4 });
      if (w.kind !== 'ext' && w.kind !== 'int') continue;
      for (const o of App.V.openings.filter(x => x.wall === w.id)) {
        const s0 = Math.max(0, o.pos - o.w / 2 - 25), s1 = Math.min(L, o.pos + o.w / 2 + 25);
        const A = G.add(G.add(w.a, G.mul(u, s0)), G.mul(n, w.th / 2 - 4)), B = G.add(G.add(w.a, G.mul(u, s1)), G.mul(n, w.th / 2 - 4));
        ctx.strokeStyle = col; ctx.lineWidth = 3 * px; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        for (const E of [A, B]) { ctx.beginPath(); ctx.moveTo(E.x - n.x * 8, E.y - n.y * 8); ctx.lineTo(E.x + n.x * 2, E.y + n.y * 2); ctx.stroke(); }
      }
    }
    ctx.restore();
  },
  /** Контур фундамента на плане: ленты под несущими стенами (пунктир), для УШП — плита */
  draw(env) {
    const F = Struct.foundation();
    if (!F) return;
    const { ctx, px } = env, col = '#6b5b45';
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * px; ctx.setLineDash([10 * px, 5 * px]);
    ctx.fillStyle = 'rgba(107, 91, 69, 0.05)';
    if (F.type === 'slab' && (App.floorData || [])[0]) {
      for (const ol of App.floorData[0].outlines) { const pts = G.offsetPoly(ol.outer, 30); Render.polyPath(ctx, pts, true); ctx.fill(); ctx.stroke(); }
    } else {
      const bw = F.type === 'pile' ? 40 : F.width * 100;
      for (const w of Struct.bearing(App.doc.floors[0].id)) {
        const u = G.unit(G.sub(w.b, w.a)), n = G.mul(G.perp(u), bw / 2), a = G.sub(w.a, G.mul(u, bw / 2)), b = G.add(w.b, G.mul(u, bw / 2));
        const pts = [G.add(a, n), G.add(b, n), G.sub(b, n), G.sub(a, n)];
        Render.polyPath(ctx, pts, true); ctx.fill(); ctx.stroke();
        if (F.type === 'pile') { const Lw = G.dist(w.a, w.b), k = Math.max(1, Math.round(Lw / 250)); ctx.setLineDash([]); for (let i = 0; i <= k; i++) { const c = G.add(w.a, G.mul(u, Lw * i / k)); ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.stroke(); } ctx.setLineDash([10 * px, 5 * px]); }
      }
    }
    ctx.restore();
  },
};
