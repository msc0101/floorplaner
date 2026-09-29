'use strict';
/* ==========================================================================
   «Анализ проекта»: общая статистика (площади, помещения, постройки, сети,
   смета) и все замечания по нормам в одном отчёте. Нормы — справочные,
   значения отступов можно поменять на вкладке «Участок».
   ========================================================================== */

const Analysis = {
  /** Собрать отчёт: { stats: [{ title, rows: [[имя, значение]] }], rooms: [...], issues: [{ sev, group, text, src, at, id }] } */
  /** Результат на текущую ревизию проекта (App.rev растёт при каждом изменении) — чтобы не считать по нескольку раз */
  run() {
    if (Analysis._cache && Analysis._cache.rev === App.rev && Analysis._cache.doc === App.doc) return Analysis._cache.r;
    const r = Analysis._run();
    Analysis._cache = { rev: App.rev, doc: App.doc, r };
    return r;
  },
  _run() {
    const d = App.doc, s = Rooms.summary(), ch = Checks.run(), issues = [];
    const m2 = (v) => U.fmtArea(v), m = (v) => (v / 100).toFixed(2).replace(/\.?0+$/, '') + ' м';
    // fix — автоисправление (кнопка «Исправить» в анализе)
    const add = (sev, group, text, src, at, id, fix) => issues.push({ sev, group, text, src: src || '', at: at || null, id: id || null, fix: fix || null });
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

    // ---------------- конструкции: уклон кровли, простенки у углов, пролёты, снегозадержание, фундамент ----------------
    Analysis.structure(d, fd, add, m);
    Struct.issues(add, m);
    for (const F of Struct.all()) { const at = stats.findIndex(x => /Смета/.test(x.title));
      stats.splice(at < 0 ? stats.length : at, 0, { title: F.house ? 'Фундамент дома (авторасчёт)' : `Фундамент: ${F.name.toLowerCase()} (авторасчёт)`, rows: [['Тип', FOUND_TYPES[F.type]], ['Грунт / вода', `${Struct.soilText()} / УГВ ${m(F.gwl)}`], ['Промерзание', `${m(F.dfn * 100)} × ${String(F.kh).replace('.', ',')} = ${m(F.df * 100)} (${F.khWhy})`], ['Глубина / ширина', F.type === 'pile' ? `сваи ${F.piles} шт.` : `${m(F.depth * 100)} / ${m(F.width * 100)}`], ['Нагрузка / давление', `${F.qn.toFixed(0)} кН/м / ${F.p.toFixed(0)} из ${F.R.toFixed(0)} кПа`], ['Бетон B20 / арматура', `${F.concrete.toFixed(1)} м³ / ${F.rebar.toFixed(0)} кг`]] }); }

    // ---------------- вентиляция, дымоходы, печи ----------------
    Analysis.vent(d, fd, add, stats, m);

    // ---------------- климат: откуда берутся нагрузки и глубины ----------------
    { const cl = Climate.get(), at = stats.findIndex(x => /Смета/.test(x.title));
      stats.splice(at < 0 ? stats.length : at, 0, { title: 'Климат (' + cl.city + ')', rows: [['Климатический подрайон', cl.zone], ['Снеговой район / Sg', `${Climate.roman(cl.snow)} / ${cl.snowKpa.toFixed(1)} кПа`], ['Ветровой район / w0', `${Climate.roman(cl.wind, true)} / ${cl.windKpa.toFixed(2)} кПа`], ['Расчётная зимняя t', cl.t5 + ' °C'], ['Глубина промерзания', m(Climate.frost())]] }); }

    // ---------------- подключения: приборам — их трассы, концы трасс — не в воздухе ----------------
    Analysis.links(d, add);

    // ---------------- скважина / колодец у границы с соседом: его септик может оказаться рядом ----------------
    Analysis.wellsBound(d, add, m);

    // ---------------- электрика: группы щита, автомат против сечения, УЗО на розетках ----------------
    Analysis.electric(d, add, stats);

    // ---------------- освещение помещений и гаража (СП 52.13330) ----------------
    Analysis.lighting(d, fd, add, stats);

    // ---------------- видеонаблюдение: охват периметра участка ----------------
    const cov = Analysis.cctv(d, fd);
    if (cov) {
      const at = stats.findIndex(x => /Смета/.test(x.title));
      stats.splice(at < 0 ? stats.length : at, 0, { title: 'Видеонаблюдение', rows: [['Камер', String(cov.cams)], ['Подходы к дому и гаражу в обзоре', `${cov.pctHouse.toFixed(0)}%`], ['Въезды и калитки в обзоре', `${cov.doors - cov.blind.length} из ${cov.doors}`], ['Периметр участка (справочно)', `${cov.pct.toFixed(0)}%`]] });
      for (const g of cov.hGaps.slice(0, 4)) add('warn', 'Видеонаблюдение', `подход к стене ${m(g.len)} не попадает ни в одну камеру — поверните камеру на углу или добавьте`, 'Камеры на углах дома и гаража под свесом: каждая стена и вход — в обзоре соседней камеры', g.at);
      for (const x of cov.blind) add('warn', 'Видеонаблюдение', `${x.it.label || catItem(x.it.key).name}: въезд не в обзоре камер`, 'ГОСТ Р 51558-2014: зона входа — с различением лица', x.p, x.it.id);
    }

    // ---------------- нормы отступов и сети ----------------
    for (const r of ch.results.filter(x => !x.ok)) add('bad', 'Отступы', `${r.a.name} — ${r.bName}: ${m(r.d)} (норма ≥ ${m(r.rule.min)})`, r.rule.src, r.pa || r.pb, Model.get(r.a.id) ? r.a.id : null);
    for (const n of (ch.nets || []).filter(x => x.ok === false)) {
      // водопровод мельче промерзания — опустить на промерзание + 0,5 м (все части трассы)
      const fix = (n.kind === 'water' || n.kind === 'hotwater') && /глубина/.test(n.text) && !n.line.heated ? () => { for (const p of n.line.parts || [n.line]) { const o = Model.get(p.id); if (o) o.depth = Math.ceil((Climate.frost() + 50) / 10) * 10; } }
        : n.kind === 'sewer' && /глубина/.test(n.text) && !n.line.heated ? () => { for (const p of n.line.parts || [n.line]) { const o = Model.get(p.id); if (o) o.heated = true; } } : null;
      add('bad', 'Сети', `${n.title}: ${n.text}`, n.src, n.at, n.line.id, fix);
    }
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

    // ---------------- ворота: зона отката откатных ворот свободна и в пределах участка ----------------
    for (const it of d.items) {
      if (catItem(it.key).shape !== 'gateSlide') continue;
      const z = gateZone(it, it.w), W2 = (x, y) => G.toWorld({ x: it.flip ? -x : x, y }, it.x, it.y, it.rot || 0);
      const zone = [W2(Math.min(z.x0, z.x1), -30), W2(Math.max(z.x0, z.x1), -30), W2(Math.max(z.x0, z.x1), 30), W2(Math.min(z.x0, z.x1), 30)];
      const hit = d.items.find(o => o !== it && o.h > 20 && !catItem(o.key).sym && (it.floor || '') === (o.floor || '') && (Model.itemPts(o).some(q => G.pointInPoly(q, zone)) || zone.some(q => G.pointInPoly(q, Model.itemPts(o)))));
      const end = [W2(z.x1, 40), W2(z.x1, -40)];
      const outside = plots.length && !end.some(q => plots.some(pl => G.pointInPoly(q, pl.pts)));
      const name = it.label || catItem(it.key).name;
      if (hit) add('bad', 'Ворота', `${name}: в зоне отката (${m(z.len)} вдоль забора) стоит «${hit.label || catItem(hit.key).name}» — полотно не откроется`, 'нужно ≈ 1,5 ширины проёма свободного забора', G.mid(zone[0], zone[2]), it.id);
      else if (outside) add('bad', 'Ворота', `${name}: зона отката (${m(z.len)}) выходит за угол участка — смените сторону отката или поставьте распашные ворота`, 'нужно ≈ 1,5 ширины проёма свободного забора', G.mid(zone[0], zone[2]), it.id);
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

    const order = { bad: 0, warn: 1, info: 2, note: 3 };
    issues.sort((a, b) => order[a.sev] - order[b.sev]);
    return { stats, rooms, issues };
  },
  /** Вентиляция по помещениям (СП 54.13330 табл. 9.1, СП 55.13330, СП 60.13330), трубы над крышей и печи (СП 7.13130) */
  /** Автопроверка после каждого изменения: новое нарушение — всплывающее уведомление; число нарушений — на кнопке «Анализ».
   *  Ключ замечания — без чисел, чтобы при перетаскивании одного и того же объекта не сыпались повторы */
  _prev: null,
  live: U.debounce(() => {
    let iss;
    try { iss = Analysis.run().issues; } catch { return; }
    const key = (x) => x.group + '|' + (x.id || '') + '|' + x.text.replace(/[\d.,]+/g, '#');
    const prev = Analysis._prev, now = new Set(iss.map(key));
    if (prev && App.doc.settings.liveChecks !== false) iss.filter(x => !prev.has(key(x)) && (x.sev === 'bad' || x.sev === 'warn')).slice(0, 2).forEach(x => UI.warnToast(x));
    Analysis._prev = now;
    UI.setAnalyzeBadge(iss.filter(x => x.sev === 'bad').length);
  }, 700),
  /** Проверки конструктора */
  structure(d, fd, add, m) {
    const f1 = d.floors[0].id;
    // уклон кровли не меньше допустимого для материала — у дома и у построек (с учётом примыкания к дому)
    // подходящая кровля для уклона: из привычных — первая, что допускает такой уклон
    const fitMat = (pitch) => ['metaltile', 'soft', 'profile', 'seam', 'membrane'].find(k => (ROOF_MATERIALS[k].min || 0) <= pitch);
    const chk = (name, mat, pitch, at, id, setMat) => {
      const M = ROOF_MATERIALS[mat];
      if (M && M.min && pitch < M.min - 0.5) add('bad', 'Кровля', `${name}: уклон ${pitch.toFixed(1)}° меньше допустимого для «${M.name.toLowerCase()}» (от ${M.min}°) — будет протекать. Смените кровлю (при малом уклоне — мембрана или наплавляемая по сплошному настилу, фальц — от 7°) или увеличьте уклон`, 'СП 17.13330.2017 табл. 4.1', at, id, () => setMat(fitMat(pitch)));
    };
    for (const r of d.roofs) if (r.type !== 'flat') chk('Крыша дома', r.mat, r.pitch || 0, r, r.id, (k) => { r.mat = k; });
    for (const it of d.items) {
      const sh = catItem(it.key).shape;
      if (!BLD_ROOF_SHAPES.has(sh) || (it.floor || f1) !== f1) continue;
      const R = bldRoof(it);
      if (R.type === 'none' || R.type === 'flat' || R.type === 'arch') continue;
      const hollow = BLD_HOLLOW.has(sh), g0 = View3D.roofGeom(it, it.h || 250, R.open ? 180 : 150, hollow ? bldWallH(it) : undefined);
      const g = View3D.leanJoin(it, g0, { world: (q) => G.toWorld(q, it.x, it.y, it.rot || 0), eave: g0.eave }) || g0;
      chk(it.label || catItem(it.key).name, g.R.mat, g.pitch, it, it.id, (k) => { it.roofMat = k; });
    }
    // простенок у угла: перемычке нужно опирание ≥ 25 см с каждой стороны
    for (const o of d.openings) {
      const w = d.walls.find(x => x.id === o.wall);
      if (!w || w.kind !== 'ext') continue;
      const L = Model.wallLen(w);
      for (const [end, dist] of [[w.a, o.pos - o.w / 2], [w.b, L - o.pos - o.w / 2]]) {
        const uw = G.unit(G.sub(w.b, w.a)), other = d.walls.find(x => x !== w && x.kind !== 'fence' && (x.floor || f1) === (w.floor || f1) && (G.dist(x.a, end) < 2 || G.dist(x.b, end) < 2) && Math.abs(G.dot(uw, G.unit(G.sub(x.b, x.a)))) < 0.9);   // соосное продолжение — не угол
        if (!other) continue;
        // облицовка соседней стены — не кладка: если она обращена к проёму (внутренний угол у крыльца), простенок — до несущего слоя
        const dir = end === w.a ? uw : G.mul(uw, -1), fdo = fd.find(x => x.floor.id === (w.floor || f1));
        let no = G.perp(G.unit(G.sub(other.b, other.a)));
        if (fdo && fdo.outlines.some(ol => G.pointInPoly(G.add(G.mid(other.a, other.b), G.mul(no, other.th / 2 + 10)), ol.outer))) no = G.mul(no, -1);
        const clear = dist - other.th / 2 + (G.dot(dir, no) > 0.5 ? wallClad(other) : 0);
        if (clear < 30 && clear > -1) add('warn', 'Конструкции', `${OPENING_TYPES[o.type].name}: простенок до угла ${m(Math.max(0, clear))} — перемычке нужно опирание не меньше 25 см, а угол кладки ослаблен. Сдвиньте проём от угла`, 'СП 15.13330.2020 п. 9.33; СП 339.13330 (перемычки)', G.add(end, G.mul(G.unit(G.sub(end === w.a ? w.b : w.a, end)), Math.max(dist, 20))), o.id);
      }
    }
    // пролёт перекрытия: по коротким сторонам помещений (деревянные балки — до 6 м без промежуточной опоры)
    for (const f of fd) for (const r of f.rooms) {
      const q = r.floor || r.axis;
      if (!q || q.length > 6) continue;
      const bb = G.bbox(q), span = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0);
      if (span > 600) add('warn', 'Конструкции', `${r.name}: пролёт перекрытия ${m(span)} — деревянным балкам нужно сечение ≥ 75×250 мм с шагом 60 см или промежуточная опора (ригель, стена); плиты — по расчёту`, 'СП 64.13330.2017 (деревянные конструкции); СП 20.13330 (нагрузки)', G.polyCentroid(q));
    }
    // снегозадержатели: скатная кровля с наружным водостоком над входами и дорожками
    for (const r of d.roofs) if (r.type !== 'flat' && (r.pitch || 0) >= 5 && !r.snowGuard) add('warn', 'Кровля', 'Крыша дома: нужны снегозадержатели над входами, крыльцом и дорожками (и на металлической кровле — по всему периметру карниза)', 'СП 17.13330.2017 п. 9.11', r, r.id, () => { r.snowGuard = true; });
  },
  /** Колодец / скважина ближе 20 м к границе с соседом: санитарный разрыв до чужого септика и уборной от нас не зависит */
  wellsBound(d, add, m) {
    const f1 = d.floors[0].id, plots = d.areas.filter(a => a.kind === 'plot' && (a.floor || f1) === f1);
    for (const w of d.items.filter(it => (it.floor || f1) === f1 && ['well', 'borehole', 'boreholeArt'].includes(it.key))) {
      let best = null;
      for (const pl of plots) pl.pts.forEach((a, i) => {
        if (Checks.edgeType(pl, i) !== 'neighbor') return;
        const dd = G.distSeg(w, a, pl.pts[(i + 1) % pl.pts.length]);
        if (!best || dd < best) best = dd;
      });
      if (best == null || best >= 2000) continue;
      const name = w.label || catItem(w.key).name, art = w.key === 'boreholeArt';
      add('warn', 'Водоснабжение', `${name} в ${m(best)} от границы с соседом: он вправе поставить у своего забора септик, уборную или компост — и до скважины окажется меньше санитарных 20 м (у поля фильтрации — 50 м). Надёжнее — ≥ 20 м от соседских границ, ближе к улице и подальше от чужих выгребов; обсадка с цементацией затрубья, герметичный оголовок или кессон` + (art ? '. Артезианскую — оформить: паспорт скважины, для водоносного горизонта, используемого для централизованного водоснабжения, — лицензия на пользование недрами (уточните в местном органе)' : ''), 'СП 53.13330.2019 п. 6.8; СанПиН 2.1.3684-21 (зона санитарной охраны); Закон РФ «О недрах» ст. 19', { x: w.x, y: w.y }, w.id);
    }
  },
  /** Освещённость: E ≈ Φ·η / S (η = 0,45 — коэффициент использования с запасом); нет света или мало — автоисправление */
  LUX_K: 0.45,
  luxNorm(nm) {
    if (/кухн|гостин|спальн|детск|кабинет|комнат|столов/.test(nm)) return 150;
    if (/гардероб/.test(nm)) return 75;
    if (/гараж|мастерск/.test(nm)) return 75;
    return 50;                                                             // санузлы, коридоры, прихожая, кладовая, котельная
  },
  lighting(d, fd, add, stats) {
    const f1 = d.floors[0].id, rows = [], src = 'СП 52.13330.2016 табл. 4.1; СанПиН 1.2.3685-21';
    const check = (name, poly, fid, at, key) => {
      const A = Math.abs(G.polyArea(poly)) / 1e4;
      if (A < 1.5) return;
      const lamps = d.items.filter(it => (it.floor || f1) === fid && catItem(it.key).lm && catItem(it.key).key !== 'lamp36' && G.pointInPoly(it, poly));
      const lm = lamps.reduce((s, it) => s + catItem(it.key).lm, 0), E = lm * Analysis.LUX_K / A, norm = Analysis.luxNorm(name.toLowerCase());
      rows.push([name, `${Math.round(E)} / ${norm} лк`]);
      const fix = () => Analysis.addLamps(poly, fid, norm * A / Analysis.LUX_K - lm, key);
      if (!lamps.length) add('warn', 'Освещение', `${name}: нет светильника (нужно ≈ ${Math.ceil(norm * A / Analysis.LUX_K / 100) * 100} лм)`, src, at, null, fix);
      else if (E < norm * 0.9) add('warn', 'Освещение', `${name}: освещённость ≈ ${Math.round(E)} лк при норме ${norm} лк — добавьте светильники`, src, at, null, fix);
    };
    for (const f of fd) for (const r of f.rooms) check(r.name, r.floor || r.axis, f.floor.id, G.polyCentroid(r.floor || r.axis), 'lamp');
    for (const it of d.items) {
      if (!BLD_HOLLOW.has(catItem(it.key).shape) || catItem(it.key).key === 'house' || (it.floor || f1) !== f1) continue;
      const s = bldShell(it, it.w, it.d), q = [[s.inner.x0, s.inner.y0], [s.inner.x1, s.inner.y0], [s.inner.x1, s.inner.y1], [s.inner.x0, s.inner.y1]].map(([x, y]) => G.toWorld({ x, y }, it.x, it.y, it.rot || 0));
      check(it.label || catItem(it.key).name, q, f1, it, catItem(it.key).shape === 'garage' ? 'ledLinear' : 'lamp');
      // ямы и погреба внутри — безопасное напряжение 36 В
      for (const p of d.items.filter(o => ['inspPit', 'cellar', 'podpol'].includes(o.key) && G.pointInPoly(o, q))) {
        const pp = Model.itemPts(p);
        if (!d.items.some(o => o.key === 'lamp36' && G.distPoly(o, pp) < 40)) add('warn', 'Освещение', `${p.label || catItem(p.key).name}: нужен светильник 36 В (IP65) через разделительный трансформатор — обычная сеть 220 В в яме запрещена`, 'ПУЭ 6.1.16, 1.7.79', p, p.id, () => Analysis.addPitLamp(p, it));
      }
    }
    if (rows.length) { const at = stats.findIndex(x => /Смета/.test(x.title)); stats.splice(at < 0 ? stats.length : at, 0, { title: 'Освещённость (факт / норма)', rows }); }
  },
  /** Подключения по всем этажам: каждому прибору — нужные трассы (itemLinks); концы трасс — к прибору, колодцу или другой трассе */
  links(d, add) {
    const f1 = d.floors[0].id, SRC = { water: 'СП 30.13330.2020', hotwater: 'СП 30.13330.2020', sewer: 'СП 30.13330.2020; СП 32.13330.2018', drain: 'СП 32.13330.2018', heating: 'СП 60.13330.2020', gas: 'СП 62.13330.2011', gasAir: 'СП 62.13330.2011', power: 'ПУЭ 7-е изд., гл. 7.1', lowvolt: 'СП 134.13330.2022', freon: 'инструкция производителя', warmfloor: 'СП 60.13330.2020', airIn: 'СП 7.13130.2013 п. 5.14; инструкция изготовителя печи: воздух для горения — снаружи, не из помещения', socket: 'ПУЭ 7.1.47; СП 256.1325800' };
    const SOCK = new Set(['socket', 'socket2', 'socketP', 'socketOut']);
    for (const fl of d.floors) {
      const lines = d.lines.filter(l => (l.floor || f1) === fl.id && l.pts.length >= 2 && l.kind !== 'overhead'), items = d.items.filter(it => (it.floor || f1) === fl.id);
      const inRect = (it, p, tol) => { const q = G.toLocal(p, it.x, it.y, it.rot || 0); return Math.abs(q.x) <= it.w / 2 + tol && Math.abs(q.y) <= it.d / 2 + tol; };
      const touches = (it, l) => l.pts.some(p => inRect(it, p, 20)) || l.pts.some((p, i) => i && G.distSeg(it, l.pts[i - 1], p) <= 6);
      const has = (it, kd) => kd === 'socket' ? items.some(o => SOCK.has(catItem(o.key).shape) && G.dist(o, it) <= 150 + Math.max(it.w, it.d) / 2)
        : kd === 'inlet' ? items.some(o => catItem(o.key).shape === 'stormInlet' && G.dist(o, it) < 60)
        : lines.some(l => l.kind === kd && touches(it, l));
      for (const it of items) {
        const miss = itemLinks(it).filter(([, kinds]) => !kinds.some(kd => has(it, kd)));
        if (!miss.length) continue;
        const name = it.label || catItem(it.key).name, kinds = miss.flatMap(x => x[1]);
        const can = miss.map(([, ks]) => ks.find(kd => lines.some(l => l.kind === kd))).filter(Boolean);
        add('warn', 'Подключения', `${name}: не подключено — ${miss.map(x => x[0]).join(', ')}`, [...new Set(kinds.map(k => SRC[k]).filter(Boolean))].join('; '), { x: it.x, y: it.y }, it.id,
          can.length ? () => { for (const kd of can) Analysis.autoLink(it, kd); } : null);
      }
      // концы трасс: в приборе (с нужной системой), в колодце, на другой трассе той же системы
      const ok = (l, p) => items.some(it => inRect(it, p, 15) && (itemLinks(it).some(([, ks]) => ks.includes(l.kind)) || catItem(it.key).sym || ['pit', 'ring', 'borehole', 'well', 'septic', 'boiler', 'pole'].includes(catItem(it.key).shape)))
        || lines.some(x => x !== l && sysOfLine(x) === sysOfLine(l) && x.pts.some((q, i) => G.dist(q, p) <= 15 || (i && G.distSeg(p, x.pts[i - 1], q) <= 8)));
      const mans = items.filter(it => it.key === 'manifoldWF');
      let nFeed = 0;
      for (const l of lines) {
        if (l.kind === 'warmfloor') {
          // контур тёплого пола: начало (подача и обратка) — у коллектора или на подводке от него
          const p = l.pts[0];
          if (ok(l, p) || !mans.length) continue;
          const m0 = mans.slice().sort((a, b) => G.dist(a, p) - G.dist(b, p))[0], k = nFeed++;
          add('warn', 'Подключения', `${l.label || 'Контур тёплого пола'}: не подведён к коллектору тёплого пола`, SRC.warmfloor, p, l.id, () => {
            const mx = Math.round(m0.x - 20 + (k % 8) * 5), my = Math.round(m0.y + 5);
            Model.add('lines', { kind: 'warmfloor', dia: 16, depth: 0, floor: l.floor, label: 'ТП подводка: ' + (l.label || '').replace(/^ТП\s*/, ''), note: 'Подводка к контуру: подача и обратка, транзит под другими помещениями — в гофре и теплоизоляции', pts: [{ x: mx, y: my }, { x: mx, y: Math.round(p.y) }, { x: Math.round(p.x), y: Math.round(p.y) }] });
          });
          continue;
        }
        for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) if (!ok(l, p)) add('warn', 'Подключения', `${l.label || LINE_KINDS[l.kind].code} — ${LINE_KINDS[l.kind].name.toLowerCase()}: конец трассы никуда не подключён (${U.fmtLen(p.x)}, ${U.fmtLen(p.y)})`, SRC[l.kind] || '', p, l.id);
      }
    }
  },
  /** Подключить прибор к ближайшей трассе вида kd: перпендикуляр к ближайшему участку (или «Г»), глубина и марка — как у трассы */
  autoLink(it, kd) {
    const f1 = App.doc.floors[0].id, fl = it.floor || f1;
    let best = null;
    if (it.key === 'lamp36') {                                                  // 36 В — только от разделительного трансформатора
      const t = App.doc.items.filter(o => o.key === 'transformer36' && (o.floor || f1) === fl).sort((a, b) => G.dist(a, it) - G.dist(b, it))[0];
      if (t) Model.add('lines', { kind: 'power', depth: 0, section: 'ВВГнг 2×1.5', label: `36 В → ${(it.label || 'светильник').replace(/^Светильник 36 В — /, '')}`, note: 'Безопасное напряжение 36 В от разделительного трансформатора (ПУЭ 6.1.16)', pts: [{ x: t.x, y: t.y }, { x: t.x, y: it.y }, { x: it.x, y: it.y }].filter((p, i, a) => !i || G.dist(p, a[i - 1]) > 1), floor: t.floor });
      return;
    }
    const light = kd === 'power' && (catItem(it.key).lm || /lamp|light|spot|bollard|ledline|transformer/i.test(catItem(it.key).shape + it.key));
    const pref = light && App.doc.lines.some(l => l.kind === 'power' && (l.floor || f1) === fl && /свет|освещ/i.test(l.label || ''));
    for (const l of App.doc.lines) {
      if (l.kind !== kd || (l.floor || f1) !== fl || (pref && !/свет|освещ/i.test(l.label || ''))) continue;
      for (let i = 1; i < l.pts.length; i++) { const pr = G.proj(it, l.pts[i - 1], l.pts[i]); if (!best || pr.d < best.d) best = { d: pr.d, q: pr.q, l }; }
    }
    if (!best) return;
    const c = { x: Math.round(it.x), y: Math.round(it.y) }, q = { x: Math.round(best.q.x), y: Math.round(best.q.y) };
    const pts = Math.abs(c.x - q.x) < 3 || Math.abs(c.y - q.y) < 3 ? [q, c] : [q, { x: q.x, y: c.y }, c];
    const L = best.l, name = it.label || catItem(it.key).name;
    Model.add('lines', { kind: kd, depth: L.depth || 0, dia: L.dia, section: L.section, label: `${(L.label || LINE_KINDS[kd].code).split(' ')[0]} → ${name.split(' (')[0].slice(0, 30)}`, note: 'Подключение прибора (автоматически)', pts, floor: L.floor });
  },
  /** Добавить светильники в помещение: сеткой по длинной стороне, внутри контура; подключить к ближайшей линии «Свет» */
  addLamps(poly, fid, needLm, key = 'lamp') {
    const def = catItem(key), n = Math.max(1, Math.ceil(needLm / def.lm)), b = G.bbox(poly), W = b.x1 - b.x0, H = b.y1 - b.y0, along = W >= H;
    // перебор сеток (n, n+1, …): центр часто уже занят существующим светильником
    const pts = [], free = (p) => G.pointInPoly(p, poly) && !App.doc.items.some(o => catItem(o.key).lm && G.dist(o, p) < 80) && !pts.some(q => G.dist(q, p) < 80);
    for (let m = n; m <= n + 6 && pts.length < n; m++) {
      const rowsN = Math.max(1, Math.round(Math.sqrt(m * (along ? H / W : W / H)))), cols = Math.ceil(m / rowsN);
      for (let i = 0; i < rowsN && pts.length < n; i++) for (let j = 0; j < cols && pts.length < n; j++) {
        const p = along ? { x: b.x0 + W * (j + 0.5) / cols, y: b.y0 + H * (i + 0.5) / rowsN } : { x: b.x0 + W * (i + 0.5) / rowsN, y: b.y0 + H * (j + 0.5) / cols };
        if (free(p)) pts.push(p);
      }
    }
    const f1 = App.doc.floors[0].id;
    const grp = App.doc.lines.filter(l => l.kind === 'power' && (l.floor || f1) === fid && /свет/i.test(l.label || ''));
    for (const p of pts) {
      Model.add('items', { key, x: Math.round(p.x), y: Math.round(p.y), w: def.w, d: def.d, h: def.h, rot: along ? 0 : 90, flip: false, floor: fid });
      let best = null;
      for (const l of grp) for (const q of l.pts) { const dd = G.dist(q, p); if (!best || dd < best.d) best = { d: dd, q, l }; }
      if (best) Model.add('lines', { kind: 'power', depth: 0, section: best.l.section, label: best.l.label, note: 'Ответвление к добавленному светильнику', pts: [{ ...best.q }, { x: p.x, y: best.q.y }, { x: Math.round(p.x), y: Math.round(p.y) }], floor: fid });
    }
  },
  addPitLamp(p, bld) {
    const s = catItem(p.key), c = G.toWorld({ x: 0, y: -p.d / 2 + 10 }, p.x, p.y, p.rot || 0);
    Model.add('items', { key: 'lamp36', x: Math.round(c.x), y: Math.round(c.y), w: 16, d: 10, h: p.key === 'inspPit' ? -60 : -80, rot: p.rot || 0, flip: false, floor: p.floor, label: `Светильник 36 В — ${p.label || s.name}` });
    if (!App.doc.items.some(o => o.key === 'transformer36' && G.pointInPoly(o, Model.itemPts(bld)))) {
      const t = G.toWorld({ x: -bld.w / 2 + 40, y: -bld.d / 2 + 20 }, bld.x, bld.y, bld.rot || 0);
      Model.add('items', { key: 'transformer36', x: Math.round(t.x), y: Math.round(t.y), w: 20, d: 12, h: 150, rot: bld.rot || 0, flip: false, floor: bld.floor, label: 'Трансформатор 220/36 В для ямы и погреба' });
    }
  },
  /** Группы электрощита — внутренние кабельные линии (глубина 0) с автоматом; проверки по ПУЭ */
  electric(d, add, stats) {
    const groups = d.lines.filter(l => l.kind === 'power' && !(l.depth > 0) && (l.breaker || l.rcd));
    if (!groups.length) return;
    const LIM = { 1.5: 16, 2.5: 25, 4: 32, 6: 40, 10: 50, 16: 63, 25: 80 };
    const SOCK = new Set(['socket', 'socket2', 'socketP', 'socketOut']);
    const rows = [];
    for (const l of groups) {
      const sec = parseFloat(String(l.section || '').replace(',', '.').split('×').pop()), nums = String(l.breaker || '').match(/\d+(?:[.,]\d+)?/g), amp = nums ? parseFloat(nums[nums.length - 1].replace(',', '.')) : NaN;   // «3P C25» → 25
      const devs = d.items.filter(it => catItem(it.key).sym && l.pts.some(p => G.dist(it, p) < 5));   // точки, через которые проведена линия
      const socks = devs.filter(it => SOCK.has(catItem(it.key).shape));
      rows.push([l.label || 'Линия', `${l.breaker || '—'}${l.rcd ? ' + УЗО ' + l.rcd : ''} · ${l.section || ''}${devs.length ? ` · ${devs.length} точ.` : ''}`]);
      const REC = { 1.5: 'C10', 2.5: 'C16', 4: 'C25', 6: 'C32', 10: 'C40', 16: 'C50', 25: 'C63' };
      if (LIM[sec] && amp > LIM[sec]) add('bad', 'Электрика', `${l.label || 'Линия'}: автомат ${l.breaker} больше допустимого для кабеля ${sec} мм² (до ${LIM[sec]} А) — кабель перегреется раньше, чем сработает автомат`, 'ПУЭ табл. 1.3.4, п. 3.1.4', l.pts[0], l.id, () => { l.breaker = (/3P/.test(l.breaker) ? '3P ' : '') + REC[sec]; });
      if (socks.length && !l.rcd) add('warn', 'Электрика', `${l.label || 'Линия'}: розетки без УЗО — поставьте УЗО или дифавтомат 30 мА`, 'ПУЭ 7.1.79, 7.1.83; СП 256.1325800.2016 п. 15.3', l.pts[0], l.id, () => { l.rcd = '30 мА'; });
    }
    const at = stats.findIndex(x => /Смета/.test(x.title));
    stats.splice(at < 0 ? stats.length : at, 0, { title: 'Электрощит: группы', rows });
  },
  /** Какая часть забора (границы участка) видна камерам: дальность, угол обзора, постройки заслоняют.
   *  Под самой камерой (до 1 м) — считаем видно: там её опора. null — нет камер или границы участка */
  cctv(d, fd) {
    const f1 = d.floors[0].id, cams = d.items.filter(it => catItem(it.key).shape === 'cctv');
    const plot = d.areas.find(a => a.kind === 'plot');
    if (!cams.length || !plot) return null;
    const fl = fd.find(x => x.floor.id === f1), blds = (fl ? fl.outlines.map(o => o.outer) : [])
      .concat(d.items.filter(it => (it.floor || f1) === f1 && BLD_ROOF_SHAPES.has(catItem(it.key).shape) && catItem(it.key).shape !== 'greenhouse' && !['canopy', 'canopyLean'].includes(catItem(it.key).shape)).map(it => Model.itemPts(it)));
    const blocked = (a, b) => blds.some(poly => !G.pointInPoly(a, poly) && poly.some((p, i) => G.segInter(a, b, p, poly[(i + 1) % poly.length])));
    const sees = (c, p) => {
      const def = catItem(c.key), rot = U.rad(c.rot || 0), o = G.toWorld({ x: 0, y: c.d / 2 }, c.x, c.y, c.rot || 0);
      const v = G.sub(p, o), dist = G.len(v);
      if (dist < 100) return true;
      if (dist > (c.range ?? def.range ?? 1500)) return false;
      const dir = { x: -Math.sin(rot), y: Math.cos(rot) }, ang = Math.acos(U.clamp(G.dot(v, dir) / dist, -1, 1));
      return U.deg(ang) <= (c.fov ?? def.fov ?? 90) / 2 && !blocked(o, p);
    };
    const pts = plot.pts, step = 50, gaps = [];
    let total = 0, seen = 0, run = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = G.dist(a, b), n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const p = G.add(a, G.mul(G.sub(b, a), (k + 0.5) / n)), ok = cams.some(c => sees(c, p));
        total += L / n;
        if (ok) { seen += L / n; if (run) { gaps.push(run); run = null; } }
        else if (run) run.len += L / n;
        else run = { len: L / n, at: p };
      }
    }
    if (run) gaps.push(run);
    // главное — подходы к дому и гаражу (полоса 1,5 м вдоль стен) и въезды: ворота и калитки
    const ring = blds.slice(0, (fl ? fl.outlines.length : 0)).concat(d.items.filter(it => (it.floor || f1) === f1 && BLD_HOLLOW.has(catItem(it.key).shape)).map(it => Model.itemPts(it)));
    let hT = 0, hS = 0;
    const hGaps = [];
    for (const poly of ring) {
      const off = G.offsetPoly(poly, 150), P2 = Math.abs(G.polyArea(off)) > Math.abs(G.polyArea(poly)) ? off : G.offsetPoly(poly, -150);
      let hr = null;
      for (let i = 0; i < P2.length; i++) {
        const a = P2[i], b = P2[(i + 1) % P2.length], L = G.dist(a, b), n = Math.max(1, Math.round(L / step));
        for (let k = 0; k < n; k++) {
          const p = G.add(a, G.mul(G.sub(b, a), (k + 0.5) / n));
          if (blds.some(q => G.pointInPoly(p, q))) { if (hr) { hGaps.push(hr); hr = null; } continue; }   // вплотную к другой постройке
          const ok = cams.some(c => sees(c, p));
          hT += L / n; if (ok) { hS += L / n; if (hr) { hGaps.push(hr); hr = null; } } else if (hr) hr.len += L / n; else hr = { len: L / n, at: p };
        }
      }
      if (hr) hGaps.push(hr);
    }
    const c0 = G.polyCentroid(plot.pts);
    const doors = d.items.filter(it => ['gateSwing', 'gateSlide', 'wicket'].includes(catItem(it.key).shape) || /^gate|wicket/.test(it.key)).map(it => ({ it, p: G.add(it, G.mul(G.unit(G.sub(c0, it)), 150)) }));
    const blind = doors.filter(x => !cams.some(c => sees(c, x.p)));
    return { cams: cams.length, pct: total ? seen / total * 100 : 0, gaps: gaps.filter(g => g.len >= 100).sort((x, y) => y.len - x.len),
      pctHouse: hT ? hS / hT * 100 : 100, hGaps: hGaps.filter(g => g.len >= 350).sort((x, y) => y.len - x.len), doors: doors.length, blind };
  },
  vent(d, fd, add, stats, m) {
    const f1 = d.floors[0].id, EXH = new Set(['ventGrille', 'ventShaft', 'ventShaft2', 'ventPipe', 'fan', 'recuperator']);
    const SHAFT = (it) => catItem(it.key).stack === 'vent';
    const near = (p, poly, tol) => G.distPoly(p, poly) <= tol;
    const name = (it) => it.label || catItem(it.key).name;
    let need = 0, supplyNeed = 0;
    const noSupply = [];
    const rowsOf = [];
    for (const f of fd) Drawing.onFloor(f.floor.id, () => {
      const items = d.items.filter(it => (it.floor || f1) === f.floor.id);
      const H = (f.floor.h || 270) / 100;
      for (const r of f.rooms) {
        const nm = (r.name || '').toLowerCase(), at = G.polyCentroid(r.floor || r.axis), A = r.areaFloor / 1e4;
        const inR = items.filter(it => near(it, r.axis, 15));
        const exh = inR.filter(it => EXH.has(it.key)), sup = inR.filter(it => it.key === 'ventSupply' || it.key === 'recuperator');
        const wins = Rooms.windowsOf(r).length;
        const gasBoiler = inR.some(it => /gasBoiler/.test(it.key));
        const stove = inR.find(it => ['stoveHeat', 'fireplace', 'fireplaceCorner', 'stoveMetal'].includes(catItem(it.key).shape));
        const kitchen = /кухн/.test(nm), wc = /сануз|с\/у|туалет|уборн/.test(nm), bath = /ванн|душ/.test(nm) || inR.some(it => ['bath', 'bathCorner', 'shower'].includes(catItem(it.key).shape));
        const living = !!(r.tag && r.tag.living) || /спальн|гостин|детск|кабинет|комнат/.test(nm);
        const hood = inR.some(it => it.key === 'hood'), gasStove = inR.find(it => (/gas/i.test(it.key) && catItem(it.key).shape === 'stove') || (KITCHEN_SHAPES.has(catItem(it.key).shape) && it.hob === 'gas'));
        let q = 0, why = '';
        if (kitchen) { q = gasStove ? 90 : 60; why = gasStove ? 'кухня с газовой плитой — 90 м³/ч' : 'кухня — 60 м³/ч (с газовой плитой — 90)'; }
        else if (gasBoiler || /котельн|топочн/.test(nm)) { q = Math.ceil(3 * A * H); why = `котельная — 3 объёма в час (${q} м³/ч)`; }
        else if (wc && bath) { q = 50; why = 'совмещённый санузел — 50 м³/ч'; }
        else if (wc || bath) { q = 25; why = (bath ? 'ванная' : 'туалет') + ' — 25 м³/ч'; }
        else if (/постироч|прачечн/.test(nm)) { q = Math.ceil(5 * A * H); why = ''; }
        if (q) {
          need += q; rowsOf.push([r.name, `${q} м³/ч${exh.length ? '' : ' — нет вытяжки'}`]);
          const sev = why ? 'bad' : 'warn';
          if (!exh.length) add(sev, 'Вентиляция', `${r.name}: нет вытяжки${hood ? ' (зонту над плитой нужен свой вентканал)' : ''} — ${why || 'нужна вытяжка'}; поставьте вентканал или решётку в канал`, 'СП 54.13330 табл. 9.1; СП 55.13330; СП 60.13330', at);
        }
        if (gasStove) {
          if (!wins) add('bad', 'Газ', `${r.name}: газовая плита — только в помещении с окном (с форточкой или створкой)`, 'СП 402.1325800 п. 5.5', at);
          if (A * H < 15) add('warn', 'Газ', `${r.name}: объём ${(A * H).toFixed(1)} м³ — для плиты на 4 конфорки нужно не меньше 15 м³`, 'СП 402.1325800 п. 5.5', at);
          if (!d.items.some(it => it.key === 'gasValve' && G.dist(it, gasStove) < 400)) add('warn', 'Газ', `${name(gasStove)}: поставьте кран на опуске газопровода перед плитой`, 'СП 62.13330 п. 5.1.7; СП 402.1325800', gasStove, gasStove.id);
        }
        if (gasBoiler) {
          if (!sup.length && !wins && !inR.some(it => it.key === 'ventTransfer')) add('bad', 'Вентиляция', `${r.name}: газовый котёл без притока — нужен приточный клапан или решётка (приток = вытяжка + воздух на горение)`, 'СП 62.13330; СП 402.1325800', at);
          else if (!sup.length) add('warn', 'Вентиляция', `${r.name}: газовый котёл — поставьте приточный клапан или решётку в двери/стене (≥ 0,02 м²); форточка не заменяет постоянный приток`, 'СП 402.1325800', at);
        }
        if (living) { supplyNeed += Math.ceil(3 * A); if (!sup.length) noSupply.push(r.name); }
        if (stove && !sup.length && !wins) add('warn', 'Печь', `${r.name}: печи / камину нужен приток воздуха на горение — окно или приточный клапан`, 'СП 7.13130', at);
      }
      // решётка должна стоять у вентканала (на этом этаже или проходящего снизу)
      for (const g of items.filter(it => it.key === 'ventGrille')) {
        const ok = d.items.some(o => SHAFT(o) && Model.floorIdx(o.floor || f1) <= Model.floorIdx(f.floor.id) && G.dist(o, g) <= Math.max(o.w, o.d) / 2 + 60);
        if (!ok) add('warn', 'Вентиляция', `${name(g)}: рядом нет вентканала — решётке некуда отводить воздух`, '', g, g.id);
      }
    });
    // трубы над крышей: высота относительно конька
    for (const it of d.items) {
      const def = catItem(it.key);
      if (!def.stack) continue;
      const st = Checks.stack(it);
      if (!st) continue;
      const top = st.e + Checks.stackH(it);
      if (top < st.need - 1) add('bad', def.stack === 'smoke' ? 'Печь' : 'Вентиляция', `${name(it)}: верх трубы ${m(top - st.roofZ)} над кровлей, ${top >= st.ridgeZ ? 'выше' : 'ниже'} конька на ${m(Math.abs(top - st.ridgeZ))}, до конька ${m(st.dist)} — нужно поднять на ${m(st.need - top)}`, 'СП 7.13130.2013 п. 5.10: до 1,5 м от конька — 0,5 м над ним; 1,5–3 м — не ниже конька; дальше — не ниже линии 10°', it, it.id, () => { it.autoH = true; });
    }
    // печи и камины: дымоход и свободное место перед топкой
    const ws = d.walls.filter(w => w.kind !== 'fence');
    for (const it of d.items) {
      const sh = catItem(it.key).shape;
      if (!['stoveHeat', 'fireplace', 'fireplaceCorner', 'stoveMetal'].includes(sh)) continue;
      const fl = it.floor || f1, poly = Model.itemPts(it);
      const flue = d.items.find(o => catItem(o.key).stack === 'smoke' && (o.floor || f1) === fl && near(o, poly, 60));
      if (!flue) add('bad', 'Печь', `${name(it)}: нет дымохода — поставьте «Дымоход / труба» над печью или вплотную к ней`, 'СП 7.13130.2013', it, it.id);
      if (sh === 'fireplaceCorner') continue;
      // перед топочной дверкой до противоположной стены — не меньше 1,25 м
      const front = G.toWorld({ x: 0, y: it.d / 2 }, it.x, it.y, it.rot || 0), dir = G.sub(G.toWorld({ x: 0, y: it.d / 2 + 100 }, it.x, it.y, it.rot || 0), front);
      const u = G.unit(dir);
      let free = Infinity;
      for (const w of ws.filter(w => (w.floor || f1) === fl)) {
        const n = G.perp(G.unit(G.sub(w.b, w.a))), den = G.dot(u, n);
        if (Math.abs(den) < 1e-6) continue;
        const t = G.dot(G.sub(w.a, front), n) / den;
        if (t <= 0) continue;
        const p = G.add(front, G.mul(u, t)), L = Model.wallLen(w), s = G.dot(G.sub(p, w.a), G.unit(G.sub(w.b, w.a)));
        if (s < -w.th / 2 || s > L + w.th / 2) continue;
        free = Math.min(free, t - w.th / (2 * Math.abs(den)));
      }
      if (free < 124.5) add('bad', 'Печь', `${name(it)}: от топочной дверки до стены ${m(free)} — нужно не меньше 1,25 м`, 'СП 7.13130.2013, разд. 5', front, it.id);
      const soft = d.items.find(o => o !== it && (o.floor || f1) === fl && ['sofa', 'sofaL', 'armchair', 'bed', 'wardrobe'].includes(catItem(o.key).shape) && Model.itemPts(o).some(q => { const v = G.sub(q, front), a = G.dot(v, u); return a > 0 && a < 125 && Math.abs(G.cross(u, v)) < it.w / 2 + 20; }));
      if (soft) add('warn', 'Печь', `${name(it)}: «${name(soft)}» ближе 1,25 м перед топкой — отодвиньте мягкую мебель от дверки`, 'СП 7.13130.2013, разд. 5', front, it.id);
    }
    const shafts = d.items.filter(SHAFT), sups = d.items.filter(it => it.key === 'ventSupply');
    const at = stats.findIndex(x => /Смета/.test(x.title));
    if (need || shafts.length || sups.length) stats.splice(at < 0 ? stats.length : at, 0, { title: 'Вентиляция', rows: [
      ['Вытяжка по нормам', `${need} м³/ч`],
      ...rowsOf.map(([a, b]) => ['— ' + a, b]),
      ['Приток в жилые комнаты (3 м³/ч на 1 м²)', `${supplyNeed} м³/ч`],
      ['Вентканалы', shafts.length ? `${shafts.length} шт., каналов ${shafts.reduce((a, it) => a + (catItem(it.key).channels || 1), 0)}` : 'нет'],
      ['Приточные клапаны', sups.length ? `${sups.length} шт.` : 'нет'],
      noSupply.length ? ['Жилые без клапана (приток только через окна)', noSupply.join(', ')] : null,
    ].filter(Boolean) });
  },

  open() { Analysis.render(); $('dlgAnalysis').showModal(); },
  render() {
    const R = Analysis.run(), box = $('anBody');
    box.textContent = '';
    const bad = R.issues.filter(i => i.sev === 'bad').length, warn = R.issues.filter(i => i.sev === 'warn').length, info = R.issues.filter(i => i.sev === 'info').length, notes = R.issues.filter(i => i.sev === 'note').length;
    const sum = U.el('div', { class: 'check-sum ' + (bad ? 'bad' : 'ok') },
      bad ? `✗ Нарушений норм: ${bad}` : '✓ Нарушений норм не найдено',
      U.el('span', {}, ` · замечаний ${warn} · по чертежу ${info}${notes ? ` · указаний строителям ${notes}` : ''}`));
    const fixes = R.issues.filter(i => i.fix);
    if (fixes.length) sum.append(U.el('button', { type: 'button', class: 'primary an-fixall', title: 'Применить все автоисправления: автоматы по сечению, УЗО, кровля по уклону, снегозадержатели, высота труб', onclick: () => { for (const i of fixes) i.fix(); Model.commit(); Analysis.render(); UI.toast(`Исправлено автоматически: ${fixes.length}`); } }, `✓ Исправить автоматически (${fixes.length})`));
    const head = $('anSum');
    if (head) { head.textContent = ''; head.append(sum); } else box.append(sum);
    // две колонки: слева статистика и помещения, справа — замечания
    const left = U.el('div', { class: 'an-left' }), right = U.el('div', { class: 'an-right' });
    box.append(U.el('div', { class: 'an-cols' }, left, right));
    // статистика
    const grid = U.el('div', { class: 'an-stats' });
    for (const s of R.stats) grid.append(U.el('div', { class: 'an-card' }, U.el('h4', {}, s.title), U.el('table', { class: 'tbl' }, s.rows.map(([k, v]) => U.el('tr', {}, U.el('td', {}, k), U.el('td', { class: 'num' }, v))))));
    left.append(grid);
    if (R.rooms.length) {
      const multi = new Set(R.rooms.map(r => r.floor)).size > 1;
      grid.append(U.el('div', { class: 'an-card an-wide' }, U.el('h4', {}, 'Помещения'),
        U.el('table', { class: 'tbl an-rooms' }, U.el('tr', {}, U.el('th', {}, 'Помещение'), U.el('th', {}, 'Площадь'), U.el('th', {}, 'Окон'), U.el('th', {}, 'Окна : пол')),
          R.rooms.map(r => U.el('tr', {}, U.el('td', {}, (multi ? r.floor + ': ' : '') + r.name + (r.living ? ' (жилая)' : '')), U.el('td', { class: 'num' }, U.fmtArea(r.area)), U.el('td', { class: 'num' }, String(r.windows)),
            U.el('td', { class: 'num ' + ((r.living || r.kitchen) && r.ratio > 8.05 ? 'bad' : '') }, r.windows ? '1:' + r.ratio.toFixed(1) : '—'))))));
    }
    // замечания
    const sevName = { bad: 'Нарушение', warn: 'Замечание', info: 'Неточности чертежа', note: 'Указания строителям' };
    const probs = R.issues.filter(i => i.sev !== 'note'), noteList = R.issues.filter(i => i.sev === 'note');
    if (noteList.length) left.append(U.el('div', { class: 'an-card an-wide an-notes' }, U.el('h4', {}, `Указания строителям (${noteList.length}) — не нарушения, а готовые решения; печатаются на листах`),
      U.el('ul', {}, noteList.map(i => U.el('li', { onclick: () => Analysis.show(i), title: 'Показать на плане' }, U.el('b', {}, i.group + ': '), i.text, i.src ? U.el('em', {}, ' § ' + i.src) : null)))));
    if (probs.length) {
      const list = U.el('div', { class: 'an-issues' });
      let group = null;
      for (const i of probs) {
        const g = i.sev === 'info' ? sevName.info : `${sevName[i.sev]} · ${i.group}`;
        if (g !== group) { group = g; list.append(U.el('h4', {}, g)); }
        const fx = i.fix ? U.el('span', { class: 'an-fix', role: 'button', title: 'Исправить автоматически по норме', onclick: (e) => { e.stopPropagation(); i.fix(); Model.commit(); Analysis.render(); } }, '✓ Исправить') : null;
        const b = U.el('button', { type: 'button', class: 'check-item an-' + i.sev + (i.sev === 'bad' ? ' bad' : '') }, U.el('span', {}, i.text), i.src ? U.el('em', {}, i.src) : null, fx);
        b.onclick = () => Analysis.show(i);
        list.append(b);
      }
      right.append(U.el('h3', { class: 'an-h' }, 'Нарушения и замечания'), list);
    } else right.append(U.el('h3', { class: 'an-h' }, 'Нарушения и замечания'), U.el('p', { class: 'note' }, 'Нарушений норм и замечаний нет.'));
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
    for (const i of R.issues) L.push(`  [${{ bad: 'нарушение', warn: 'замечание', info: 'чертёж', note: 'указание' }[i.sev]}] ${i.text}${i.src ? ` (${i.src})` : ''}`);
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
    if ($('anSum')) body.prepend($('anSum').cloneNode(true));
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
