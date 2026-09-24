'use strict';
/* ==========================================================================
   Файлы: JSON, автосохранение, PNG, печать/PDF, демо-проект.
   ========================================================================== */

const AUTOSAVE_KEY = 'floorplaner:autosave:v1';

const IO = {
  newProject() {
    const d = Model.newDoc();
    d.geo = { ...App.doc.geo };
    App.doc = d;
    App.sel.clear();
    App.heat = null;
    Model.reindex();
    Underlay.sync();
    Model.commit();
    UI._welcomeOff = false; UI.refresh();
    View.fit({ x0: -500, y0: -400, x1: 1000, y1: 800 });
  },
  fileName(ext) {
    const n = (App.doc.name || 'plan').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'plan';
    return n + '.' + ext;
  },
  serialize() { return JSON.stringify(App.doc); },
  saveJSON() {
    U.download(IO.fileName('json'), IO.serialize(), 'application/json');
    UI.toast('Проект сохранён в файл');
  },
  openFile(f) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const raw = JSON.parse(r.result);
        if (!raw || (raw.app !== 'floorplaner' && !raw.walls)) throw new Error('not a plan');
        IO.load(Model.normalize(raw), true);
        UI.toast('Открыт: ' + App.doc.name);
      } catch (e) {
        console.error(e);
        UI.toast('Не удалось открыть файл: это не проект Floorplaner', 'err');
      }
    };
    r.readAsText(f);
  },
  load(doc, keepHistory) {
    App.doc = doc;
    App.sel.clear();
    App.heat = null;
    Model.reindex();
    Underlay.sync();
    if (keepHistory) Model.commit(); else { Model.resetHistory(); App.changed(); }
    setTimeout(() => View.fit(Model.contentBBox()), 0);
  },

  /* ------------------------------ автосохранение ------------------------- */
  autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, IO.serialize());
      App.autosaveNote = '';
    } catch (e) {
      try {
        // не влезло (обычно из-за большой подложки) — сохраняем без картинки
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(App.doc, (k, v) => (k === 'src' ? undefined : v)));
        App.autosaveNote = 'Подложка слишком большая для автосохранения — сохраните проект в файл.';
      } catch (e2) { App.autosaveNote = 'Автосохранение недоступно.'; }
    }
  },
  loadAutosave() {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (!s) return null;
      return Model.normalize(JSON.parse(s));
    } catch (e) { return null; }
  },

  /* --------------------------- рендер в картинку ------------------------- */
  regionFor(area) {
    if (area === 'view') return { x0: View.ox, y0: View.oy, x1: View.ox + App.cw / View.scale, y1: View.oy + App.ch / View.scale };
    let b = null;
    if (area === 'sel') b = Model.bboxOf([...App.sel].filter(id => Model.get(id)));
    if (!G.bboxValid(b)) b = Model.contentBBox();
    if (!G.bboxValid(b)) b = { x0: -500, y0: -500, x1: 500, y1: 500 };
    const pad = Math.max(60, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.04);
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  },
  /** Отрисовать область region (см) в канвас W×H px (светлая тема, без выделения) */
  renderRegion(region, W, H, o = {}) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(W); cv.height = Math.round(H);
    const ctx = cv.getContext('2d');
    const scale = Math.min(W / (region.x1 - region.x0), H / (region.y1 - region.y0));
    const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2;
    const prevC = Theme.C;
    Theme.C = Theme.light;
    const layers = { ...App.doc.settings.layers, grid: !!o.grid };
    try {
      Render.draw({ ctx, w: cv.width, h: cv.height, dpr: 1, fs: o.fs || 1, scale, ox: cx - cv.width / 2 / scale, oy: cy - cv.height / 2 / scale, C: Theme.light, exporting: true, printGrid: !!o.grid, layers });
      // компас и масштабная линейка
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const k = Math.max(1, Math.min(W, H) / 900);
      ctx.save(); ctx.scale(k, k);
      const env = { ctx, C: Theme.light, w: cv.width / k, h: cv.height / k, scale: scale / k, layers };
      const saveCw = App.cw; App.cw = cv.width / k;
      Render.compass(env); Render.scaleBar(env);
      App.cw = saveCw;
      ctx.restore();
    } finally { Theme.C = prevC; }
    return { canvas: cv, scale };
  },
  exportPNG(o) {
    const region = IO.regionFor(o.area);
    const w = region.x1 - region.x0, h = region.y1 - region.y0;
    let pxPerCm = 2;
    if (Math.max(w, h) * pxPerCm > 7000) pxPerCm = 7000 / Math.max(w, h);
    if (Math.max(w, h) * pxPerCm < 1600) pxPerCm = 1600 / Math.max(w, h);
    const { canvas } = IO.renderRegion(region, w * pxPerCm, h * pxPerCm, { ...o, fs: Math.max(1, Math.max(w, h) * pxPerCm / 1800) });
    canvas.toBlob((blob) => { if (blob) { U.download(IO.fileName('png'), blob); UI.toast('PNG сохранён'); } }, 'image/png');
  },

  /* -------------------------------- печать ------------------------------- */
  print(o) {
    const sizes = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
    let [PW, PH] = sizes[o.paper] || sizes.A4;
    if (o.orient === 'portrait') [PW, PH] = [PH, PW];
    const M = 10, headH = 14;
    const boxW = PW - 2 * M, boxH = PH - 2 * M - headH - 2;
    let region = IO.regionFor(o.area);
    const rw = region.x1 - region.x0, rh = region.y1 - region.y0;
    let N;
    if (o.scale === 'fit') {
      // ближайший стандартный масштаб, при котором всё помещается
      const need = Math.max(rw * 10 / boxW, rh * 10 / boxH);
      const std = [1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000];
      N = std.find(x => x >= need) || Math.ceil(need);
      const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2, ww = boxW * N / 10, hh = boxH * N / 10;
      region = { x0: cx - ww / 2, y0: cy - hh / 2, x1: cx + ww / 2, y1: cy + hh / 2 };
    }
    else {
      N = +o.scale;
      // фиксированный масштаб: область листа вокруг центра
      const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2;
      const ww = boxW * N / 10, hh = boxH * N / 10;
      if (ww < rw || hh < rh) UI.toast(`В масштабе 1:${N} план не помещается на ${o.paper} — напечатана центральная часть`, 'err');
      region = { x0: cx - ww / 2, y0: cy - hh / 2, x1: cx + ww / 2, y1: cy + hh / 2 };
    }
    const imgWmm = (region.x1 - region.x0) * 10 / N, imgHmm = (region.y1 - region.y0) * 10 / N;
    const dpmm = o.paper === 'A2' ? 5 : 7;
    // шрифты ≈ 8 pt на бумаге независимо от разрешения
    const { canvas } = IO.renderRegion(region, imgWmm * dpmm, imgHmm * dpmm, { ...o, fs: dpmm / 4 });
    const area = $('printArea');
    area.textContent = '';
    const style = U.el('style', {}, `@page { size: ${PW}mm ${PH}mm; margin: 0; }`);
    const date = new Date().toLocaleDateString('ru-RU');
    const sheet = U.el('div', { class: 'sheet', style: { width: PW + 'mm', height: PH + 'mm', padding: M + 'mm' } },
      U.el('div', { class: 'sheet-head' },
        U.el('b', {}, App.doc.name || 'План'),
        U.el('span', {}, `Масштаб 1:${Math.round(N)} · ${App.doc.geo.city || (App.doc.geo.lat.toFixed(2) + '°, ' + App.doc.geo.lon.toFixed(2) + '°')} · ${date}`)),
      U.el('div', { class: 'sheet-img', style: { height: boxH + 'mm' } },
        U.el('img', { src: canvas.toDataURL('image/png'), style: { width: imgWmm + 'mm', height: imgHmm + 'mm' }, alt: 'План' })));
    area.append(style, sheet);
    if (o.expl || o.spec || o.legend || App.doc.notes.length) area.append(IO.reportSheet(PW, PH, M, o));
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); area.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  },
  reportSheet(PW, PH, M, o) {
    const s = Rooms.summary();
    const sheet = U.el('div', { class: 'sheet report', style: { width: PW + 'mm', minHeight: PH + 'mm', padding: M + 'mm' } },
      U.el('div', { class: 'sheet-head' }, U.el('b', {}, (App.doc.name || 'План') + ' — ведомости'), U.el('span', {}, new Date().toLocaleDateString('ru-RU'))));
    const cols = U.el('div', { class: 'report-cols' });
    const table = (title, head, rows) => U.el('div', { class: 'rep' }, U.el('h4', {}, title),
      U.el('table', {}, U.el('tr', {}, head.map(h => U.el('th', {}, h))), rows.map(r => U.el('tr', {}, r.map(c => U.el('td', {}, c))))));
    if (o.expl) {
      const rows = App.rooms.map((r, i) => [String(i + 1), r.name + (r.tag?.living ? ' (жил.)' : ''), (r.areaFloor / 1e4).toFixed(2), (r.perimFloor / 100).toFixed(2)]);
      rows.push(['', 'Общая площадь', (s.total / 1e4).toFixed(2), '']);
      if (s.living) rows.push(['', 'в т.ч. жилая', (s.living / 1e4).toFixed(2), '']);
      rows.push(['', 'Площадь застройки', (s.footprint / 1e4).toFixed(2), '']);
      cols.append(table('Экспликация помещений', ['№', 'Помещение', 'Площадь, м²', 'Периметр, м'], rows));
      const zr = [];
      if (s.plotArea) zr.push(['Участок', `${(s.plotArea / 1e4).toFixed(1)} м² (${(s.plotArea / 1e6).toFixed(2)} сот.)`], ['Застроено', `${(s.built / 1e4).toFixed(1)} м² (${(s.built / s.plotArea * 100).toFixed(1)}%)`]);
      for (const z of Object.values(s.zones)) zr.push([z.name, (z.area / 1e4).toFixed(1) + ' м²']);
      for (const it of s.outb) zr.push([it.label || catItem(it.key).name, `${(it.w * it.d / 1e4).toFixed(1)} м² (${(it.w / 100).toFixed(1)}×${(it.d / 100).toFixed(1)} м)`]);
      if (zr.length) cols.append(table('Участок и постройки', ['Наименование', 'Площадь'], zr));
    }
    if (o.spec) {
      const net = {};
      for (const l of App.doc.lines) {
        const k = l.kind + '|' + (l.dia || '') + '|' + (l.section || '');
        const n = net[k] || (net[k] = { kind: l.kind, dia: l.dia, section: l.section, len: 0, depth: l.depth });
        n.len += G.polyPerimeter(l.pts, false);
      }
      const nr = Object.values(net).map(n => [LINE_KINDS[n.kind].code, LINE_KINDS[n.kind].name, n.section || (n.dia ? 'Ø' + n.dia + ' мм' : ''), (n.len / 100).toFixed(1), n.depth ? (n.depth / 100).toFixed(2) : '—']);
      if (nr.length) cols.append(table('Инженерные сети', ['Обозн.', 'Сеть', 'Диаметр / марка', 'Длина, м', 'Глубина, м'], nr));
      const spec = {};
      for (const it of App.doc.items) { const d = catItem(it.key); const k = d.key + '|' + Math.round(it.w) + '|' + Math.round(it.d); spec[k] = spec[k] || { name: d.name, w: it.w, d: it.d, n: 0, cat: d.cat }; spec[k].n++; }
      const sr = Object.values(spec).sort((a, b) => a.cat.localeCompare(b.cat)).map(x => [x.name, `${Math.round(x.w)}×${Math.round(x.d)}`, String(x.n)]);
      if (sr.length) cols.append(table('Оборудование, мебель, постройки', ['Наименование', 'Размер, см', 'Кол-во'], sr));
    }
    if (o.legend) cols.append(table('Условные обозначения сетей', ['Обозн.', 'Сеть'], Object.values(LINE_KINDS).map(k => [k.code, k.name])));
    if (App.doc.notes.length) cols.append(table('Примечания', ['№', 'Текст', 'Объект'], App.doc.notes.map((n, i) => [String(i + 1), (n.done ? '✓ ' : '') + (n.text || ''), n.target && Model.get(n.target) ? UI.targetName(n.target) : '—'])));
    sheet.append(cols);
    return sheet;
  },
  copySummary() {
    const s = Rooms.summary();
    const L = [];
    L.push(App.doc.name);
    L.push('Экспликация помещений:');
    App.rooms.forEach((r, i) => L.push(`${i + 1}. ${r.name} — ${(r.areaFloor / 1e4).toFixed(2)} м²`));
    L.push(`Общая площадь: ${(s.total / 1e4).toFixed(2)} м²`);
    if (s.living) L.push(`Жилая площадь: ${(s.living / 1e4).toFixed(2)} м²`);
    L.push(`Площадь застройки: ${(s.footprint / 1e4).toFixed(2)} м²`);
    if (s.plotArea) L.push(`Участок: ${(s.plotArea / 1e6).toFixed(2)} сот.; застроено ${(s.built / s.plotArea * 100).toFixed(1)}%`);
    for (const z of Object.values(s.zones)) L.push(`${z.name}: ${(z.area / 1e4).toFixed(1)} м²`);
    const text = L.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => UI.toast('Скопировано'), () => { U.download('площади.txt', text, 'text/plain'); });
  },

  /* ------------------------------ демо-проект ---------------------------- */
  loadDemo() {
    const d = Model.newDoc();
    d.name = 'Пример: дом 10×9 м на участке 10 соток';
    d.north = -15;
    d.settings.sun = { date: new Date().getFullYear() + '-06-22', min: 15 * 60, period: 'day', step: 15 };
    const W = (a, b, kind = 'ext') => { const w = { id: U.uid('w'), kind, th: WALL_KINDS[kind].th, h: WALL_KINDS[kind].h, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } }; d.walls.push(w); return w; };
    const O = (w, type, pos, width, extra = {}) => { const t = OPENING_TYPES[type]; d.openings.push({ id: U.uid('op'), wall: w.id, type, pos, w: width || t.w, h: t.h, sill: t.sill, side: 1, hinge: 0, ...extra }); };
    const I = (key, x, y, rot = 0, extra = {}) => { const c = catItem(key); const it = { id: U.uid('i'), key, x, y, w: c.w, d: c.d, h: c.h, rot, ...extra }; d.items.push(it); return it; };
    const A = (kind, pts, name = '') => d.areas.push({ id: U.uid('a'), kind, pts: pts.map(([x, y]) => ({ x, y })), name });
    const Ln = (kind, pts, extra = {}) => { const k = LINE_KINDS[kind]; const l = { id: U.uid('l'), kind, pts: pts.map(([x, y]) => ({ x, y })), dia: k.dia, depth: k.depth, section: k.section || '', ...extra }; d.lines.push(l); return l; };
    // участок 25×40 м
    A('plot', [[0, 0], [2500, 0], [2500, 4000], [0, 4000]], 'Участок');
    A('road', [[1850, 0], [2250, 0], [2250, 150], [1850, 150]], 'Въезд');
    A('lawn', [[150, 2350], [1150, 2350], [1150, 3050], [150, 3050]], 'Газон');
    A('garden', [[150, 3250], [1100, 3250], [1100, 3850], [150, 3850]], 'Огород');
    // забор с воротами и калиткой
    const f1 = W([0, 0], [2500, 0], 'fence'); W([2500, 0], [2500, 4000], 'fence'); W([2500, 4000], [0, 4000], 'fence'); W([0, 4000], [0, 0], 'fence');
    O(f1, 'gate', 2050, 360); O(f1, 'door', 1500, 100);
    // дом (оси наружных стен)
    const top = W([700, 1200], [1700, 1200]), right = W([1700, 1200], [1700, 2100]), bottom = W([1700, 2100], [700, 2100]), left = W([700, 2100], [700, 1200]);
    const mid = W([1150, 1200], [1150, 2100], 'int');
    const pLiv = W([700, 1650], [1150, 1650], 'part');
    const pBath = W([1150, 1500], [1700, 1500], 'part');
    const pKit = W([1150, 1800], [1700, 1800], 'part');
    const pBoil = W([1450, 1200], [1450, 1500], 'part');
    // двери
    O(right, 'door', 450, 90, { side: -1, hinge: 1, h: 210 });
    O(mid, 'door', 525, 80, { side: -1 });
    O(mid, 'door', 375, 80, { side: -1, hinge: 1 });
    O(pKit, 'door', 150, 80, { side: -1 });
    O(pBath, 'door', 150, 70, { side: 1 });
    O(pBath, 'door', 400, 70, { side: 1, hinge: 1 });
    // окна
    O(bottom, 'win3', 775, 180); O(bottom, 'win2', 275, 120);
    O(left, 'win2', 225, 120); O(left, 'win2', 675, 120);
    O(top, 'win2', 225, 120); O(top, 'win1', 600, 60); O(top, 'win1', 875, 60);
    void pLiv; void pBoil;
    // помещения
    const T = (x, y, name, living) => d.roomTags.push({ id: U.uid('t'), x, y, name, living });
    T(925, 1900, 'Гостиная', true); T(925, 1420, 'Спальня', true); T(1300, 1350, 'Санузел'); T(1575, 1350, 'Котельная');
    T(1480, 1650, 'Прихожая'); T(1420, 1950, 'Кухня');
    // гостиная
    I('sofa3', 1092.5, 1900, 90); I('coffeetable', 960, 1900, 90); I('armchair', 900, 1720, 180); I('tvstand', 737.5, 1900, -90); I('tv', 725, 1900, -90);
    I('fireplace', 925, 2057.5, 180); I('rug', 950, 1900, 90, { w: 200, d: 250 });
    // спальня
    I('bed160', 1032.5, 1400, 90); I('nightstand', 1120, 1285, 90); I('wardrobe3', 815, 1615, 180); I('dresser', 740, 1300, -90);
    // кухня
    I('kitchenI', 1470, 2055, 180); I('fridge', 1625, 2052.5, 180); I('table4', 1290, 1920, 90); I('chair', 1235, 1880, 90); I('chair', 1235, 1960, 90); I('chair', 1345, 1880, -90); I('chair', 1345, 1960, -90);
    // санузел
    I('bath170', 1245, 1250, 0); I('toilet', 1412.5, 1300, 90); I('sink', 1422.5, 1440, 90); I('washer', 1190, 1450, -90); I('boiler80', 1240, 1470);
    // котельная
    I('gasBoilerWall', 1520, 1230, 0); I('indirect', 1630, 1280); I('panel', 1677.5, 1420, 90); I('riser', 1435, 1215);
    // прихожая
    I('hallWardrobe', 1560, 1775, 180); I('shoeRack', 1240, 1520, 0);
    // радиаторы под окнами
    I('radiatorLong', 925, 2080, 180); I('radiator', 1425, 2080, 180); I('radiator', 720, 1875, -90); I('radiator', 720, 1425, -90); I('radiator', 925, 1220, 0);
    // электрика
    I('socket2', 1140, 1800, 90); I('socket', 720, 1780, -90); I('socket2', 1500, 2080, 180); I('switch', 1690, 1580, 90);
    I('lamp', 925, 1880); I('lamp', 925, 1420); I('lamp', 1420, 1950); I('lamp', 1420, 1650); I('spot', 1300, 1350);
    // участок
    I('garage1', 2050, 450, 180, { label: 'Гараж' });
    I('carport', 2050, 1100, 180);
    I('shed', 2150, 3700, 0); I('bathhouse', 2050, 3100, 90); I('greenhouse', 1450, 3550, 90);
    I('septic2', 2250, 2700, 90); I('manhole', 1900, 2450);
    I('well', 400, 3150); I('pole', 2400, 60); I('lightPole', 1650, 250);
    I('tree', 300, 700); I('fruitTree', 500, 2250); I('fruitTree', 1000, 3120); I('conifer', 150, 1500); I('conifer', 150, 1900); I('bush', 1300, 700); I('hedge', 1050, 150, 0, { w: 700 });
    I('car', 2050, 1100, 180); I('bbq', 1300, 2450, 0); I('terrace', 925, 2300, 0, { w: 450, d: 250, label: 'Терраса' });
    // сети
    Ln('sewer', [[1412, 1330], [1412, 1470], [1800, 1470], [1800, 2450], [2150, 2450], [2150, 2700]], { depth: 120 });
    Ln('water', [[400, 3150], [400, 1100], [1600, 1100], [1600, 1215]], { depth: 180 });
    Ln('overhead', [[2400, 60], [1700, 1300]]);
    Ln('power', [[1680, 1420], [1800, 1420], [1800, 800], [1900, 800]], { depth: 70 });
    Ln('heating', [[1520, 1240], [1520, 1480], [1140, 1480], [1140, 2070], [930, 2070]]);
    Ln('drain', [[680, 2140], [680, 2250], [250, 2250], [250, 3600]]);
    // размеры дома
    d.dims.push({ id: U.uid('d'), a: { x: 685, y: 1185 }, b: { x: 1715, y: 1185 }, off: -70 });
    d.dims.push({ id: U.uid('d'), a: { x: 1715, y: 1185 }, b: { x: 1715, y: 2115 }, off: -180 });
    d.dims.push({ id: U.uid('d'), a: { x: 1715, y: 2400 }, b: { x: 2150, y: 2640 }, off: 0, text: '≥ 5 м от дома' });
    // примечания
    const septic = d.items.find(i => i.key === 'septic2'), ov = d.lines.find(l => l.kind === 'overhead');
    d.notes.push({ id: U.uid('n'), target: septic.id, dx: 180, dy: 160, text: 'Септик: не ближе 5 м от дома и 20 м от колодца (СП 32.13330). Нужен подъезд ассенизатора.' });
    d.notes.push({ id: U.uid('n'), target: ov.id, dx: 250, dy: -150, text: 'Ввод ВЛ — согласовать ТУ с сетевой компанией' });
    d.roads.push({ id: U.uid('r'), kind: 'street', width: 600, name: 'ул. Садовая', pts: [{ x: -1200, y: -420 }, { x: 3700, y: -420 }] });
    d.roads.push({ id: U.uid('r'), kind: 'sidewalk', width: 150, name: '', pts: [{ x: -1200, y: -40 }, { x: 3700, y: -40 }] });
    d.roads.push({ id: U.uid('r'), kind: 'path', width: 100, name: 'Дорожка к бане', pts: [{ x: 1700, y: 1650 }, { x: 1780, y: 1650 }, { x: 1780, y: 3100 }, { x: 1850, y: 3100 }] });
    d.roads.push({ id: U.uid('r'), kind: 'path', width: 80, name: '', pts: [{ x: 1500, y: 0 }, { x: 1500, y: 1100 }] });
    IO.load(Model.normalize(d), true);
    UI.toast('Открыт пример. Всё можно менять; Ctrl+Z — отмена.');
  },
};
