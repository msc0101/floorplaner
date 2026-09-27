'use strict';
/* ==========================================================================
   Проверка отступов на участке: от границ и между объектами.
   Значения по умолчанию — СП 53.13330.2019 (пп. 6.6–6.8) и санитарные
   рекомендации; все нормы можно изменить под местные ПЗЗ.
   ========================================================================== */

const CHECK_RULES = [
  { id: 'house_street', a: 'house', b: 'bound:street', min: 500, name: 'Дом — красная линия улицы', src: 'СП 53.13330.2019 п. 6.6' },
  { id: 'house_lane', a: 'house', b: 'bound:lane', min: 300, name: 'Дом — красная линия проезда', src: 'СП 53.13330.2019 п. 6.6' },
  { id: 'outb_street', a: 'outbuilding', b: 'bound:street', min: 500, name: 'Хозпостройка — красная линия улицы', src: 'СП 53.13330.2019 п. 6.6' },
  { id: 'outb_lane', a: 'outbuilding', b: 'bound:lane', min: 500, name: 'Хозпостройка — красная линия проезда', src: 'СП 53.13330.2019 п. 6.6' },
  { id: 'house_neighbor', a: 'house', b: 'bound:neighbor', min: 300, name: 'Дом — граница соседнего участка', src: 'СП 53.13330.2019 п. 6.7' },
  { id: 'animals_neighbor', a: 'animals', b: 'bound:neighbor', min: 400, name: 'Постройка для скота и птицы — граница соседа', src: 'СП 53.13330.2019 п. 6.7' },
  { id: 'outb_neighbor', a: 'outbuilding', b: 'bound:neighbor', min: 100, name: 'Другие постройки (гараж, баня, сарай) — граница соседа', src: 'СП 53.13330.2019 п. 6.7', except: 'animals' },
  { id: 'tall_neighbor', a: 'treeTall', b: 'bound:neighbor', min: 400, name: 'Высокорослое дерево — граница соседа', src: 'СП 53.13330.2019 п. 6.7' },
  { id: 'mid_neighbor', a: 'treeMid', b: 'bound:neighbor', min: 200, name: 'Среднерослое дерево — граница соседа', src: 'СП 53.13330.2019 п. 6.7' },
  { id: 'shrub_neighbor', a: 'shrub', b: 'bound:neighbor', min: 100, name: 'Кустарник — граница соседа', src: 'СП 53.13330.2019 п. 6.7' },
  { id: 'house_animals', a: 'house', b: 'animals', min: 1200, name: 'Дом — постройка для скота и птицы', src: 'СП 53.13330 п. 6.8; СП 30-102-99: от окон 10–40 м в зависимости от поголовья' },
  { id: 'house_toilet', a: 'house', b: 'toilet', min: 1200, name: 'Дом — уборная, выгребная яма', src: 'СП 53.13330 п. 6.8' },
  { id: 'cellar_toilet', a: 'cellar', b: 'toilet', min: 1200, name: 'Погреб — уборная', src: 'СП 53.13330 п. 6.8' },
  { id: 'house_bath', a: 'house', b: 'bath', min: 800, name: 'Дом — баня, летний душ', src: 'СП 53.13330.2019 п. 6.8' },
  { id: 'well_toilet', a: 'well', b: 'toilet', min: 800, name: 'Колодец — уборная, компост', src: 'СП 53.13330.2019 п. 6.8' },
  { id: 'septic_house', a: 'septic', b: 'house', min: 500, name: 'Септик — дом', src: 'СП 32.13330, рекомендация' },
  { id: 'septic_well', a: 'septic', b: 'well', min: 2000, name: 'Септик — колодец / скважина', src: 'санитарные правила; с полем фильтрации — 50 м' },
  { id: 'septic_neighbor', a: 'septic', b: 'bound:neighbor', min: 200, name: 'Септик — граница соседа', src: 'рекомендация' },
];
const CHECK_GROUPS = {
  house: 'Дом', outbuilding: 'Хозпостройка', animals: 'Постройка для скота и птицы', bath: 'Баня / душ', toilet: 'Уборная / выгребная яма / компост',
  cellar: 'Погреб', septic: 'Септик', well: 'Колодец / скважина', treeTall: 'Высокорослое дерево', treeMid: 'Среднерослое дерево', shrub: 'Кустарник',
};
/** Назначение постройки для проверки норм (вручную в свойствах): '' — по виду из библиотеки */
const CHECK_AS = { '': 'по виду постройки', house: 'жилой дом', outb: 'хозпостройка (гараж, сарай…)', animals: 'для скота и птицы (курятник, хлев)', bath: 'баня / душ', toilet: 'уборная', none: 'не учитывать' };
const BOUND_TYPES = { auto: 'авто', neighbor: 'сосед', street: 'улица', lane: 'проезд', none: 'не учитывать' };

