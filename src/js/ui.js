'use strict';
/* ==========================================================================
   Интерфейс: верхняя панель, инструменты, библиотека, вкладки справа.
   ========================================================================== */

const $ = (id) => document.getElementById(id);

/* ---------------------------- конструктор форм --------------------------- */
const F = {
  /** Раздел панели; клик по заголовку сворачивает его (состояние запоминается) */
  _collapsed: (() => { try { return new Set(JSON.parse(localStorage.getItem('fp:collapsed') || '[]')); } catch (e) { return new Set(); } })(),
  section(title, ...kids) {
    const sec = U.el('section', { class: 'sect' + (title && F._collapsed.has(title) ? ' collapsed' : '') });
    if (title) {
      const h = U.el('h4', { class: 'sect-h', tabindex: '0', role: 'button', 'aria-expanded': String(!F._collapsed.has(title)), title: 'Свернуть / развернуть' }, title);
      const toggle = () => {
        const c = sec.classList.toggle('collapsed');
        h.setAttribute('aria-expanded', String(!c));
        if (c) F._collapsed.add(title); else F._collapsed.delete(title);
        try { localStorage.setItem('fp:collapsed', JSON.stringify([...F._collapsed])); } catch (e) { /* нет доступа */ }
      };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      sec.append(h);
    }
    sec.append(...kids.flat().filter(k => k != null && k !== false));
    return sec;
  },
  row(label, control, unit) {
    return U.el('label', { class: 'frow' }, U.el('span', { class: 'flabel' }, label), control, unit ? U.el('span', { class: 'funit' }, unit) : null);
  },
  num(label, value, onChange, o = {}) {
    const inp = U.el('input', { type: 'number', value: U.isNum(value) ? Math.round(value * 100) / 100 : '', step: o.step ?? 1, min: o.min, max: o.max, inputmode: 'decimal', 'data-field': o.field });
    if (value === null) inp.placeholder = '—';
    inp.addEventListener('change', () => {
      const v = U.num(inp.value, NaN);
      if (!Number.isFinite(v)) return;
      onChange(o.min !== undefined || o.max !== undefined ? U.clamp(v, o.min ?? -Infinity, o.max ?? Infinity) : v);
    });
    return F.row(label, inp, o.unit ?? 'см');
  },
  text(label, value, onChange, o = {}) {
    const inp = o.multiline ? U.el('textarea', { rows: 3, 'data-field': o.field }) : U.el('input', { type: 'text', 'data-field': o.field, placeholder: o.placeholder || '' });
    inp.value = value ?? '';
    inp.addEventListener('change', () => onChange(inp.value));
    return F.row(label, inp);
  },
  select(label, value, options, onChange, o = {}) {
    const sel = U.el('select', { 'data-field': o.field });
    for (const [v, t] of options) sel.append(U.el('option', { value: v, selected: String(v) === String(value) }, t));
    sel.addEventListener('change', () => onChange(sel.value));
    return label ? F.row(label, sel) : sel;
  },
  check(label, value, onChange) {
    const c = U.el('input', { type: 'checkbox', checked: !!value });
    c.addEventListener('change', () => onChange(c.checked));
    return U.el('label', { class: 'fcheck' }, c, U.el('span', {}, label));
  },
  range(label, value, min, max, step, onInput, onChange, fmt) {
    const r = U.el('input', { type: 'range', min, max, step, value });
    const out = U.el('output', {}, fmt ? fmt(value) : value);
    r.addEventListener('input', () => { out.textContent = fmt ? fmt(+r.value) : r.value; onInput(+r.value); });
    if (onChange) r.addEventListener('change', () => onChange(+r.value));
    return U.el('div', { class: 'frange' }, U.el('span', { class: 'flabel' }, label), r, out);
  },
  info(label, value) { return U.el('div', { class: 'finfo' }, U.el('span', {}, label), U.el('b', {}, value)); },
  btns(list) {
    return U.el('div', { class: 'fbtns' }, list.filter(Boolean).map(([t, fn, cls, title]) => U.el('button', { class: cls || '', onclick: fn, title: title || null, type: 'button' }, t)));
  },
  note(t) { return U.el('p', { class: 'fnote', html: t }); },
};

