'use strict';
/* ==========================================================================
   Комплект для строителей: каждый лист — своя тема и только нужное на ней
   (генплан, фундамент, кладка, планы этажей, сети по отдельности — внутри дома
   и на участке, разрезы, узлы, кровля, отделка). Масштаб и ориентация листа
   подбираются сами так, чтобы чертёж занял лист; в предпросмотре у каждого
   листа можно сменить масштаб, ориентацию и что на нём показать.
   Оформление — по ГОСТ Р 21.101-2026 (поле 20 мм слева, 5 мм по краям, штамп 185 мм).
   ========================================================================== */

const Sheets = {
  PAPER: { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] },
  STD: [5, 10, 20, 25, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 2000],
  /** Какие предметы показывать на листе системы: слои каталога */
  SYS_LAYERS: { water: ['plumbing'], sewer: ['plumbing'], heating: ['heating'], warmfloor: ['heating'], vent: ['heating'], ac: ['electric', 'heating'], power: ['electric'], lowvolt: ['electric'], gas: ['gas'] },
  ITEM_LAYERS: ['furniture', 'plumbing', 'heating', 'gas', 'electric'],
  /** Сохранённые настройки листа: вкл., масштаб, ориентация, что показывать */
  cfg(key) { const s = App.doc.settings.sheets || {}; return s[key] || {}; },
  setCfg(key, patch) { const s = App.doc.settings.sheets = { ...(App.doc.settings.sheets || {}) }; s[key] = { ...(s[key] || {}), ...patch }; },
  /** Габарит дома по стенам этажа, см */
  wallsBox(fid) {
    let b = null;
    for (const w of Model.viewOf(fid).walls) if (w.kind !== 'fence') b = G.bboxUnion(b, G.bbox(Model.wallRect(w)));
    return b;
  },
  pad(b, p) { return b && { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p }; },
  inBox(p, b) { return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1; },

  /** Список листов проекта (порядок — как строится дом) */
  list() {
    const d = App.doc, g = d.floors[0], out = [], house = Sheets.wallsBox(g.id);
    const plot = d.areas.find(a => a.kind === 'plot');
    if (plot || d.roads.length) out.push({ key: 'site', kind: 'site', fid: g.id, title: 'Генплан участка', sub: 'Схема планировочной организации участка', bbox: () => plot ? G.bbox(plot.pts) : IO.regionFor('all'),
      toggles: { dims: ['Размеры', false], wells: ['Колодцы, септик, скважина', true], nets: ['Подземные сети', false] }, panel: () => Sheets.sitePanel() });
    const FDs = Struct.all();
    if (FDs.length) {
      const FH = Struct.foundation(), bor = FH && FH.type === 'bored';
      out.push({ key: 'found', kind: 'found', fid: g.id, title: bor ? 'План свай и ростверка' : 'План фундамента', sub: bor ? 'Разбивка свай и ростверка, шаг свай, армирование, объёмы' : 'Разбивка лент под стены, армирование, объёмы', bbox: () => Sheets.foundBox(), toggles: { dims: ['Размеры', true], walls: ['Контур стен', true], pits: ['Погреб, яма', true] }, panel: () => Sheets.foundPanel() });
      if (typeof Detail !== 'undefined') out.push({ key: 'found-node', kind: 'detail', detail: 'foundNode', fid: g.id, title: bor ? 'Узел фундамента: свая и ростверк' : 'Узел фундамента (разрез по ленте)', sub: bor ? 'Свая с уширением, ростверк, сминаемый слой, утепление, отмостка' : 'Подушка, лента, утепление, отмостка, гидроизоляция', fixedN: 20, panel: (sp) => Detail.nodePanel(sp, 'Узел фундамента', /Фундамент/) });
    }
    if (house) {
      out.push({ key: 'masonry', kind: 'masonry', fid: g.id, title: 'План кладки', sub: 'Материалы стен, армирование рядов, перемычки', bbox: () => Sheets.pad(Sheets.wallsBoxAll(g.id), 60), toggles: { dims: ['Размеры', true] }, panel: () => Sheets.masonryPanel() });
      if (typeof Detail !== 'undefined' && Struct.lintels().length) out.push({ key: 'lintels', kind: 'detail', detail: 'lintels', fid: g.id, title: 'Перемычки и армопояс', sub: 'Сечения, ведомость перемычек, уголки под облицовку, мауэрлат', fixedN: 10, panel: (sp) => Detail.lintelsPanel(sp) });
      if (typeof Detail !== 'undefined') for (const w of Detail.elevWalls()) out.push({ key: 'elev:' + w.key, kind: 'detail', detail: 'wallElev', arg: w, fid: g.id, title: 'Раскладка кладки: ' + w.name, sub: 'Ряды блоков, перевязка, армирование, перемычки, армопояс', panel: () => Sheets.elevPanel(w) });
    }
    for (const f of d.floors) {
      if (!Model.viewOf(f.id).walls.some(w => w.kind !== 'fence')) continue;
      out.push({ key: 'plan:' + f.id, kind: 'plan', fid: f.id, title: Drawing.sheetTitle(f), sub: `Отметка чистого пола ${f.elev >= 0 ? '+' : ''}${(f.elev / 100).toFixed(3)}`, bbox: () => Sheets.wallsBox(f.id),
        toggles: { dims: ['Размеры', true], furniture: ['Мебель и сантехника', true], rooms: ['Помещения', true], nets: ['Все сети', false] }, panel: () => Sheets.explPanel(f) });
    }
    // гараж (и другие тёплые/капитальные постройки от 20 м²): свой план с размерами, проёмами, ямой и погребом
    for (const it of d.items) if ((it.floor || g.id) === g.id && catItem(it.key).shape === 'garage') out.push({ key: 'plan-bld:' + it.id, kind: 'plan', bld: it.id, fid: g.id, title: 'План: ' + (it.label || catItem(it.key).name).toLowerCase(), sub: 'Размеры, ворота, двери, окна, смотровая яма, погреб, оборудование',
      bbox: () => Sheets.pad(G.bbox(Model.itemPts(it)), 60), toggles: { dims: ['Размеры', true], furniture: ['Оборудование', true] }, panel: () => Sheets.bldPanel(it) });
    if (house && typeof Detail !== 'undefined') out.push({ key: 'section', kind: 'detail', detail: 'section', fid: g.id, title: 'Разрез 1-1', sub: 'Фундамент, стены, перекрытие, крыша — отметки и узлы', panel: (sp) => Detail.sectionPanel(sp) });
    if (d.roofs.some(r => Roof.frame(r)) && typeof Detail !== 'undefined') {
      out.push({ key: 'roof', kind: 'detail', detail: 'roofPlan', fid: g.id, title: 'Кровля: стропильная система', sub: 'Стропила, обрешётка, мауэрлат, снеговая нагрузка', panel: () => Sheets.roofPanel() });
      out.push({ key: 'roof-node', kind: 'detail', detail: 'roofNode', fid: g.id, title: 'Узел: карниз и опирание стропил', sub: 'Армопояс, опорный брус, стропило, утепление, кровельный пирог', fixedN: 10, panel: (sp) => Detail.nodePanel(sp, 'Узел карниза', null, Detail.model().mz ? Detail.EAVE_NOTES_M : Detail.EAVE_NOTES) });
    }
    // крыши построек (гараж, сарай): свой лист стропильной системы
    if (typeof Detail !== 'undefined') for (const it of d.items) if ((it.floor || g.id) === g.id && bldFrame(it) && (catItem(it.key).shape === 'garage' || it.w * it.d >= 20e4)) out.push({ key: 'roof-bld:' + it.id, kind: 'detail', detail: 'bldRoof', arg: it.id, fid: g.id, title: 'Кровля: ' + (it.label || catItem(it.key).name).toLowerCase() + ' — стропильная система', sub: 'Разрез по ферме / стропилу, раскладка, мауэрлат, снеговая нагрузка', panel: (sp) => Detail.bldRoofPanel(it.id, sp) });
    if (house && typeof Finish !== 'undefined') out.push({ key: 'finish', kind: 'finish', fid: g.id, title: 'План отделки', sub: 'Полы, стены, потолки по помещениям', bbox: () => Sheets.wallsBox(g.id), toggles: { dims: ['Размеры', false], furniture: ['Мебель', false] }, panel: () => Finish.panel(d.floors.length > 1 ? g.id : null) });
    if (house && typeof Finish !== 'undefined') for (const f of d.floors.slice(1)) if (Model.viewOf(f.id).walls.some(w => w.kind !== 'fence')) out.push({ key: 'finish:' + f.id, kind: 'finish', fid: f.id, title: 'План отделки — ' + f.name.toLowerCase(), sub: 'Полы, стены, потолки по помещениям', bbox: () => Sheets.wallsBox(f.id), toggles: { dims: ['Размеры', false], furniture: ['Мебель', false] }, panel: () => Finish.panel(f.id) });
    // сети: внутри дома и снаружи — отдельными листами, у каждого свой масштаб
    const onG = (o) => (o.floor || g.id) === g.id, hb = Sheets.pad(house, 150);
    // ГОСТ Р 21.101-2026 п. 4.2: комплект открывает лист общих данных — ведомость листов, ссылочные документы, общие указания
    if (house) out.unshift({ key: 'general', kind: 'tab', fid: g.id, title: 'Общие данные', sub: 'Ведомость листов, ссылочные документы, общие указания', content: () => Sheets.generalContent() });
    for (const id of Object.keys(SYSTEMS)) {
      const lines = d.lines.filter(l => sysOfLine(l) === id && onG(l)), items = d.items.filter(it => sysOf(it) === id && onG(it));
      if (!lines.length && !items.length) continue;
      // внутри дома — трассы целиком в габарите дома (в т. ч. под полом); остальные — на участке
      const fdo = (App.floorData || []).find(x => x.floor.id === g.id), inH = (p) => fdo ? fdo.outlines.some(o => G.distPoly(p, o.outer) < 40) : hb && Sheets.inBox(p, hb);
      const out1 = (l) => l.pts.some(p => !inH(p));
      const inner = !hb ? [] : lines.filter(l => !out1(l)), outer = lines.filter(out1);
      const inItems = hb ? items.filter(it => Sheets.inBox(it, hb)) : [], outItems = items.filter(it => !hb || !Sheets.inBox(it, hb));
      const S = SYSTEMS[id];
      // электрика и любые сети с большими ведомостями: схема — на весь лист, таблицы — следующими листами (сколько нужно)
      const push = (spec, ls, its, where) => {
        const R = Sheets.sysRows(id, ls, its), big = id === 'power' || R.lrows.length > 20 || R.erows.length > 14;
        out.push(spec);
        if (!big) return;
        spec.panel = null; spec.sub += ' · ведомости — на следующих листах';
        const per = 32, pages = Math.max(1, Math.ceil(R.lrows.length / per), Math.ceil(R.erows.length / per));
        for (let p = 0; p < pages; p++) out.push({ key: spec.key + ':tab' + p, kind: 'tab', fid: spec.fid, title: 'Ведомость — ' + spec.title.charAt(0).toLowerCase() + spec.title.slice(1) + (pages > 1 ? ` (${p + 1} из ${pages})` : ''), sub: id === 'power' ? 'Группы щита, кабели, автоматы и УЗО, оборудование' : 'Трассы и оборудование', content: () => Sheets.tabContent(id, R, p, per, where, ls, its) });
      };
      if (house && (inner.length || inItems.length)) push({ key: 'sys-in:' + id, kind: 'sys', sys: id, lineSet: new Set(inner.map(l => l.id)), fid: g.id, title: 'Сети в доме: ' + S.name.toLowerCase(), sub: 'Внутренние сети, первый этаж', bbox: () => { let b = house; for (const l of inner) b = G.bboxUnion(b, G.bbox(l.pts)); return b; },
        toggles: { dims: ['Размеры', true], fixtures: ['Сантехника и приборы', true] }, panel: () => Sheets.sysPanel(id, inner, inItems, 'в доме') }, inner, inItems, 'в доме');
      if (outer.length || outItems.length) push({ key: 'sys-out:' + id, kind: 'sys', sys: id, outdoor: true, lineSet: new Set(outer.map(l => l.id)), fid: g.id, title: 'Сети на участке: ' + S.name.toLowerCase(), sub: 'Наружные сети, глубины, колодцы', bbox: () => { let b = Sheets.wallsBoxAll(g.id); for (const l of outer) b = G.bboxUnion(b, G.bbox(l.pts)); for (const it of outItems) b = G.bboxUnion(b, G.bbox(Model.itemPts(it))); return Sheets.pad(b, 150); },
        toggles: { dims: ['Размеры дома', false] }, panel: () => Sheets.sysPanel(id, outer, outItems, 'на участке') }, outer, outItems, 'на участке');
    }
    // верхние этажи (мансарда): свои листы внутренних сетей
    for (const f of d.floors.slice(1)) {
      const fb = Sheets.wallsBox(f.id);
      if (!fb) continue;
      for (const id of Object.keys(SYSTEMS)) {
        const lines = d.lines.filter(l => sysOfLine(l) === id && l.floor === f.id), items = d.items.filter(it => sysOf(it) === id && it.floor === f.id);
        if (!lines.length && !items.length) continue;
        const S = SYSTEMS[id], where = f.name.toLowerCase();
        out.push({ key: 'sys-in:' + id + ':' + f.id, kind: 'sys', sys: id, lineSet: new Set(lines.map(l => l.id)), fid: f.id, title: `Сети: ${S.name.toLowerCase()} — ${where}`, sub: 'Внутренние сети, ' + where,
          bbox: () => { let b = fb; for (const l of lines) b = G.bboxUnion(b, G.bbox(l.pts)); return Sheets.pad(b, 60); },
          toggles: { dims: ['Размеры', true], fixtures: ['Сантехника и приборы', true] }, panel: () => Sheets.sysPanel(id, lines, items, where) });
      }
    }
    out.push({ key: 'report', kind: 'report', title: 'Ведомости', sub: 'Экспликация, сети, оборудование' });
    return out;
  },
  /** Все стены этажа и стены построек (гараж) */
  wallsBoxAll(fid) {
    let b = Sheets.wallsBox(fid);
    for (const it of App.doc.items) if ((it.floor || App.doc.floors[0].id) === fid && BLD_HOLLOW.has(catItem(it.key).shape) && catItem(it.key).key !== 'house') b = G.bboxUnion(b, G.bbox(Model.itemPts(it)));
    return b;
  },
  foundBox() {
    let b = null;
    for (const F of Struct.all()) {
      for (const s of F.segs) b = G.bboxUnion(b, G.bbox([s.a, s.b]));
      for (const p of F.slabs || []) if (F.type === 'slab') b = G.bboxUnion(b, G.bbox(p));
      b = Sheets.pad(b, (F.width || 0.4) * 50);
    }
    return b;
  },

  /** Раскладка листа: бумага, ориентация, масштаб, поле чертежа (мм) */
  layout(spec, o) {
    const c = Sheets.cfg(spec.key), paper = Sheets.PAPER[o.paper] || Sheets.PAPER.A3;
    const hasPanel = !!spec.panel, bbox = spec.kind === 'detail' ? Detail.bbox(spec) : spec.bbox && spec.bbox();
    const try1 = (land) => {
      const [PW, PH] = land ? [Math.max(...paper), Math.min(...paper)] : [Math.min(...paper), Math.max(...paper)];
      const fw = PW - 25, fh = PH - 10, tbH = 40;
      const panelW = hasPanel ? (PW >= 400 ? 118 : 96) : 0;
      // узкий книжный лист: панель — под чертежом (высота чертежа — по масштабу, остальное — панели)
      const below = hasPanel && !land && PW < 300, minPanel = 80;
      const box = below ? { x: 21, y: 6, w: fw - 2, h: fh - tbH - minPanel - 5 } : { x: 21, y: 6, w: fw - panelW - 4, h: fh - tbH - 3 };
      if (!bbox) return { PW, PH, box, pnl: hasPanel ? (below ? { x: 21, y: 6 + box.h + 2, w: fw - 2, h: fh - tbH - box.h - 5 } : { x: 20 + fw - panelW, y: 6, w: panelW - 1, h: fh - tbH - 3 }) : null, N: spec.fixedN || 100, fill: 0 };
      const padMM = spec.kind === 'detail' ? 4 : (c.t && 'dims' in c.t ? c.t.dims : spec.toggles && spec.toggles.dims && spec.toggles.dims[1]) ? 24 : 8;
      const bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0;
      const n = Math.max((bw * 10) / (box.w - 2 * padMM), (bh * 10) / (box.h - 2 * padMM)), fixed = U.isNum(+c.scale) && +c.scale > 0 ? +c.scale : spec.fixedN || 0;
      // свой масштаб пользователя — как есть; типовой масштаб узла (1:10, 1:20) — если узел в него помещается
      const fit = Sheets.STD.find(x => x >= n) || Math.ceil(n), N = U.isNum(+c.scale) && +c.scale > 0 ? +c.scale : Math.max(fixed, fit);
      if (below) box.h = Math.min(box.h, Math.ceil(bh * 10 / N + 2 * padMM + 4));
      const pnl = !hasPanel ? null : below ? { x: 21, y: 6 + box.h + 2, w: fw - 2, h: fh - tbH - box.h - 5 } : { x: 20 + fw - panelW, y: 6, w: panelW - 1, h: fh - tbH - 3 };
      const draw = (bw * bh * 100 / N / N) / (fw * fh);                        // доля листа под чертежом
      return { PW, PH, box, pnl, N, fill: draw, land, fits: N >= n };
    };
    const L = try1(true), P = try1(false);
    const orient = c.orient || 'auto';
    const r = orient === 'landscape' ? L : orient === 'portrait' ? P : (P.N < L.N || (P.N === L.N && P.fill > L.fill * 1.15) ? P : L);
    r.bbox = bbox;
    return r;
  },

  /** Отрисовать лист в DOM-элемент */
  render(spec, o, idx, total) {
    if (spec.kind === 'report') {
      const [a, b] = Sheets.PAPER[o.paper] || Sheets.PAPER.A3, PW = Math.max(a, b), PH = Math.min(a, b);
      const el = IO.reportSheet(PW, PH, 10, { expl: true, spec: true, legend: true });
      el.dataset.key = spec.key; el._page = `p${PW}x${PH}`; el.style.page = el._page;
      return el;
    }
    if (spec.kind === 'tab') {
      const [a, b] = Sheets.PAPER[o.paper] || Sheets.PAPER.A3, PW = Math.max(a, b), PH = Math.min(a, b), mm = (v) => v + 'mm';
      const sheet = U.el('div', { class: 'sheet drawing sheet2', style: { width: mm(PW), height: mm(PH) }, 'data-key': spec.key },
        U.el('div', { class: 'dframe2', style: { left: '20mm', top: '5mm', width: mm(PW - 25), height: mm(PH - 10) } }),
        U.el('div', { class: 'spanel wide tabpage', style: { left: '23mm', top: '8mm', width: mm(PW - 31), height: mm(PH - 58), display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '8mm', alignItems: 'start' } }, spec.content()),
        U.el('div', { class: 'tb2', style: { right: '5mm', bottom: '5mm' } }, Sheets.tblock(spec, '—', idx, total)));
      sheet._page = `p${PW}x${PH}`; sheet.style.page = sheet._page;
      return sheet;
    }
    const Lt = Sheets.layout(spec, o), c = Sheets.cfg(spec.key), t = {};
    for (const [k, [, def]] of Object.entries(spec.toggles || {})) t[k] = c.t && k in c.t ? c.t[k] : def;
    const dpmm = Lt.PW > 500 ? 4 : 6, { box, N } = Lt;
    let img;
    if (spec.kind === 'detail') img = Detail.render(spec, box.w * dpmm, box.h * dpmm, N, dpmm);
    else {
      const b = Lt.bbox, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const reg = { x0: cx - box.w * N / 20, x1: cx + box.w * N / 20, y0: cy - box.h * N / 20, y1: cy + box.h * N / 20 };
      const opt = Sheets.renderOpts(spec, t);
      const draw = () => IO.renderRegion(reg, box.w * dpmm, box.h * dpmm, { drawing: true, fs: dpmm / 4, ...opt });
      img = Drawing.onFloor(spec.fid, () => t.dims && ['plan', 'sys', 'masonry', 'finish'].includes(spec.kind) ? Drawing.withAutoDims(spec.fid, draw, { blds: spec.kind === 'masonry' || spec.bld, noHouse: !!spec.bld }) : draw()).canvas;
    }
    const tb = Sheets.tblock(spec, '1:' + N, idx, total);
    const mm = (v) => v + 'mm';
    const sheet = U.el('div', { class: 'sheet drawing sheet2', style: { width: mm(Lt.PW), height: mm(Lt.PH) }, 'data-key': spec.key },
      U.el('div', { class: 'dframe2', style: { left: '20mm', top: '5mm', width: mm(Lt.PW - 25), height: mm(Lt.PH - 10) } }),
      U.el('img', { src: img.toDataURL('image/png'), style: { position: 'absolute', left: mm(box.x), top: mm(box.y), width: mm(box.w), height: mm(box.h) }, alt: spec.title }),
      Lt.pnl ? U.el('div', { class: 'spanel' + (Lt.pnl.w > 150 ? ' wide' : ''), style: { left: mm(Lt.pnl.x), top: mm(Lt.pnl.y), width: mm(Lt.pnl.w), height: mm(Lt.pnl.h) } }, spec.panel(spec)) : null,
      U.el('div', { class: 'tb2', style: { right: '5mm', bottom: '5mm' } }, tb));
    sheet._layout = Lt;
    sheet._page = `p${Lt.PW}x${Lt.PH}`;
    sheet.style.page = sheet._page;
    return sheet;
  },
  /** Штамп листа (ГОСТ Р 21.101-2026, упрощённо): проект, лист, масштаб, номер */
  tblock(spec, scale, idx, total) {
    const date = new Date().toLocaleDateString('ru-RU');
    return U.el('table', { class: 'tblock' },
      U.el('tr', {}, U.el('td', { colspan: 3, class: 'tb-proj' }, App.doc.name || 'Проект')),
      U.el('tr', {}, U.el('td', { rowspan: 2, class: 'tb-sheet' }, spec.title, U.el('div', { class: 'tb-note' }, spec.sub || '')), U.el('td', { class: 'tb-h' }, 'Масштаб'), U.el('td', { class: 'tb-h' }, 'Лист')),
      U.el('tr', {}, U.el('td', {}, scale), U.el('td', {}, `${idx + 1} / ${total}`)),
      U.el('tr', {}, U.el('td', { colspan: 3, class: 'tb-date' }, `Floorplaner · ${date}`)));
  },
  /** Слои и фильтры отрисовки плана по виду листа */
  renderOpts(spec, t) {
    const L = { grid: false, underlay: false, site: false, siteobj: false, walls: true, roof: false, lower: false, rooms: true, furniture: false, plumbing: false, heating: false, gas: false, electric: false, dims: !!t.dims, notes: false, checks: false, found: false, masonry: false, finish: false, shadows: false, heat: false, fence: false };
    const none = Object.fromEntries(Object.keys(SYSTEMS).map(k => [k, false])), all = Object.fromEntries(Object.keys(SYSTEMS).map(k => [k, true]));
    switch (spec.kind) {
      case 'site': {
        Object.assign(L, { site: true, siteobj: true, fence: true, rooms: false, plumbing: !!t.wells, gas: !!t.wells, dims: !!t.dims });
        // машины, яма и погреб внутри гаража на генплане не нужны — только загромождают подписи
        // и всё, что внутри дома (сантехника, приборы), — на генплане дом показан контуром с подписью
        const fdo = (App.floorData || [])[0], inHouse = (it) => !!fdo && fdo.outlines.some(o => G.pointInPoly(it, o.outer));
        const inner = (it) => ['car', 'pit'].includes(catItem(it.key).shape) || inHouse(it);
        return { layersOver: L, siteTies: true, sys: t.wells || t.nets ? all : none, noLines: !t.nets, itemFilter: (it) => !inner(it) && (t.wells || !sysOf(it)) };
      }
      case 'found': {
        Object.assign(L, { rooms: false, found: true, siteobj: !!t.pits, dims: false });
        return { layersOver: L, sys: none, noLines: true, ghostWalls: t.walls !== false, noCompass: true, itemFilter: (it) => catItem(it.key).shape === 'pit', found: true, foundDims: !!t.dims };
      }
      case 'masonry': {
        Object.assign(L, { rooms: false, masonry: true, siteobj: true });
        return { layersOver: L, sys: none, noLines: true, noCompass: true, itemFilter: (it) => BLD_HOLLOW.has(catItem(it.key).shape) };
      }
      case 'plan': case 'finish': {
        if (spec.bld) {                                                       // план постройки: она сама и всё внутри (без машин)
          const B = Model.get(spec.bld), poly = B ? Model.itemPts(B) : [];
          Object.assign(L, { furniture: !!t.furniture, plumbing: !!t.furniture, heating: !!t.furniture, electric: !!t.furniture, siteobj: true, rooms: false, walls: false });
          return { layersOver: L, sys: none, noLines: true, roomNums: false, noBldLabel: true, itemFilter: (it) => it === B || (catItem(it.key).shape !== 'car' && G.pointInPoly(it, poly)) };
        }
        // веранды и крыльца — часть дома (иначе стол на веранде «висит» в воздухе), прочие постройки участка — нет
        Object.assign(L, { furniture: !!t.furniture, plumbing: !!t.furniture, rooms: t.rooms !== false, finish: spec.kind === 'finish', heating: !!t.nets, gas: !!t.nets, electric: !!t.nets, siteobj: true });
        // и не то, что стоит внутри гаража / сарая (антресоли, стеллажи) — у них свои листы
        const bldPolys = App.doc.items.filter(b => BLD_HOLLOW.has(catItem(b.key).shape)).map(b => Model.itemPts(b));
        return { layersOver: L, sys: t.nets ? all : none, noLines: !t.nets, noCompass: spec.kind === 'finish', roomNums: true, itemFilter: (it) => (catItem(it.key).layer !== 'siteobj' || catItem(it.key).shape === 'veranda') && !bldPolys.some(q => G.pointInPoly(it, q)) };
      }
      case 'sys': {
        for (const k of Sheets.SYS_LAYERS[spec.sys] || []) L[k] = true;
        if (t.fixtures && (spec.sys === 'water' || spec.sys === 'sewer')) L.plumbing = true;
        L.rooms = !spec.outdoor; L.furniture = false;
        if (spec.outdoor) Object.assign(L, { site: true, siteobj: true, fence: true });
        const only = { ...none, [spec.sys]: true };
        // в доме — только то, что у дома (вентиляция гаража и т.п. не лезет на край листа); на участке — все постройки для привязки
        const near = Sheets.houseBox(spec.fid);
        const inDoor = (it) => !near || (it.x > near.x0 && it.x < near.x1 && it.y > near.y0 && it.y < near.y1);
        const site = (it) => { const d = catItem(it.key); return BLD_HOLLOW.has(d.shape) || SITE_BLD_SHAPES.has(d.shape); };
        const tags = ['vent', 'gas'].includes(spec.sys) || (spec.outdoor && !['power', 'lowvolt'].includes(spec.sys)) ? spec.sys : null;
        return { layersOver: L, sysOnly: only, roomNums: !spec.outdoor, sysTags: tags, lineFilter: spec.lineSet ? (l) => spec.lineSet.has(l.id) : null, itemFilter: spec.outdoor ? (it) => sysOf(it) === spec.sys || site(it) : inDoor };
      }
    }
    return { layersOver: L };
  },

  /** Габарит помещений этажа + 2 м — «дом» на листах внутренних сетей */
  houseBox(fid) {
    const fd = (App.floorData || []).find(x => x.floor.id === fid) || (App.floorData || [])[0];
    if (!fd || !fd.rooms.length) return null;
    const b = G.bbox(fd.rooms.flatMap(r => r.floor || r.axis || []));
    return G.bboxValid(b) ? { x0: b.x0 - 200, y0: b.y0 - 200, x1: b.x1 + 200, y1: b.y1 + 200 } : null;
  },

  /* ----------------------------- панели листов ----------------------------- */
  T(head, rows) { return U.el('table', {}, head ? U.el('tr', {}, head.map(h => U.el('th', {}, h))) : null, rows.map(r => U.el('tr', {}, r.map(c => U.el('td', {}, c))))); },
  cut(rows, n) { return rows.length > n ? rows.slice(0, n).concat([['… ещё ' + (rows.length - n)].concat(Array(Math.max(0, (rows[0] || []).length - 1)).fill(''))]) : rows; },
  ul(list) { return U.el('ul', {}, list.map(r => U.el('li', {}, r))); },
  notes(re) { try { return Analysis.run().issues.filter(i => i.sev === 'note' && re.test(i.group)).map(i => i.text); } catch { return []; } },
  notesPanel(re) { const n = Sheets.notes(re); return U.el('div', { class: 'sysdesc' }, U.el('h4', {}, 'Указания'), n.length ? Sheets.ul(n) : U.el('p', {}, 'Выполнять по узлу.')); },
  sitePanel() {
    const s = Rooms.summary(), rows = [];
    if (s.plotArea) rows.push(['Участок', `${(s.plotArea / 1e4).toFixed(0)} м² (${(s.plotArea / 1e6).toFixed(2)} сот.)`], ['Застроено', `${(s.built / 1e4).toFixed(0)} м² (${(s.built / s.plotArea * 100).toFixed(1)}%)`]);
    for (const it of s.outb) rows.push([it.label || catItem(it.key).name, `${(it.w * it.d / 1e4).toFixed(1)} м²`]);
    let ch = []; try {
      // главное для согласования — дом и постройки к границам, улице и друг к другу; кусты и деревья — в конец, повторы — одной строкой
      const minor = (r) => /Кустарник|Дерев|Плодов|Хвойн/.test(r.a.name + r.bName) ? 1 : 0, seen = new Set();
      ch = Checks.run().results.filter(r => r.ok).sort((a, b) => minor(a) - minor(b) || (a.d - a.rule.min) - (b.d - b.rule.min))
        .map(r => [`${r.a.name} — ${r.bName}`, `${(r.d / 100).toFixed(1)} м (≥ ${(r.rule.min / 100).toFixed(1)})`]).filter(r => !seen.has(r[0]) && seen.add(r[0])).slice(0, 12);
    } catch { ch = []; }
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Генплан'), Sheets.T(['Объект', 'Площадь'], Sheets.cut(rows, 14)), ch.length ? U.el('h4', {}, 'Отступы по нормам (выполнены)') : null, ch.length ? Sheets.T(null, ch) : null,
      U.el('div', { class: 'norm' }, '§ СП 42.13330.2026; СП 53.13330.2019; СП 4.13130.2013'));
  },
  /** Панель листа постройки: габариты, стены, проёмы, полы, инженерия */
  bldPanel(it) {
    const s = bldShell(it, it.w, it.d), R = bldRoof(it), wm = WALL_MATERIALS[bldWallMat(it)] || {}, core = s.t - (it.clad > 0 ? it.clad + (it.gap ?? 1) : 0);
    const inside = (k) => App.doc.items.filter(x => G.pointInPoly(x, Model.itemPts(it)) && k(x));
    const ops = s.ops.map(o => `${OPENING_TYPES[o.type].name} ${Math.round(o.w)}×${Math.round(o.h)}${o.label ? ' — ' + o.label : ''}${o.out ? ', наружу' : ''}`);
    const pit = inside(x => catItem(x.key).shape === 'pit'), vent = inside(x => sysOf(x) === 'vent'), lamps = inside(x => /lamp|led/i.test(catItem(x.key).shape)), heat = inside(x => sysOf(x) === 'heating');
    const rows = [
      ['Габарит по наружным граням', `${(it.w / 100).toFixed(2)} × ${(it.d / 100).toFixed(2)} м`], ['Площадь внутри', `${(bldInnerArea(it) / 1e4).toFixed(1)} м²`],
      ['Стены', `${wm.name || bldWallMat(it)} ${Math.round(core)} см${it.clad > 0 ? `, облицовка ${it.clad} см (зазор ${it.gap ?? 1} см)` : ''}`], ['Высота стен до карниза', `${(bldWallH(it) / 100).toFixed(2)} м`],
      ['Крыша', `${ITEM_ROOF_TYPES[R.type].name}, ${Math.round(R.pitch)}°, ${(ROOF_MATERIALS[R.mat] || {}).name || R.mat}`], ['Проёмы', ops.join('; ')],
      ['Пол', 'бетон B22,5 W6 100 мм по XPS 50 мм и песку, сетка Ø8 150×150, уклон 1 % к воротам, упрочнённый верх (топпинг)'],
      pit.length ? ['Яма / погреб', pit.map(x => x.label || catItem(x.key).name).join('; ')] : null,
      ['Отопление', heat.length ? `${heat.length} прибора, дежурный режим +5 °C` : 'нет'], ['Вентиляция', vent.length ? vent.map(x => x.label || catItem(x.key).name).join('; ') : 'нет'],
      ['Освещение', `${lamps.length} светильника`],
    ].filter(Boolean);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, it.label || catItem(it.key).name), Sheets.T(null, rows),
      U.el('h4', {}, 'Указания'), Sheets.ul(['Ворота — утеплённые секционные, с калиткой или отдельной дверью; над воротами — козырёк', 'Дверь в дом — только через крыльцо-тамбур: утеплённая металлическая, с порогом и доводчиком (газы из гаража не проходят в жилые помещения)', 'Приток — решётка внизу стены, вытяжка — из-под кровли (переток по высоте): 180 м³/ч на машину', 'Яма и погреб — монолит с гидроизоляцией; люк ямы — щиты, ограждение при работе; освещение ямы — 36 В', 'Электрика — отдельная группа с УЗО 30 мА, розетки IP44 на 1,0 м']),
      U.el('div', { class: 'norm' }, '§ СП 113.13330.2023 (стоянки); СП 60.13330.2020; СП 52.13330.2016; ПУЭ 7.1'));
  },
  foundPanel() {
    const FDs = Struct.all(), notes = Sheets.notes(/Фундамент/);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Фундамент'),
      Sheets.T(['Параметр', ...FDs.map(F => F.name)], [
        ['Тип', ...FDs.map(F => FOUND_TYPES[F.type])],
        ['Грунт', ...FDs.map(() => Struct.soilText())],
        ['Промерзание, м', ...FDs.map(F => `${F.dfn.toFixed(2)} × ${F.kh} = ${F.df.toFixed(2)}`)],
        ['Размеры, м (глубина / ширина / высота)', ...FDs.map(F => Struct.dimsText(F))],
        ['Нагрузка / несущая способность', ...FDs.map(F => Struct.loadText(F))],
        ['Армирование', ...FDs.map(F => F.bars)],
        ['Бетон (лента/ростверк B20–B22,5 W6 F150, сваи B22,5)', ...FDs.map(F => `${F.concrete.toFixed(1)} м³`)],
        ['Арматура', ...FDs.map(F => `${F.rebar.toFixed(0)} кг`)],
        ['Подушка / XPS', ...FDs.map(F => `${(F.sand || 0).toFixed(1)} м³ / ${F.xps.toFixed(0)} м²`)]]),
      U.el('h4', {}, 'Указания'), Sheets.ul(notes.concat(FDs.some(F => F.type === 'bored') ? ['Сваи: разбивка по осям ±20 мм, бурение ТИСЭ с уширением пяты, обсадка рубероидом в зоне промерзания; бетонировать в день бурения, с вибрированием; выпуски 4 Ø12 на 400 мм в ростверк', 'Ростверк: по сминаемому слою 150 мм на песке 100 мм, опалубка, гидроизоляция боковых граней, отсечка 2 слоя под кладку; углы и примыкания — Г- и П-образными стержнями, нахлёст 50d', 'Защитный слой 40 мм; бетонирование ростверка без перерывов; распалубка ≥ 7 сут, кладка — после 70 % прочности'] : ['Подошва — на уплотнённую песчаную подушку 200 мм (Кпл ≥ 0,95), гидроизоляция боковых граней, отсечка под кладку', 'Защитный слой 40 мм, нахлёст стержней 50d, в углах — Г-образные элементы', 'Бетонирование без перерывов; распалубка ≥ 7 сут, кладка — после 70 % прочности'])),
      U.el('div', { class: 'norm' }, '§ СП 22.13330.2016; СП 24.13330.2021 (сваи); СП 63.13330.2018; СП 50-101-2004; СП 45.13330.2017'));
  },
  masonryPanel() {
    const rows = Struct.masonry().filter(r => r.lenBear || r.rule.every);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Кладка'),
      Sheets.T(['Стена', 'Армирование'], rows.map(r => [`${r.name}, ${r.th} см, ${r.len.toFixed(1)} м, ${r.courses} рядов`, (r.rule.every ? `1-й и каждый ${r.rule.every}-й ряд: ${r.rule.how}` : r.rule.how) + (r.ring ? '; армопояс 250 мм, 4 Ø12' : '') + (r.ops ? `; перемычки ${r.ops} шт.` : '')])),
      U.el('h4', {}, 'Указания'), Sheets.ul(Sheets.notes(/Конструкции/).concat(['Первый ряд — на цементно-песчаный раствор по горизонтальной гидроизоляции, выверить по уровню', 'Перевязка швов — не менее 0,4 высоты блока (обычно ½ блока); углы и примыкания — с перевязкой через ряд или гибкими связями', 'Толщина швов: клей 2–3 мм, раствор 10–12 мм; вертикальные швы — заполнять', 'Опирание перемычек — не менее 250 мм с каждой стороны'])),
      U.el('div', { class: 'norm' }, '§ СП 15.13330.2020; СП 70.13330.2012; СП 339.13330.2017'));
  },
  explPanel(f) {
    const fd = (App.floorData || []).find(x => x.floor.id === f.id);
    // мансарда: высота по скату (от — до) и доля площади ≥ 2,5 м; часть ниже 1,5 м — с коэффициентом 0,7 (СП 54.13330.2022, прил. А)
    const hs = (fd ? fd.rooms : []).map(r => Roof.roomHeights(r.floor || r.axis, f)), mans = hs.some(Boolean);
    const rows = (fd ? fd.rooms : []).map((r, i) => { const h = hs[i]; const a = r.areaFloor / 1e4, ak = h ? a * (1 - h.lo15 * 0.3) : a;
      return [String(i + 1), r.name, a.toFixed(2), ...(mans ? [h ? `${(h.min / 100).toFixed(2)}…${(h.max / 100).toFixed(2)} (${Math.round(h.hi * 100)} %)` : '', ak.toFixed(2)] : [])]; });
    const s = rows.reduce((a, r) => a + +r[2], 0), sk = mans ? rows.reduce((a, r) => a + +r[4], 0) : 0;
    rows.push(['', 'Итого', s.toFixed(2), ...(mans ? ['', sk.toFixed(2)] : [])]);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Экспликация помещений'), Sheets.T(mans ? ['№', 'Помещение', 'м²', 'h, м (≥ 2,5 м)', 'м² с коэф.'] : ['№', 'Помещение', 'м²'], rows),
      mans ? U.el('div', { class: 'tb-note' }, 'Мансарда: высота под скатом — от кнеевой стены до плоского потолка; площадь с высотой ниже 1,5 м — с коэффициентом 0,7') : null,
      U.el('div', { class: 'norm' }, '§ СП 55.13330.2016; СП 54.13330.2022' + (mans ? ', прил. А' : '')));
  },
  /** Строки ведомостей системы: трассы (одинаковые подписи — одной строкой; у электрики — по группам щита: автомат, УЗО)
   *  и оборудование по наименованиям */
  sysRows(id, lines, items) {
    const power = id === 'power', by = new Map();
    for (const l of lines) {
      const lbl = l.label || LINE_KINDS[l.kind].code, m = power && /^Гр\.(\d+)/.exec(lbl), k = m ? 'Гр.' + m[1] : lbl, L = G.polyPerimeter(l.pts, false) / 100;
      const r = by.get(k) || { k, name: lbl, longest: 0, sec: '', br: '', rcd: '', L: 0, depth: 0, heated: false, n: 0 };
      if (L > r.longest && !/→/.test(lbl)) { r.longest = L; r.name = lbl; }
      r.L += L; r.n++; r.depth = Math.max(r.depth, l.depth || 0); r.heated = r.heated || !!l.heated;
      r.sec = r.sec || l.section || (l.dia ? 'Ø' + l.dia : ''); r.br = r.br || l.breaker || ''; r.rcd = r.rcd || l.rcd || '';
      by.set(k, r);
    }
    // ответвление группы на другом листе (в сарай, на участок): автомат и УЗО — с основной линии группы в щите
    if (power) for (const r of by.values()) if (/^Гр\.\d+$/.test(r.k) && !r.br) {
      const main = App.doc.lines.find(l => l.kind === 'power' && l.breaker && new RegExp('^' + r.k.replace('.', '\\.') + '(?!\\d)').test(l.label || ''));
      if (main) { r.br = main.breaker; r.rcd = r.rcd || main.rcd || ''; }
    }
    const ord = (k) => { const m = /^Гр\.(\d+)/.exec(k); return m ? +m[1] : /^Ввод/.test(k) ? -1 : 1e3; };
    const rows = [...by.values()].sort((a, b) => ord(a.k) - ord(b.k) || a.k.localeCompare(b.k, 'ru'));
    const lrows = rows.map(r => power ? [r.name, r.sec, r.br, r.rcd, r.L.toFixed(1), r.depth ? (r.depth / 100).toFixed(2) : '—'] : [r.name, r.sec, r.L.toFixed(1), r.depth ? (r.depth / 100).toFixed(2) + (r.heated ? '*' : '') : '—']);
    const eq = {};
    // наименование — по каталогу; подпись — уточнение («Розетка двойная — над столом»), если это не само название
    for (const it of items) { const nm = catItem(it.key).name, lb = it.label || '', k = !lb ? nm : lb.toLowerCase().startsWith(nm.toLowerCase().split(' ')[0]) || lb.length > 24 && !/^(IP|над|у |для)/i.test(lb) ? lb : nm + ' — ' + lb.charAt(0).toLowerCase() + lb.slice(1); eq[k] = (eq[k] || 0) + 1; }
    return { lrows, lhead: power ? ['Группа / линия', 'Кабель', 'Автомат', 'УЗО', 'L, м', 'Глуб., м'] : ['Обозн.', 'Марка / Ø', 'L, м', 'Глуб., м'],
      erows: Object.entries(eq).sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([k, n]) => [k, String(n)]), len: lines.reduce((a, l) => a + G.polyPerimeter(l.pts, false), 0) };
  },
  /** Лист-ведомость к листу сетей: трассы слева, оборудование справа; на первом — легенда, требования, нормы */
  tabContent(id, R, p, per, where, lines, items) {
    const S = SYSTEMS[id], kinds = [...new Set(lines.map(l => l.kind))], lr = R.lrows.slice(p * per, (p + 1) * per), er = R.erows.slice(p * per, (p + 1) * per);
    const left = U.el('div', { class: 'sysdesc' }, U.el('h3', {}, S.name + ' — ' + where),
      p === 0 && kinds.length ? U.el('div', {}, kinds.map(k => U.el('div', {}, U.el('span', { class: 'sw', style: { borderTopColor: LINE_KINDS[k].color, borderTopStyle: LINE_KINDS[k].dash.length ? 'dashed' : 'solid' } }), `${LINE_KINDS[k].code} — ${LINE_KINDS[k].name}`))) : null,
      lr.length ? U.el('h4', {}, id === 'power' ? `Группы и линии: ${R.lrows.length}, кабеля всего ${(R.len / 100).toFixed(1)} м` : `Трассы: ${R.lrows.length}, всего ${(R.len / 100).toFixed(1)} м`) : null,
      lr.length ? Sheets.T(R.lhead, lr) : null);
    const right = U.el('div', { class: 'sysdesc' }, er.length ? U.el('h4', {}, 'Оборудование') : null, er.length ? Sheets.T(['Наименование', 'Кол.'], er) : null,
      p === 0 ? U.el('h4', {}, 'Требования') : null, p === 0 ? Sheets.ul(SYSTEM_RULES[id] || []) : null,
      p === 0 ? U.el('div', { class: 'norm' }, '§ ' + S.norms) : null);
    return [left, right];
  },
  /** Ссылочные нормативные документы комплекта (редакции на 01.10.2026) */
  REFS: [
    ['ГОСТ Р 21.101-2026', 'СПДС. Основные требования к проектной и рабочей документации (с 01.04.2026, взамен ГОСТ Р 21.101-2020)'],
    ['СП 42.13330.2026', 'Градостроительство. Планировка и застройка территорий (с 12.07.2026, взамен СП 42.13330.2016): ИЖС — Кз ≤ 0,2, Кпз ≤ 0,4'],
    ['СП 53.13330.2019', 'Планировка и застройка территорий садоводства — отступы построек, разрывы (справочно для ИЖС)'],
    ['СП 55.13330.2016', 'Дома жилые одноквартирные'],
    ['СП 50.13330.2024', 'Тепловая защита зданий'],
    ['СП 131.13330.2020', 'Строительная климатология'],
    ['СП 20.13330.2016', 'Нагрузки и воздействия'],
    ['СП 22.13330.2016', 'Основания зданий и сооружений'],
    ['СП 24.13330.2021', 'Свайные фундаменты'],
    ['СП 63.13330.2018', 'Бетонные и железобетонные конструкции'],
    ['СП 15.13330.2020', 'Каменные и армокаменные конструкции'],
    ['СП 64.13330.2017', 'Деревянные конструкции'],
    ['СП 16.13330.2017; СП 70.13330.2012', 'Стальные конструкции (уголки перемычек); несущие и ограждающие конструкции (производство работ)'],
    ['СП 17.13330.2017', 'Кровли'],
    ['ГОСТ 23166-2021; ГОСТ 30971-2012', 'Оконные блоки; швы монтажные узлов примыкания к стеновым проёмам'],
    ['ГОСТ Р 72796-2026', 'Подоконники из алюминиевых и ПВХ-профилей (с 01.10.2026, впервые)'],
    ['ГОСТ 475-2026', 'Блоки дверные деревянные и комбинированные (с 01.10.2026, взамен ГОСТ 475-2016)'],
    ['СП 30.13330.2020', 'Внутренний водопровод и канализация зданий'],
    ['СП 31.13330.2021; СП 32.13330.2018', 'Водоснабжение. Наружные сети; Канализация. Наружные сети'],
    ['СП 60.13330.2020', 'Отопление, вентиляция и кондиционирование воздуха'],
    ['СП 62.13330.2011; СП 402.1325800.2018', 'Газораспределительные системы; системы газопотребления жилых зданий'],
    ['ПУЭ 7; СП 256.1325800.2016', 'Электроустановки жилых и общественных зданий'],
    ['СП 6.13130.2026; ГОСТ 31565-2012', 'Пожарная безопасность электроустановок (с 30.06.2026); кабели — классы пожарной опасности'],
    ['СП 52.13330.2016', 'Естественное и искусственное освещение'],
    ['СП 134.13330.2022', 'Системы электросвязи зданий'],
    ['СП 4.13130.2013', 'Ограничение распространения пожара: разрывы между зданиями'],
    ['СП 29.13330.2011; СП 71.13330.2017', 'Полы; изоляционные и отделочные покрытия'],
    ['ГОСТ Р 72509-2026', 'Отделочные работы. Требования к результатам работ (с 01.03.2026)'],
    ['ГОСТ Р 58276-2025', 'Смеси сухие строительные на гипсовом вяжущем. Методы испытаний (с 01.10.2026, взамен 2018)'],
    ['СанПиН 2.1.3684-21', 'Зоны санитарной охраны источников водоснабжения, септик, выгреб (с изм. от 10.03.2026)'],
  ],
  /** Лист «Общие данные»: ведомость листов (слева), ссылочные документы и общие указания (справа) */
  generalContent() {
    const list = Sheets.list(), cl = Climate.get(), b = Sheets.wallsBox(App.doc.floors[0].id);
    let iss = []; try { iss = Analysis.run().issues.filter(x => x.sev !== 'note'); } catch { iss = []; }
    const m = (v) => (v / 100).toFixed(2).replace('.', ',');
    const notes = [
      `Район строительства: ${cl.city}. Снеговой район ${Climate.roman(cl.snow)} (Sg = ${cl.snowKpa} кПа), ветровой ${Climate.roman(cl.wind, true)} (w0 = ${cl.windKpa} кПа), расчётная температура ${cl.t5} °C, ГСОП ≈ ${Climate.gsop()} °C·сут, нормативная глубина промерзания ${(Climate.frost() / 100).toFixed(2).replace('.', ',')} м.`,
      `Требуемое сопротивление теплопередаче (СП 50.13330.2024 табл. 3): стены ${Climate.Rreq('wall')}, чердачное перекрытие ${Climate.Rreq('attic')}, покрытие ${Climate.Rreq('roof')} м²·°C/Вт.`.replace(/(\d)\.(\d)/g, '$1,$2'),
      typeof Struct !== 'undefined' ? `Основание: ${Struct.soilText()}. Без инженерно-геологических изысканий фундамент рассчитан по табличным R0 — до начала работ выполнить изыскания (СП 22.13330.2016 п. 5.1).` : '',
      b ? `Габарит дома по наружным стенам ${m(b.x1 - b.x0)} × ${m(b.y1 - b.y0)} м. За отметку 0,000 принят уровень чистого пола первого этажа.` : '',
      'Отступы от границ участка и красных линий проверены по СП 42.13330.2026 и СП 53.13330.2019; окончательно — по ПЗЗ муниципалитета и ГПЗУ.',
      (() => { const S = Rooms.summary(); return S.plotArea ? `Участок ${(S.plotArea / 1e4).toFixed(0)} м²: застройка ${(S.built / 1e4).toFixed(0)} м² — коэффициент застройки ${(S.built / S.plotArea).toFixed(2).replace('.', ',')}, плотности ${(S.gross / S.plotArea).toFixed(2).replace('.', ',')} (СП 42.13330.2026 для кварталов ИЖС — 0,2 / 0,4; для участка обязателен предельный процент застройки по ПЗЗ).` : ''; })(),
      'Электропроводка в доме и постройках — кабелем ВВГнг(А)-LS; в каркасных и деревянных конструкциях — в металлической трубе или металлорукаве (СП 6.13130.2026, ГОСТ 31565-2012).',
      'Наружные двери — с порогом и не менее чем двумя контурами уплотнения, класс водонепроницаемости по ГОСТ 475-2026 (деревянные и комбинированные) / ГОСТ 31173-2016 (стальные).',
      'Септик — не ближе 5 м от фундамента; расстояние до скважины — по СанПиН 2.1.3684-21 (изм. от 12.02.2026) в зависимости от грунта и объёма стоков; сброс в канаву, кювет, овраг запрещён — только доочистка в грунте в границах участка.',
      'Монтажные швы окон — трёхслойные по ГОСТ 30971-2012: внутри пароизоляционная лента, в середине ПСУЛ/пена, снаружи паропроницаемая лента.',
      'Двери — по ГОСТ 475-2026, подоконники — по ГОСТ Р 72796-2026, отделку принимать по ГОСТ Р 72509-2026 (класс отделки указать в договоре подряда).',
      'Уведомление о планируемом строительстве ИЖС и об окончании строительства — через Госуслуги; с 01.09.2026 разрешительные документы ведутся в электронном реестре (выписка вместо бумажного документа).',
      iss.length ? `Автоматическая проверка проекта: замечаний ${iss.length} — см. панель «Анализ».` : 'Автоматическая проверка проекта по нормам: замечаний нет.',
    ].filter(Boolean);
    const left = U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Ведомость листов'),
      Sheets.T(['Лист', 'Наименование', 'Содержание'], list.map((x, i) => [String(i + 1), x.title, x.sub || ''])));
    const right = U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Ссылочные документы'), Sheets.T(['Обозначение', 'Наименование'], Sheets.REFS),
      U.el('h3', {}, 'Общие указания'), U.el('ol', {}, notes.map(t => U.el('li', {}, t))));
    return [left, right];
  },
  sysPanel(id, lines, items, where) {
    const S = SYSTEMS[id], len = lines.reduce((a, l) => a + G.polyPerimeter(l.pts, false), 0), kinds = [...new Set(lines.map(l => l.kind))];
    const R = Sheets.sysRows(id, lines, items), lrows = R.lrows, eq = Object.fromEntries(R.erows.map(([k, n]) => [k, +n]));
    const grp = { power: 'Электрика', lowvolt: 'Видеонаблюдение', vent: 'Вентиляция', gas: 'Газ' };
    let iss = []; try { iss = Analysis.run().issues.filter(x => x.sev !== 'note' && (x.group === grp[id] || (x.group === 'Подключения' && (lines.some(l => l.id === x.id) || items.some(i => i.id === x.id))))); } catch { iss = []; }
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, S.name + ' — ' + where),
      kinds.length ? U.el('div', {}, kinds.map(k => U.el('div', {}, U.el('span', { class: 'sw', style: { borderTopColor: LINE_KINDS[k].color, borderTopStyle: LINE_KINDS[k].dash.length ? 'dashed' : 'solid' } }), `${LINE_KINDS[k].code} — ${LINE_KINDS[k].name}`))) : null,
      lines.length ? U.el('h4', {}, `Трассы: ${lines.length}, всего ${(len / 100).toFixed(1)} м`) : null,
      lines.length ? Sheets.T(R.lhead, Sheets.cut(lrows, 22)) : null,
      lines.some(l => l.heated) ? U.el('div', { class: 'tb-note' }, '* утеплённая труба / с греющим кабелем') : null,
      Object.keys(eq).length ? U.el('h4', {}, 'Оборудование') : null,
      Object.keys(eq).length ? Sheets.T(['Наименование', 'Кол.'], Sheets.cut(Object.entries(eq).map(([k, n]) => [k, String(n)]), 14)) : null,
      U.el('h4', {}, 'Требования'), Sheets.ul((SYSTEM_RULES[id] || []).slice(0, 6)),
      iss.length ? U.el('div', { class: 'warnbox' }, `Замечания анализа (${iss.length}): ` + iss.slice(0, 3).map(x => x.text).join('; ')) : U.el('div', { class: 'okbox' }, '✓ Замечаний анализа нет'),
      U.el('div', { class: 'norm' }, '§ ' + S.norms));
  },
  sectionPanel() { return typeof Detail !== 'undefined' ? Detail.sectionPanel() : U.el('div'); },
  roofPanel(node) { return typeof Detail !== 'undefined' ? Detail.roofPanel(node) : U.el('div'); },
  elevPanel(w) { return typeof Detail !== 'undefined' ? Detail.elevPanel(w) : U.el('div'); },

  /* ----------------------------- сборка и предпросмотр ----------------------------- */
  /** Собрать включённые листы в #printArea */
  build(o) {
    const area = $('printArea'), specs = Sheets.list().filter(s => Sheets.cfg(s.key).on !== false);
    area.textContent = '';
    const els = specs.map((s, i) => Sheets.render(s, o, i, specs.length));
    // листы разной ориентации: именованные страницы @page (размер у каждого листа свой)
    const sizes = new Set(els.map(el => el._page).filter(Boolean));
    area.append(U.el('style', {}, [...sizes].map(k => { const [w, h] = k.slice(1).split('x'); return `@page ${k} { size: ${w}mm ${h}mm; margin: 0; }`; }).join('\n') + '\n@page { margin: 0; }'));
    for (const el of els) area.append(el);
    Sheets._o = o;
    return els.length;
  },
  /** Предпросмотр комплекта: у каждого листа — масштаб, ориентация, что показывать, «печатать лист» */
  preview(o) {
    Sheets._o = o;
    const body = $('pvBody'), specs = Sheets.list();
    body.textContent = '';
    $('pvTitle').textContent = `Комплект для строителей — листов: ${specs.filter(s => Sheets.cfg(s.key).on !== false).length} из ${specs.length}`;
    const top = U.el('div', { class: 'pv-top' },
      U.el('label', {}, 'Формат ', U.el('select', { onchange: (e) => { Sheets._o = { ...Sheets._o, paper: e.target.value }; App.doc.settings.sheetPaper = e.target.value; const k = body.scrollTop / Math.max(1, body.scrollHeight); Sheets.preview(Sheets._o); body.scrollTop = k * body.scrollHeight; } }, Object.keys(Sheets.PAPER).map(k => U.el('option', { value: k, selected: k === o.paper }, k)))),
      U.el('span', { class: 'note' }, 'Масштаб и ориентация подбираются сами, чтобы чертёж занял лист. У листа можно выбрать своё.'));
    body.append(top);
    if (!$('dlgPreview').open) $('dlgPreview').showModal();                // ширина окна известна только после показа
    const avail = Math.max(300, body.clientWidth - 48);
    let n = 0;
    specs.forEach((spec) => {
      const c = Sheets.cfg(spec.key), on = c.on !== false;
      const wrap = U.el('div', { class: 'pv-sheet' + (on ? '' : ' off'), 'data-pv': spec.key });
      // перестроить комплект, не теряя места: лист, на котором щёлкнули, остаётся там же на экране
      const redraw = () => {
        const y = wrap.getBoundingClientRect().top;
        Sheets.preview(Sheets._o);
        const w2 = [...body.querySelectorAll('.pv-sheet')].find(x => x.dataset.pv === spec.key);
        if (w2) body.scrollTop += w2.getBoundingClientRect().top - y;
      };
      const tools = U.el('div', { class: 'pv-tools' },
        U.el('label', { class: 'pv-on' }, U.el('input', { type: 'checkbox', checked: on, onchange: (e) => { Sheets.setCfg(spec.key, { on: e.target.checked }); redraw(); } }), U.el('b', {}, spec.title)),
        !['report', 'tab'].includes(spec.kind) ? U.el('label', {}, 'Масштаб ', U.el('select', { onchange: (e) => { Sheets.setCfg(spec.key, { scale: e.target.value === 'auto' ? undefined : e.target.value }); redraw(); } },
          U.el('option', { value: 'auto' }, 'авто'), Sheets.STD.map(x => U.el('option', { value: String(x), selected: String(c.scale) === String(x) }, '1:' + x)))) : null,
        !['report', 'tab'].includes(spec.kind) ? U.el('label', {}, 'Лист ', U.el('select', { onchange: (e) => { Sheets.setCfg(spec.key, { orient: e.target.value === 'auto' ? undefined : e.target.value }); redraw(); } },
          [['auto', 'авто'], ['landscape', 'альбомный'], ['portrait', 'книжный']].map(([v, t]) => U.el('option', { value: v, selected: (c.orient || 'auto') === v }, t)))) : null,
        Object.entries(spec.toggles || {}).map(([k, [name, def]]) => U.el('label', { class: 'pv-chk' }, U.el('input', { type: 'checkbox', checked: c.t && k in c.t ? !!c.t[k] : def, onchange: (e) => { Sheets.setCfg(spec.key, { t: { ...(Sheets.cfg(spec.key).t || {}), [k]: e.target.checked } }); redraw(); } }), name)));
      wrap.append(tools);
      if (on) {
        const total = specs.filter(s => Sheets.cfg(s.key).on !== false).length;
        const el = Sheets.render(spec, Sheets._o, n++, total), wmm = parseFloat(el.style.width) || 297;
        el.style.zoom = Math.min(1, avail / (wmm * 3.78)).toFixed(3);
        wrap.append(el);
      }
      body.append(wrap);
    });
    if (!$('dlgPreview').open) $('dlgPreview').showModal();
  },
};