const Checks = {
  /** Группа объекта для правил */
  groupsOf(it) {
    const k = it.key, sh = catItem(k).shape, g = [];
    const as = { house: ['house'], outb: ['outbuilding'], animals: ['outbuilding', 'animals'], bath: ['outbuilding', 'bath'], toilet: ['outbuilding', 'toilet'], none: [] }[it.checkAs];
    if (as) return as;
    if (k === 'house') g.push('house');
    else if (BLD_ROOF_SHAPES.has(sh) || sh === 'gazebo') g.push('outbuilding');   // гараж, сарай, баня, навесы, теплица, беседка
    if (['coop', 'barn'].includes(k)) g.push('animals');
    if (['bathhouse', 'showerOut'].includes(k)) g.push('bath');
    if (['outhouse', 'cesspool', 'compost'].includes(k)) g.push('toilet');
    if (['cellar', 'cellarHouse', 'podpol'].includes(k)) g.push('cellar');
    if (['septic2', 'septic3', 'septicRing', 'filterField'].includes(k)) g.push('septic');
    if (['well', 'borehole'].includes(k)) g.push('well');
    if (['tree', 'fruitTree', 'conifer', 'thuja'].includes(k) || sh === 'tree' || sh === 'conifer') g.push(it.h >= 1000 ? 'treeTall' : it.h >= 400 ? 'treeMid' : 'shrub');
    if (['bush', 'hedge'].includes(k)) g.push('shrub');
    return g;
  },
  /** Контур постройки для норм: если свес крыши выступает больше чем на 50 см — по проекции крыши (СП 53 п. 6.7, прим.) */
  itemPoly(it) {
    const sh = catItem(it.key).shape;
    if (BLD_ROOF_SHAPES.has(sh)) {
      const R = bldRoof(it);
      if (Math.max(R.sides.l, R.sides.r, R.sides.f, R.sides.b) > 50) {
        const r = bldRoofRect(it, it.w, it.d), c = G.toWorld({ x: r.x, y: r.y }, it.x, it.y, it.rot || 0);
        return G.rectPts(c.x, c.y, r.w, r.d, (it.rot || 0) + r.rot);
      }
    }
    return Model.itemPts(it);
  },
  rules() {
    const over = App.doc.settings.checkRules || {};
    return CHECK_RULES.map(r => ({ ...r, min: U.isNum(over[r.id]?.min) ? over[r.id].min : r.min, off: !!over[r.id]?.off }));
  },
  /** Объекты группы: { id, name, poly (контур) или pt (точка — ствол) } */
  objects(group) {
    const res = [];
    const ground = App.doc.floors[0].id;
    if (group === 'house') {
      const fd = (App.floorData || [])[0], outs = fd ? fd.outlines.map(o => o.outer) : [];
      outs.forEach((o, i) => res.push({ id: 'outline' + i, name: 'Дом', poly: o }));
      // выступающие больше чем на 50 см части дома — от них: свес крыши, крыльцо, веранда (СП 53 п. 6.7, примечание)
      const beyond = (poly) => outs.length && poly.some(q => !outs.some(o => G.pointInPoly(q, o)) && Math.min(...outs.map(o => Checks.dist({ pt: q }, { poly: o }).d)) > 51);
      for (const r of App.doc.roofs) {
        const poly = G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0);
        if (beyond(poly)) res.push({ id: r.id, name: 'Дом (свес крыши)', poly });
      }
      for (const it of App.doc.items) {
        if (it.floor !== ground || catItem(it.key).shape !== 'veranda' || it.checkAs === 'none') continue;
        const o = porchOpt(it), poly = Model.itemPts(it);
        if (!(o.roofed || o.ph > 30) || !outs.some(ol => Checks.dist({ poly }, { poly: ol }).d < 60) || !beyond(poly)) continue;
        res.push({ id: it.id, name: 'Дом (' + (it.label || catItem(it.key).name).toLowerCase() + ')', poly });
      }
    }
    for (const it of App.doc.items) {
      if (it.floor !== ground || !Checks.groupsOf(it).includes(group)) continue;
      const tree = group.startsWith('tree') || group === 'shrub';
      res.push({ id: it.id, name: it.label || catItem(it.key).name, poly: tree ? null : Checks.itemPoly(it), pt: tree ? { x: it.x, y: it.y } : null, groups: Checks.groupsOf(it) });
    }
    return res;
  },
  /** Тип стороны участка (с учётом ручной настройки) */
  edgeType(area, i) {
    const manual = (area.edges || [])[i];
    if (manual && manual !== 'auto') return manual;
    const a = area.pts[i], b = area.pts[(i + 1) % area.pts.length];
    const m = G.mid(a, b), u = G.unit(G.sub(b, a));
    let best = null, bd = Infinity;
    for (const r of App.doc.roads) {
      if (!['street', 'road', 'gravel'].includes(r.kind)) continue;
      for (let k = 0; k < r.pts.length - 1; k++) {
        const d = G.distSeg(m, r.pts[k], r.pts[k + 1]) - r.width / 2;
        const par = Math.abs(G.dot(u, G.unit(G.sub(r.pts[k + 1], r.pts[k]))));
        if (d < 1500 && par > 0.9 && d < bd) { bd = d; best = r; }
      }
    }
    if (!best) return 'neighbor';
    return best.kind === 'street' ? 'street' : 'lane';
  },
  /** Мин. расстояние и ближайшие точки между фигурами (контур или точка) */
  dist(A, B) {
    const segs = (o) => { if (o.pt) return [[o.pt, o.pt]]; const p = o.poly || o.seg; if (o.seg) return [o.seg]; return p.map((q, i) => [q, p[(i + 1) % p.length]]); };
    // внутри контура — расстояние 0
    const inside = (o, q) => o.poly && G.pointInPoly(q, o.poly);
    const repA = A.pt || (A.poly && A.poly[0]) || (A.seg && A.seg[0]), repB = B.pt || (B.poly && B.poly[0]) || (B.seg && B.seg[0]);
    if ((repB && inside(A, repB)) || (repA && inside(B, repA))) return { d: 0, pa: repA, pb: repB };
    let best = { d: Infinity };
    for (const [a1, a2] of segs(A)) for (const [b1, b2] of segs(B)) {
      if (a1 !== a2 && b1 !== b2 && G.segInter(a1, a2, b1, b2)) return { d: 0, pa: a1, pb: a1 };
      for (const [p, s1, s2, flip] of [[a1, b1, b2, false], [a2, b1, b2, false], [b1, a1, a2, true], [b2, a1, a2, true]]) {
        const pr = G.proj(p, s1, s2);
        if (pr.d < best.d) best = flip ? { d: pr.d, pa: pr.q, pb: p } : { d: pr.d, pa: p, pb: pr.q };
      }
    }
    return best;
  },
  run() {
    const out = [];
    const plots = App.doc.areas.filter(a => a.kind === 'plot' && a.floor === App.doc.floors[0].id);
    const cache = {};
    const objs = (g) => cache[g] || (cache[g] = Checks.objects(g));
    for (const r of Checks.rules()) {
      if (r.off) continue;
      const As = objs(r.a);
      if (!As.length) continue;
      if (r.b.startsWith('bound:')) {
        const type = r.b.slice(6);
        for (const A of As) {
          if (r.except && (A.groups || []).includes(r.except)) continue;
          // отступ — от границ своего участка (объекты на соседних участках не проверяем)
          const rep = A.pt || G.polyCentroid(A.poly);
          const own = plots.filter(pl => G.pointInPoly(rep, pl.pts));
          let best = null;
          for (const pl of own) pl.pts.forEach((p, i) => {
            if (Checks.edgeType(pl, i) !== type) return;
            const q = pl.pts[(i + 1) % pl.pts.length];
            const res = Checks.dist(A, { seg: [p, q] });
            if (!best || res.d < best.d) best = res;
          });
          if (best) out.push({ rule: r, a: A, bName: { street: 'красная линия улицы', lane: 'красная линия проезда', neighbor: 'граница соседа' }[type], ...best, ok: best.d >= r.min - 0.5 });
        }
      } else {
        const Bs = objs(r.b);
        for (const A of As) for (const B of Bs) {
          if (A.id === B.id) continue;
          const res = Checks.dist(A, B);
          out.push({ rule: r, a: A, b: B, bName: B.name, ...res, ok: res.d >= r.min - 0.5 });
        }
      }
    }
    out.sort((x, y) => (x.ok - y.ok) || (x.d - x.rule.min) - (y.d - y.rule.min));
    App.checks = { results: out, fails: out.filter(x => !x.ok).length };
    return App.checks;
  },
  draw(env) {
    if (!App.doc.settings.showChecks || Model.floorIdx(App.floor) !== 0) return;
    const res = (App.checks || Checks.run()).results;
    const { ctx, px } = env;
    // стороны участка: красная линия улицы / проезда и граница с соседом — от них разные нормы
    for (const pl of App.doc.areas) {
      if (pl.kind !== 'plot' || pl.floor !== App.doc.floors[0].id) continue;
      const cw = G.polyArea(pl.pts) > 0 ? 1 : -1;
      pl.pts.forEach((a, i) => {
        const type = Checks.edgeType(pl, i);
        if (type === 'none') return;
        const b = pl.pts[(i + 1) % pl.pts.length], red = type !== 'neighbor';
        ctx.save();
        ctx.strokeStyle = red ? '#d0312d' : '#7b8494'; ctx.lineWidth = (red ? 2.4 : 1.6) * px;
        ctx.setLineDash(red ? [14 * px, 4 * px, 3 * px, 4 * px] : [3 * px, 5 * px]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
        if (G.dist(a, b) * env.scale < 120) return;
        const inward = G.mul(G.perp(G.unit(G.sub(b, a))), cw * 13 * px);
        Render.label(env, { street: 'красная линия улицы', lane: 'красная линия проезда', neighbor: 'граница с соседом' }[type], G.add(G.mid(a, b), inward), G.angle(a, b),
          { size: 9.5, color: red ? '#d0312d' : '#6b7482', prio: 2 });
      });
    }
    for (const r of res) {
      if (r.ok && !App.doc.settings.showChecksOk) continue;
      if (!r.pa || !r.pb) continue;
      const color = r.ok ? '#1e9b57' : '#d33a3a';
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = (r.ok ? 1 : 1.8) * px; ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath(); ctx.moveTo(r.pa.x, r.pa.y); ctx.lineTo(r.pb.x, r.pb.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [r.pa, r.pb]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
      ctx.restore();
      const m = r.d > 1 ? G.mid(r.pa, r.pb) : r.pa;
      const to = r.rule.b.startsWith('bound:') ? { street: 'до улицы ', lane: 'до проезда ', neighbor: 'до соседа ' }[r.rule.b.slice(6)] : '';
      Render.label(env, `${to}${(r.d / 100).toFixed(1)} ${r.ok ? '≥' : '<'} ${(r.rule.min / 100).toFixed(r.rule.min % 100 ? 1 : 0)} м`, m, r.d > 1 ? G.angle(r.pa, r.pb) : 0,
        { size: 10.5, bold: !r.ok, color, bg: true, pad: 2, border: color, prio: r.ok ? 3 : 8 });
    }
  },
};
