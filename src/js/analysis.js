'use strict';
/* ==========================================================================
   «Анализ проекта»: общая статистика (площади, помещения, постройки, сети,
   смета) и все замечания по нормам в одном отчёте. Нормы — справочные,
   значения отступов можно поменять на вкладке «Участок».
   ========================================================================== */

const Analysis = {
  /** Собрать отчёт: { stats: [{ title, rows: [[имя, значение]] }], rooms: [...], issues: [{ sev, group, text, src, at, id }] } */
  run() {
    const d = App.doc, s = Rooms.summary(), ch = Checks.run(), issues = [];
    const m2 = (v) => U.fmtArea(v), m = (v) => (v / 100).toFixed(2).replace(/\.?0+$/, '') + ' м';
    const add = (sev, group, text, src, at, id) => issues.push({ sev, group, text, src: src || '', at: at || null, id: id || null });
    const fd = App.floorData || [];

    // ---------------- статистика ----------------
    const stats = [];
    const plots = d.areas.filter(a => a.kind === 'plot');
    if (plots.length) {
      const per = plots.reduce((a, p) => a + G.polyPerimeter(p.pts, true), 0);
      stats.push({ title: 'Участок', rows: [
        ['Площадь', `${(s.plotArea / 1e6).toFixed(2)} сот. (${m2(s.plotArea)})`],
        ['Периметр (длина забора)', m(per)],
        ['Застройка (дом + постройки под крышей)', `${m2(s.built)} — ${(s.built / s.plotArea * 100).toFixed(1)}% участка`],
        ['Свободная площадь', m2(s.free)],
        // покрытия и дорожки участка (улицы и тротуары за забором — не участок)
        ...Object.entries(s.zones).filter(([k]) => k !== 'road:street' && k !== 'road:sidewalk').map(([, z]) => [z.name, `${m2(z.area)}${z.count > 1 ? ` (${z.count})` : ''}`]),
      ] });
    }
    const ext = d.walls.filter(w => w.kind === 'ext'), int = d.walls.filter(w => w.kind === 'int' || w.kind === 'part');
    const len = (ws) => ws.reduce((a, w) => a + Model.wallLen(w), 0);
    const wallArea = ext.reduce((a, w) => a + Model.wallLen(w) * w.h, 0);
    const ops = d.openings.map(o => OPENING_TYPES[o.type]).filter(Boolean);
    const winArea = d.openings.filter(o => (OPENING_TYPES[o.type] || {}).cat === 'window').reduce((a, o) => a + o.w * o.h, 0);
    if (ext.length || s.total) {
      const roofArea = d.roofs.reduce((a, r) => a + Roof.params(r).area, 0);
      stats.push({ title: 'Дом', rows: [
        ['Этажей', String(d.floors.length)],
        ['Площадь застройки (по наружным стенам)', m2(s.footprint)],
        ['Общая площадь помещений', m2(s.total)],
        ['Жилая площадь', m2(s.living)],
        ...(s.perFloor.length > 1 ? s.perFloor.map(f => [`— ${f.floor.name}`, `${m2(f.total)}, помещений ${f.rooms}`]) : []),
        ['Помещений', String(fd.reduce((a, f) => a + f.rooms.length, 0))],
        ['Наружные стены', `${m(len(ext))}, площадь ${m2(wallArea)} (без проёмов ${m2(Math.max(0, wallArea - winArea))})`],
        ['Внутренние стены и перегородки', m(len(int))],
        ['Окна / двери', `${ops.filter(t => t.cat === 'window').length} / ${ops.filter(t => t.cat === 'door').length}, остекление ${m2(winArea)}`],
        roofArea ? ['Кровля', m2(roofArea)] : null,
      ].filter(Boolean) });
    }
    const outb = s.outb;
    if (outb.length) stats.push({ title: 'Постройки на участке', rows: [
      ...outb.map(it => [it.label || catItem(it.key).name, BLD_HOLLOW.has(catItem(it.key).shape) ? `внутри ${m2(bldInnerArea(it))}, застройка ${m2(it.w * it.d)}` : `${m2(it.w * it.d)}`]),
      s.outbInner ? ['Хозпостройки: площадь внутри', m2(s.outbInner)] : null,
    ].filter(Boolean) });
    const nets = {};
    for (const l of d.lines) nets[l.kind] = (nets[l.kind] || 0) + G.polyPerimeter(l.pts, false);
    if (Object.keys(nets).length) stats.push({ title: 'Инженерные сети', rows: Object.entries(nets).map(([k, v]) => [`${LINE_KINDS[k].code} ${LINE_KINDS[k].name}`, m(v)]) });
    const blind = Model.blindAreas();
    if (blind.length) stats.push({ title: 'Отмостка', rows: blind.map(b => [b.name, `${m(b.w)} шириной, ${m2(b.area)}`]) });
    const est = Estimate.totals(Estimate.rows());
    if (est.total) stats.push({ title: 'Смета (ориентировочно)', rows: [['Итого с резервом ' + est.pct + '%', Estimate.money(est.total)]] });

    // ---------------- помещения ----------------
    const rooms = [];
    for (const f of fd) Drawing.onFloor(f.floor.id, () => {
      for (const r of f.rooms) {
        const nm = (r.name || '').toLowerCase();
        const ws = Rooms.windowsOf(r), glass = ws.reduce((a, w) => a + w.op.w * w.op.h, 0);
        const living = !!(r.tag && r.tag.living) || /спальн|гостин|детск|кабинет|комнат/.test(nm);
        const kitchen = /кухн/.test(nm);
        const at = G.polyCentroid(r.floor || r.axis);
        rooms.push({ name: r.name, floor: f.floor.name, area: r.areaFloor, windows: ws.length, ratio: glass ? r.areaFloor / glass : Infinity, living, kitchen });
        // освещённость: площадь окон к площади пола жилых комнат и кухни — не менее 1:8
        if ((living || kitchen) && !ws.length) add('bad', 'Освещённость', `${r.name}: нет окон — жилой комнате и кухне нужно естественное освещение`, 'СП 55.13330, СанПиН 1.2.3685-21', at);
        else if ((living || kitchen) && r.areaFloor / glass > 8.05) add('bad', 'Освещённость', `${r.name}: окна 1:${(r.areaFloor / glass).toFixed(1)} к площади пола (норма не меньше 1:8 — нужно ещё ≈ ${m2(r.areaFloor / 8 - glass)} остекления)`, 'СП 55.13330.2016', at);
        // минимальные площади
        const minA = /спальн|детск/.test(nm) ? [80000, 'спальни — 8 м²'] : /гостин|общ.*комнат/.test(nm) ? [120000, 'общей комнаты — 12 м²'] : kitchen && !/гостин/.test(nm) ? [60000, 'кухни — 6 м²'] : null;
        if (minA && r.areaFloor < minA[0] - 50) add('bad', 'Помещения', `${r.name}: ${m2(r.areaFloor)} — меньше минимума (${minA[1]})`, 'СП 55.13330.2016 п. 5.7', at);
        // газовый котёл: остекление 0,03 м² на 1 м³ объёма помещения
        const gas = d.items.some(it => (it.floor || d.floors[0].id) === f.floor.id && /gasBoiler/.test(it.key) && G.pointInPoly(it, r.axis));
        if (gas) {
          const vol = r.areaFloor * (f.floor.h || 270) / 1e6, need = 0.03 * vol;
          if (glass / 1e4 < need - 0.005) add('bad', 'Газ', `${r.name}: газовый котёл, остекление ${(glass / 1e4).toFixed(2)} м² — нужно не меньше ${need.toFixed(2)} м² (0,03 м² на 1 м³, объём ${vol.toFixed(1)} м³)`, 'СП 62.13330', at);
        }
      }
    });
    // высота этажей
    for (const f of d.floors) {
      const hs = d.walls.filter(w => w.floor === f.id && w.kind !== 'fence').map(w => w.h);
      if (hs.length && Math.max(...hs) < 250) add('bad', 'Помещения', `${f.name}: высота стен ${m(Math.max(...hs))} — жилым помещениям нужно не меньше 2,5 м`, 'СП 55.13330.2016 п. 6.2');
    }

    // ---------------- нормы отступов и сети ----------------
    for (const r of ch.results.filter(x => !x.ok)) add('bad', 'Отступы', `${r.a.name} — ${r.bName}: ${m(r.d)} (норма ≥ ${m(r.rule.min)})`, r.rule.src, r.pa || r.pb, Model.get(r.a.id) ? r.a.id : null);
    for (const n of (ch.nets || []).filter(x => x.ok === false)) add('bad', 'Сети', `${n.title}: ${n.text}`, n.src, n.at, n.line.id);
    if (!plots.length && (ext.length || d.items.length)) add('warn', 'Отступы', 'Нет границы участка — отступы от соседей и улицы не проверяются (инструмент «Зона → Граница участка»)');

    // ---------------- отмостка ----------------
    if (ext.length && !blind.some(b => b.id.startsWith('house'))) add('warn', 'Отмостка', 'У дома нет отмостки: нужна шириной 0,8–1 м и на 20 см шире свеса крыши (вкладка «Проект»)', 'СП 82.13330');
    for (const b of blind) if (b.over && b.w < b.over + 20) add('bad', 'Отмостка', `${b.name}: отмостка ${m(b.w)} при свесе крыши ${m(b.over)} — должна быть шире свеса на 20 см`, 'СП 82.13330', b.outer[0]);

    // ---------------- постройки ----------------
    for (const it of d.items) {
      if (!BLD_HOLLOW.has(catItem(it.key).shape)) continue;
      const name = it.label || catItem(it.key).name;
      if (!bldOps(it).some(o => (OPENING_TYPES[o.type] || {}).cat === 'door')) add('warn', 'Постройки', `${name}: нет ни двери, ни ворот`, '', it, it.id);
    }

    // ---------------- аккуратность чертежа ----------------
    const W = d.walls.filter(w => w.kind !== 'fence');
    for (const w of W) {
      const a = Math.abs(U.deg(G.angle(w.a, w.b))) % 90, dev = Math.min(a, 90 - a);
      if (dev > 0.005 && dev < 1) add('info', 'Чертёж', `Стена почти по оси, но с перекосом ${dev.toFixed(2)}° (${(Model.wallLen(w) * Math.sin(U.rad(dev))).toFixed(1)} см на длину) — выровняйте`, '', G.mid(w.a, w.b), w.id);
    }
    const seen = [];
    for (const w of W) for (const e of ['a', 'b']) for (const o of W) if (o !== w) for (const f of ['a', 'b']) {
      const g = G.dist(w[e], o[f]);
      if (g > 0.05 && g < 5 && !seen.some(q => G.dist(q, w[e]) < 6)) { seen.push(w[e], o[f]); add('info', 'Чертёж', `Концы стен почти сходятся, но не совпадают (зазор ${g.toFixed(1)} см)`, '', w[e], w.id); }
    }
    for (const t of d.roomTags) if (!fd.some(f => f.rooms.some(r => r.tag === t))) add('info', 'Чертёж', `Подпись «${t.name}» не относится ни к одному помещению (лишняя или внутри другого)`, '', t, t.id);
    if (plots.length > 1) add('warn', 'Чертёж', `Границ участка ${plots.length} — площадь участка считается суммой. Если это не участок (например, заезд) — смените вид зоны`, '', plots[1].pts[0], plots[1].id);
    const skew = d.items.filter(it => { const r = ((it.rot || 0) % 90 + 90) % 90; return Math.min(r, 90 - r) > 0.01 && Math.min(r, 90 - r) < 0.5; });
    if (skew.length) add('info', 'Чертёж', `Предметов, повёрнутых чуть мимо прямого угла (например, 89,97°): ${skew.length}`, '', skew[0], skew[0].id);

    const order = { bad: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.sev] - order[b.sev]);
    return { stats, rooms, issues };
  },

  open() { Analysis.render(); $('dlgAnalysis').showModal(); },
  render() {
    const R = Analysis.run(), box = $('anBody');
    box.textContent = '';
    const bad = R.issues.filter(i => i.sev === 'bad').length, warn = R.issues.filter(i => i.sev === 'warn').length, info = R.issues.filter(i => i.sev === 'info').length;
    box.append(U.el('div', { class: 'check-sum ' + (bad ? 'bad' : 'ok') },
      bad ? `✗ Нарушений норм: ${bad}` : '✓ Нарушений норм не найдено',
      U.el('span', {}, ` · замечаний ${warn} · по чертежу ${info}`)));
    // статистика
    const grid = U.el('div', { class: 'an-stats' });
    for (const s of R.stats) grid.append(U.el('div', { class: 'an-card' }, U.el('h4', {}, s.title), U.el('table', { class: 'tbl' }, s.rows.map(([k, v]) => U.el('tr', {}, U.el('td', {}, k), U.el('td', { class: 'num' }, v))))));
    box.append(grid);
    if (R.rooms.length) {
      const multi = new Set(R.rooms.map(r => r.floor)).size > 1;
      box.append(U.el('div', { class: 'an-card' }, U.el('h4', {}, 'Помещения'),
        U.el('table', { class: 'tbl' }, U.el('tr', {}, U.el('th', {}, 'Помещение'), U.el('th', {}, 'Площадь'), U.el('th', {}, 'Окон'), U.el('th', {}, 'Окна : пол')),
          R.rooms.map(r => U.el('tr', {}, U.el('td', {}, (multi ? r.floor + ': ' : '') + r.name + (r.living ? ' (жилая)' : '')), U.el('td', { class: 'num' }, U.fmtArea(r.area)), U.el('td', { class: 'num' }, String(r.windows)),
            U.el('td', { class: 'num ' + ((r.living || r.kitchen) && r.ratio > 8.05 ? 'bad' : '') }, r.windows ? '1:' + r.ratio.toFixed(1) : '—'))))));
    }
    // замечания
    const sevName = { bad: 'Нарушение', warn: 'Замечание', info: 'Чертёж' };
    if (R.issues.length) {
      const list = U.el('div', { class: 'an-issues' });
      let group = null;
      for (const i of R.issues) {
        const g = `${sevName[i.sev]} · ${i.group}`;
        if (g !== group) { group = g; list.append(U.el('h4', {}, g)); }
        const b = U.el('button', { type: 'button', class: 'check-item an-' + i.sev + (i.sev === 'bad' ? ' bad' : '') }, U.el('span', {}, i.text), i.src ? U.el('em', {}, i.src) : null);
        b.onclick = () => Analysis.show(i);
        list.append(b);
      }
      box.append(U.el('h3', { class: 'an-h' }, 'Нарушения и замечания'), list);
    }
    box.append(U.el('p', { class: 'note' }, 'Нормы справочные (СП 53, СП 55, СП 30, СП 62, СП 82, ПУЭ); значения отступов меняются на вкладке «Участок» → «Нормы». Проверьте требования ПЗЗ вашего поселения. Клик по замечанию — показать место на плане.'));
    Analysis._last = R;
  },
  /** Показать место замечания на плане */
  show(i) {
    $('dlgAnalysis').close();
    if (i.id && Model.get(i.id)) { App.sel.clear(); App.sel.add(i.id); App.selChanged(); }
    if (i.at) { View.ox = i.at.x - App.cw / 2 / View.scale; View.oy = i.at.y - App.ch / 2 / View.scale; }
    App.redraw();
  },
  /** Отчёт текстом — для копирования в мессенджер или письмо */
  text() {
    const R = Analysis._last || Analysis.run(), L = [`Анализ проекта «${App.doc.name || ''}» — ${new Date().toLocaleDateString('ru-RU')}`, ''];
    for (const s of R.stats) { L.push(s.title.toUpperCase()); for (const [k, v] of s.rows) L.push(`  ${k}: ${v}`); L.push(''); }
    if (R.rooms.length) { L.push('ПОМЕЩЕНИЯ'); for (const r of R.rooms) L.push(`  ${r.name}: ${U.fmtArea(r.area)}${r.windows ? `, окна 1:${r.ratio.toFixed(1)}` : ''}`); L.push(''); }
    L.push('ЗАМЕЧАНИЯ');
    if (!R.issues.length) L.push('  нет');
    for (const i of R.issues) L.push(`  [${{ bad: 'нарушение', warn: 'замечание', info: 'чертёж' }[i.sev]}] ${i.text}${i.src ? ` (${i.src})` : ''}`);
    return L.join('\n');
  },
  copy() {
    const t = Analysis.text();
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => UI.toast('Отчёт скопирован'), () => { U.download(IO.fileName('txt').replace('.txt', '-анализ.txt'), t, 'text/plain'); });
  },
  print() {
    Analysis.render();
    const area = $('printArea');
    area.textContent = '';
    const body = $('anBody').cloneNode(true);
    body.querySelectorAll('button').forEach(b => { const d2 = document.createElement('div'); d2.className = b.className; d2.append(...b.childNodes); b.replaceWith(d2); });
    area.append(U.el('style', {}, '@page { size: 210mm 297mm; margin: 0; }'),
      U.el('div', { class: 'sheet report an-print', style: { width: '210mm', minHeight: '297mm', padding: '12mm' } },
        U.el('div', { class: 'sheet-head' }, U.el('b', {}, 'Анализ проекта: ' + (App.doc.name || '')), U.el('span', {}, new Date().toLocaleDateString('ru-RU'))), body));
    document.body.classList.add('printing');
    $('dlgAnalysis').close();
    const done = () => { document.body.classList.remove('printing'); area.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  },
};
