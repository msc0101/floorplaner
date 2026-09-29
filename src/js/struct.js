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
  sand:      { name: 'Песок средней крупности, крупный', R0: 400, heave: false, d0: 0.30 },
  sandFine:  { name: 'Песок мелкий, пылеватый', R0: 300, heave: true, d0: 0.28 },
  sandyLoam: { name: 'Супесь', R0: 250, heave: true, d0: 0.28 },
  loam:      { name: 'Суглинок', R0: 220, heave: true, d0: 0.23 },
  clay:      { name: 'Глина', R0: 250, heave: true, d0: 0.23 },
  peat:      { name: 'Торф, насыпной, ил (слабый)', R0: 50, heave: true, weak: true, d0: 0.23 },
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
  /** Настройки основания: soil — грунт под растительным слоем (толщиной top), layer — его мощность, soil2 — что ниже; survey — есть изыскания */
  opt() {
    const s = App.doc.settings;
    return Object.assign({ soil: 'loam', gwl: 300, type: 'auto', plinth: 40, top: 20, layer: 0, soil2: 'clay', survey: false }, s.found || {});
  },
  /** Грунт словами: «растительный 5 см, песок мелкий 1,0 м, ниже глина» */
  soilText() {
    const o = Struct.opt(), S1 = SOILS[o.soil] || SOILS.loam, S2 = o.soil2 && o.layer ? SOILS[o.soil2] : null;
    return (o.top ? `растительный слой ${o.top} см, ` : '') + S1.name.toLowerCase() + (S2 ? ` ${(o.layer / 100).toFixed(1).replace('.', ',')} м, ниже ${S2.name.toLowerCase()}` : '') + (o.survey ? '' : ' (без изысканий — запас 0,8 к R)');
  },
  /** Грунт на глубине z (м от поверхности) */
  soilAt(z) { const o = Struct.opt(); return o.soil2 && o.layer && z * 100 >= o.layer ? SOILS[o.soil2] || SOILS.loam : SOILS[o.soil] || SOILS.loam; },
  set(k, v) { App.doc.settings.found = { ...(App.doc.settings.found || {}), [k]: v }; },
  /** Несущие стены этажа: наружные и внутренние несущие (перегородки — на стяжке) */
  bearing(fid) { return App.doc.walls.filter(w => (w.floor === fid) && (w.kind === 'ext' || w.kind === 'int')); },
  /** Фундамент дома (первый из списка всех фундаментов) */
  foundation() { return Struct.all().find(x => x.house) || null; },
  /** Все фундаменты: дом (по стенам 1-го этажа) и постройки со стенами — гараж, баня, сарай */
  all() {
    const key = JSON.stringify(App.doc.settings.found || {}) + '|' + (App.doc.settings.city || '');
    if (Struct._fc && Struct._fc.rev === App.rev && Struct._fc.doc === App.doc && Struct._fc.key === key) return Struct._fc.list;
    const list = [], H = Struct._house();
    if (H) list.push(H);
    for (const it of Struct.blds()) { const B = Struct._bld(it); if (B) list.push(B); }
    Struct._fc = { rev: App.rev, doc: App.doc, key, list };
    return list;
  },
  /** Постройки «как дом» на первом этаже (гараж, баня, сарай со стенами) */
  blds() {
    const f1 = App.doc.floors[0].id;
    return App.doc.items.filter(it => (it.floor || f1) === f1 && BLD_HOLLOW.has(catItem(it.key).shape) && catItem(it.key).key !== 'house');
  },
  _house() {
    const d = App.doc, o = Struct.opt(), f1 = d.floors[0], cl = Climate.get();
    const walls = Struct.bearing(f1.id);
    if (!walls.length) return null;
    const Lext = walls.filter(w => w.kind === 'ext').reduce((a, w) => a + Model.wallLen(w), 0) / 100, Lint = walls.filter(w => w.kind === 'int').reduce((a, w) => a + Model.wallLen(w), 0) / 100;
    const fd = (App.floorData || [])[0], area = fd ? fd.outlines.reduce((a, x) => a + x.area, 0) / 1e4 : 0;
    // нагрузки, кН: стены всех этажей над основанием, крыша со снегом, перекрытия
    let Gw = 0;
    for (const w of d.walls) if (w.kind === 'ext' || w.kind === 'int') Gw += ((WALL_GAMMA[w.mat] || 10) * wallCore(w) + (w.clad > 0 ? WALL_GAMMA.brick * w.clad : 0) + 1.2 * (w.ins || 0)) / 100 * (w.h / 100) * Model.wallLen(w) / 100;
    const roofA = d.roofs.reduce((a, r) => a + Roof.params(r).area / 1e4, 0) || area * 1.25;
    const roofDead = d.roofs.some(r => ['ceramic', 'slate'].includes(r.mat)) ? 0.8 : 0.5;
    const pitch = d.roofs.length ? Math.max(...d.roofs.map(r => r.type === 'flat' ? 0 : r.pitch || 0)) : 30;
    const snow = 0.7 * cl.snowKpa * U.clamp((60 - pitch) / 30, 0, 1);
    return Struct._calc({
      house: true, id: 'house', name: 'Дом', Lext, Lint, area, Gw, Groof: roofA * (roofDead + snow), snow,
      Gceil: area * d.floors.length * (1.5 + 1.5),                          // перекрытия (балки, утеплитель, пол) + полезная 1,5 кПа
      kh: 0.6, khWhy: 'дом отапливаемый, пол по грунту',                      // СП 22.13330 табл. 5.3
      thMax: Math.max(...walls.filter(w => w.kind === 'ext').map(w => w.th), 20) / 100,
      segs: walls.map(w => ({ a: w.a, b: w.b })), slabs: fd ? fd.outlines.map(x => G.offsetPoly(x.outer, 30)) : [],
      type: o.type, depth: o.depth, width: o.width,
    });
  },
  /** Постройка: стены по оси (кольцо), вес стен за вычетом проёмов, крыша со снегом на две стены вдоль конька; пол — по грунту */
  _bld(it) {
    const cl = Climate.get(), sh = bldShell(it, it.w, it.d), t = sh.t, mat = bldWallMat(it), wh = bldWallH(it);
    const aw = it.w - t, ad = it.d - t;
    if (aw < 50 || ad < 50) return null;
    const P = [[-aw / 2, -ad / 2], [aw / 2, -ad / 2], [aw / 2, ad / 2], [-aw / 2, ad / 2]].map(([x, y]) => bldWorld(it, { x, y }));
    const segs = P.map((a, i) => ({ a, b: P[(i + 1) % 4] }));
    const Lext = 2 * (aw + ad) / 100, area = it.w * it.d / 1e4;
    const opA = sh.ops.reduce((a, op) => a + op.w * Math.min(op.h, wh), 0) / 1e4;
    const ck = it.clad > 0 ? it.clad : 0, Gw = ((WALL_GAMMA[mat] || 10) * (t - ck - (ck ? it.gap ?? 1 : 0)) + WALL_GAMMA.brick * ck) / 100 * Math.max(0, Lext * wh / 100 - opA);
    const R = bldRoof(it), rr = bldRoofRect(it, it.w, it.d);
    let Groof = 0, snow = 0, Lroof = Lext;
    if (R.type !== 'none') {
      const pitch = R.type === 'flat' ? 0 : R.pitch || 0, dead = ['ceramic', 'slate'].includes(R.mat) ? 0.8 : R.mat === 'soft' ? 0.4 : 0.3;
      snow = 0.7 * cl.snowKpa * U.clamp((60 - pitch) / 30, 0, 1);
      const A = rr.w * rr.d / 1e4;
      Groof = A / Math.cos(U.rad(pitch)) * dead + A * snow;
      // стропила опираются на две стены вдоль конька (у вальмовой — на все четыре)
      if (R.type !== 'hip') Lroof = 2 * ((Math.abs((rr.rot || 0) % 180) === 90 ? ad : aw) / 100);
    }
    // обогрев: радиаторы/конвекторы внутри — по термоголовке (СП 22.13330 табл. 5.3: +5 °C → 0,8 … +20 °C → 0,5; неотапливаемое — 1,1)
    const poly = Model.itemPts(it), f1 = App.doc.floors[0].id;
    const heat = App.doc.items.filter(x => x !== it && (x.floor || f1) === f1 && sysOf(x) === 'heating' && G.pointInPoly(x, poly));
    const tIn = heat.length ? Math.max(...heat.map(x => U.isNum(x.tset) ? x.tset : 20)) : null;
    const kh = tIn == null ? 1.1 : +U.clamp(0.9 - 0.02 * tIn, 0.5, 0.9).toFixed(2);
    const pits = App.doc.items.filter(x => (x.floor || f1) === f1 && catItem(x.key).shape === 'pit' && G.pointInPoly(x, poly));
    return Struct._calc({
      house: false, id: it.id, item: it, name: it.label || catItem(it.key).name, Lext, Lint: 0, area, Gw, Groof, Lroof, Gceil: 0, snow,
      kh, khWhy: tIn == null ? 'не отапливается' : `отопление +${tIn} °C, пол по грунту`, tIn, mat, wallT: t, wallH: wh, pits,
      thMax: t / 100, segs, slabs: [G.rectPts(it.x, it.y, it.w + 60, it.d + 60, it.rot)],
      type: it.foundType || 'auto',
    });
  },
  /** Общий расчёт: нагрузка на 1 м → тип, глубина (промерзание × kh), ширина подошвы, давление, армирование, объёмы */
  _calc(sp) {
    const o = Struct.opt(), S1 = SOILS[o.soil] || SOILS.loam, S2 = o.soil2 && o.layer ? SOILS[o.soil2] : null;
    const L = sp.Lext + sp.Lint, Lroof = sp.Lroof || L;
    const qn = (sp.Gw + sp.Gceil) / Math.max(L, 1) + sp.Groof / Math.max(Lroof, 1);   // кН/м по наиболее нагруженной стене (без веса фундамента)
    const q = qn * 1.2;                                                     // с коэффициентом надёжности по нагрузке
    // глубина: пучинистые грунты — не меньше расчётного промерзания df = kh · dfn
    const dfn = Climate.frost() / 100, df = +(sp.kh * dfn).toFixed(2);   // промерзание — по грунту верхнего слоя (Climate.frost)
    const high = o.gwl / 100 < df + 2;                                      // вода близко — пучение сильнее
    // пучение: грунт основания пучинистый или пучинистый слой ниже, но в зоне промерзания
    const heave = S1.heave || !!(S2 && S2.heave && df * 100 > o.layer);
    const S = { ...S1, heave, weak: S1.weak || !!(S2 && S2.weak && o.layer < 150) };
    // песок поверх пучинистой глины: МЗЛФ на природной песчаной подушке, промерзание глины отсекает утеплённая отмостка
    const sandTop = /^sand/.test(o.soil) && S2 && S2.heave;
    const type = FOUND_TYPES[sp.type] && sp.type !== 'auto' ? sp.type : S.weak ? 'pile' : heave && o.gwl < 150 ? 'slab' : heave && (high || sandTop) ? 'mzlf' : 'strip';
    let depth = type === 'strip' ? (heave ? Math.max(df, 0.5) : 0.5) : type === 'mzlf' ? 0.5 : type === 'slab' ? 0.35 : 0;
    if (U.isNum(sp.depth)) depth = sp.depth / 100;
    // ширина подошвы: q / (R − γ·d); не меньше стены + 10 см и не меньше 30 см
    const H = depth + o.plinth / 100;                                        // высота ленты с цоколем
    // расчётное сопротивление: грунт под подошвой, а если слабее грунт ниже в пределах ~1 м — по нему; без изысканий — запас 0,8
    const Sb = Struct.soilAt(depth), Sd = Struct.soilAt(depth + 1), R0 = Math.min(Sb.R0, Sd.R0);
    const R = R0 * (type === 'mzlf' ? 0.9 : 1) * (o.survey ? 1 : 0.8);
    let b = q / Math.max(30, R - 24 * H);                                  // та же формула, что и в проверке давления
    b = Math.max(b, sp.thMax + 0.1, 0.3);
    b = Math.ceil(b * 20) / 20;
    if (U.isNum(sp.width)) b = sp.width / 100;
    const p = (q + 24 * b * H) / b;                                          // давление под подошвой, кПа
    const out = { ...sp, soil: S, soil2: S2, layer: o.layer, survey: o.survey, soilKey: o.soil, gwl: o.gwl, type, depth, width: b, H, qn, q, p, R, df, dfn, L, high, plinth: o.plinth };
    const { Lext, Lint, area } = sp;
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
    // низ подошвы (от уровня земли), м: у свай — ростверк 0,4 м над сваями
    out.bottom = type === 'pile' ? 0.4 : depth;
    return out;
  },
  /** Кладка и армирование: по каждой паре «материал, толщина» наружных и несущих стен */
  masonry() {
    const d = App.doc, rows = new Map();
    for (const w of d.walls) {
      if (w.kind === 'fence') continue;
      const R = WALL_REINF[w.mat] || { every: 0, how: '', ring: false, src: '' }, M = WALL_MATERIALS[w.mat] || {};
      const th = wallCore(w), k = w.mat + ':' + th, L = Model.wallLen(w) / 100;
      const r = rows.get(k) || rows.set(k, { mat: w.mat, name: M.name || w.mat, th, len: 0, lenBear: 0, h: 0, rule: R, ops: 0, opLen: 0 }).get(k);
      r.len += L; r.h = Math.max(r.h, w.h / 100);
      if (w.kind === 'ext' || w.kind === 'int') r.lenBear += L;
      for (const o of d.openings) if (o.wall === w.id) { r.ops++; r.opLen += (o.w + 50) / 100; }   // перемычка: проём + 2 × 25 см опирания
    }
    // стены построек (гараж, баня, сарай): кольцо по оси, несущие; проёмы — ворота и двери
    for (const it of Struct.blds()) {
      const sh = bldShell(it, it.w, it.d), mat = bldWallMat(it), R = WALL_REINF[mat] || { every: 0, how: '', ring: false, src: '' }, M = WALL_MATERIALS[mat] || {};
      const core = sh.t - (it.clad > 0 ? it.clad + (it.gap ?? 1) : 0), k = mat + ':' + core, L = 2 * (it.w + it.d - 2 * sh.t) / 100;
      const r = rows.get(k) || rows.set(k, { mat, name: M.name || mat, th: core, len: 0, lenBear: 0, h: 0, rule: R, ops: 0, opLen: 0 }).get(k);
      r.len += L; r.lenBear += L; r.h = Math.max(r.h, bldWallH(it) / 100);
      for (const o of sh.ops) { r.ops++; r.opLen += (o.w + 50) / 100; }
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
  /** Замечания для «Анализа» (и автопроверки) — по каждому фундаменту */
  issues(add, m) {
    const A = Struct.all();
    if (!A.length) return;
    const o = Struct.opt();
    for (const F of A) {
      const nm = F.house ? 'Фундамент' : 'Фундамент: ' + F.name.toLowerCase(), at = F.house ? null : F.item, id = F.house ? null : F.id;
      const pos = at ? { x: at.x, y: at.y } : null;
      const fix = (k, v) => F.house ? () => Struct.set(k, v) : () => { if (v === undefined) delete F.item.foundType; else F.item.foundType = v; };
      if ((F.type === 'strip' || F.type === 'mzlf') && F.p > F.R * 1.001) add('bad', nm, `давление под подошвой ${F.p.toFixed(0)} кПа больше расчётного сопротивления грунта ${F.R.toFixed(0)} кПа — расширьте подошву`, 'СП 22.13330.2016 п. 5.6', pos, id, F.house && U.isNum(o.width) ? fix('width', undefined) : null);
      if (F.soil.heave && (F.type === 'strip') && F.depth < F.df - 0.005) add('bad', nm, `глубина заложения ${m(F.depth * 100)} меньше расчётного промерзания ${m(F.df * 100)} на пучинистом грунте — фундамент будет выпирать`, 'СП 22.13330.2016 п. 5.5.3, табл. 5.3', pos, id, F.house ? fix('depth', undefined) : null);
      if (F.soil.heave && F.type === 'strip' && F.high) add('warn', nm, `грунтовые воды на ${m(o.gwl)} — ближе промерзания + 2 м: для ленты нужны дренаж и утепление отмостки, либо МЗЛФ / УШП`, 'СП 22.13330.2016 п. 5.5.4; СП 104.13330', pos, id, fix('type', 'mzlf'));
      if (F.soil.weak && F.type !== 'pile') add('bad', nm, 'слабый грунт (торф, насыпной, ил) — нужен свайный фундамент до плотного слоя или замена грунта', 'СП 22.13330.2016 п. 6.4; СП 24.13330', pos, id, fix('type', 'pile'));
      if (F.house && o.top) add('note', nm, `срезать растительный слой ${o.top} см по пятну застройки + 1 м; котлован — по разметке осей, дно уплотнить; обратная засыпка пазух — песком послойно с трамбованием`, 'СП 45.13330.2017 п. 6.1, 7.4');
      if (F.soil.heave && F.type === 'mzlf') add('note', nm, `МЗЛФ ${m(F.depth * 100)} при промерзании ${m(F.df * 100)} (${F.khWhy}): обязательно утеплить подошву и отмостку XPS по периметру (юбка ≥ 1,2 м) и сделать подушку из непучинистого песка`, 'СП 22.13330.2016 п. 5.5.4; СП 50-101-2004 п. 12');
      // ямы и погреба у ленты: дно ниже подошвы ближе, чем на разность отметок, — лента «подрезается» (СП 22.13330 п. 5.5.9: Δh ≤ a·(tgφ + c/p) ≈ a)
      if (F.type !== 'slab') for (const pit of App.doc.items.filter(x => catItem(x.key).shape === 'pit' && (x.floor || App.doc.floors[0].id) === App.doc.floors[0].id)) {
        const pd = pitGeom(pit, pit.w, pit.d).depth / 100, dh = pd - F.bottom;
        if (dh <= 0.05) continue;
        const pp = Model.itemPts(pit), gap = Math.min(...F.segs.map(sg => Struct._polySegDist(pp, sg))) / 100 - F.width / 2;
        if (gap >= dh) continue;
        const name = pit.label || catItem(pit.key).name, src = 'СП 22.13330.2016 п. 5.5.9, 5.5.10; СП 63.13330.2018; СП 50-101-2004';
        if (pit.monolith) add('note', nm, `${name} глубиной ${m(pd * 100)} в ${m(Math.max(0, gap) * 100)} от подошвы: стенки — монолит ж/б 200 мм, две сетки Ø10–12 шаг 200, рассчитать как подпорные на давление грунта с пригрузом от ленты; бетонировать до устройства ленты, наружная гидроизоляция и дренаж`, src, { x: pit.x, y: pit.y }, pit.id);
        else add(gap < 0.05 ? 'bad' : 'warn', nm, `${name} глубиной ${m(pd * 100)} — на ${m(dh * 100)} ниже подошвы (${m(F.bottom * 100)}) и в ${m(Math.max(0, gap) * 100)} от неё: грунт из-под ленты «поплывёт». Отодвиньте яму на ≥ ${m(dh * 100)} от края подошвы или сделайте стенки монолитными ж/б (подпорными)`, src, { x: pit.x, y: pit.y }, pit.id, () => { pit.monolith = true; });
      }
    }
    // постройка, пристроенная к дому: осадочный шов и одна отметка подошвы у примыкания
    const Hs = A.find(x => x.house);
    if (Hs) for (const F of A.filter(x => !x.house)) {
      const near = Math.min(...F.segs.flatMap(sg => Hs.segs.map(hs => Struct._segSegDist(sg, hs))));
      if (near > (F.wallT + 60)) continue;
      const dd = Math.round((F.bottom - Hs.bottom) * 100);
      add('note', 'Фундамент: ' + F.name.toLowerCase(), `примыкает к дому: между фундаментами и стенами — деформационный шов 20–30 мм (ленты арматурой не связывать — нагрузки и осадки разные); кровлю — с компенсатором` + (Math.abs(dd) >= 5 ? `. Подошвы отличаются на ${m(Math.abs(dd))} — у примыкания на длине ≥ 1 м ${dd > 0 ? 'заглубите ленту дома' : 'заглубите ленту постройки'} до общей отметки ${m(Math.max(F.bottom, Hs.bottom) * 100)}, иначе более глубокий котлован подрежет основание соседней ленты` : ''), 'СП 22.13330.2016 п. 5.5.9, 6.13; СП 70.13330', { x: F.item.x, y: F.item.y }, F.id);
    }
    // ячеистые блоки: опирание перемычек и армопояс под крышу
    for (const w of App.doc.walls) {
      const R = WALL_REINF[w.mat];
      if (!R || !R.ring || w.kind !== 'ext') continue;
      for (const op of App.doc.openings.filter(x => x.wall === w.id && x.w > 150)) add('note', 'Конструкции', `${OPENING_TYPES[op.type].name} ${m(op.w)} в стене «${(WALL_MATERIALS[w.mat] || {}).name}»: перемычка — из U-блоков с армированием 2–4 Ø12 или готовая, опирание ≥ 25 см; ряд под окном — армировать с заходом 0,9 м в стороны`, R.src, G.mid(w.a, w.b), op.id);
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
  /** Минимальное расстояние от многоугольника до отрезка, см */
  _polySegDist(pts, sg) {
    if (G.pointInPoly(sg.a, pts) || G.pointInPoly(sg.b, pts)) return 0;
    let d = Infinity;
    for (let i = 0; i < pts.length; i++) d = Math.min(d, Struct._segSegDist({ a: pts[i], b: pts[(i + 1) % pts.length] }, sg));
    return d;
  },
  _segSegDist(s, t) {
    if (G.segInter(s.a, s.b, t.a, t.b)) return 0;
    return Math.min(G.distSeg(s.a, t.a, t.b), G.distSeg(s.b, t.a, t.b), G.distSeg(t.a, s.a, s.b), G.distSeg(t.b, s.a, s.b));
  },
  /** Размеры лент для листа фундамента: длина каждой ленты по оси (снаружи контура) и ширина подошвы */
  drawDims(env) {
    const c = Theme.C.dim || '#333';
    for (const F of Struct.all()) {
      if (F.type === 'slab') continue;
      const all = F.segs.flatMap(sg => [sg.a, sg.b]), cen = { x: all.reduce((a, p) => a + p.x, 0) / all.length, y: all.reduce((a, p) => a + p.y, 0) / all.length };
      for (const sg of F.segs) {
        if (G.dist(sg.a, sg.b) < 80) continue;
        const u = G.unit(G.sub(sg.b, sg.a)), n = G.perp(u), m = G.mid(sg.a, sg.b), out = G.dot(n, G.sub(m, cen)) > 0 ? 1 : -1;
        // внешние ленты — размер снаружи, внутренние — рядом с лентой
        const edge = F.segs.filter(o => o !== sg).every(o => G.dot(G.sub(G.mid(o.a, o.b), m), G.mul(n, out)) <= 5);
        Render.dimLine(env, sg.a, sg.b, (edge ? 70 + F.width * 50 : F.width * 50 + 25) * out, null, c);
      }
    }
  },
  /** Контур фундаментов на плане: ленты под несущими стенами дома и стенами построек (пунктир), для УШП — плита */
  draw(env) {
    const A = Struct.all();
    if (!A.length) return;
    if (env.foundDims) Struct.drawDims(env);
    const { ctx, px } = env, col = '#6b5b45';
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * px; ctx.setLineDash([10 * px, 5 * px]);
    ctx.fillStyle = 'rgba(107, 91, 69, 0.05)';
    for (const F of A) {
      if (F.type === 'slab') {
        for (const pts of F.slabs) { Render.polyPath(ctx, pts, true); ctx.fill(); ctx.stroke(); }
      } else {
        const bw = F.type === 'pile' ? 40 : F.width * 100;
        for (const w of F.segs) {
          const u = G.unit(G.sub(w.b, w.a)), n = G.mul(G.perp(u), bw / 2), a = G.sub(w.a, G.mul(u, bw / 2)), b = G.add(w.b, G.mul(u, bw / 2));
          const pts = [G.add(a, n), G.add(b, n), G.sub(b, n), G.sub(a, n)];
          Render.polyPath(ctx, pts, true); ctx.fill(); ctx.stroke();
          if (F.type === 'pile') { const Lw = G.dist(w.a, w.b), k = Math.max(1, Math.round(Lw / 250)); ctx.setLineDash([]); for (let i = 0; i <= k; i++) { const c = G.add(w.a, G.mul(u, Lw * i / k)); ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.stroke(); } ctx.setLineDash([10 * px, 5 * px]); }
        }
      }
      if (!F.house) {
        // подпись — у самой длинной ленты, внутрь постройки
        const it = F.item, sg = F.segs.reduce((a, b) => G.dist(b.a, b.b) > G.dist(a.a, a.b) ? b : a), mid = G.mid(sg.a, sg.b), c = G.add(mid, G.mul(G.unit(G.sub(it, mid)), F.width * 50 + 45));
        const txt = F.type === 'pile' ? `Фундамент: сваи ${F.piles} шт.` : `Фундамент: ${F.type === 'slab' ? 'УШП' : F.type === 'mzlf' ? 'МЗЛФ' : 'лента'}${F.type === 'slab' ? '' : `, подошва ${(F.width * 100).toFixed(0)} см`}, низ −${F.bottom.toFixed(2).replace('.', ',')} м`;
        const ang = G.angle(sg.a, sg.b), up = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
        Render.label(env, txt, c, up, { size: 10, color: col, bg: true, pad: 2, prio: 5 });
      }
    }
    ctx.restore();
  },
};
