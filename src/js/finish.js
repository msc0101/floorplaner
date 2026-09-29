'use strict';
/* ==========================================================================
   Чистовая отделка: полы, стены, потолки по помещениям, двери, окна, фасад.
   Правила по умолчанию (можно менять на вкладке «Проект» → «Отделка»):
   полы — крупноформатный керамогранит, в спальнях — ковролин; стены —
   обои под покраску светлые (в санузлах — плитка); потолки — натяжные;
   двери — дерево среднего тона; окна — снаружи антрацит, внутри белые;
   фасад — облицовочный кирпич. Слой «Отделка» на плане, в 3D и смете.
   ========================================================================== */

const FIN_FLOORS = {
  porcelain: { name: 'Керамогранит 600×1200 мм (крупноформатный, матовый)', short: 'Керамогранит 60×120', color: '#d9d6cf', tile: [120, 60], price: 'fin:porcelain' },
  carpet:    { name: 'Ковролин (петлевой, на подложке)', short: 'Ковролин', color: '#8d9096', price: 'fin:carpet' },
  tile:      { name: 'Керамическая плитка 300×300 мм (противоскользящая)', short: 'Плитка 30×30', color: '#cfd3d6', tile: [30, 30], price: 'fin:tile' },
  laminate:  { name: 'Ламинат 33 класс', short: 'Ламинат', color: '#b58d61', price: 'fin:laminate' },
  concrete:  { name: 'Бетонный пол с топпингом (обеспыленный)', short: 'Бетон', color: '#9d9c98', price: 'fin:topping' },
};
const FIN_WALLS = {
  paint: { name: 'Обои под покраску (флизелин), краска матовая светлая', short: 'Покраска светлая', color: '#f1eee8', price: 'fin:paint' },
  tile:  { name: 'Керамическая плитка светлая 300×600 мм (мокрые зоны) по гидроизоляции', short: 'Плитка', color: '#e9ecee', price: 'fin:walltile' },
  plaster: { name: 'Цементная штукатурка, покраска фасадной краской', short: 'Штукатурка', color: '#d6d3cc', price: 'fin:paint' },
};
const FIN_CEIL = {
  stretch: { name: 'Натяжной потолок ПВХ, матовый белый', short: 'Натяжной', color: '#fbfbfa', price: 'fin:stretch' },
  gkl:     { name: 'ГКЛ по каркасу, покраска', short: 'ГКЛ', color: '#f6f6f4', price: 'fin:gkl' },
};
const FIN_FACADE = {
  brick:  { name: 'Облицовочный кирпич 250×120×65 на гибких связях', short: 'Облицовочный кирпич', th: 12, gap: 3, price: 'fin:brick' },
  none:   { name: 'Без облицовки', short: '—', th: 0, gap: 0 },
};
const FIN_BRICK_COLORS = { red: ['Красно-коричневый', '#9b5238'], brown: ['Коричневый', '#6e4633'], beige: ['Бежевый', '#cdb48f'], gray: ['Серый', '#8c8a86'], white: ['Белый', '#e6e1d7'] };