const UI = {
  init() {
    // инструменты
    for (const b of document.querySelectorAll('.rail .tool')) b.addEventListener('click', () => { Tools.set(b.dataset.tool); UI.closeDrawers(); });
    // вкладки
    for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => UI.showTab(b.dataset.tab));
    // файл-меню
    const fm = $('fileMenu');
    $('btnFile').addEventListener('click', (e) => { e.stopPropagation(); const open = fm.hidden; UI.hideMenu(); fm.hidden = !open; $('btnFile').setAttribute('aria-expanded', String(open)); });
    fm.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { fm.hidden = true; UI.action(b.dataset.act); } });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-wrap')) fm.hidden = true; if (!e.target.closest('#ctxmenu')) UI.hideMenu(); });
    $('welcome').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) UI.action(b.dataset.act); });
    $('btnUndo').onclick = () => App.undo();
    $('btnRedo').onclick = () => App.redo();
    $('btnZoomIn').onclick = () => View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 1.25);
    $('btnZoomOut').onclick = () => View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 0.8);
    $('btnZoomVal').onclick = () => View.zoomAt({ x: App.cw / 2, y: App.ch / 2 }, 1 / View.scale);
    $('btnFit').onclick = () => View.fit(Model.contentBBox());
    $('btnGrid').onclick = () => { App.doc.settings.layers.grid = !App.doc.settings.layers.grid; UI.syncToggles(); App.redraw(); App.saveSoon(); };
    $('btnSnap').onclick = () => { App.doc.settings.snap = !App.doc.settings.snap; UI.syncToggles(); App.saveSoon(); };
    $('btnHelp').onclick = () => $('dlgHelp').showModal();
    $('btn3d').onclick = () => View3D.toggle();
    $('estAdd').onclick = () => Estimate.addCustom();
    $('estReset').onclick = () => Estimate.resetPrices();
    $('estCsv').onclick = () => Estimate.csv();
    $('estPrint').onclick = () => Estimate.print();
    $('estClose').onclick = () => $('dlgEstimate').close();
    $('btnHelpClose').onclick = () => $('dlgHelp').close();
    for (const b of document.querySelectorAll('#themeSeg [data-theme]')) b.addEventListener('click', () => Theme.set(b.dataset.theme));
    $('projectName').addEventListener('change', () => { App.doc.name = $('projectName').value.trim() || 'Проект'; Model.commit(); });
    $('fileJson').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) IO.openFile(f); e.target.value = ''; });
    $('fileImage').addEventListener('change', (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const r = new FileReader();
      r.onload = () => Underlay.set(r.result, f.name);
      r.readAsDataURL(f);
    });
    // мобильные «ящики»
    $('btnLibToggle').onclick = () => UI.toggleDrawer('library');
    $('btnPanelToggle').onclick = () => UI.toggleDrawer('panel');
    $('scrim').onclick = () => UI.closeDrawers();
    // библиотека
    $('libSearch').addEventListener('input', () => UI.buildLibrary());
    UI.buildLibrary();
    // печать
    $('dlgPrint').addEventListener('close', () => {
      const v = $('dlgPrint').returnValue;
      if (v === 'ok') IO.print(UI.printOpts());
      else if (v === 'png') IO.exportPNG(UI.printOpts());
      else if (v === 'svg' || v === 'dxf') Vector.exportFile(v, UI.printOpts());
    });
    // отложенное обновление панели, если оно пришлось на момент ввода в поле
    $('panel').addEventListener('focusout', () => { if (UI._pending) setTimeout(() => { if (UI._pending) { UI._pending = false; UI.refresh(); } }, 0); });
    UI.showTab('props');
    UI.syncTheme();
  },
  printOpts() {
    return { paper: $('prPaper').value, orient: $('prOrient').value, scale: $('prScale').value, area: $('prArea').value, expl: $('prExpl').checked, spec: $('prSpec').checked, legend: $('prLegend').checked, grid: $('prGrid').checked, drawing: $('prDrawing').checked };
  },

  action(act) {
    UI._welcomeOff = true; $('welcome').hidden = true;
    switch (act) {
      case 'new': if (confirm('Начать новый проект? Несохранённые изменения можно будет вернуть через «Отменить».')) IO.newProject(); break;
      case 'open': $('fileJson').click(); break;
      case 'save': IO.saveJSON(); break;
      case 'png': IO.exportPNG({ area: 'all', grid: false }); break;
      case 'print': $('prDrawing').checked = false; $('dlgPrint').showModal(); break;
      case 'svg': Vector.exportFile('svg', { area: 'all', scale: 100 }); break;
      case 'ifc': IFC.export(); break;
      case 'estimate': Estimate.open(); break;
      case 'drawings': $('prDrawing').checked = true; $('dlgPrint').showModal(); break;
      case 'obj': View3D.exportOBJ(); break;
      case 'dxf': Vector.exportFile('dxf', { area: 'all', scale: 100 }); break;
      case 'underlay': $('fileImage').click(); break;
      case 'demo': IO.loadDemo(); break;
      case 'plot': Tools.opts.areaKind = 'plot'; Tools.opts.areaRect = true; Tools.set('area', { force: true }); UI.showTab('sun'); UI.toast('Протяните прямоугольник участка или введите размеры, например 2000x3000'); break;
      case 'house': Tools.set('room'); UI.toast('Протяните прямоугольник дома или кликните и введите размеры: 1000x800'); break;
    }
  },

  /* ------------------------------ ящики (моб.) ---------------------------- */
  toggleDrawer(id) {
    const el = $(id), open = !el.classList.contains('open');
    UI.closeDrawers();
    if (open) { el.classList.add('open'); $('scrim').hidden = false; }
  },
  closeDrawers() { $('library').classList.remove('open'); $('panel').classList.remove('open'); $('scrim').hidden = true; },

  /* ------------------------ подсказка при наведении ------------------------ */
  _tipTimer: 0, _tipId: null,
  /** Заголовок и строки подсказки для объекта плана */
  tipFor(id) {
    const L = (v) => U.fmtLen(v);
    if (Tools.isRoom(id)) {
      const r = App.rooms.find(x => x.id === id);
      if (!r) return null;
      const wins = Rooms.windowsOf(r);
      return { title: r.name, lines: [`Площадь пола ${U.fmtArea(r.areaFloor)}`, `По осям ${U.fmtArea(r.areaAxis)} · периметр ${L(r.perimFloor)}`, wins.length ? 'Окна: ' + wins.map(w => w.info.dir).join(', ') : 'Без окон'], hint: 'Клик — выбрать, двойной клик — переименовать' };
    }
    if (id === 'underlay') return { title: 'Подложка', lines: [App.doc.underlay?.name || 'картинка плана'], hint: 'Тяните, чтобы сдвинуть' };
    const o = Model.get(id), c = Model.coll(id);
    if (!o) return null;
    const note = App.doc.notes.filter(n => n.target === id).length;
    const tail = note ? [`Примечаний: ${note}`] : [];
    switch (c) {
      case 'walls': {
        if (o.kind === 'fence') return { title: 'Забор', lines: [(FENCE_MATERIALS[o.mat] || {}).name || '', `Длина ${L(Model.wallLen(o))}, высота ${L(o.h)}`, ...tail] };
        const M = WALL_MATERIALS[o.mat];
        const R = o.kind === 'ext' ? wallR(o) : null;
        return { title: 'Стена: ' + WALL_KINDS[o.kind].name.toLowerCase(), lines: [M ? M.name : '', `Длина ${L(Model.wallLen(o))} · толщина ${Math.round(o.th)} см${o.ins ? ` (утепл. ${Math.round(o.ins)} см)` : ''} · высота ${L(o.h)}`, R ? `R = ${R.toFixed(2)} м²·°C/Вт` : '', ...tail].filter(Boolean), hint: 'Тяните — сдвиг поперёк, за конец — длина' };
      }
      case 'openings': {
        const T = OPENING_TYPES[o.type], win = T.cat === 'window';
        const info = win ? Sun.windowInfo(o) : null;
        return { title: T.name, lines: [`${Math.round(o.w)} × ${Math.round(o.h)} см${win ? `, подоконник ${Math.round(o.sill || 0)} см` : ''}`, info && !info.interior ? `Смотрит на ${U.compass16(info.bearing)} (${Math.round(info.bearing)}°)` : '', ...tail].filter(Boolean), hint: 'Тяните вдоль стены; петли и сторона — в свойствах' };
      }
      case 'items': {
        const d = catItem(o.key);
        return { title: o.label || d.name, lines: [`${Math.round(o.w)} × ${Math.round(o.d)} см, высота ${Math.round(o.h)} см`, o.rot ? `Поворот ${Math.round(o.rot)}°` : '', o.note || '', ...tail].filter(Boolean), hint: 'Тяните — переместить, ручки — размер и поворот' };
      }
      case 'lines': {
        const k = LINE_KINDS[o.kind];
        return { title: `${k.code} — ${k.name}`, lines: [`Длина ${L(G.polyPerimeter(o.pts, false))}`, o.dia ? `Ø ${o.dia} мм` : (o.section || ''), o.depth ? `Глубина ${L(o.depth)}` : '', ...tail].filter(Boolean) };
      }
      case 'areas': {
        const ar = Math.abs(G.polyArea(o.pts));
        return { title: o.name || AREA_KINDS[o.kind].name, lines: [o.kind === 'plot' ? `${(ar / 1e6).toFixed(2)} сот. (${(ar / 1e4).toFixed(1)} м²)` : U.fmtArea(ar), `Периметр ${L(G.polyPerimeter(o.pts))}`, ...tail] };
      }
      case 'roads': return { title: o.name || ROAD_KINDS[o.kind].name, lines: [ROAD_KINDS[o.kind].name, `Ширина ${L(o.width)}, длина ${L(G.polyPerimeter(o.pts, false))}`, ...tail] };
      case 'roofs': { const P = Roof.params(o); return { title: 'Крыша: ' + ROOF_TYPES[o.type].name.toLowerCase(), lines: [`Кровля ${U.fmtArea(P.area)} · ${(ROOF_MATERIALS[o.mat] || {}).name || ''}`, o.type !== 'flat' ? `Уклон ${Math.round(o.pitch)}°, конёк на ${L(P.top)}` : '', ...tail].filter(Boolean) }; }
      case 'dims': return { title: 'Размер', lines: [o.text || L(G.dist(o.a, o.b))] };
      case 'texts': return { title: 'Надпись', lines: [String(o.text || '').slice(0, 80)] };
      case 'notes': return { title: 'Примечание №' + (App.doc.notes.indexOf(o) + 1), lines: [String(o.text || '(пусто)').slice(0, 160), o.target && Model.get(o.target) ? 'К объекту: ' + UI.targetName(o.target) : ''].filter(Boolean) };
      case 'roomTags': return { title: 'Помещение «' + o.name + '»', lines: [] };
    }
    return null;
  },
  /** Показать подсказку для объекта id у экранной точки sp (с задержкой) */
  hoverTip(id, sp) {
    const tip = $('hovertip');
    clearTimeout(UI._tipTimer);
    if (!id || App.doc.settings.hoverTips === false) { tip.hidden = true; UI._tipId = null; return; }
    if (UI._tipId !== id) tip.hidden = true;
    UI._tipTimer = setTimeout(() => {
      const t = UI.tipFor(id);
      if (!t) { tip.hidden = true; return; }
      const o = Model.get(id);
      if (o && o.grp) t.lines = [...t.lines, `В группе: ${Model.groupOf(id).length} объектов (Alt+клик — только этот)`];
      tip.textContent = '';
      tip.append(U.el('b', {}, t.title), ...t.lines.map(l => U.el('div', {}, l)), t.hint ? U.el('em', {}, t.hint) : null);
      tip.hidden = false;
      UI._tipId = id;
      const W = App.cw, H = App.ch;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = sp.x + 16, y = sp.y + 18;
      if (x + w > W - 8) x = sp.x - w - 12;
      if (y + h > H - 30) y = sp.y - h - 12;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
    }, UI._tipId === id ? 60 : 380);
  },
  hideTip() { clearTimeout(UI._tipTimer); $('hovertip').hidden = true; UI._tipId = null; },

  /* ---------------------------------- 3D ---------------------------------- */
  render3dPanel() {
    const p = $('panel3d');
    p.textContent = '';
    const o = View3D.opts;
    const chk = (label, key) => F.check(label, o[key], (v) => { o[key] = v; View3D.dirty = true; View3D.redraw(); });
    const head = U.el('button', { type: 'button', class: 'p3d-head', title: 'Свернуть / развернуть панель' }, '3D-вид');
    head.onclick = () => { p.classList.toggle('collapsed'); try { localStorage.setItem('fp:p3d', p.classList.contains('collapsed') ? '1' : ''); } catch (e) { /* нет хранилища */ } };
    try { p.classList.toggle('collapsed', localStorage.getItem('fp:p3d') === '1'); } catch (e) { /* нет хранилища */ }
    p.append(head,
      chk('Этажи выше текущего', 'upper'), chk('Крыша', 'roof'), chk('Мебель и предметы', 'items'), chk('Участок', 'site'),
      F.check('Свет от солнца (дата/время — «Участок»)', o.sun, (v) => { o.sun = v; View3D.redraw(); }),
      F.check('Тени', o.shadows, (v) => { o.shadows = v; View3D.redraw(); }),
      U.el('div', { class: 'fbtns views3d' },
        U.el('button', { type: 'button', title: 'Вид с южной стороны', onclick: () => View3D.view('s') }, 'С юга'),
        U.el('button', { type: 'button', title: 'Вид с северной стороны', onclick: () => View3D.view('n') }, 'С севера'),
        U.el('button', { type: 'button', title: 'Вид с восточной стороны', onclick: () => View3D.view('e') }, 'С востока'),
        U.el('button', { type: 'button', title: 'Вид с западной стороны', onclick: () => View3D.view('w') }, 'С запада'),
        U.el('button', { type: 'button', title: 'Вид сверху', onclick: () => View3D.view('top') }, 'Сверху'),
        U.el('button', { type: 'button', title: 'С высоты человеческого роста', onclick: () => View3D.view('eye') }, 'Глаза')),
      U.el('div', { class: 'fbtns' },
        U.el('button', { type: 'button', onclick: () => { View3D.fit(); View3D.redraw(); } }, 'Показать всё'),
        U.el('button', { type: 'button', onclick: () => View3D.snapshot() }, 'PNG'),
        U.el('button', { type: 'button', onclick: () => View3D.exportOBJ(), title: '3D-модель для Blender, SketchUp, Twinmotion' }, 'OBJ'),
        U.el('button', { type: 'button', onclick: () => IFC.export(), title: 'BIM-модель для Revit, ArchiCAD, Renga' }, 'IFC')),
      U.el('button', { type: 'button', class: Walk.on ? 'primary' : '', title: 'Прогулка от первого лица: WASD — ходить, ←→ — поворот, мышь — осмотреться', onclick: () => { if (Walk.on) Walk.stop(); else Walk.start(); $('canvas3d').focus && $('canvas3d').focus(); } }, Walk.on ? '← Обзор сверху' : '🚶 Прогулка (WASD)'),
      U.el('p', { class: 'fnote' }, Walk.on
        ? 'WASD — ходить, ↑↓ — вперёд/назад, ←→ — поворот, ЛКМ + мышь — осмотреться, Shift — бегом, Space — прыжок, C — присесть, PgUp/PgDn — этаж, N — сквозь стены, Esc — выйти.'
        : 'ЛКМ — вращать, ПКМ / Shift — сдвиг, колесо — масштаб. WASD или стрелки — прогулка. Esc — к плану.'),
      U.el('button', { type: 'button', class: 'primary', onclick: () => View3D.toggle(false) }, '← К плану'));
  },

  /* -------------------------------- этажи --------------------------------- */
  renderFloorbar() {
    const bar = $('floorbar');
    bar.textContent = '';
    const fl = App.doc.floors;
    for (let i = fl.length - 1; i >= 0; i--) {
      const f = fl[i];
      const b = U.el('button', { type: 'button', class: 'fl-btn' + (f.id === App.floor ? ' on' : ''), title: `${f.name}: отметка ${(f.elev / 100).toFixed(2)} м, высота ${(f.h / 100).toFixed(2)} м` }, f.name);
      b.onclick = () => Model.setFloor(f.id);
      bar.append(b);
    }
    bar.append(U.el('button', { type: 'button', class: 'fl-btn add', title: 'Добавить этаж сверху', onclick: () => App.addFloor(true) }, '+ этаж'));
  },
  floorsSection() {
    const d = App.doc;
    const tbl = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, 'Этаж'), U.el('th', {}, 'Отметка, м'), U.el('th', {}, 'Высота, см'), U.el('th', {}, '')));
    d.floors.forEach((f, i) => {
      const name = U.el('input', { type: 'text', value: f.name });
      name.onchange = () => { f.name = name.value.trim() || f.name; Model.commit(); };
      const elev = U.el('input', { type: 'number', value: (f.elev / 100).toFixed(2), step: 0.05, disabled: i > 0 });
      elev.onchange = () => { f.elev = U.num(elev.value, 0) * 100; App.relevel(); Model.commit(); };
      const h = U.el('input', { type: 'number', value: f.h, step: 5, min: 100 });
      h.onchange = () => { f.h = U.clamp(U.num(h.value, f.h), 100, 2000); App.relevel(); Model.commit(); };
      const del = U.el('button', { type: 'button', class: 'mini danger', title: 'Удалить этаж', disabled: d.floors.length < 2, onclick: () => App.deleteFloor(f.id) }, '✕');
      tbl.append(U.el('tr', { class: f.id === App.floor ? 'sel' : '' }, U.el('td', {}, name), U.el('td', {}, elev), U.el('td', {}, h), U.el('td', {}, del)));
    });
    return F.section('Этажи', tbl,
      F.btns([['+ Этаж (копия наружных стен)', () => App.addFloor(true), 'primary'], ['+ Пустой этаж', () => App.addFloor(false)]]),
      F.note('Высота этажа — от пола до пола следующего (с перекрытием). Отметки верхних этажей пересчитываются автоматически. Нижний этаж показывается бледной подсказкой; лестница с нижнего этажа видна как проём.'));
  },

  /* ------------------------------ библиотека ------------------------------ */
  _thumbCache: new Map(),
  thumb(def) {
    const key = def.key + (Theme.isDark() ? ':d' : ':l');
    if (UI._thumbCache.has(key)) return UI._thumbCache.get(key);
    const S = 44, dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = S * dpr; cv.height = S * dpr;
    const ctx = cv.getContext('2d');
    let w = def.w, d = def.d;
    if (def.sym) { const k = Math.max(1, def.sym / Math.max(w, d)); w *= k; d *= k; }
    const k = (S - 8) / Math.max(w, d);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * S / 2, dpr * S / 2);
    const C = Theme.C;
    ctx.fillStyle = C.itemFill; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.1 / k; ctx.lineJoin = 'round';
    const P = { ctx, px: 1 / k, C, it: { ...def, label: def.label }, def, upright: false, rotRad: 0, flip: false };
    try { (Painters.S[def.shape] || Painters.S.labelbox)(P, w, d); } catch (e) { /* пропуск */ }
    const url = cv.toDataURL();
    UI._thumbCache.set(key, url);
    return url;
  },
  _openCats: new Set(['living']),
  buildLibrary() {
    const q = $('libSearch').value.trim().toLowerCase();
    const list = $('libList');
    list.textContent = '';
    for (const cat of CATALOG) {
      // ищем по названию, группе и синонимам (kw), каждое слово запроса отдельно: «забор проф», «ограда»
      const words = q.split(/\s+/).filter(Boolean);
      const items = cat.items.filter(it => { const hay = (it.name + ' ' + cat.name + ' ' + (it.kw || '')).toLowerCase(); return words.every(wd => hay.includes(wd)); });
      if (!items.length) continue;
      const open = !!q || UI._openCats.has(cat.id);
      const det = U.el('details', { class: 'lib-cat', open });
      det.addEventListener('toggle', () => { if (det.open) UI._openCats.add(cat.id); else UI._openCats.delete(cat.id); });
      det.append(U.el('summary', {}, cat.name, U.el('span', { class: 'count' }, String(items.length))));
      const grid = U.el('div', { class: 'lib-grid' });
      for (const it of items) {
        const tip = it.tool ? `${it.name}\nРисуется по точкам, как стена; высота ${it.h} см` : it.action ? `${it.name}\nЗабор по всем сторонам границы участка` : `${it.name}\n${it.w}×${it.d} см, высота ${it.h} см`;
        const b = U.el('button', { class: 'lib-item' + (Tools.cur === 'place' && Tools.opts.placeKey === it.key ? ' active' : ''), title: tip, 'data-key': it.key, type: 'button' },
          U.el('img', { src: UI.thumb(it), alt: '' }),
          U.el('span', { class: 'lib-name' }, it.name),
          U.el('span', { class: 'lib-size' }, it.tool ? `выс. ${it.h}` : it.action ? 'по участку' : `${it.w}×${it.d}`));
        b.addEventListener('click', () => {
          if (it.tool) { Tools.set(it.tool, { mat: it.mat, h: it.h }); UI.toast(`${it.name}: кликайте точки забора, Esc — готово`); }
          else if (it.action === 'fenceAround') App.fenceAroundPlot();
          else Tools.set('place', { key: it.key });
          UI.closeDrawers();
        });
        grid.append(b);
      }
      det.append(grid);
      list.append(det);
    }
    if (!list.children.length) list.append(U.el('p', { class: 'fnote' }, 'Ничего не найдено'));
  },

  /* ------------------------------ инструменты ----------------------------- */
  syncTool() {
    if (View3D.active && Tools.cur !== 'select') View3D.toggle(false);
    if (Tools.cur !== 'select') { UI._welcomeOff = true; $('welcome').hidden = true; }
    for (const b of document.querySelectorAll('.rail .tool')) {
      const on = b.dataset.tool === Tools.vcur();
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    }
    for (const b of document.querySelectorAll('.lib-item')) b.classList.toggle('active', Tools.cur === 'place' && b.dataset.key === Tools.opts.placeKey);
    UI.renderToolOpts();
    $('stHint').textContent = TOOL_INFO[Tools.vcur()]?.hint || '';
    App.canvas.style.cursor = Tools.cur === 'pan' ? 'grab' : Tools.cur === 'select' ? 'default' : 'crosshair';
  },
  renderToolOpts() {
    const box = $('toolOpts');
    box.textContent = '';
    box.classList.toggle('is-hint', Tools.cur === 'select');
    const t = Tools.cur, o = Tools.opts, vt = Tools.vcur();
    const title = U.el('b', { class: 'to-title' }, TOOL_INFO[vt]?.name || '');
    box.append(title);
    const sel = (value, opts, fn, label) => { const s = F.select(null, value, opts, (v) => { fn(v); UI.renderToolOpts(); App.redraw(); }); return label ? U.el('label', { class: 'to-f' }, label, s) : s; };
    const num = (label, value, fn, unit = 'см', step = 1) => {
      const i = U.el('input', { type: 'number', value, step, inputmode: 'decimal' });
      i.addEventListener('change', () => { const v = U.num(i.value, NaN); if (v > 0) { fn(v); App.redraw(); App.saveSoon(); } });
      return U.el('label', { class: 'to-f' }, label, i, U.el('span', { class: 'funit' }, unit));
    };
    if (vt === 'fence') {
      const d = App.doc.defaults.wall.fence;
      box.append(sel(d.mat, Object.entries(FENCE_MATERIALS).map(([k, v]) => [k, v.name]), (v) => { d.mat = v; App.saveSoon(); }, 'Материал'),
        num('Высота', d.h, (v) => { d.h = U.clamp(v, 30, 600); }),
        U.el('button', { class: 'to-btn', type: 'button', title: 'Забор по всем сторонам границы участка', onclick: () => App.fenceAroundPlot() }, 'По границе участка'));
    } else if (t === 'wall' || t === 'room') {
      const d = App.doc.defaults.wall[o.wallKind];
      box.append(sel(o.wallKind, Object.entries(WALL_KINDS).map(([k, v]) => [k, v.name]), (v) => { o.wallKind = v; UI.syncTool(); }, 'Тип'),
        sel(d.mat, Object.entries(materialsFor(o.wallKind)).map(([k, v]) => [k, v.name]), (v) => { d.mat = v; App.saveSoon(); }, 'Материал'),
        num('Толщина', d.th, (v) => { d.th = U.clamp(v, 2, 150); }),
        num('Высота', d.h, (v) => { d.h = U.clamp(v, 10, 2000); }));
    } else if (t === 'door') {
      const types = Object.entries(OPENING_TYPES).filter(([, v]) => v.cat === 'door');
      box.append(sel(o.doorType, types.map(([k, v]) => [k, v.name]), (v) => { o.doorType = v; o.doorW = OPENING_TYPES[v].w; o.doorH = OPENING_TYPES[v].h; }, 'Тип'),
        sel(o.doorW, DOOR_WIDTHS.concat(DOOR_WIDTHS.includes(o.doorW) ? [] : [o.doorW]).sort((a, b) => a - b).map(w => [w, w + ' см']), (v) => { o.doorW = +v; }, 'Ширина'),
        num('Высота', o.doorH, (v) => { o.doorH = v; }));
    } else if (t === 'window') {
      const types = Object.entries(OPENING_TYPES).filter(([, v]) => v.cat === 'window');
      box.append(sel(o.winType, types.map(([k, v]) => [k, v.name]), (v) => { o.winType = v; o.winW = OPENING_TYPES[v].w; o.winH = OPENING_TYPES[v].h; o.winSill = OPENING_TYPES[v].sill; }, 'Тип'),
        sel(o.winW, WINDOW_WIDTHS.concat(WINDOW_WIDTHS.includes(o.winW) ? [] : [o.winW]).sort((a, b) => a - b).map(w => [w, w + ' см']), (v) => { o.winW = +v; }, 'Ширина'),
        num('Высота', o.winH, (v) => { o.winH = v; }),
        num('Подоконник', o.winSill, (v) => { o.winSill = v; }));
    } else if (t === 'line') {
      const k = LINE_KINDS[o.lineKind];
      box.append(U.el('span', { class: 'swatch', style: { background: k.color } }),
        sel(o.lineKind, Object.entries(LINE_KINDS).map(([kk, v]) => [kk, `${v.code} — ${v.name}`]), (v) => { o.lineKind = v; }, 'Вид'));
    } else if (t === 'roof') {
      const ov = U.el('input', { type: 'number', value: Tools.opts.roofOv ?? 50, step: 5, min: 0 });
      ov.onchange = () => { Tools.opts.roofOv = U.clamp(U.num(ov.value, 50), 0, 300); };
      box.append(U.el('button', { class: 'to-btn primary', type: 'button', onclick: () => App.roofFromOutline(Tools.opts.roofOv ?? 50) }, 'По контуру дома'),
        U.el('label', { class: 'to-f' }, 'свес', ov, U.el('span', { class: 'funit' }, 'см')),
        U.el('span', { class: 'to-hint' }, 'или протяните прямоугольник'));
    } else if (t === 'road') {
      box.append(sel(o.roadKind, Object.entries(ROAD_KINDS).map(([kk, v]) => [kk, v.name]), (v) => { o.roadKind = v; o.roadW = ROAD_KINDS[v].width; }, 'Вид'),
        num('Ширина', o.roadW, (v) => { o.roadW = U.clamp(v, 20, 5000); }));
    } else if (t === 'area') {
      box.append(sel(o.areaKind, Object.entries(AREA_KINDS).map(([kk, v]) => [kk, v.name]), (v) => { o.areaKind = v; }, 'Вид'),
        U.el('div', { class: 'seg small' },
          U.el('button', { class: o.areaRect ? '' : 'on', onclick: () => { o.areaRect = false; Tools.st = {}; UI.renderToolOpts(); }, type: 'button' }, 'Многоугольник'),
          U.el('button', { class: o.areaRect ? 'on' : '', onclick: () => { o.areaRect = true; Tools.st = {}; UI.renderToolOpts(); }, type: 'button' }, 'Прямоугольник')));
    } else if (t === 'dim') {
      box.append(U.el('span', { class: 'to-hint' }, 'Клик — клик — отвести линию.'),
        U.el('button', { class: 'to-btn primary', type: 'button', onclick: () => Drawing.addToPlan(), title: 'Размерные цепочки по фасадам: проёмы, простенки и габариты' }, 'Авторазмеры по фасадам'));
    } else if (t === 'place') {
      const def = catItem(o.placeKey);
      box.append(U.el('img', { src: UI.thumb(def), class: 'to-thumb', alt: '' }), U.el('span', {}, `${def.name} · ${def.w}×${def.d} см`),
        U.el('button', { class: 'to-btn', type: 'button', onclick: () => { o.placeRot = U.normDeg(o.placeRot + 90); App.redraw(); } }, '⟳ 90° (R)'));
    } else if (t === 'select') {
      box.append(U.el('span', { class: 'to-hint' }, 'Выберите объект или инструмент слева. Объекты — в библиотеке.'));
    } else {
      box.append(U.el('span', { class: 'to-hint' }, TOOL_INFO[t]?.hint || ''));
    }
    const k = TOOL_INFO[vt]?.key;
    if (k) title.append(U.el('kbd', {}, k));
  },

  /* ------------------------------- вкладки -------------------------------- */
  tab: 'props',
  showTab(name) {
    UI.tab = name;
    for (const b of document.querySelectorAll('.tabs [data-tab]')) { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }
    for (const t of ['props', 'layers', 'sun', 'summary', 'project']) $('tab-' + t).hidden = t !== name;
    UI.refresh();
  },
  refresh() {
    try { UI._refresh(); } catch (e) { console.error(e); }
  },
  _refresh() {
    const f = { props: UI.renderProps, layers: UI.renderLayers, sun: UI.renderSun, summary: UI.renderSummary, project: UI.renderProject }[UI.tab];
    const body = $('tab-' + UI.tab);
    const st = body.scrollTop;
    // не перерисовываем, пока пользователь печатает в поле этой вкладки
    const ae = document.activeElement;
    if (ae && body.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'checkbox' && ae.type !== 'range'))) { UI._pending = true; return; }
    UI._pending = false;
    f && f();
    body.scrollTop = st;
    UI.syncUndo();
    UI.syncToggles();
    UI.renderFloorbar();
    if (View3D.active) { View3D.dirty = true; View3D.redraw(); }
    $('projectName').value = App.doc.name;
    $('welcome').hidden = !App.isEmpty() || UI._welcomeOff;
  },
  syncUndo() { $('btnUndo').disabled = Model._undo.length < 2; $('btnRedo').disabled = !Model._redo.length; },
  syncToggles() {
    $('btnGrid').classList.toggle('on', !!App.doc.settings.layers.grid);
    $('btnSnap').classList.toggle('on', !!App.doc.settings.snap);
  },
  syncTheme() {
    for (const b of document.querySelectorAll('#themeSeg [data-theme]')) b.classList.toggle('on', b.dataset.theme === Theme.mode);
    if (document.getElementById('libList')) UI.buildLibrary();
  },
  updateZoom() { $('btnZoomVal').textContent = Math.round(View.scale * 100) + '%'; },
  status(p) {
    $('stX').textContent = (p.x / 100).toFixed(2);
    $('stY').textContent = (p.y / 100).toFixed(2);
    const el = $('stSun');
    if (App.heat && App.doc.settings.layers.heat) {
      const v = Sun.heatAt(p);
      el.hidden = false;
      el.textContent = v === null ? '☀ —' : '☀ ' + U.fmtHours(v) + ' солнца';
    } else el.hidden = true;
  },
  setInput(s) { const el = $('stInput'); el.hidden = !s; el.textContent = s ? 'Ввод: ' + s + ' ↵' : ''; },
  toast(msg, type) {
    const t = U.el('div', { class: 'toast' + (type === 'err' ? ' err' : '') }, msg);
    $('toasts').append(t);
    setTimeout(() => t.classList.add('hide'), 2600);
    setTimeout(() => t.remove(), 3100);
  },
  focusField(name) {
    UI.showTab('props');
    setTimeout(() => { const el = document.querySelector(`#tab-props [data-field="${name}"]`); if (el) { el.focus(); el.select && el.select(); } }, 30);
  },
  /** Запрос числа. parse(строка) → число или NaN; по умолчанию — просто число. Enter = OK */
  promptNumber(title, label, value, onOk, onCancel, parse) {
    const d = $('dlgPrompt');
    $('dlgPromptTitle').textContent = title; $('dlgPromptLabel').textContent = label;
    const inp = $('dlgPromptInput'); inp.value = value;
    const read = () => (parse ? parse(inp.value) : U.num(inp.value, NaN));
    // Enter в поле: без этого форма «нажимает» первую кнопку — «Отмена»
    const onKey = (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (Number.isFinite(read())) d.close('ok'); else UI.toast('Не понял число: ' + inp.value, 'err');
    };
    const handler = () => {
      d.removeEventListener('close', handler); inp.removeEventListener('keydown', onKey);
      if (d.returnValue === 'ok') {
        const v = read();
        if (Number.isFinite(v)) onOk(v);
        else { UI.toast('Не понял число: ' + inp.value, 'err'); onCancel && onCancel(); }
      } else onCancel && onCancel();
    };
    d.addEventListener('close', handler);
    inp.addEventListener('keydown', onKey);
    d.returnValue = '';
    d.showModal();
    setTimeout(() => inp.select(), 20);
  },

  /* ------------------------------ свойства -------------------------------- */
  renderProps() {
    const body = $('tab-props');
    body.textContent = '';
    const ids = [...App.sel].filter(id => Model.get(id) || id === 'underlay' || Tools.isRoom(id));
    if (!ids.length) { UI.propsNone(body); return; }
    if (ids.length === 1) {
      const id = ids[0];
      if (id === 'underlay') { body.append(UI.underlaySection(true)); return; }
      if (Tools.isRoom(id)) {
        const r = App.rooms.find(x => x.id === id);
        UI.propsRoom(body, r);
        if (r && r.tag) body.append(UI.notesOf(r.tag.id));
        return;
      }
      const c = Model.coll(id), o = Model.get(id);
      const fn = { roofs: UI.propsRoof, roads: UI.propsRoad, walls: UI.propsWall, openings: UI.propsOpening, items: UI.propsItem, lines: UI.propsLine, areas: UI.propsArea, dims: UI.propsDim, texts: UI.propsText, notes: UI.propsNote, roomTags: UI.propsTag }[c];
      if (fn) fn(body, o);
      if (o && o.grp) {
        const n = Model.groupOf(id).length;
        body.append(F.section('Группа', F.note(`Объект входит в группу из ${n}. Обычный клик выделяет всю группу, Alt+клик — один объект.`),
          F.btns([['Выделить всю группу', () => { App.sel.clear(); for (const m of Model.groupOf(id)) App.sel.add(m); App.selChanged(); }], ['Убрать из группы', () => { delete o.grp; Model.commit(); App.selChanged(); }]])));
      }
      if (c !== 'notes') body.append(UI.notesOf(id));
    } else UI.propsMulti(body, ids);
    const tr = ids.filter(id => Model.get(id) && Model.coll(id) !== 'openings');
    if (tr.length) body.append(UI.transformSection(tr));
  },
  set(o, k, v) { o[k] = v; Model.commit(); },
  head(body, title, sub) { body.append(U.el('div', { class: 'phead' }, U.el('b', {}, title), sub ? U.el('span', {}, sub) : null)); },

  propsNone(body) {
    if (App.isEmpty()) {
      UI.head(body, 'Пустой проект');
      body.append(F.note('С чего начать: инструмент <b>Стена</b> (W) или <b>Комната</b> (Q) — для дома, <b>Зона → Граница участка</b> (B) — для участка. Мебель, сантехника, септик, постройки — в библиотеке слева. Размеры — в сантиметрах, как в жизни.'),
        F.btns([['Открыть пример', () => IO.loadDemo(), 'primary'], ['Справка (F1)', () => $('dlgHelp').showModal()]]));
      return;
    }
    UI.head(body, 'Ничего не выделено');
    body.append(F.note('Кликните по объекту, чтобы изменить его размеры, поворот и свойства. Рамкой слева направо — выбрать целиком попавшие, справа налево — задетые.'));
    body.append(F.section('Весь план',
      F.note('Поворот всего плана — участка, построек, сетей — относительно сторон света.'),
      UI.rotateRow((deg) => App.rotateAll(deg, false)),
      F.btns([['Отразить ↔', () => App.mirrorAll('x')], ['Отразить ↕', () => App.mirrorAll('y')]]),
      F.check('Поворачивать вид вместе с компасом (ориентация сохраняется)', App._rotKeepNorth, (v) => { App._rotKeepNorth = v; }),
    ));
    const s = Rooms.summary();
    body.append(F.section('Кратко',
      F.info('Помещений', String(App.rooms.length)),
      F.info('Общая площадь', U.fmtArea(s.total)),
      s.footprint ? F.info('Площадь застройки дома', U.fmtArea(s.footprint)) : null,
      s.plotArea ? F.info('Участок', `${(s.plotArea / 1e6).toFixed(2)} сот.`) : null,
      F.btns([['Все площади →', () => UI.showTab('summary')]])));
    body.append(UI.notesList());
  },
  rotateRow(fn) {
    const inp = U.el('input', { type: 'number', value: 15, step: 1, inputmode: 'decimal' });
    return U.el('div', { class: 'rot-row' },
      U.el('button', { type: 'button', onclick: () => fn(-90), title: 'Против часовой на 90°' }, '⟲90°'),
      U.el('button', { type: 'button', onclick: () => fn(-U.num(inp.value, 0)), title: 'Против часовой на заданный угол' }, '⟲'),
      inp, U.el('span', { class: 'funit' }, '°'),
      U.el('button', { type: 'button', onclick: () => fn(U.num(inp.value, 0)), title: 'По часовой на заданный угол' }, '⟳'),
      U.el('button', { type: 'button', onclick: () => fn(90), title: 'По часовой на 90°' }, '⟳90°'));
  },
  transformSection(ids) {
    const b = Model.bboxOf(ids);
    const c = b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : { x: 0, y: 0 };
    const locked = ids.every(id => Model.get(id).locked);
    return F.section('Поворот и действия',
      F.check('Закрепить (не сдвигать случайно)', locked, (v) => { for (const id of ids) { if (v) Model.get(id).locked = true; else delete Model.get(id).locked; } Model.commit(); }),
      ids.length > 1 && !App.selGroup() ? U.el('div', { class: 'fbtns align' }, [['⇤', 'left', 'По левому краю'], ['↔', 'cx', 'По центру по горизонтали'], ['⇥', 'right', 'По правому краю'], ['⤒', 'top', 'По верху'], ['↕', 'cy', 'По центру по вертикали'], ['⤓', 'bottom', 'По низу']]
        .map(([t, m, title]) => U.el('button', { type: 'button', title, onclick: () => App.align(m) }, t))) : null,
      UI.rotateRow((deg) => { Model.rotate(ids, c, deg); Model.commit(); }),
      F.btns([
        ['Отразить ↔', () => { Model.mirror(ids, c, 'x'); Model.commit(); }],
        ['Отразить ↕', () => { Model.mirror(ids, c, 'y'); Model.commit(); }],
      ]),
      F.btns([
        ['Дублировать', () => App.duplicate(), '', 'Ctrl+D'],
        ['Удалить', () => App.deleteSel(), 'danger', 'Delete'],
      ]));
  },
  propsWall(body, w) {
    const L = Model.wallLen(w);
    UI.head(body, 'Стена', WALL_KINDS[w.kind].name);
    const setLen = (v) => {
      if (!(v > 1)) return;
      const u = Model.wallDir(w);
      const nb = G.add(w.a, G.mul(u, v));
      const att = Model.wallEndsAt(w.b, new Set([w.id]), 0.5);
      w.b.x = nb.x; w.b.y = nb.y;
      for (const r of att) { r.w[r.end].x = nb.x; r.w[r.end].y = nb.y; }
      Model.commit();
    };
    const ang = U.normDeg(-U.deg(G.angle(w.a, w.b)));
    const mats = materialsFor(w.kind), M = mats[w.mat];
    const setKind = (v) => {
      w.kind = v;
      if (!materialsFor(v)[w.mat]) w.mat = App.doc.defaults.wall[v].mat;
      if (v === 'fence') delete w.ins;
      Model.commit();
    };
    body.append(F.section('Параметры',
      F.select('Тип', w.kind, Object.entries(WALL_KINDS).map(([k, v]) => [k, v.name]), setKind),
      F.select('Материал', w.mat, Object.entries(mats).map(([k, v]) => [k, v.name]), (v) => App.setWallMat([w], v), { field: 'mat' }),
      M && M.ths ? U.el('div', { class: 'frow' }, U.el('span', { class: 'flabel' }, 'Типовая толщина'), U.el('div', { class: 'chips' }, M.ths.map(t => {
        const total = t + (w.ins || 0);
        return U.el('button', { type: 'button', class: Math.abs(w.th - total) < 0.01 ? 'on' : '', title: `${t} см` + (w.ins ? ` + утеплитель ${w.ins} см` : ''), onclick: () => { w.th = total; Model.commit(); } }, String(t));
      }))) : null,
      F.num('Длина (по оси)', L, setLen, { min: 1, field: 'len' }),
      F.num(w.ins ? 'Толщина (общая)' : 'Толщина', w.th, (v) => UI.set(w, 'th', Math.max(v, (w.ins || 0) + 1)), { min: 2, max: 150 }),
      w.kind !== 'fence' ? F.num('Утеплитель (минвата)', w.ins || 0, (v) => {
        const old = w.ins || 0, nv = U.clamp(v, 0, 50);
        w.th = Math.max(2, w.th + nv - old);          // утеплитель добавляется к толщине стены
        if (nv > 0) w.ins = nv; else delete w.ins;
        Model.commit();
      }, { min: 0, max: 50 }) : null,
      F.num('Высота', w.h, (v) => UI.set(w, 'h', v), { min: 0, max: 3000 }),
      F.num('Угол', Math.round(ang * 10) / 10, (v) => {
        const a = -U.rad(v);
        const nb = G.add(w.a, G.fromAngle(a, L));
        const att = Model.wallEndsAt(w.b, new Set([w.id]), 0.5);
        w.b.x = nb.x; w.b.y = nb.y;
        for (const r of att) { r.w[r.end].x = nb.x; r.w[r.end].y = nb.y; }
        Model.commit();
      }, { unit: '°', step: 1 }),
      (() => {
        // сдвиг поперёк стены: «+» — вправо для вертикальных, вниз для горизонтальных
        let n = G.perp(Model.wallDir(w));
        const horiz = Math.abs(n.x) > Math.abs(n.y);
        if ((horiz ? n.x : n.y) < 0) n = G.mul(n, -1);
        return F.num(horiz ? 'Сдвинуть вправо (+) / влево (−)' : 'Сдвинуть вниз (+) / вверх (−)', 0, (v) => {
          if (!v) return;
          Model.moveWalls([w.id], n.x * v, n.y * v); Model.commit();
          UI.toast(`Стена сдвинута на ${U.fmtLen(Math.abs(v))}, примыкающие стены подтянуты`);
        }, { field: 'shift' });
      })(),
      F.info('Азимут фасада', (() => { const n = G.perp(Model.wallDir(w)); const b1 = Sun.bearingOf(n), b2 = Sun.bearingOf(G.mul(n, -1)); return `${U.compass8(b1)} ${Math.round(b1)}° / ${U.compass8(b2)} ${Math.round(b2)}°`; })()),
      F.info('Площадь стены (без проёмов)', U.fmtArea(L * w.h - App.doc.openings.filter(o => o.wall === w.id).reduce((s, o) => s + o.w * (o.h || 0), 0))),
    ));
    if (w.kind === 'ext' && WALL_MATERIALS[w.mat]) {
      const R = wallR(w), need = 3.0;
      body.append(F.section('Теплозащита',
        U.el('div', { class: 'finfo' }, U.el('span', {}, 'Сопротивление теплопередаче R'), U.el('b', { class: R >= need ? 'ok' : 'bad' }, `${R.toFixed(2)} м²·°C/Вт`)),
        F.note(`Для жилого дома в средней полосе России нужно около ${need.toFixed(1)}–3.5 (СП 50.13330, зависит от региона). ` +
          (R >= need ? 'Стена проходит.' : `Не хватает: добавьте утеплитель ≈ ${Math.ceil((need - R) * INSULATION_LAM * 100 / 5) * 5} см минваты или возьмите толще/теплее материал.`) +
          ' Расчёт упрощённый, без учёта мостиков холода.')));
    }
    body.append(F.section('Стена',
      F.btns([
        ['Разделить пополам', () => { const w2 = Model.splitWall(w, 0.5); App.sel.clear(); App.sel.add(w2.id); Model.commit(); App.selChanged(); }],
        ['+ Дверь', () => Tools.set('door')], ['+ Окно', () => Tools.set('window')],
      ]),
      F.btns([['Применить толщину ко всем стенам этого типа', () => { for (const x of App.doc.walls) if (x.kind === w.kind) x.th = w.th; App.doc.defaults.wall[w.kind].th = w.th; Model.commit(); }]]),
    ));
  },
  propsOpening(body, op) {
    const t = OPENING_TYPES[op.type];
    const isWin = t.cat === 'window';
    UI.head(body, isWin ? 'Окно' : 'Дверь', t.name);
    const g = Model.opGeom(op);
    const widths = isWin ? WINDOW_WIDTHS : DOOR_WIDTHS;
    body.append(F.section('Размеры',
      F.select('Тип', op.type, Object.entries(OPENING_TYPES).filter(([, v]) => v.cat === t.cat).map(([k, v]) => [k, v.name]), (v) => { op.type = v; Model.commit(); }),
      F.select('Типовая ширина', widths.includes(op.w) ? op.w : '', [['', '— своя —'], ...widths.map(w => [w, w + ' см'])], (v) => { if (v) { op.w = +v; Model.commit(); } }),
      F.num('Ширина', op.w, (v) => UI.set(op, 'w', U.clamp(v, 20, g ? g.L : 1000)), { min: 20 }),
      F.num('Высота', op.h, (v) => UI.set(op, 'h', v), { min: 10 }),
      isWin ? F.num('Подоконник (от пола)', op.sill, (v) => UI.set(op, 'sill', v), { min: 0 }) : null,
      g ? F.num('От начала стены (до оси)', Math.round(g.pos), (v) => UI.set(op, 'pos', v), { min: 0 }) : null,
    ));
    body.append(F.section('Открывание',
      F.btns([
        ['⇄ Петли слева/справа', () => { op.hinge = op.hinge ? 0 : 1; Model.commit(); }],
        ['⇅ Внутрь/наружу', () => { op.side = -(op.side || 1); Model.commit(); }],
      ]),
      F.note('Сторону открывания видно на плане: дуга показывает движение створки.')));
    if (isWin) {
      const info = Sun.windowInfo(op);
      if (info && !info.interior) {
        const st = Sun.state();
        const res = Sun.windowSun(op, st.date, Sun.casters());
        body.append(F.section('Ориентация и солнце',
          F.info('Смотрит на', `${U.compass16(info.bearing)} (${Math.round(info.bearing)}°)`),
          info.room ? F.info('Помещение', info.room.name) : null,
          res ? F.info(`Прямое солнце ${st.date.split('-').reverse().join('.')}`, U.fmtHours(res.total)) : null,
          res ? F.info('Непрерывно, максимум', U.fmtHours(res.cont)) : null,
          F.note('Дату и место меняйте на вкладке «Солнце». Учитываются тени построек, деревьев, стен.')));
      } else if (info && info.interior) body.append(F.note('Окно во внутренней стене (между помещениями).'));
    }
    body.append(F.section('', F.btns([['Дублировать', () => App.duplicate()], ['Удалить', () => App.deleteSel(), 'danger']])));
  },
  /** Выбор сторон площадки (ступени, ограждение): кнопки-переключатели */
  sideChips(label, free, on, onChange) {
    const set = new Set(on);
    return U.el('div', { class: 'frow' }, U.el('span', { class: 'flabel' }, label), U.el('div', { class: 'chips' }, ['front', 'left', 'right', 'back'].filter(k => free.includes(k)).map(k => U.el('button', {
      type: 'button', class: set.has(k) ? 'on' : '', 'aria-pressed': String(set.has(k)), 'data-side': k,
      onclick: () => { if (set.has(k)) set.delete(k); else set.add(k); onChange(['front', 'left', 'right', 'back'].filter(x => set.has(x))); },
    }, PORCH_SIDES[k].name))));
  },
  propsItem(body, it) {
    const def = catItem(it.key);
    UI.head(body, it.label || def.name, CATALOG.find(c => c.id === def.cat)?.name);
    // варианты того же вида
    const same = CATALOG.find(c => c.id === def.cat).items.filter(x => x.shape === def.shape && x.key !== def.key);
    body.append(F.section('Размеры',
      same.length ? F.select('Типоразмер', '', [['', `${def.name} (${def.w}×${def.d})`], ...same.map(x => [x.key, `${x.name} (${x.w}×${x.d})`])], (v) => { if (!v) return; const d2 = catItem(v); it.key = v; it.w = d2.w; it.d = d2.d; it.h = d2.h; for (const k of PORCH_KEYS.concat(PIT_KEYS)) delete it[k]; for (const k of ['roofType', 'roofMat', 'roofPitch', 'roofRidge', 'roofShed']) delete it[k]; Model.commit(); }) : null,
      F.num('Ширина', it.w, (v) => UI.set(it, 'w', v), { min: 1, field: 'w' }),
      F.num('Глубина', it.d, (v) => UI.set(it, 'd', v), { min: 1 }),
      F.num('Высота', it.h, (v) => UI.set(it, 'h', v), { min: 0 }),
      F.btns([['Сбросить к типовым', () => { it.w = def.w; it.d = def.d; it.h = def.h; Model.commit(); }], ['Поменять Ш↔Г', () => { [it.w, it.d] = [it.d, it.w]; Model.commit(); }]]),
    ));
    const roofSection = () => {
      const R = bldRoof(it);
      const types = Object.entries(ITEM_ROOF_TYPES).filter(([k]) => k !== 'arch' || def.shape !== 'canopyLean');
      return F.section('Крыша',
        F.select('Тип', R.type, types.map(([k, v]) => [k, v.name]), (v) => { it.roofType = v; delete it.roofPitch; Model.commit(); }, { field: 'roofType' }),
        F.select('Материал', R.mat, Object.entries(ROOF_MATERIALS).map(([k, v]) => [k, v.name]), (v) => { it.roofMat = v; Model.commit(); }, { field: 'roofMat' }),
        R.type === 'gable' || R.type === 'hip' || R.type === 'shed' ? F.num('Уклон', R.pitch, (v) => { it.roofPitch = U.clamp(v, 3, 60); Model.commit(); }, { unit: '°', min: 3, max: 60 }) : null,
        R.type === 'gable' || R.type === 'hip' || R.type === 'arch' ? F.select('Конёк', R.ridge, [['long', 'вдоль длинной стороны'], ['short', 'вдоль короткой стороны']], (v) => { it.roofRidge = v; Model.commit(); }) : null,
        R.type === 'shed' ? F.select('Высокая сторона', R.shedDir, [['back', 'сзади (−Г)'], ['front', 'спереди (+Г)'], ['left', 'слева (−Ш)'], ['right', 'справа (+Ш)']], (v) => { it.roofShed = v; Model.commit(); }) : null,
        F.note(def.shape === 'veranda'
          ? 'Высота объекта — до верха крыши; «сзади» — сторона у дома: у пристроенной там нет свеса, односкатная поднимается к стене. Столбы доходят до низа ската.'
          : 'Высота объекта — до конька; высота стен (столбов) получается из уклона. Направления — относительно самой постройки: поверните её ручкой, крыша повернётся вместе с ней.'));
    };
    if (BLD_ROOF_SHAPES.has(def.shape)) body.append(roofSection());
    if (BLD_HOLLOW.has(def.shape)) {
      const sh = bldShell(it, it.w, it.d);
      body.append(F.section('Стены',
        F.num('Толщина стен', sh.t, (v) => { it.wallT = U.clamp(v, 3, 60); Model.commit(); }, { min: 3, max: 60, field: 'wallT' }),
        F.info('Внутри', `${U.fmtLen(sh.inner.x1 - sh.inner.x0)} × ${U.fmtLen(sh.inner.y1 - sh.inner.y0)}, ${sh.gate ? 'ворота' : 'дверь'} ${U.fmtLen(sh.dw)} спереди`),
        F.note('Внутри постройки видно всё, что в ней стоит: погреб, смотровую яму, машину, верстак. Крыша рисуется в слое «Крыша» — выключите его (на плане или в 3D), чтобы посмотреть сверху. В 3D пол вырезается под открытую яму.')));
    }
    if (def.shape === 'pit') {
      const g = pitGeom(it, it.w, it.d);
      body.append(F.section('Погреб / яма',
        F.num('Глубина', g.depth, (v) => { it.pitDepth = U.clamp(v, 30, 600); Model.commit(); }, { min: 30, max: 600, field: 'pitDepth' }),
        F.select('Лестница', g.stair, Object.entries(PIT_STAIRS), (v) => { it.stair = v; Model.commit(); }, { field: 'stair' }),
        g.stair !== 'none' ? F.select('Спуск со стороны', g.side, [['back', 'сзади (−Г)'], ['front', 'спереди (+Г)'], ['left', 'слева (−Ш)'], ['right', 'справа (+Ш)']], (v) => { it.stairSide = v; Model.commit(); }) : null,
        g.stair !== 'none' ? F.num('Ширина лестницы', g.sw, (v) => { it.stairW = U.clamp(v, 40, 200); Model.commit(); }, { min: 40 }) : null,
        F.select('Сверху', g.cover, Object.entries(PIT_COVERS), (v) => { it.cover = v; Model.commit(); }, { field: 'cover' }),
        g.stair === 'stairs' ? F.info('Ступени', `${g.n} шт., подъём ${U.fmtLen(g.rise)}, проступь ${U.fmtLen(g.tread)}, марш ${U.fmtLen(g.L)}${g.tread < 14 ? ' — очень круто, лучше удлинить яму' : ''}`) : null,
        F.info('Внутри', `${U.fmtLen(g.iw)} × ${U.fmtLen(g.id)}, стенки ${g.t} см`),
        F.info('Выемка грунта', `${g.volume.toFixed(1)} м³`),
        F.note('Размеры — снаружи по стенкам. Под домом ставьте люк: пол дома его перекрывает, в 3D виден только люк. В гараже или сарае подойдёт и открытая (смотровая яма) — пол постройки под ней вырезается. Открытую яму видно в 3D, в прогулке в неё можно спуститься по ступеням.')));
    }
    if (def.shape === 'veranda') {
      const o = porchOpt(it), g = porchGeom(it, it.w, it.d);
      body.append(F.section('Исполнение',
        F.select('Тип', o.encl, Object.entries(PORCH_ENCL).map(([k, v]) => [k, v.name]), (v) => { it.encl = v; if ((v === 'glazed' || v === 'closed') && !o.roofed) { it.roofed = true; if (it.h < o.ph + 240) it.h = o.ph + 280; } Model.commit(); }, { field: 'encl' }),
        F.check('С крышей / козырьком', o.roofed, (v) => { it.roofed = v; if (v && it.h < o.ph + 240) it.h = o.ph + 280; Model.commit(); }),
        F.check('Пристроена к дому (задняя сторона — у стены)', o.attached, (v) => { it.attached = v; Model.commit(); }),
        F.num('Высота площадки над землёй', o.ph, (v) => { it.ph = U.clamp(v, 0, 300); Model.commit(); }, { min: 0, max: 300 }),
        UI.sideChips('Ступени', o.free, o.stepSides, (list) => { it.stepSides = list; delete it.steps; Model.commit(); }),
        o.stepSides.length ? F.select('Ступени на стороне', o.stepPos, [['center', 'по центру'], ['start', 'к левому краю (на боковых — к переду)'], ['end', 'к правому краю (на боковых — к дому)']], (v) => { it.stepPos = v; Model.commit(); }) : null,
        o.stepSides.length ? F.num('Ширина ступеней / прохода', o.stepW, (v) => { it.stepW = U.clamp(v, 60, 1000); Model.commit(); }, { min: 60 }) : null,
        o.encl !== 'open' ? UI.sideChips({ rail: 'Ограждение', glazed: 'Остекление', closed: 'Стены' }[o.encl], o.free, o.railSides, (list) => { it.railSides = list; Model.commit(); }) : null,
        g.steps ? F.info('Ступени', `${g.steps - 1} шт. + площадка, подъём ${U.fmtLen(g.rise)}, проступь ${g.tread} см`) : null,
        F.note('Стороны — если смотреть на площадку спереди; «сзади» — сторона у дома (у пристроенной недоступна). Где ступени — там проход в ограждении, у закрытой веранды — дверь. Высота объекта — до верха крыши.')));
      if (o.roofed) body.append(roofSection());
    }
    body.append(F.section('Положение',
      F.num('X', it.x / 100, (v) => UI.set(it, 'x', v * 100), { unit: 'м', step: 0.01 }),
      F.num('Y', it.y / 100, (v) => UI.set(it, 'y', v * 100), { unit: 'м', step: 0.01 }),
      F.num('Поворот', Math.round((it.rot || 0) * 10) / 10, (v) => UI.set(it, 'rot', U.normDeg(v)), { unit: '°' }),
      F.check('Зеркально', it.flip, (v) => UI.set(it, 'flip', v)),
    ));
    const casts = it.shadow ?? def.shadow;
    body.append(F.section('Прочее',
      F.text('Подпись', it.label || '', (v) => UI.set(it, 'label', v.trim() || undefined), { placeholder: def.name }),
      F.check('Отбрасывает тень (расчёт солнца)', casts, (v) => UI.set(it, 'shadow', v)),
      (def.layer === 'siteobj' || def.cat === 'buildings') ? F.info('Площадь', U.fmtArea(it.w * it.d)) : null,
      F.text('Примечание', it.note || '', (v) => UI.set(it, 'note', v), { multiline: true }),
    ));
  },
  propsLine(body, l) {
    const k = LINE_KINDS[l.kind];
    const len = G.polyPerimeter(l.pts, false);
    UI.head(body, k.name, k.code);
    body.append(F.section('Трасса',
      F.select('Вид', l.kind, Object.entries(LINE_KINDS).map(([kk, v]) => [kk, `${v.code} — ${v.name}`]), (v) => { l.kind = v; Model.commit(); }),
      F.info('Длина', U.fmtLen(len)),
      F.info('Точек', String(l.pts.length)),
      k.dia || l.dia ? F.num('Диаметр', l.dia, (v) => UI.set(l, 'dia', v), { unit: 'мм' }) : null,
      k.section !== undefined ? F.text('Сечение / марка', l.section || '', (v) => UI.set(l, 'section', v), { placeholder: k.section }) : null,
      F.num('Глубина заложения', l.depth ?? 0, (v) => UI.set(l, 'depth', v), { min: 0 }),
      F.text('Обозначение', l.label || '', (v) => UI.set(l, 'label', v.trim() || undefined), { placeholder: k.code }),
      F.text('Примечание', l.note || '', (v) => UI.set(l, 'note', v), { multiline: true }),
    ));
    body.append(F.section('Точки',
      F.btns([['Развернуть направление', () => { l.pts.reverse(); Model.commit(); }], ['Продолжить трассу', () => { Tools.opts.lineKind = l.kind; Tools.set('line'); Tools.st = { pts: l.pts.map(p => ({ ...p })) }; Model.remove([l.id]); Model.commit(); }]]),
      F.note('Двойной клик по линии — добавить точку, по точке — удалить. Стрелки на канализации показывают направление уклона.')));
  },
  propsArea(body, a) {
    const k = AREA_KINDS[a.kind];
    const ar = Math.abs(G.polyArea(a.pts)), per = G.polyPerimeter(a.pts);
    UI.head(body, a.name || k.name, k.name);
    body.append(F.section('Зона',
      F.select('Вид', a.kind, Object.entries(AREA_KINDS).map(([kk, v]) => [kk, v.name]), (v) => { a.kind = v; Model.commit(); }),
      F.text('Название', a.name || '', (v) => UI.set(a, 'name', v)),
      F.info('Площадь', `${(ar / 1e4).toFixed(2)} м²` + (a.kind === 'plot' ? ` · ${(ar / 1e6).toFixed(2)} сот.` : '')),
      F.info('Периметр', U.fmtLen(per)),
    ));
    // покрытие: у границы участка и охранных зон — новая зона по тому же контуру, у остальных — смена вида
    const pave = (kind) => {
      if (a.kind === 'plot' || a.kind === 'protect' || a.kind === 'zone') {
        const n = Model.add('areas', { kind, pts: a.pts.map(p => ({ ...p })) });
        App.sel.clear(); App.sel.add(n.id); Model.commit(); App.selChanged();
        UI.toast(`${AREA_KINDS[kind].name}: ${(ar / 1e4).toFixed(1)} м² по контуру «${a.name || k.name}», без бордюров`);
      } else { a.kind = kind; Model.commit(); UI.toast(`Покрытие: ${AREA_KINDS[kind].name.toLowerCase()}, ${(ar / 1e4).toFixed(1)} м²`); }
    };
    if (a.kind !== 'water') body.append(F.section('Покрытие',
      F.btns([['Заасфальтировать', () => pave('asphalt'), a.kind === 'asphalt' ? 'on' : 'primary'], ['Бетон', () => pave('concrete'), a.kind === 'concrete' ? 'on' : ''], ['Щебень', () => pave('gravel'), a.kind === 'gravel' ? 'on' : '']]),
      F.btns([['Плитка / мощение', () => pave('paving'), a.kind === 'paving' ? 'on' : ''], ['Газон', () => pave('lawn'), a.kind === 'lawn' ? 'on' : '']]),
      F.note(a.kind === 'plot' ? 'Для границы участка создаётся отдельная зона покрытия по тому же контуру (граница остаётся). Чтобы покрыть только часть — нарисуйте зону инструментом «Зона».' : 'Покрытие ровное, вровень с землёй, без бордюров. Площадь идёт в «Площади» и в смету.')));
    const sides = U.el('div', { class: 'sides' });
    a.pts.forEach((p, i) => {
      const q = a.pts[(i + 1) % a.pts.length];
      const b = Sun.bearingOf(G.perp(G.unit(G.sub(q, p))));
      if (a.kind === 'plot') {
        const cur = (a.edges || [])[i] || 'auto';
        const auto = cur === 'auto' ? ` (${BOUND_TYPES[Checks.edgeType(a, i)]})` : '';
        sides.append(F.select(`Граница ${i + 1}`, cur, Object.entries(BOUND_TYPES).map(([k, v]) => [k, k === 'auto' ? 'авто' + auto : v]), (v) => {
          a.edges = a.edges || []; while (a.edges.length < a.pts.length) a.edges.push('auto'); a.edges[i] = v; Model.commit();
        }));
      }
      sides.append(F.num(`Сторона ${i + 1} (${U.compass8(b)})`, G.dist(p, q), (v) => {
        if (!(v > 1)) return;
        const u = G.unit(G.sub(q, p));
        const nq = G.add(p, G.mul(u, v)), d = G.sub(nq, q);
        // сдвигаем все следующие вершины, кроме первой — форма сохраняется
        for (let j = i + 1; j < a.pts.length; j++) { a.pts[j].x += d.x; a.pts[j].y += d.y; }
        Model.commit();
      }, { min: 1 }));
    });
    body.append(F.section('Стороны', sides, F.note('Изменение длины стороны сдвигает следующие вершины. Двойной клик по контуру — добавить/удалить вершину.')));
    if (a.kind === 'plot') body.append(F.section('Участок', F.btns([['Забор по границе', () => App.fenceAround(a)], ['Ориентация и солнце →', () => UI.showTab('sun')]])));
  },
  propsRoof(body, r) {
    const P = Roof.params(r);
    UI.head(body, 'Крыша', ROOF_TYPES[r.type].name);
    body.append(F.section('Форма',
      F.select('Тип', r.type, Object.entries(ROOF_TYPES).map(([k, v]) => [k, v.name]), (v) => { r.type = v; Model.commit(); }),
      r.type !== 'flat' ? F.num('Уклон', r.pitch, (v) => UI.set(r, 'pitch', U.clamp(v, 3, 70)), { unit: '°', min: 3, max: 70 }) : null,
      r.type !== 'flat' ? U.el('div', { class: 'chips' }, [15, 20, 25, 30, 35, 40, 45].map(a => U.el('button', { type: 'button', class: Math.round(r.pitch) === a ? 'on' : '', onclick: () => UI.set(r, 'pitch', a) }, a + '°'))) : null,
      F.select('Кровля', r.mat, Object.entries(ROOF_MATERIALS).map(([k, v]) => [k, v.name]), (v) => { r.mat = v; Model.commit(); }),
      F.num('Длина (вдоль конька)', r.w, (v) => UI.set(r, 'w', Math.max(50, v)), { min: 50 }),
      F.num('Ширина', r.d, (v) => UI.set(r, 'd', Math.max(50, v)), { min: 50 }),
      F.num('Низ крыши (карниз) от земли', r.base, (v) => UI.set(r, 'base', Math.max(0, v)), { min: 0 }),
      F.btns([['Высота по стенам', () => UI.set(r, 'base', Roof.autoBase(r.floor))], ['Повернуть конёк на 90°', () => { [r.w, r.d] = [r.d, r.w]; r.rot = U.normDeg((r.rot || 0) + 90); Model.commit(); }]]),
    ));
    body.append(F.section('Расчёт кровли',
      F.info('Площадь кровли', U.fmtArea(P.area)),
      F.info('Площадь в плане', U.fmtArea(r.w * r.d)),
      r.type !== 'flat' ? F.info('Подъём ската', U.fmtLen(P.rise)) : null,
      F.info('Высота конька от земли', U.fmtLen(P.top)),
      P.ridge ? F.info('Длина конька', U.fmtLen(P.ridge)) : null,
      P.rafter ? F.info('Длина ската (стропила)', U.fmtLen(P.rafter)) : null,
      F.info('Карнизные свесы', U.fmtLen(P.eaves)),
      P.rakes ? F.info('Фронтонные свесы', U.fmtLen(P.rakes)) : null,
      P.hipLen ? F.info('Рёбра вальм', U.fmtLen(P.hipLen)) : null,
      F.note('Площадь ската = площадь в плане / cos(уклона); свесы входят в размеры. Для закупки добавьте 10–15% на подрезку и нахлёсты.')));
    body.append(F.section('Положение',
      F.num('X', r.x / 100, (v) => UI.set(r, 'x', v * 100), { unit: 'м', step: 0.01 }),
      F.num('Y', r.y / 100, (v) => UI.set(r, 'y', v * 100), { unit: 'м', step: 0.01 }),
      F.num('Поворот', Math.round((r.rot || 0) * 10) / 10, (v) => UI.set(r, 'rot', U.normDeg(v)), { unit: '°' })));
  },
  propsRoad(body, r) {
    const k = ROAD_KINDS[r.kind];
    const len = G.polyPerimeter(r.pts, false);
    UI.head(body, r.name || k.name, k.name);
    body.append(F.section('Дорога',
      F.text('Название', r.name || '', (v) => UI.set(r, 'name', v.trim()), { field: 'roadName', placeholder: 'например, ул. Садовая' }),
      F.select('Вид', r.kind, Object.entries(ROAD_KINDS).map(([kk, v]) => [kk, v.name]), (v) => { r.kind = v; Model.commit(); }),
      F.num('Ширина', r.width, (v) => UI.set(r, 'width', v), { min: 20 }),
      F.info('Длина по оси', U.fmtLen(len)),
      F.info('Площадь покрытия ≈', U.fmtArea(len * r.width)),
      F.check('Бордюр по краям', roadCurb(r), (v) => UI.set(r, 'curb', v)),
      F.check('Показывать длину в подписи', r.showLen, (v) => UI.set(r, 'showLen', v)),
      F.btns([['Развернуть', () => { r.pts.reverse(); Model.commit(); }], ['Продолжить', () => { Tools.opts.roadKind = r.kind; Tools.opts.roadW = r.width; Tools.set('road'); Tools.st = { pts: r.pts.map(p => ({ ...p })) }; Model.remove([r.id]); Model.commit(); }]]),
      F.note('Двойной клик по дороге — добавить изгиб, по точке — удалить.')));
  },
  propsDim(body, d) {
    UI.head(body, 'Размер', U.fmtLen(G.dist(d.a, d.b)));
    body.append(F.section('Размер',
      F.info('Длина', U.fmtLen(G.dist(d.a, d.b))),
      F.num('Отступ линии', d.off || 0, (v) => UI.set(d, 'off', v)),
      F.text('Свой текст', d.text || '', (v) => UI.set(d, 'text', v.trim() || undefined), { placeholder: 'авто' }),
    ));
  },
  propsText(body, t) {
    UI.head(body, 'Надпись');
    body.append(F.section('Надпись',
      F.text('Текст', t.text, (v) => UI.set(t, 'text', v), { multiline: true, field: 'text' }),
      F.num('Размер шрифта', t.size || 30, (v) => UI.set(t, 'size', v), { min: 2 }),
      F.num('Поворот', t.rot || 0, (v) => UI.set(t, 'rot', U.normDeg(v)), { unit: '°' }),
      F.check('Жирный', t.bold, (v) => UI.set(t, 'bold', v)),
    ));
  },
  /** Примечания, привязанные к объекту */
  notesOf(id) {
    const list = App.doc.notes.filter(n => n.target === id);
    const sec = F.section('Примечания к объекту');
    for (const n of list) {
      const i = App.doc.notes.indexOf(n) + 1;
      sec.append(U.el('button', { type: 'button', class: 'note-item' + (n.done ? ' done' : ''), onclick: () => { App.sel.clear(); App.sel.add(n.id); App.selChanged(); } },
        U.el('span', { class: 'note-num' }, String(i)), U.el('span', {}, n.text || '(пусто)')));
    }
    sec.append(F.btns([['+ Примечание', () => { const n = App.addNote(id); App.sel.clear(); App.sel.add(n.id); App.selChanged(); UI.focusField('note'); }]]));
    return sec;
  },
  targetName(id) {
    const o = Model.get(id), c = Model.coll(id);
    if (!o) return '—';
    if (c === 'walls') return 'Стена (' + WALL_KINDS[o.kind].name.toLowerCase() + ', ' + U.fmtLen(Model.wallLen(o)) + ')';
    if (c === 'items') return o.label || catItem(o.key).name;
    if (c === 'openings') return OPENING_TYPES[o.type].name;
    if (c === 'lines') return LINE_KINDS[o.kind].name;
    if (c === 'areas') return o.name || AREA_KINDS[o.kind].name;
    if (c === 'roads') return o.name || ROAD_KINDS[o.kind].name;
    if (c === 'roofs') return 'Крыша (' + ROOF_TYPES[o.type].name.toLowerCase() + ')';
    if (c === 'roomTags') return 'Помещение «' + o.name + '»';
    if (c === 'dims') return 'Размер';
    if (c === 'texts') return 'Надпись';
    return c;
  },
  propsNote(body, n) {
    const i = App.doc.notes.indexOf(n) + 1;
    UI.head(body, 'Примечание №' + i, n.target ? 'к объекту' : 'свободное');
    body.append(F.section('Примечание',
      F.text('Текст', n.text || '', (v) => UI.set(n, 'text', v), { multiline: true, field: 'note' }),
      F.text('Автор', n.author || '', (v) => UI.set(n, 'author', v.trim() || undefined)),
      F.check('Выполнено / решено', n.done, (v) => UI.set(n, 'done', v)),
      n.target && Model.get(n.target) ? F.info('Привязано к', UI.targetName(n.target)) : F.note('Не привязано. Чтобы привязать — создайте примечание инструментом «Заметка» кликом по объекту.'),
      F.btns([
        n.target && Model.get(n.target) ? ['Показать объект', () => { App.sel.clear(); App.sel.add(n.target); App.selChanged(); }] : null,
        n.target ? ['Отвязать', () => { const p = Model.notePos(n); n.x = p.x; n.y = p.y; delete n.target; delete n.dx; delete n.dy; Model.commit(); }] : null,
        ['Удалить', () => App.deleteSel(), 'danger'],
      ]),
      F.note('Выноску можно перетаскивать — она останется привязанной к объекту.')));
  },
  propsTag(body, t) {
    const r = App.rooms.find(x => x.tag === t);
    if (r) UI.propsRoom(body, r);
    else { UI.head(body, 'Метка помещения', t.name); body.append(F.note('Метка вне замкнутого контура стен.')); }
  },
  notesList() {
    const notes = App.doc.notes;
    const sec = F.section(`Примечания на плане (${notes.length})`);
    if (!notes.length) { sec.append(F.note('Инструмент «Заметка» (K): кликните по объекту, чтобы оставить к нему примечание.')); return sec; }
    notes.forEach((n, i) => sec.append(U.el('button', { type: 'button', class: 'note-item' + (n.done ? ' done' : ''), onclick: () => { App.sel.clear(); App.sel.add(n.id); App.selChanged(); const p = Model.notePos(n); View.ox = p.x - App.cw / 2 / View.scale; View.oy = p.y - App.ch / 2 / View.scale; App.redraw(); } },
      U.el('span', { class: 'note-num' }, String(i + 1)), U.el('span', {}, (n.text || '(пусто)') + (n.target && Model.get(n.target) ? ' — ' + UI.targetName(n.target) : '')))));
    return sec;
  },
  propsRoom(body, r) {
    if (!r) return;
    UI.head(body, r.name, 'Помещение');
    const ensureTag = () => {
      if (r.tag) return r.tag;
      const t = Model.add('roomTags', { x: r.label.x, y: r.label.y, name: r.name });
      App.sel.clear(); App.sel.add(t.id);
      return t;
    };
    const wins = Rooms.windowsOf(r);
    body.append(F.section('Помещение',
      F.text('Название', r.name, (v) => { const t = ensureTag(); t.name = v.trim() || r.name; Model.commit(); App.selChanged(); }, { field: 'roomName' }),
      F.check('Жилое (для «жилой площади»)', r.tag?.living, (v) => { const t = ensureTag(); t.living = v; Model.commit(); App.selChanged(); }),
      F.info('Площадь пола', U.fmtArea(r.areaFloor)),
      F.info('Площадь по осям стен', U.fmtArea(r.areaAxis)),
      F.info('Периметр по полу', U.fmtLen(r.perimFloor)),
      F.info('Окна', wins.length ? wins.map(w => w.info.dir).join(', ') : 'нет'),
      F.btns([['Переименовать на плане: двойной клик', null, 'ghost']].map(x => [x[0], () => UI.focusField('roomName'), x[2]])),
      r.tag && r.tag.fixed ? F.btns([['Подпись — в центр помещения', () => { const t = r.tag; delete t.fixed; const c = G.labelPoint(r.floor); t.x = c.x; t.y = c.y; Model.commit(); }]]) : null,
      F.note(r.tag && r.tag.fixed ? 'Подпись закреплена там, куда её перетащили.' : 'Подпись стоит по центру помещения; перетащите её, чтобы закрепить в другом месте.'),
    ));
    const name = r.name.toLowerCase();
    const presets = ['Гостиная', 'Кухня', 'Кухня-гостиная', 'Спальня', 'Детская', 'Кабинет', 'Санузел', 'Ванная', 'Туалет', 'Прихожая', 'Коридор', 'Гардероб', 'Котельная', 'Кладовая', 'Терраса', 'Гараж'];
    body.append(F.section('Быстрое название', U.el('div', { class: 'chips' }, presets.map(p => U.el('button', {
      type: 'button', class: name === p.toLowerCase() ? 'on' : '',
      onclick: () => { const t = ensureTag(); t.name = p; t.living = ['Гостиная', 'Спальня', 'Детская', 'Кабинет', 'Кухня-гостиная'].includes(p); Model.commit(); App.selChanged(); },
    }, p)))));
  },
  propsMulti(body, ids) {
    const byType = {};
    for (const id of ids) { const c = Tools.isRoom(id) ? 'rooms' : id === 'underlay' ? 'underlay' : Model.coll(id); byType[c] = (byType[c] || 0) + 1; }
    const names = { roofs: 'крыш', roads: 'дорог', walls: 'стен', openings: 'проёмов', items: 'объектов', lines: 'трасс', areas: 'зон', dims: 'размеров', texts: 'надписей', roomTags: 'меток', rooms: 'помещений', underlay: 'подложка' };
    const gid = App.selGroup();
    const walls = ids.filter(id => Model.coll(id) === 'walls').map(Model.get);
    const onlyWalls = walls.length === ids.length;
    UI.head(body, gid ? (onlyWalls ? 'Группа стен' : 'Группа') : `Выделено: ${ids.length}`, Object.entries(byType).map(([k, v]) => `${names[k] || k}: ${v}`).join(', '));
    if (gid) {
      // сдвиг группы на точное расстояние: у стен — с подтягиванием примыкающих
      let dx = 0, dy = 0;
      body.append(F.section('Группа',
        F.num('Сдвинуть по X (вправо +)', 0, (v) => { dx = v; }, { field: 'gdx' }),
        F.num('Сдвинуть по Y (вниз +)', 0, (v) => { dy = v; }, { field: 'gdy' }),
        F.btns([['Сдвинуть', () => { App.moveSel(dx, dy); UI.toast(`Группа сдвинута на ${U.fmtLen(Math.hypot(dx, dy))}`); }, 'primary'], ['Разгруппировать', () => App.ungroup(), '', 'Ctrl+Shift+G']]),
        F.note('Группа выделяется и двигается как одно целое: перетащите её мышью или стрелками (Shift — по 10 см), поверните и отразите ниже. Alt+клик — выбрать одну стену внутри группы.')));
    } else {
      const hasGrp = ids.some(id => Model.get(id) && Model.get(id).grp);
      body.append(F.btns([['Сгруппировать', () => App.group(), 'primary', 'Ctrl+G'], hasGrp ? ['Разгруппировать', () => App.ungroup(), '', 'Ctrl+Shift+G'] : null]));
    }
    if (walls.length) {
      const same = (k) => walls.every(w => w[k] === walls[0][k]) ? walls[0][k] : null;
      body.append(F.section('Стены (все выделенные)',
        F.select('Тип', same('kind') ?? '', [['', '— разные —'], ...Object.entries(WALL_KINDS).map(([k, v]) => [k, v.name])], (v) => { if (v) { walls.forEach(w => { w.kind = v; if (!materialsFor(v)[w.mat]) w.mat = App.doc.defaults.wall[v].mat; }); Model.commit(); } }),
        F.select('Материал', same('mat') ?? '', [['', '— разные —'], ...Object.entries(walls.every(w => w.kind === 'fence') ? FENCE_MATERIALS : walls.some(w => w.kind === 'fence') ? {} : WALL_MATERIALS).map(([k, v]) => [k, v.name])], (v) => { if (v) App.setWallMat(walls, v); }),
        F.num('Толщина', same('th'), (v) => { walls.forEach(w => (w.th = v)); Model.commit(); }, { min: 2 }),
        F.num('Высота', same('h'), (v) => { walls.forEach(w => (w.h = v)); Model.commit(); }, { min: 0 }),
        F.info('Суммарная длина', U.fmtLen(walls.reduce((s, w) => s + Model.wallLen(w), 0)))));
    }
    const lines = ids.filter(id => Model.coll(id) === 'lines').map(Model.get);
    if (lines.length) body.append(F.info('Длина трасс', U.fmtLen(lines.reduce((s, l) => s + G.polyPerimeter(l.pts, false), 0))));
  },

  /* ------------------------------- слои ----------------------------------- */
  renderLayers() {
    const body = $('tab-layers');
    body.textContent = '';
    const L = App.doc.settings.layers;
    const list = U.el('div', { class: 'layer-list' });
    for (const l of LAYERS) {
      const b = U.el('button', { type: 'button', class: 'layer' + (L[l.id] !== false ? ' on' : ''), 'aria-pressed': String(L[l.id] !== false) },
        U.el('span', { class: 'eye' }), U.el('span', {}, l.name));
      b.onclick = () => {
        L[l.id] = !(L[l.id] !== false);
        if (l.id === 'heat' && L.heat && !App.heat) UI.toast('Карта ещё не рассчитана: вкладка «Солнце» → «Рассчитать карту»');
        App.redraw(); App.saveSoon(); UI.refresh();
      };
      list.append(b);
    }
    body.append(F.section('Видимость слоёв', list,
      F.btns([['Показать все', () => { for (const l of LAYERS) L[l.id] = !['heat'].includes(l.id) || !!App.heat; App.redraw(); UI.refresh(); }], ['Только дом', () => { for (const l of LAYERS) L[l.id] = ['grid', 'walls', 'rooms', 'furniture', 'dims', 'plumbing', 'heating', 'electric', 'gas'].includes(l.id); App.redraw(); UI.refresh(); }]])));
    const s = App.doc.settings;
    body.append(F.section('Подписи на плане',
      F.check('Длины стен', s.showWallDims, (v) => { s.showWallDims = v; App.redraw(); App.saveSoon(); }),
      F.check('Размеры предметов (Ш×Г)', s.showItemDims, (v) => { s.showItemDims = v; App.redraw(); App.saveSoon(); }),
      F.check('Расстояния до стен у выделенного', s.showGuides !== false, (v) => { s.showGuides = v; App.redraw(); App.saveSoon(); }),
      F.check('Открывание окон (дуги)', s.showSwing !== false, (v) => { s.showSwing = v; App.redraw(); App.saveSoon(); }),
      F.check('Штриховка материалов стен (при приближении)', s.wallHatch !== false, (v) => { s.wallHatch = v; App.redraw(); App.saveSoon(); }),
      F.check('Подсказки при наведении на объекты', s.hoverTips !== false, (v) => { s.hoverTips = v; if (!v) UI.hideTip(); App.saveSoon(); })));
    const used = [...new Set(App.doc.walls.filter(w => w.kind !== 'fence').map(w => w.mat))].filter(k => WALL_MATERIALS[k]);
    const usedF = [...new Set(App.doc.walls.filter(w => w.kind === 'fence').map(w => w.mat))].filter(k => FENCE_MATERIALS[k]);
    if (used.length || usedF.length) {
      const leg2 = U.el('div', { class: 'mat-legend' });
      for (const k of used) leg2.append(U.el('div', {}, U.el('img', { src: UI.matSwatch(k), alt: '' }), U.el('span', {}, WALL_MATERIALS[k].name)));
      if (App.doc.walls.some(w => w.ins > 0)) leg2.append(U.el('div', {}, U.el('img', { src: UI.matSwatch('insulation'), alt: '' }), U.el('span', {}, 'Утеплитель (минвата)')));
      for (const k of usedF) leg2.append(U.el('div', {}, U.el('i', { style: { borderTop: `3px ${FENCE_MATERIALS[k].dash.length ? 'dashed' : 'solid'} ${FENCE_MATERIALS[k].color}` } }), U.el('span', {}, 'Забор: ' + FENCE_MATERIALS[k].name)));
      body.append(F.section('Материалы стен в проекте', leg2));
    }
    body.append(UI.underlaySection(false));
    const leg = U.el('div', { class: 'legend' });
    for (const [, k] of Object.entries(LINE_KINDS)) leg.append(U.el('div', {}, U.el('i', { style: { borderTop: `3px ${k.dash.length ? 'dashed' : 'solid'} ${k.color}` } }), U.el('b', { style: { color: k.color } }, k.code), U.el('span', {}, k.name)));
    body.append(F.section('Условные обозначения сетей', leg));
  },
  matSwatch(key) {
    const tile = Render.matTile(key, Theme.isDark(), 2);
    if (!tile) return '';
    const cv = document.createElement('canvas'); cv.width = 56; cv.height = 28;
    const c = cv.getContext('2d');
    c.fillStyle = c.createPattern(tile, 'repeat'); c.fillRect(0, 0, 56, 28);
    c.strokeStyle = Theme.C.wallStroke; c.lineWidth = 2; c.strokeRect(1, 1, 54, 26);
    return cv.toDataURL();
  },
  underlaySection(asProps) {
    const u = App.doc.underlay;
    const sec = F.section('Подложка (картинка плана)');
    if (!u || !u.src) {
      sec.append(F.note('Загрузите фото или скан плана (БТИ, кадастр, эскиз) и обведите его стенами. Прозрачность настраивается.'),
        F.btns([['Загрузить картинку…', () => $('fileImage').click(), 'primary']]));
      return sec;
    }
    if (asProps) sec.querySelector('h4').textContent = 'Подложка';
    sec.append(
      F.range('Прозрачность', Math.round((1 - u.opacity) * 100), 0, 98, 1, (v) => { u.opacity = 1 - v / 100; App.redraw(); }, () => Model.commit(), (v) => v + '%'),
      U.el('div', { class: 'seg' },
        U.el('button', { type: 'button', class: u.front ? '' : 'on', onclick: () => { u.front = false; Model.commit(); } }, 'Под планом'),
        U.el('button', { type: 'button', class: u.front ? 'on' : '', onclick: () => { u.front = true; Model.commit(); } }, 'Поверх плана')),
      F.check('Показывать', u.visible, (v) => { u.visible = v; Model.commit(); }),
      F.check('Закрепить (не выделяется кликом)', u.locked, (v) => { u.locked = v; if (v) App.sel.delete('underlay'); Model.commit(); App.selChanged(); }),
      F.num('Масштаб: 1 px картинки =', u.scale * 10, (v) => { if (v > 0) { u.scale = v / 10; Model.commit(); } }, { unit: 'мм', step: 0.1 }),
      F.num('Поворот', u.rot || 0, (v) => UI.set(u, 'rot', U.normDeg(v)), { unit: '°' }),
      F.btns([
        ['Калибровать по 2 точкам', () => { u.visible = true; App.doc.settings.layers.underlay = true; Tools.set('calib'); UI.toast('Кликните две точки с известным расстоянием'); }, 'primary'],
        ['Выделить / двигать', () => { u.locked = false; App.sel.clear(); App.sel.add('underlay'); Tools.set('select'); Model.commit(); App.selChanged(); }],
      ]),
      F.btns([['Заменить…', () => $('fileImage').click()], ['Удалить подложку', () => { App.doc.underlay = null; App.sel.delete('underlay'); Underlay.sync(); Model.commit(); }, 'danger']]),
    );
    return sec;
  },

  /* -------------------------------- солнце -------------------------------- */
  syncSun() { if (UI.tab === 'sun') UI.refresh(); App.redraw(); },
  _play: 0,
  renderSun() {
    const body = $('tab-sun');
    body.textContent = '';
    const d = App.doc, g = d.geo, st = Sun.state(), L = d.settings.layers;
    // ориентация
    body.append(F.section('Ориентация по сторонам света',
      F.range('Север', Math.round(d.north), -180, 180, 1, (v) => { d.north = v; App.redraw(); }, () => Model.commit(), (v) => (v > 0 ? '+' : '') + v + '°'),
      F.num('Точно', d.north, (v) => { d.north = U.normDeg(v); Model.commit(); }, { unit: '°', step: 0.5 }),
      F.btns([['С ↑', () => { d.north = 0; Model.commit(); }], ['С →', () => { d.north = 90; Model.commit(); }], ['С ↓', () => { d.north = 180; Model.commit(); }], ['С ←', () => { d.north = -90; Model.commit(); }]]),
      F.note('Угол — куда указывает север относительно верха экрана (по часовой). Компас на плане можно вращать мышью. Чтобы развернуть сам участок с постройками — выделите их и поверните ручкой ⟳ или на вкладке «Свойства».')));
    // место
    const citySel = F.select('Город', g.city || '', [['', '— свои координаты —'], ...CITIES.map(c => [c[0], c[0]])], (v) => {
      const c = CITIES.find(x => x[0] === v); if (!c) return;
      g.city = c[0]; g.lat = c[1]; g.lon = c[2]; g.tz = c[3]; Model.commit();
    });
    body.append(F.section('Местоположение', citySel,
      F.num('Широта', g.lat, (v) => { g.lat = U.clamp(v, -89, 89); g.city = ''; Model.commit(); }, { unit: '°', step: 0.01 }),
      F.num('Долгота', g.lon, (v) => { g.lon = U.clamp(v, -180, 180); g.city = ''; Model.commit(); }, { unit: '°', step: 0.01 }),
      F.num('Часовой пояс UTC+', g.tz, (v) => { g.tz = U.clamp(v, -12, 14); Model.commit(); }, { unit: 'ч', step: 1 })));
    // быстрый участок и проверка отступов — сразу после ориентации
    const wIn = U.el('input', { type: 'number', value: 20, step: 0.5, min: 1 }), dIn = U.el('input', { type: 'number', value: 30, step: 0.5, min: 1 });
    if (!App.doc.areas.some(a => a.kind === 'plot')) body.append(F.section('Быстрый участок',
      U.el('div', { class: 'frow' }, U.el('span', { class: 'flabel' }, 'Ширина × длина'), wIn, U.el('span', { class: 'funit' }, '×'), dIn, U.el('span', { class: 'funit' }, 'м')),
      F.btns([['Создать участок', () => App.createPlot(U.num(wIn.value, 20) * 100, U.num(dIn.value, 30) * 100), 'primary']]),
      F.note('6 соток ≈ 20×30 м, 10 соток ≈ 25×40 м, 15 соток ≈ 30×50 м.')));
    body.append(UI.checksSection());
    // дата и время
    const date = U.el('input', { type: 'date', value: st.date });
    date.addEventListener('change', () => { if (date.value) { st.date = date.value; if (App.heat) App.heat.stale = true; App.saveSoon(); UI.refresh(); App.redraw(); } });
    const y = st.date.slice(0, 4);
    const info = Sun.dayInfo(st.date, g);
    const pos = Sun.current();
    const playBtn = U.el('button', { type: 'button', class: UI._play ? 'on' : '' }, UI._play ? '■ Стоп' : '▶ День');
    playBtn.onclick = () => UI.togglePlay();
    body.append(F.section('Дата и время',
      F.row('Дата', date),
      U.el('div', { class: 'chips' }, [['22.03', `${y}-03-22`, 'равноденствие'], ['22.04', `${y}-04-22`, 'начало нормативного периода'], ['22.06', `${y}-06-22`, 'летнее солнцестояние'], ['22.08', `${y}-08-22`, 'конец нормативного периода'], ['22.12', `${y}-12-22`, 'зимнее солнцестояние']]
        .map(([t, v, title]) => U.el('button', { type: 'button', title, class: st.date === v ? 'on' : '', onclick: () => { st.date = v; if (App.heat) App.heat.stale = true; App.saveSoon(); UI.refresh(); App.redraw(); } }, t))),
      F.range('Время', st.min, 0, 1439, 5, (v) => { st.min = v; UI.updateSunInfo(); App.redraw(); }, () => { App.saveSoon(); UI.refresh(); }, U.fmtTime),
      U.el('div', { class: 'fbtns' }, playBtn,
        U.el('button', { type: 'button', onclick: () => { st.min = Math.round(info.noon); UI.refresh(); App.redraw(); } }, 'Полдень'),
        info.rise !== null ? U.el('button', { type: 'button', onclick: () => { st.min = Math.ceil(info.rise + 30); UI.refresh(); App.redraw(); } }, 'Утро') : null,
        info.set !== null ? U.el('button', { type: 'button', onclick: () => { st.min = Math.floor(info.set - 30); UI.refresh(); App.redraw(); } }, 'Вечер') : null),
      U.el('div', { id: 'sunInfo', class: 'sun-info' }),
      F.info('Восход / заход', info.polarDay ? 'полярный день' : `${U.fmtTime(info.rise)} / ${U.fmtTime(info.set)}`),
      F.info('Долгота дня', U.fmtHours(info.length / 60)),
      F.info('Макс. высота солнца', info.maxAlt.toFixed(1) + '°'),
      F.check('Показывать тени на плане', L.shadows, (v) => { L.shadows = v; App.redraw(); App.saveSoon(); })));
    UI.updateSunInfo(pos);
    // карта инсоляции
    const prog = U.el('progress', { id: 'heatProg', max: 1, value: 0, hidden: true });
    const h = App.heat;
    const heatSec = F.section('Карта освещённости участка',
      F.note('Считает, сколько часов прямого солнца получает каждая точка участка с учётом теней от дома, построек, заборов и деревьев (высоты задаются в свойствах).'),
      F.select('Период', st.period || 'day', [['day', 'Выбранный день'], ['season', 'Сезон (22 апр – 22 авг), среднее'], ['year', 'Год (21-е число месяцев), среднее']], (v) => { st.period = v; App.saveSoon(); }),
      F.select('Шаг', st.step || 15, [[5, '5 минут (точнее)'], [15, '15 минут'], [30, '30 минут (быстрее)']], (v) => { st.step = +v; App.saveSoon(); }),
      F.btns([['Рассчитать карту', () => UI.runHeat(), 'primary'], h ? ['Скрыть', () => { L.heat = false; App.redraw(); UI.refresh(); }] : null]),
      prog);
    if (h) {
      const n = h.cells || 1;
      heatSec.append(
        F.info('Период расчёта', h.period === 'day' ? h.date.split('-').reverse().join('.') : h.period === 'season' ? 'апрель–август' : 'год'),
        F.info('В среднем по участку', U.fmtHours(h.avg)),
        F.info('Минимум / максимум', `${h.min.toFixed(1)} / ${h.max.toFixed(1)} ч`),
        F.info('Светлое время', U.fmtHours(h.daylight)),
        UI.hist([['меньше 3 ч (тень)', h.hist[0] / n, '#3468be'], ['3–6 ч (полутень)', h.hist[1] / n, '#28aaaa'], ['6–9 ч', h.hist[2] / n, '#78c850'], ['больше 9 ч (солнце)', h.hist[3] / n, '#f5cd32']]),
        F.note('Наведите курсор на план — в строке состояния видно число часов в точке. Для огорода и теплицы нужно 6+ часов, для газона — 4+.'));
      if (h.stale) heatSec.append(F.note('<b>План или дата изменились</b> — пересчитайте карту.'));
    }
    body.append(heatSec);
    // инсоляция помещений
    const norm = Sun.norm(g.lat);
    const roomsSec = F.section('Инсоляция помещений (через окна)',
      F.note(`Норматив для ${norm.zone}: не менее <b>${norm.hours} ч</b> непрерывной инсоляции в период ${norm.period} (СанПиН 1.2.3685-21) хотя бы для одной жилой комнаты.`),
      F.btns([['Рассчитать на выбранную дату', () => { UI._roomIns = { date: st.date, res: Sun.roomsInsolation(st.date) }; UI.refresh(); }, 'primary']]));
    if (UI._roomIns) {
      const { res, date: dd } = UI._roomIns;
      const tbl = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, 'Помещение'), U.el('th', {}, 'Окна'), U.el('th', {}, 'Непр.'), U.el('th', {}, 'Всего')));
      for (const r of App.rooms) {
        const x = res.get(r.id);
        const ok = x && x.cont >= norm.hours;
        tbl.append(U.el('tr', {}, U.el('td', {}, r.name), U.el('td', {}, x ? [...new Set(x.windows.map(w => w.dir))].join(', ') : '—'),
          U.el('td', { class: x ? (ok ? 'ok' : 'bad') : '' }, x ? x.cont.toFixed(1) + ' ч' : '—'), U.el('td', {}, x ? x.total.toFixed(1) + ' ч' : '—')));
      }
      roomsSec.append(F.info('Дата', dd.split('-').reverse().join('.')), tbl);
    }
    body.append(roomsSec);
  },
  checksSection() {
    const s = App.doc.settings;
    const ch = App.checks || Checks.run();
    const sec = F.section('Проверка отступов (нормы)');
    const hasPlot = App.doc.areas.some(a => a.kind === 'plot');
    sec.append(F.check('Показывать на плане', s.showChecks, (v) => { s.showChecks = v; App.redraw(); App.saveSoon(); }),
      F.check('Показывать и соблюдённые', s.showChecksOk, (v) => { s.showChecksOk = v; App.redraw(); App.saveSoon(); }));
    if (!ch.results.length) {
      sec.append(F.note(hasPlot ? 'Нет объектов для проверки: дом (стены 1 этажа), постройки, септик, колодец, деревья.' : 'Нарисуйте границу участка — будут проверены отступы от соседей, улицы и проезда.'));
    } else {
      const fails = ch.results.filter(r => !r.ok), ok = ch.results.filter(r => r.ok);
      sec.append(U.el('div', { class: 'check-sum ' + (fails.length ? 'bad' : 'ok') }, fails.length ? `✗ Нарушений: ${fails.length}` : '✓ Все отступы соблюдены', U.el('span', {}, ` · проверено ${ch.results.length}`)));
      const row = (r) => {
        const b = U.el('button', { type: 'button', class: 'check-item ' + (r.ok ? 'ok' : 'bad') },
          U.el('b', {}, `${(r.d / 100).toFixed(1)} м`), U.el('span', {}, `${r.a.name} — ${r.bName}`), U.el('em', {}, `норма ≥ ${(r.rule.min / 100).toFixed(1)} м · ${r.rule.src}`));
        b.onclick = () => { if (Model.get(r.a.id)) { App.sel.clear(); App.sel.add(r.a.id); App.selChanged(); } const p = r.pa || r.pb; if (p) { View.ox = p.x - App.cw / 2 / View.scale; View.oy = p.y - App.ch / 2 / View.scale; App.redraw(); } };
        return b;
      };
      fails.forEach(r => sec.append(row(r)));
      if (ok.length) { const det = U.el('details', {}, U.el('summary', {}, `Соблюдено: ${ok.length}`)); ok.forEach(r => det.append(row(r))); sec.append(det); }
    }
    // нормы
    const over = s.checkRules || (s.checkRules = {});
    const tbl = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, ''), U.el('th', {}, 'Правило'), U.el('th', {}, 'м')));
    for (const r of Checks.rules()) {
      const on = U.el('input', { type: 'checkbox', checked: !r.off });
      on.onchange = () => { (over[r.id] = over[r.id] || {}).off = !on.checked; Model.commit(); };
      const v = U.el('input', { type: 'number', value: r.min / 100, step: 0.5, min: 0 });
      v.onchange = () => { (over[r.id] = over[r.id] || {}).min = U.num(v.value, r.min / 100) * 100; Model.commit(); };
      tbl.append(U.el('tr', { title: r.src }, U.el('td', {}, on), U.el('td', {}, r.name), U.el('td', { class: 'td-num' }, v)));
    }
    sec.append(U.el('details', {}, U.el('summary', {}, 'Нормы (можно изменить под местные ПЗЗ)'), tbl,
      F.btns([['Сбросить к умолчаниям', () => { s.checkRules = {}; Model.commit(); }]]),
      F.note('Тип каждой стороны участка (сосед / улица / проезд) определяется по ближайшей дороге; поменять вручную — в свойствах границы участка. Расстояния — от стен/контура построек, для деревьев — от ствола. Значения справочные, проверьте ПЗЗ вашего поселения.')));
    return sec;
  },
  updateSunInfo(pos) {
    const el = document.getElementById('sunInfo');
    if (!el) return;
    pos = pos || Sun.current();
    const st = Sun.state();
    el.innerHTML = '';
    el.append(U.el('div', {}, U.el('span', {}, U.fmtTime(st.min)), U.el('b', {}, pos.alt > 0 ? `☀ высота ${pos.alt.toFixed(1)}°, азимут ${Math.round(pos.az)}° (${U.compass16(pos.az)})` : 'Солнце за горизонтом')));
    if (pos.alt > 0.5) el.append(U.el('div', { class: 'muted' }, `Тень от 1 м высоты: ${(1 / Math.tan(U.rad(pos.alt))).toFixed(2)} м на ${U.compass8(pos.az + 180)}`));
  },
  hist(rows) {
    return U.el('div', { class: 'hist' }, rows.map(([t, v, c]) => U.el('div', { class: 'hist-row' },
      U.el('span', {}, t), U.el('i', {}, U.el('em', { style: { width: (v * 100).toFixed(1) + '%', background: c } })), U.el('b', {}, Math.round(v * 100) + '%'))));
  },
  togglePlay() {
    if (UI._play) { clearInterval(UI._play); UI._play = 0; UI.refresh(); return; }
    const st = Sun.state(), g = App.doc.geo;
    const info = Sun.dayInfo(st.date, g);
    if (info.rise === null && !info.polarDay) { UI.toast('В этот день солнце не восходит'); return; }
    App.doc.settings.layers.shadows = true;
    const from = info.polarDay ? 0 : Math.ceil(info.rise), to = info.polarDay ? 1439 : Math.floor(info.set);
    if (st.min < from || st.min >= to) st.min = from;
    UI._play = setInterval(() => {
      st.min += 5;
      if (st.min > to) st.min = from;
      const r = document.querySelector('#tab-sun input[type=range][max="1439"]');
      if (r) { r.value = st.min; r.nextElementSibling.textContent = U.fmtTime(st.min); }
      UI.updateSunInfo(); App.redraw();
    }, 60);
    UI.refresh();
  },
  async runHeat() {
    const prog = document.getElementById('heatProg');
    if (prog) prog.hidden = false;
    const r = await Sun.computeHeat((v) => { const p = document.getElementById('heatProg'); if (p) p.value = v; });
    if (r) {
      App.doc.settings.layers.heat = true;
      UI.toast(`Готово: в среднем ${U.fmtHours(r.avg)} прямого солнца`);
      App.redraw();
    }
    UI.refresh();
  },

  /* ------------------------------ площади --------------------------------- */
  renderSummary() {
    const body = $('tab-summary');
    body.textContent = '';
    const s = Rooms.summary();
    const mode = App.doc.settings.areaMode;
    body.append(F.section('Здание',
      F.info('Общая площадь (по полу)', U.fmtArea(s.total)),
      F.info('Жилая площадь', s.living ? U.fmtArea(s.living) : '— отметьте жилые комнаты'),
      F.info('Площадь по осям стен', U.fmtArea(s.axis)),
      F.info('Площадь застройки (по наружным граням)', U.fmtArea(s.footprint)),
      s.perFloor.length > 1 ? s.perFloor.map(x => F.info(`  ${x.floor.name}`, U.fmtArea(x.total))) : null,
      App.doc.roofs.length ? F.info('Площадь кровли', U.fmtArea(App.doc.roofs.reduce((a, r) => a + Roof.params(r).area, 0))) : null,
      F.info('Помещений', String(App.rooms.length)),
      U.el('div', { class: 'seg' },
        U.el('button', { type: 'button', class: mode === 'floor' ? 'on' : '', onclick: () => { App.doc.settings.areaMode = 'floor'; Model.commit(); } }, 'Подписи: по полу'),
        U.el('button', { type: 'button', class: mode === 'axis' ? 'on' : '', onclick: () => { App.doc.settings.areaMode = 'axis'; Model.commit(); } }, 'по осям'))));
    // оценка материалов по стенам
    const mq = Rooms.materials();
    if (mq.rows.length) {
      const t2 = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, 'Материал'), U.el('th', {}, 'Длина, м'), U.el('th', {}, 'Площадь, м²'), U.el('th', {}, 'Объём, м³ / кол-во')));
      for (const m of mq.rows) t2.append(U.el('tr', {}, U.el('td', {}, m.name), U.el('td', {}, (m.len / 100).toFixed(1)), U.el('td', {}, m.fence ? '—' : (m.area / 1e4).toFixed(1)), U.el('td', {}, m.fence ? '—' : (m.vol / 1e6).toFixed(2) + (m.count ? ` · ≈${m.count} ${m.unit}` : ''))));
      const perim = Rooms.outlines.reduce((s2, o) => s2 + G.polyPerimeter(o.outer), 0);
      body.append(F.section('Материалы (оценка)', t2,
        perim ? F.info('Периметр фундамента (по наружным граням)', U.fmtLen(perim)) : null,
        F.info('Окон / дверей', `${App.doc.openings.filter(o => OPENING_TYPES[o.type].cat === 'window').length} / ${App.doc.openings.filter(o => OPENING_TYPES[o.type].cat === 'door').length}`),
        F.note('Площадь и объём — за вычетом проёмов, по осям стен; утеплитель — отдельной строкой. Количество кирпича — ≈394 шт/м³ кладки, блоков — по типовому размеру. Для закупки добавьте запас 5–10%.')));
    }
    // экспликация
    const tbl = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, '№'), U.el('th', {}, 'Помещение'), U.el('th', {}, 'Площадь, м²'), U.el('th', {}, 'Периметр, м')));
    const fd = App.floorData || [];
    let nRooms = 0;
    for (const x of fd) {
      if (!x.rooms.length) continue;
      if (fd.length > 1) tbl.append(U.el('tr', { class: 'floor-row' }, U.el('td', { colspan: 4 }, `${x.floor.name} — ${U.fmtArea(x.rooms.reduce((a, r) => a + r.areaFloor, 0))}`)));
      x.rooms.forEach((r, i) => {
        nRooms++;
        const num = fd.length > 1 ? `${Model.floorIdx(x.floor.id) + 1}.${i + 1}` : String(i + 1);
        const tr = U.el('tr', { class: 'clickable' + (App.sel.has(r.id) && x.floor.id === App.floor ? ' sel' : '') }, U.el('td', {}, num), U.el('td', {}, r.name + (r.tag?.living ? ' ●' : '')), U.el('td', {}, (r.areaFloor / 1e4).toFixed(2)), U.el('td', {}, (r.perimFloor / 100).toFixed(2)));
        tr.onclick = () => { if (x.floor.id !== App.floor) Model.setFloor(x.floor.id); const rr = App.rooms.find(q => q.id === r.id); App.sel.clear(); if (rr) App.sel.add(rr.id); App.selChanged(); UI.showTab('props'); };
        tbl.append(tr);
      });
    }
    body.append(F.section('Экспликация помещений', nRooms ? tbl : F.note('Помещения определяются автоматически по замкнутым контурам стен.'), nRooms ? F.note('● — жилое помещение. Клик по строке — выделить.') : null));
    // участок
    if (s.plotArea || Object.keys(s.zones).length || s.outb.length) {
      const sec = F.section('Участок');
      if (s.plotArea) sec.append(
        F.info('Площадь участка', `${(s.plotArea / 1e6).toFixed(2)} сот. (${(s.plotArea / 1e4).toFixed(1)} м²)`),
        F.info('Застроено (дом + постройки)', `${U.fmtArea(s.built)} · ${(s.built / s.plotArea * 100).toFixed(1)}%`),
        F.info('Свободно', U.fmtArea(Math.max(0, s.free))));
      for (const z of Object.values(s.zones)) sec.append(F.info(`${z.name}${z.count > 1 ? ' (' + z.count + ')' : ''}`, U.fmtArea(z.area)));
      for (const it of s.outb) sec.append(F.info(it.label || catItem(it.key).name, `${U.fmtArea(it.w * it.d)} · ${(it.w / 100).toFixed(1)}×${(it.d / 100).toFixed(1)} м`));
      body.append(sec);
    }
    // сети
    const net = {};
    for (const l of App.doc.lines) { const n = net[l.kind] || (net[l.kind] = { len: 0, count: 0 }); n.len += G.polyPerimeter(l.pts, false); n.count++; }
    if (Object.keys(net).length) {
      const sec = F.section('Инженерные сети');
      for (const [k, v] of Object.entries(net)) sec.append(F.info(`${LINE_KINDS[k].code} ${LINE_KINDS[k].name}`, U.fmtLen(v.len)));
      body.append(sec);
    }
    // спецификация
    const spec = {};
    for (const it of App.doc.items) { const d = catItem(it.key); const k = d.key; spec[k] = spec[k] || { name: d.name, n: 0, cat: d.cat }; spec[k].n++; }
    if (Object.keys(spec).length) {
      const sec = F.section('Оборудование и мебель');
      for (const v of Object.values(spec).sort((a, b) => a.cat.localeCompare(b.cat))) sec.append(F.info(v.name, v.n + ' шт.'));
      body.append(sec);
    }
    body.append(F.btns([['Смета…', () => Estimate.open(), 'primary'], ['Печать с экспликацией…', () => $('dlgPrint').showModal()], ['Копировать как текст', () => IO.copySummary()]]));
  },

  /* ------------------------------- проект --------------------------------- */
  renderProject() {
    const body = $('tab-project');
    body.textContent = '';
    const d = App.doc, s = d.settings;
    body.append(F.section('Проект',
      F.text('Название', d.name, (v) => { d.name = v.trim() || 'Проект'; Model.commit(); }),
      F.select('Единицы подписей', s.units, [['m', 'метры (3.45 м)'], ['cm', 'сантиметры (345 см)'], ['mm', 'миллиметры (3450 мм)']], (v) => { s.units = v; Model.commit(); }),
      F.select('Шаг сетки / привязки', s.grid, [[1, '1 см'], [5, '5 см'], [10, '10 см'], [25, '25 см'], [50, '50 см'], [100, '1 м']], (v) => { s.grid = +v; Model.commit(); }),
      F.check('Привязка к сетке и объектам', s.snap, (v) => { s.snap = v; Model.commit(); }),
      F.num('Поворот сетки', s.gridAngle || 0, (v) => App.setGrid(v), { unit: '°', step: 0.5, field: 'gridAngle' }),
      F.btns([['Сетку — по выделенному', () => App.gridToSel(), '', 'Сетка, привязка и прямоугольники комнат пойдут вдоль выделенной стены, края зоны или предмета'], ['Прямо', () => App.setGrid(0, { x: 0, y: 0 }), '', 'Вернуть сетку по осям экрана']]),
      F.note('Сетка задаёт направления: «ортогонально», прямоугольные комнаты, зоны и крыши строятся вдоль её осей. При повороте всего плана сетка поворачивается вместе с ним.'),
      F.select('Тема', Theme.mode, [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']], (v) => Theme.set(v))));
    const tbl = U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, 'Тип стены'), U.el('th', {}, 'Материал'), U.el('th', {}, 'Толщ., см'), U.el('th', {}, 'Выс., см')));
    for (const [k, v] of Object.entries(WALL_KINDS)) {
      const dd = d.defaults.wall[k];
      const th = U.el('input', { type: 'number', value: dd.th, min: 1, step: 1 }), hh = U.el('input', { type: 'number', value: dd.h, min: 0, step: 1 });
      const live = () => s.wallDefaultsLive !== false;
      th.onchange = () => App.setWallDefault(k, 'th', U.clamp(U.num(th.value, dd.th), 1, 200), live());
      hh.onchange = () => App.setWallDefault(k, 'h', U.clamp(U.num(hh.value, dd.h), 0, 3000), live());
      const ms = F.select(null, dd.mat, Object.entries(materialsFor(k)).map(([mk, mv]) => [mk, mv.name]), (val) => App.setWallDefault(k, 'mat', val, live()));
      tbl.append(U.el('tr', {}, U.el('td', {}, v.name), U.el('td', { class: 'td-sel' }, ms), U.el('td', {}, th), U.el('td', {}, hh)));
    }
    body.append(UI.floorsSection());
    body.append(F.section('Стены по типам', tbl,
      F.check('Применять к уже нарисованным стенам', s.wallDefaultsLive !== false, (v) => { s.wallDefaultsLive = v; App.saveSoon(); }),
      F.btns([['Применить сейчас ко всем стенам', () => { for (const w of d.walls) { const dd = d.defaults.wall[w.kind]; w.th = dd.th + (w.ins || 0); w.h = dd.h; w.mat = dd.mat; } Model.commit(); UI.toast('Материал, толщина и высота стен обновлены (Ctrl+Z — отменить)'); }]]),
      F.note('Толщина — без утеплителя: он добавляется снаружи и задаётся у самой стены. Если галочка снята, таблица задаёт только параметры новых стен. При смене материала толщина встаёт на ближайшую типовую. Типичные толщины: газобетон 30–40, кирпич 38–51, каркас 20–25, перегородки 8–12 см.')));
    body.append(F.section('Файл',
      F.btns([['Сохранить .json', () => IO.saveJSON(), 'primary'], ['Открыть…', () => $('fileJson').click()]]),
      F.btns([['Печать / PDF…', () => $('dlgPrint').showModal()], ['PNG…', () => $('dlgPrint').showModal()]]),
      F.note('План автоматически сохраняется в браузере. Для переноса на другой компьютер — «Сохранить .json».' + (App.autosaveNote ? '<br>' + App.autosaveNote : '')),
      F.btns([['Очистить план', () => { if (confirm('Удалить все объекты? Действие можно отменить (Ctrl+Z).')) App.clearAll(); }, 'danger']])));
  },

  /* --------------------------- контекстное меню --------------------------- */
  contextMenu(sp, p, id) {
    const m = $('ctxmenu');
    m.textContent = '';
    const add = (t, fn, cls) => m.append(U.el('button', { role: 'menuitem', class: cls || '', type: 'button', onclick: () => { UI.hideMenu(); fn(); } }, t));
    const c = Model.coll(id);
    if (id && Model.get(id)) {
      if (c === 'walls') {
        const w = Model.get(id);
        add('Разделить стену здесь', () => { const t = U.clamp(G.proj(p, w.a, w.b).t, 0.05, 0.95); Model.splitWall(w, t); Model.commit(); });
        add('Вставить дверь', () => Tools.set('door'));
        add('Вставить окно', () => Tools.set('window'));
      }
      if (c === 'lines' || c === 'areas') add('Добавить/удалить точку', () => Tools.editVertex(Model.get(id), p, c === 'areas'));
      if (c === 'openings') { const op = Model.get(id); add('Петли на другую сторону', () => { op.hinge = op.hinge ? 0 : 1; Model.commit(); }); add('Открывание внутрь/наружу', () => { op.side = -(op.side || 1); Model.commit(); }); }
      if (c !== 'openings') { add('Повернуть на 90° ⟳', () => App.rotateSel(90)); add('Повернуть на 90° ⟲', () => App.rotateSel(-90)); add('Отразить ↔', () => App.mirrorSel('x')); }
      if (['walls', 'areas', 'roads', 'lines', 'items', 'roofs'].includes(c)) add('Сетку — по этому объекту', () => App.gridToSel(id));
      if (App.selIds().length > 1 && !App.selGroup()) add('Сгруппировать (Ctrl+G)', () => App.group());
      if (App.selIds().some(x => Model.get(x).grp)) add('Разгруппировать (Ctrl+Shift+G)', () => App.ungroup());
      add('Дублировать', () => App.duplicate());
      add('Копировать', () => App.copy());
      add('Удалить', () => App.deleteSel(), 'danger');
    } else if (Tools.isRoom(id)) {
      add('Переименовать', () => UI.focusField('roomName'));
    }
    if (App.clipLoad()) add(`Вставить (${App.clipboard.n || 'скопированное'})`, () => App.paste(p));
    add('Показать всё', () => View.fit(Model.contentBBox()));
    m.hidden = false;
    const r = App.canvas.getBoundingClientRect();
    const x = Math.min(r.left + sp.x, window.innerWidth - m.offsetWidth - 8), y = Math.min(r.top + sp.y, window.innerHeight - m.offsetHeight - 8);
    m.style.left = x + 'px'; m.style.top = y + 'px';
  },
  hideMenu() { $('ctxmenu').hidden = true; },
};