const Finish = {
  /** Настройки отделки проекта */
  opt() {
    return Object.assign({ floor: 'porcelain', living: 'carpet', wet: 'tile', walls: 'paint', wallColor: '#f1eee8', wetWalls: 'tile', ceil: 'stretch', door: '#8b5e3c', winOut: '#383e42', winIn: '#f4f4f2', facade: 'brick', brick: 'red', garageFloor: 'concrete' }, App.doc.settings.finish || {});
  },
  set(k, v) { App.doc.settings.finish = { ...(App.doc.settings.finish || {}), [k]: v }; },
  /** Отделка помещения по его назначению (или заданная у помещения вручную) */
  room(r) {
    const o = Finish.opt(), nm = (r.name || '').toLowerCase(), own = (o.rooms || {})[r.name] || {};
    const wet = /сануз|ванн|туалет|душ|с\/у/.test(nm), tech = /котел|котёл|кладов|гардероб/.test(nm), sleep = /спальн|детск|кабинет/.test(nm);
    return {
      floor: own.floor || (wet ? o.wet : sleep ? o.living : o.floor),
      walls: own.walls || (wet ? o.wetWalls : o.walls),
      ceil: own.ceil || o.ceil,
      wet, tech, sleep,
    };
  },
  brickColor() { return (FIN_BRICK_COLORS[Finish.opt().brick] || FIN_BRICK_COLORS.red)[1]; },

  /* ------------------------------- план ------------------------------- */
  /** Слой «Отделка»: раскладка плитки, ковролин, коды П/С/Пт у помещения */
  draw(env) {
    const { ctx, px } = env, fd = (App.floorData || []).find(f => f.floor.id === App.floor);
    if (!fd) return;
    ctx.save();
    for (const r of fd.rooms) {
      const q = r.floor || r.axis, F = Finish.room(r), M = FIN_FLOORS[F.floor] || FIN_FLOORS.porcelain;
      Render.polyPath(ctx, q, true);
      ctx.save(); ctx.clip();
      ctx.fillStyle = M.color + '55'; ctx.fill();
      const b = G.bbox(q);
      if (M.tile) {                                                             // раскладка плитки от центра комнаты
        const [tw, th] = M.tile, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        ctx.strokeStyle = 'rgba(80,80,80,.45)'; ctx.lineWidth = 0.6 * px; ctx.beginPath();
        for (let x = cx - Math.ceil((cx - b.x0) / tw) * tw; x <= b.x1; x += tw) { ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); }
        for (let y = cy - Math.ceil((cy - b.y0) / th) * th; y <= b.y1; y += th) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
        ctx.stroke();
      } else if (F.floor === 'carpet') {
        ctx.fillStyle = 'rgba(70,70,80,.35)';
        for (let x = b.x0 + 6; x < b.x1; x += 12) for (let y = b.y0 + 6 + ((x / 12) % 2) * 6; y < b.y1; y += 12) ctx.fillRect(x, y, 1.6 * px, 1.6 * px);
      }
      ctx.restore();
      const lp = r.label || G.labelPoint(q);
      Render.label(env, [`П: ${M.short}`, `С: ${(FIN_WALLS[F.walls] || FIN_WALLS.paint).short} · Пт: ${(FIN_CEIL[F.ceil] || FIN_CEIL.stretch).short}`], { x: lp.x, y: lp.y + 45 }, 0, { size: 9.5, color: '#5b4b2a', bg: true, pad: 2, prio: 6 });
    }
    ctx.restore();
  },

  /* ------------------------------- объёмы ------------------------------- */
  /** Площади отделки по материалам: полы, стены (периметр × высота − проёмы), потолки, фасад */
  quantities() {
    const d = App.doc, out = { floor: {}, walls: {}, ceil: {}, facade: 0, bricks: 0, doors: 0, windows: 0, rooms: [] };
    for (const fd of App.floorData || []) {
      const H = (fd.floor.h || 300) - 30;
      Drawing.onFloor(fd.floor.id, () => {
        for (const r of fd.rooms) {
          const F = Finish.room(r), A = r.areaFloor / 1e4, P = (r.perimFloor || G.polyPerimeter(r.floor || r.axis)) / 100;
          const opA = d.openings.filter(o => { const g = Model.opGeom(o); return g && G.distPoly(G.mid(g.a, g.b), r.floor || r.axis) < 30; }).reduce((a, o) => a + (o.w * (o.h || 150)) / 1e4, 0);
          const W = Math.max(0, P * H / 100 - opA * 0.5);
          out.floor[F.floor] = (out.floor[F.floor] || 0) + A;
          out.walls[F.walls] = (out.walls[F.walls] || 0) + W;
          out.ceil[F.ceil] = (out.ceil[F.ceil] || 0) + A;
          out.rooms.push({ name: r.name, A, W, F, floorName: fd.floor.name });
        }
      });
    }
    // фасад: наружные стены по наружной грани минус проёмы; гараж — по периметру
    const o = Finish.opt();
    if (o.facade !== 'none') {
      for (const w of d.walls.filter(x => x.kind === 'ext')) out.facade += Model.wallLen(w) * (w.h + 45) / 1e4 - d.openings.filter(x => x.wall === w.id).reduce((a, x) => a + x.w * (x.h || 150) / 1e4, 0);
      for (const it of d.items.filter(x => BLD_HOLLOW.has(catItem(x.key).shape) && catItem(x.key).key !== 'house')) out.facade += 2 * (it.w + it.d) * bldWallH(it) / 1e4 - bldShell(it, it.w, it.d).ops.reduce((a, x) => a + x.w * x.h / 1e4, 0);
      out.bricks = Math.ceil(out.facade * 51 * 1.05);                          // одинарный 250×120×65 с растворным швом 10 мм — 51 шт./м², +5 %
    }
    out.doors = d.openings.filter(x => (OPENING_TYPES[x.type] || {}).cat === 'door').length;
    out.windows = d.openings.filter(x => (OPENING_TYPES[x.type] || {}).cat === 'window').length;
    return out;
  },
  /** Облицевать наружные стены: толщина растёт наружу (внутренние грани на месте), предметы у фасада сдвигаются вместе с ним */
  cladWalls(kind = 'brick') {
    const d = App.doc, Fc = FIN_FACADE[kind] || FIN_FACADE.brick, add = Fc.th + Fc.gap;
    const moved = [];
    for (const f of d.floors) {
      const fd = (App.floorData || []).find(x => x.floor.id === f.id), inside = (p) => fd && fd.outlines.some(o => G.pointInPoly(p, o.outer));
      const ext = d.walls.filter(w => (w.floor || d.floors[0].id) === f.id && w.kind === 'ext' && !(w.clad > 0));
      if (!ext.length || !add) continue;
      // смещение оси каждой стены наружу на add/2
      const shift = new Map(ext.map(w => { const u = Model.wallDir(w); let n = G.perp(u); if (inside(G.add(G.mid(w.a, w.b), G.mul(n, w.th / 2 + 10)))) n = G.mul(n, -1); return [w, n]; }));
      const line = (w) => { const n = shift.get(w); return [G.add(w.a, G.mul(n, add / 2)), G.add(w.b, G.mul(n, add / 2))]; };
      const newPt = new Map();
      for (const w of ext) for (const key of ['a', 'b']) {
        const p = w[key], other = ext.find(x => x !== w && (G.dist(x.a, p) < 1 || G.dist(x.b, p) < 1));
        const [a1, b1] = line(w);
        let q = key === 'a' ? a1 : b1;
        if (other) { const [a2, b2] = line(other), x = G.lineInter(a1, b1, a2, b2); if (x) q = { x: x.x, y: x.y }; }
        newPt.set(w.id + key, q);
      }
      for (const w of ext) {
        const u0 = Model.wallDir(w), a0 = { ...w.a };
        w.a = newPt.get(w.id + 'a'); w.b = newPt.get(w.id + 'b');
        const ds = G.dot(G.sub(a0, w.a), u0);
        for (const op of d.openings.filter(x => x.wall === w.id)) op.pos += ds;
        w.th += add; w.clad = Fc.th; w.gap = Fc.gap; w.cladMat = kind;
        // предметы и концы трасс на фасаде (в полосе 60 см снаружи) — наружу вместе с гранью
        const n = shift.get(w), L = Model.wallLen(w);
        const onFace = (p) => { const s = G.dot(G.sub(p, w.a), Model.wallDir(w)), k = G.dot(G.sub(p, G.mid(w.a, w.b)), n); return s > -40 && s < L + 40 && k > (w.th - add) / 2 - 20 && k < (w.th - add) / 2 + 60; };
        for (const it of d.items) if ((it.floor || d.floors[0].id) === f.id && !BLD_HOLLOW.has(catItem(it.key).shape) && !moved.includes(it) && onFace(it)) { it.x += n.x * add; it.y += n.y * add; moved.push(it); }
        for (const l of d.lines) if ((l.floor || d.floors[0].id) === f.id) for (const p of l.pts) if (onFace(p) && !moved.includes(p)) { p.x += n.x * add; p.y += n.y * add; moved.push(p); }
      }
    }
    return moved.length;
  },

  /* ------------------------------- лист ------------------------------- */
  panel() {
    const Q = Finish.quantities(), o = Finish.opt();
    const rows = Q.rooms.map(r => [r.name, `${(FIN_FLOORS[r.F.floor] || {}).short || r.F.floor} — ${r.A.toFixed(1)}`, `${(FIN_WALLS[r.F.walls] || {}).short || r.F.walls} — ${r.W.toFixed(1)}`, `${(FIN_CEIL[r.F.ceil] || {}).short} — ${r.A.toFixed(1)}`]);
    const sum = (m, T) => Object.entries(m).map(([k, v]) => [(T[k] || {}).name || k, `${v.toFixed(1)} м²`]);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Ведомость отделки'),
      Sheets.T(['Помещение', 'Пол, м²', 'Стены, м²', 'Потолок, м²'], rows),
      U.el('h4', {}, 'Материалы'), Sheets.T(null, [...sum(Q.floor, FIN_FLOORS), ...sum(Q.walls, FIN_WALLS), ...sum(Q.ceil, FIN_CEIL),
        o.facade !== 'none' ? [`Фасад: ${FIN_FACADE[o.facade].name}, ${(FIN_BRICK_COLORS[o.brick] || [])[0] || ''}`, `${Q.facade.toFixed(0)} м², ≈ ${Q.bricks} шт.`] : null,
        ['Двери межкомнатные: массив / шпон, тон «орех средний»', `${Q.doors} шт.`], ['Окна ПВХ: снаружи антрацит (ламинация), внутри белые', `${Q.windows} шт.`]].filter(Boolean)),
      U.el('h4', {}, 'Указания'), Sheets.ul(['Плитка 600×1200 — на клей С2 с системой выравнивания, шов 2 мм, по стяжке с тёплым полом — эластичный клей', 'В санузлах — обмазочная гидроизоляция пола и стен на 200 мм (в душе — на высоту 2 м)', 'Обои под покраску — по шпаклёвке и грунту, краска матовая моющаяся', 'Натяжной потолок — после чистовой отделки стен; закладные под светильники заранее', 'Облицовка: кирпич на гибких связях 4 шт./м², вентзазор 20–40 мм, продухи внизу и вверху кладки']),
      U.el('div', { class: 'norm' }, '§ СП 71.13330.2017 «Изоляционные и отделочные покрытия»; СП 29.13330.2011 «Полы»; СП 15.13330.2020'));
  },
};
