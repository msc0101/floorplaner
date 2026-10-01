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
        ...(s.plotArea ? [['Коэффициент застройки / плотности', `${(s.built / s.plotArea).toFixed(2)} / ${(s.gross / s.plotArea).toFixed(2)} (норма ИЖС ≤ 0,2 / ≤ 0,4)`]] : []),
        // покрытия и дорожки участка (улицы и тротуары за забором — не участок)
        ...Object.entries(s.zones).filter(([k]) => k !== 'road:street' && k !== 'road:sidewalk').map(([, z]) => [z.name, `${m2(z.area)}${z.count > 1 ? ` (${z.count})` : ''}`]),
      ] });
    }
    // СП 42.13330.2026 (с 12.07.2026), застройка ИЖС: коэффициент застройки ≤ 0,2, плотности (площадь всех этажей) ≤ 0,4 — показатели территории квартала;
    // для отдельного участка обязателен максимальный процент застройки из ПЗЗ, поэтому превышение — справка, а не ошибка
    if (s.plotArea) {
      const f2 = (v) => v.toFixed(2).replace('.', ','), kz = s.built / s.plotArea, kp = s.gross / s.plotArea, srcK = 'СП 42.13330.2026 (параметры индивидуальной жилой застройки); ПЗЗ муниципалитета';
      const cap = (s.footprint + s.outb.filter(it => catItem(it.key).shape === 'garage' || (catItem(it.key).shape === 'veranda' && porchOpt(it).roofed) || (catItem(it.key).shape === 'building' && !['pile', 'none'].includes(it.foundType))).reduce((a, it) => a + it.w * it.d, 0)) / s.plotArea;
      if (kz > 0.2) add('info', 'Участок', `Коэффициент застройки ${f2(kz)} — больше 0,2 из СП 42.13330.2026 (капитальные: дом, веранды, гараж — ${f2(cap)}; теплица, беседка, сарай на сваях — некапитальные). Для участка обязателен предельный процент застройки по ПЗЗ — сверьте до подачи уведомления`, srcK, plots[0].pts[0]);
      if (kp > 0.4) add('info', 'Участок', `Коэффициент плотности застройки ${f2(kp)} больше 0,4 (площадь всех этажей ${m2(s.gross)}) — сверьте с ПЗЗ`, srcK, plots[0].pts[0]);
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
    // смета — скрытый раздел (Ctrl+Alt+S): в отчёте только после того, как её открыли в этом сеансе
    if (Estimate.shown) { const est = Estimate.totals(Estimate.rows()); if (est.total) stats.push({ title: 'Смета (ориентировочно)', rows: [['Итого с резервом ' + est.pct + '%', Estimate.money(est.total)]] }); }

    // ---------------- помещения ----------------
    const rooms = [];
    for (const f of fd) Drawing.onFloor(f.floor.id, () => {
      for (const r of f.rooms) {
        const nm = (r.name || '').toLowerCase();
        // окна в стенах + мансардные окна в скате над комнатой (свет по площади окна)
        const rw = d.items.filter(it => catItem(it.key).shape === 'roofWindow' && (it.floor || d.floors[0].id) === f.floor.id && G.pointInPoly(it, r.floor || r.axis));
        const ws = [...Rooms.windowsOf(r), ...rw.map(it => ({ op: { w: it.w, h: it.d }, roof: true }))], glass = ws.reduce((a, w) => a + w.op.w * w.op.h, 0);
        const living = !!(r.tag && r.tag.living) || /спальн|гостин|детск|кабинет|комнат/.test(nm);
        const kitchen = /кухн/.test(nm);
        const at = G.polyCentroid(r.floor || r.axis);
        rooms.push({ name: r.name, floor: f.floor.name, area: r.areaFloor, windows: ws.length, ratio: glass ? r.areaFloor / glass : Infinity, living, kitchen });
        // освещённость: площадь окон к площади пола жилых комнат и кухни — не менее 1:8
        if ((living || kitchen) && !ws.length) add('bad', 'Освещённость', `${r.name}: нет окон — жилой комнате и кухне нужно естественное освещение`, 'СП 55.13330, СанПиН 1.2.3685-21', at);
        else if ((living || kitchen) && r.areaFloor / glass > 8.05) add('bad', 'Освещённость', `${r.name}: окна 1:${(r.areaFloor / glass).toFixed(1)} к площади пола (норма не меньше 1:8 — нужно ещё ≈ ${m2(r.areaFloor / 8 - glass)} остекления)`, 'СП 55.13330.2016', at, null, () => {
          // расширить самое широкое окно комнаты на недостающую площадь (в пределах стены и простенков по 30 см)
          const need = r.areaFloor / 8 - glass, big = ws.map(x => x.op).sort((a, b) => b.w - a.w)[0], g = Model.opGeom(big);
          if (!big || !g) return;
          const others = App.V.openings.filter(o => o !== big && o.wall === big.wall).map(o => Model.opGeom(o)).filter(Boolean);
          let room = Math.min(g.pos, g.L - g.pos) * 2 - 60;                                        // до углов
          for (const q of others) room = Math.min(room, 2 * (Math.abs(q.pos - g.pos) - q.width / 2 - 30));
          big.w = Math.round(Math.min(Math.max(big.w, room), big.w + Math.ceil(need / big.h / 5) * 5));
          Model.commit();
        });
        // мансарда: высота до потолка (по скату / ригелям) — жилым комнатам и кухне ≥ 2,5 м не менее чем на половине площади
        {
          const MH = Roof.roomHeights(r.floor || r.axis, f.floor);
          if (MH) {
            const { hi, lo15 } = MH, H = [MH.min, MH.max];
            r._mans = MH;
            if ((living || kitchen) && hi < 0.5) add('bad', 'Мансарда', `${r.name}: высота ≥ 2,5 м только на ${Math.round(hi * 100)} % площади — нужно не меньше половины (поднимите кнеевую стену или уклон)`, 'СП 55.13330.2016 п. 6.2; СП 54.13330.2022 п. 5.12', at);
            else if (/коридор|холл/.test(nm) && Math.max(...H) < 210) add('bad', 'Мансарда', `${r.name}: высота меньше 2,1 м`, 'СП 55.13330.2016 п. 6.2', at);
            add('note', 'Мансарда', `${r.name}: высота ${(r._mans.min / 100).toFixed(2)}…${(r._mans.max / 100).toFixed(2)} м, ≥ 2,5 м — ${Math.round(hi * 100)} % площади${lo15 > 0 ? `, ниже 1,5 м — ${Math.round(lo15 * 100)} % (в площадь с коэффициентом 0,7)` : ''}`, 'СП 54.13330.2022, прил. А', at);
          }
        }
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
    // двери: одинарные межкомнатные — одной стандартной ширины (ГОСТ 475), наружные — не уже 90 (ширина выхода в свету ≥ 0,8 м)
    {
      const DS = d.openings.filter(o => o.type === 'door' || o.type === 'slide').map(o => ({ o, w: Model.get(o.wall) })).filter(x => x.w);
      const inn = DS.filter(x => x.w.kind !== 'ext'), cnt = {};
      for (const x of inn) cnt[x.o.w] = (cnt[x.o.w] || 0) + 1;
      const std = +Object.entries(cnt).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
      const odd = inn.filter(x => x.o.w !== std || ![60, 70, 80, 90].includes(x.o.w));
      if (odd.length && std) add('warn', 'Двери', `Межкомнатные двери разной ширины: ${odd.map(x => U.fmtLen(x.o.w)).join(', ')} при основной ${U.fmtLen(std)} — одинаковые полотна дешевле и проще в заказе (двустворчатые — отдельно)`, 'ГОСТ 475-2016 (полотна 600, 700, 800, 900 мм)', G.mid(...(() => { const g = Model.opGeom(odd[0].o); return [g.a, g.b]; })()), odd[0].o.id, () => { for (const x of odd) x.o.w = [60, 70, 80, 90].includes(std) ? std : 80; });
      // входы в жилую часть; дверь техпомещения (котельная, кладовая) — по месту, обычно 80
      const roomOf = (o) => { const g = Model.opGeom(o); if (!g) return null; const m = G.mid(g.a, g.b); const fd = (App.floorData || []).find(f => f.floor.id === (Model.get(o.wall).floor || d.floors[0].id)); return fd && fd.rooms.find(r => G.distPoly(m, r.floor || r.axis) < Model.get(o.wall).th / 2 + 15); };
      for (const x of DS.filter(y => y.w.kind === 'ext' && y.o.type === 'door' && y.o.w < 90 && !/котельн|топоч|кладов|техн|гараж/i.test((roomOf(y.o) || {}).name || ''))) {
        const g = Model.opGeom(x.o);
        add('warn', 'Двери', `Наружная дверь ${U.fmtLen(x.o.w)}: у входной (эвакуационной) двери ширина в свету должна быть не меньше 0,8 м — это полотно 90 см (стандартная входная дверь 860–960 мм)`, 'СП 1.13130.2020 п. 4.2.5; ГОСТ 31173-2016', g ? G.mid(g.a, g.b) : null, x.o.id, () => { x.o.w = 90; });
      }
    }
    // теплозащита по ГСОП города: наружные стены, чердачное перекрытие / скаты мансарды (облицовка за вентзазором не считается)
    {
      const city = Climate.get().city, src = `СП 50.13330.2024 п. 5.2, табл. 3; ГСОП ≈ ${Climate.gsop()} °C·сут (${city}, оценка по СП 131.13330)`, needW = Climate.Rreq('wall'), seen = new Set();
      for (const w of d.walls.filter(x => x.kind === 'ext' && WALL_MATERIALS[x.mat])) {
        const R = wallR(w), k = [w.mat, Math.round(w.th), w.ins || 0, w.clad || 0].join(':');
        if (seen.has(k)) continue;
        seen.add(k);
        const nm = `Наружные стены (${WALL_MATERIALS[w.mat].name.toLowerCase()}${w.ins ? ` + минвата ${w.ins} см` : ''})`;
        if (R < needW - 0.005) { const cm = Math.ceil((needW - R) * INSULATION_LAM * 100 / 5) * 5;
          add('warn', 'Теплозащита', `${nm}: R = ${R.toFixed(2)} при норме ${needW.toFixed(2)} м²·°C/Вт${w.clad > 0 ? ' (облицовка за вентзазором теплозащиту не даёт)' : ''} — добавьте ${cm} см минваты (стены утолщаются наружу, комнаты не меняются)`, src, G.mid(w.a, w.b), w.id, () => Finish.addIns(cm)); }
        else add('note', 'Теплозащита', `${nm}: R = ${R.toFixed(2)} ≥ ${needW.toFixed(2)} м²·°C/Вт — норма выполнена`, src);
      }
      for (const r of d.roofs) {
        const fr = Roof.frame(r), A = fr && fr.attic;
        if (!A || !U.isNum(A.R)) continue;
        const nm = A.mansard ? `Скаты мансарды (минвата ${A.ins} мм по стропилам)` : `Чердачное перекрытие (минвата ${A.ins} мм${A.auto ? ', подобрано по норме с запасом 10 % на мостики холода' : ''})`;
        if (A.R < A.need - 0.005) add('warn', 'Теплозащита', `${nm}: R = ${A.R.toFixed(2)} при норме ${A.need.toFixed(2)} м²·°C/Вт — увеличьте утеплитель`, src, { x: r.x, y: r.y }, r.id, A.mansard ? null : () => { delete r.atticIns; });
        else add('note', 'Теплозащита', `${nm}: R = ${A.R.toFixed(2)} ≥ ${A.need.toFixed(2)} м²·°C/Вт — норма выполнена (с учётом деревянных ${fr.scheme === 'truss' ? 'поясов ферм' : 'балок'} как мостиков холода)`, src);
      }
    }
    // высота этажей
    for (const f of d.floors) {
      if (d.roofs.some(r => r.floor === f.id && Roof.living(r))) continue;                  // мансарда: высоты — по помещениям под скатами (выше)
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
    // этажи: на верхний этаж с помещениями — лестница с нижнего; ступени — по СП (подъём ≤ 20 см, уклон ≤ 1:1,25, у винтовой проступь в середине ≥ 18 см)
    d.floors.forEach((f, i) => {
      if (i === 0) return;
      const fdi = (App.floorData || []).find(x => x.floor.id === f.id), lower = d.floors[i - 1];
      if (!fdi || !fdi.rooms.length) return;
      const st = d.items.filter(it => (it.floor || d.floors[0].id) === lower.id && ['stairs', 'stairsL', 'stairsSpiral'].includes(catItem(it.key).shape));
      if (!st.length) { add('bad', 'Лестница', `${f.name}: нет лестницы с нижнего этажа`, 'СП 55.13330.2016 п. 6.9', fdi.rooms[0].label || G.polyCentroid(fdi.rooms[0].floor), null); return; }
      const H = f.elev - lower.elev;
      for (const it of st) {
        const sh = catItem(it.key).shape, nm = it.label || catItem(it.key).name;
        if (!fdi.rooms.some(q => G.pointInPoly(it, q.floor || q.axis))) add('bad', 'Лестница', `${nm}: наверху выход не в помещение — проверьте положение проёма`, '', it, it.id);
        if (sh === 'stairsSpiral') {
          const S2 = spiralGeom(it, H);
          if (S2.mid < 18) add('bad', 'Лестница', `${nm}: проступь в середине ${m(S2.mid)} — нужно ≥ 0,18 м (увеличьте диаметр)`, 'СП 55.13330.2016 п. 6.9', it, it.id);
          if (S2.rise > 20.5) add('bad', 'Лестница', `${nm}: подъём ступени ${S2.rise.toFixed(1)} см — не выше 20 см`, 'СП 55.13330.2016 п. 6.9', it, it.id);
          if (S2.head < 200) add('bad', 'Лестница', `${nm}: над ступенью через виток ${m(S2.head)} — высота прохода должна быть ≥ 2,0 м`, 'СП 55.13330.2016 п. 6.9', it, it.id);
        } else {
          const n = Math.max(3, Math.round(H / 17.5)), going = (sh === 'stairs' ? it.d : it.d + it.w - Math.min(it.w / 2, 100)) / n;
          if ((H / n) / going > 1 / 1.25 + 0.01) add('warn', 'Лестница', `${nm}: уклон 1:${(going / (H / n)).toFixed(2)} — круче 1:1,25; удлините марш`, 'СП 55.13330.2016 п. 6.9', it, it.id);
          if (Math.min(it.w, sh === 'stairs' ? it.w : 100) < 89.5) add('warn', 'Лестница', `${nm}: ширина марша ${m(Math.min(it.w, 100))} — нужно ≥ 0,9 м`, 'СП 55.13330.2016 п. 6.9', it, it.id);
        }
      }
    });

    // ---------------- скважина / колодец у границы с соседом: его септик может оказаться рядом ----------------
    Analysis.wellsBound(d, add, m);
    Analysis.septicOut(d, add);

    // ---------------- электрика: группы щита, автомат против сечения, УЗО на розетках ----------------
    Analysis.electric(d, add, stats);
    Analysis.mounts(d, add);

    // ---------------- освещение помещений и гаража (СП 52.13330) ----------------
    Analysis.lighting(d, fd, add, stats);

    // ---------------- видеонаблюдение: охват периметра участка ----------------
    const cov = Analysis.cctv(d, fd);
    if (cov) {
      const at = stats.findIndex(x => /Смета/.test(x.title));
      stats.splice(at < 0 ? stats.length : at, 0, { title: 'Видеонаблюдение', rows: [['Камер', String(cov.cams)], ['Подходы к дому и гаражу в обзоре', `${cov.pctHouse.toFixed(0)}%`], ['Въезды и калитки в обзоре', `${cov.doors - cov.blind.length} из ${cov.doors}`], ['Периметр участка (справочно)', `${cov.pct.toFixed(0)}%`]] });
      for (const g of cov.hGaps.slice(0, 4)) add('warn', 'Видеонаблюдение', `подход к стене ${m(g.len)} не попадает ни в одну камеру — поверните камеру на углу или добавьте`, 'Камеры на углах дома и гаража под свесом: каждая стена и вход — в обзоре соседней камеры', g.at);
      // камера на стене дома или постройки — под свесом, ниже карниза (иначе висит над кровлей и мокнет)
      for (const c of d.items.filter(o => catItem(o.key).shape === 'cctv')) {
        const bld = d.items.find(o => BLD_HOLLOW.has(catItem(o.key).shape) && G.distPoly(c, Model.itemPts(o)) < 40);
        const house = d.roofs.find(r => r.type !== 'flat' && Roof.zAt(r, c) != null && (App.floorData || []).some(f => f.outlines.some(o => G.distPoly(c, o.outer) < 40)));
        // камера утоплена в стену — выносим на наружную грань (кронштейн)
        const wIn = d.walls.find(w => { if (w.kind !== 'ext') return false; const pr = G.proj(c, w.a, w.b); return pr.tc > 0.001 && pr.tc < 0.999 && pr.d < w.th / 2 - 1; });
        if (wIn) add('warn', 'Видеонаблюдение', `${c.label || catItem(c.key).name}: камера внутри стены — её не видно и она ничего не видит; вынести на кронштейн на наружную грань`, 'Паспорт камеры: крепление на кронштейне к фасаду', c, c.id, () => {
          const u = Model.wallDir(wIn), pr = G.proj(c, wIn.a, wIn.b); let n = G.perp(u);
          const probe = G.add(pr.q, G.mul(n, wIn.th / 2 + 20));
          if ((App.floorData || []).some(f => f.outlines.some(o => G.pointInPoly(probe, o.outer)))) n = G.mul(n, -1);
          const q = G.add(pr.q, G.mul(n, wIn.th / 2 + 8)); c.x = Math.round(q.x); c.y = Math.round(q.y); Model.commit();
        });
        // камера смотрит от стены наружу (на участок и забор), и первые 3 м обзора ничем не перекрыты
        const outl = [...(App.floorData || []).flatMap(f => f.outlines.map(o => o.outer)), ...d.items.filter(o => BLD_HOLLOW.has(catItem(o.key).shape)).map(o => Model.itemPts(o))];
        const host = outl.map(poly => ({ poly, dd: G.distPoly(c, poly) })).filter(x => x.dd < 60).sort((a, b) => a.dd - b.dd)[0];
        if (host && !wIn) {
          const cen = G.polyCentroid(host.poly), rr = U.rad(c.rot || 0), dir = { x: -Math.sin(rr), y: Math.cos(rr) };
          // наружная нормаль: от ближайшей точки контура к камере (у угла — биссектриса)
          let best = null;
          for (let i = 0; i < host.poly.length; i++) { const a2 = host.poly[i], b2 = host.poly[(i + 1) % host.poly.length], pr = G.proj(c, a2, b2); if (!best || pr.d < best.d) best = { d: pr.d, q: pr.q }; }
          let nOut = G.sub(c, best.q); if (G.len(nOut) < 1) nOut = G.sub(c, cen);
          nOut = G.unit(nOut);
          const inside = G.pointInPoly(c, host.poly);
          const lookIn = dir.x * nOut.x + dir.y * nOut.y < -0.7;                  // вдоль стены с угла — можно, прямо в стену — нет
          const blocked = [40, 80, 120].some(k => { const p = G.add(c, G.mul(dir, k)); return outl.some(poly => G.pointInPoly(p, poly)); });
          if (inside || lookIn || blocked) add('warn', 'Видеонаблюдение', `${c.label || catItem(c.key).name}: ${inside ? 'стоит внутри контура здания — снаружи не видна' : lookIn ? 'смотрит на стену, а не от дома на участок' : 'обзор перекрыт стеной или постройкой вплотную (ближе 1,2 м)'} — развернуть от стены в сторону участка и забора`,
            'Камеры — на углах и фасадах под свесом, объективом от здания; в кадре — подходы, двери, ворота', c, c.id, () => {
              if (inside) { const q = G.add(best.q, G.mul(nOut, 8)); c.x = Math.round(q.x); c.y = Math.round(q.y); }
              // новый взгляд: наружу, с сохранением бокового наклона вдоль стены (≤ 50°)
              const t = { x: -nOut.y, y: nOut.x }, side = Math.sign(dir.x * t.x + dir.y * t.y) || 1, nd = G.unit(G.add(nOut, G.mul(t, side * 0.8)));
              c.rot = Math.round(U.deg(Math.atan2(-nd.x, nd.y))); Model.commit();
            });
        }
        const eave = bld ? bldWallH(bld) : house ? (house.base || 0) : null;
        if (eave != null && (c.h || 0) > eave - 15) add('warn', 'Видеонаблюдение', `${c.label || catItem(c.key).name}: высота ${Math.round(c.h)} см — выше карниза (${Math.round(eave)} см); камеру вешают под свес, на 20–30 см ниже карниза`, 'Паспорт камеры: защита от осадков — под свесом кровли', c, c.id, () => { c.h = Math.round(eave - 25); Model.commit(); });
      }
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
    const fl = (w) => w.floor || d.floors[0].id;
    for (const w of W) for (const e of ['a', 'b']) for (const o of W) if (o !== w && fl(o) === fl(w)) for (const f of ['a', 'b']) {                   // стыки — только на одном этаже
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
    // верх проёмов (перемычки) в одной несущей стене — на одном уровне: одна отметка U-блоков, ровный фасад
    for (const w of d.walls) {
      if (w.kind !== 'ext' && w.kind !== 'int') continue;
      const ops = d.openings.filter(o => o.wall === w.id).map(o => { const T = OPENING_TYPES[o.type] || {}, win = T.cat === 'window'; return { o, win, top: (win ? o.sill || 0 : 0) + (o.h || T.h || 0) }; });
      if (ops.length < 2) continue;
      const tops = ops.map(x => x.top), lo = Math.min(...tops), hi = Math.max(...tops);
      if (hi - lo <= 5) continue;
      const doors = ops.filter(x => !x.win && OPENING_TYPES[x.o.type] && x.o.type !== 'gate' && x.o.type !== 'arch');
      const target = doors.length ? Math.max(...doors.map(x => x.top)) : hi;
      const wins = ops.filter(x => x.win && Math.abs(x.top - target) > 5);
      if (!wins.length) continue;
      add('warn', 'Конструкции', `Стена ${m(Model.wallLen(w))}: верх проёмов на разных отметках (${[...new Set(tops.map(Math.round))].sort((a, b) => a - b).join(', ')} см) — перемычки на одном уровне проще в кладке и ровнее на фасаде; выровнять окна по верху дверей (${Math.round(target)} см)`,
        'СП 15.13330.2020 (перемычки); единая отметка перемычек — один ряд U-блоков', G.mid(w.a, w.b), w.id, () => {
          for (const x of wins) {
            const o = x.o, keepSill = (o.sill || 0) >= 120;                                    // высокие окна (санузел, котельная) — сохраняем высоту
            if (keepSill || target - (o.h || 0) >= 80) o.sill = Math.max(0, target - o.h);
            else { o.sill = 80; o.h = Math.max(60, target - 80); }
          }
          Model.commit();
        });
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
  /** Септик без почвенной доочистки: с 10.03.2026 сброс в канаву, кювет, овраг запрещён — только доочистка в грунте в границах участка.
   *  Фильтрующий колодец работает лишь в песках и супесях на глубине его дна; в глинах и суглинках — поле фильтрации, инфильтраторы или накопитель с вывозом */
  septicOut(d, add) {
    const f1 = d.floors[0].id, sep = d.items.filter(it => (it.floor || f1) === f1 && ['septic2', 'septic3', 'septicRing'].includes(it.key));
    if (!sep.length || typeof Struct === 'undefined') return;
    const post = d.items.some(it => it.key === 'filterField' || /инфильтр|поле фильтрац|фильтрующ|доочист/i.test((it.label || '') + ' ' + (it.note || '')));
    const S = Struct.soilAt(2.5), sandy = S === SOILS.sand || S === SOILS.sandFine || S === SOILS.sandyLoam;
    if (post) return;
    add('warn', 'Канализация', sandy
      ? 'Септик: не указана почвенная доочистка — подпишите последний колодец как фильтрующий (дно без днища, щебень 30–50 см) или добавьте поле фильтрации / инфильтраторы; сброс в канаву запрещён'
      : `Септик: на глубине дна — ${S.name.toLowerCase()}, стоки в грунт не уйдут, а сброс в канаву запрещён — нужна доочистка в верхнем проницаемом слое (инфильтраторы, фильтрующая кассета) либо герметичный накопитель с вывозом`,
      'СанПиН 2.1.3684-21 (изм. от 12.02.2026, с 10.03.2026); СП 32.13330.2018 п. 9', sep[0], sep[0].id);
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
      const ok = (l, p) => items.some(it => inRect(it, p, 15) && (itemLinks(it).some(([, ks]) => ks.includes(l.kind)) || catItem(it.key).sym || ['pit', 'ring', 'borehole', 'well', 'septic', 'boiler', 'pole', 'ground'].includes(catItem(it.key).shape)))
        || lines.some(x => x !== l && sysOfLine(x) === sysOfLine(l) && x.pts.some((q, i) => G.dist(q, p) <= 15 || (i && G.distSeg(p, x.pts[i - 1], q) <= 8)));
      const mans = items.filter(it => it.key === 'manifoldWF');
      // тёплый пол: у коллектора — подводки, на их концах — контуры (подача и обратка рядом); касание соседнего контура — не подключение
      const atMan = (p) => mans.some(m => inRect(m, p, 20));
      const wf = lines.filter(l => l.kind === 'warmfloor'), ends = (l) => [l.pts[0], l.pts[l.pts.length - 1]];
      const feeder = (l) => ends(l).some(atMan);
      const wfOk = (l, p) => atMan(p) || wf.some(x => x !== l && feeder(x) !== feeder(l) && ends(x).some(q => G.dist(q, p) <= 15));
      let nFeed = 0;
      for (const l of lines) {
        if (l.kind === 'warmfloor') {
          if (feeder(l)) {                                                       // подводка: второй конец — у начала контура
            const far = ends(l).find(p => !atMan(p));
            if (far && !wfOk(l, far)) add('warn', 'Подключения', `${l.label || 'Подводка тёплого пола'}: конец подводки не доходит до контура`, SRC.warmfloor, far, l.id);
            continue;
          }
          // контур: подача и обратка — у коллектора или на конце подводки от него
          const bad = ends(l).filter(p => !wfOk(l, p));
          if (!bad.length || !mans.length) continue;
          const [e0, e1] = ends(l), p = G.dist(e0, e1) < 30 ? G.mid(e0, e1) : bad[0];     // подача и обратка рядом — подводка к середине между ними
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
      if (t) Model.add('lines', { kind: 'power', depth: 0, section: 'ВВГнг(А)-LS 2×1,5', label: `36 В → ${(it.label || 'светильник').replace(/^Светильник 36 В — /, '')}`, note: 'Безопасное напряжение 36 В от разделительного трансформатора (ПУЭ 6.1.16)', pts: [{ x: t.x, y: t.y }, { x: t.x, y: it.y }, { x: it.x, y: it.y }].filter((p, i, a) => !i || G.dist(p, a[i - 1]) > 1), floor: t.floor });
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
  /** Розетки, выключатели и прочее на стене: не внутри стены и не на проёме / наличнике двери или окна */
  mounts(d, add) {
    const WALLY = new Set(['socket', 'socket2', 'socketP', 'switch', 'switch2', 'lan', 'tvSocket', 'thermostat', 'intercom']);
    const f1 = d.floors[0].id;
    for (const it of d.items) {
      const def = catItem(it.key);
      if (!def.sym || !WALLY.has(def.shape)) continue;
      let best = null;
      for (const w of d.walls) {
        if (w.kind === 'fence' || (w.floor || f1) !== (it.floor || f1)) continue;
        const pr = G.proj(it, w.a, w.b);
        if (pr.tc <= 0 || pr.tc >= 1) continue;
        const dd = pr.d - w.th / 2;
        if (dd < 12 && (!best || dd < best.dd)) best = { w, dd, pr };
      }
      if (!best) continue;
      const { w, pr } = best, u = Model.wallDir(w), L = Model.wallLen(w), s = pr.tc * L, n = G.perp(u);
      const side = Math.sign(G.dot(G.sub(it, w.a), n)) || 1, ang = U.deg(Math.atan2(u.y, u.x));
      const name = it.label || def.name;
      // внутри стены или повёрнут поперёк неё — ставим на лицевую сторону, вдоль стены
      const diff = ((((it.rot || 0) - ang) % 180) + 180) % 180;
      if (best.dd < -1 || Math.abs(diff - 90) < 30) {
        add('warn', 'Электрика', `${name}: стоит ${best.dd < -1 ? 'внутри стены' : 'поперёк стены'} — поставить на стену, вдоль неё`, 'ПУЭ 7.1.48–7.1.51; монтаж — в подрозетник на лицевой стороне стены', it, it.id, () => {
          const q = G.add(G.add(w.a, G.mul(u, s)), G.mul(n, side * (w.th / 2 + (it.d || 4) / 2)));
          it.x = Math.round(q.x * 10) / 10; it.y = Math.round(q.y * 10) / 10; it.rot = Math.round(side > 0 ? ang : ang + 180) % 360; Model.commit();
        });
        continue;
      }
      // на двери / окне / наличнике: до кромки проёма ≥ 10 см (наличник 7 см + зазор), у окна — ниже подоконника
      for (const o of d.openings.filter(x => x.wall === w.id)) {
        const T = OPENING_TYPES[o.type] || {}, win = T.cat === 'window', g = Model.opGeom(o);
        if (!g) continue;
        const half = g.width / 2 + 10 + (it.w || 8) / 2, off = s - g.pos, h = it.h || 0;
        const zHit = win ? h > (o.sill || 0) - 8 && h < (o.sill || 0) + (o.h || 0) + 10 : h < (o.h || 210) + 12;
        if (Math.abs(off) >= half || !zHit) continue;
        const ns = g.pos + Math.sign(off || 1) * (half + 1), ok = ns > (it.w || 8) / 2 + 5 && ns < L - (it.w || 8) / 2 - 5;
        add('warn', 'Электрика', `${name}: заходит на ${win ? 'окно' : 'дверной проём или наличник'} — сдвинуть вдоль стены на ${Math.round(Math.abs(half - Math.abs(off)))} см`, 'Выключатель — у двери со стороны ручки, 10–15 см от наличника; розетки — не на откосах и наличниках', it, it.id, ok ? () => {
          const q = G.add(G.add(w.a, G.mul(u, ns)), G.mul(n, side * (w.th / 2 + (it.d || 4) / 2)));
          it.x = Math.round(q.x * 10) / 10; it.y = Math.round(q.y * 10) / 10; Model.commit();
        } : null);
        break;
      }
    }
  },
  electric(d, add, stats) {
    const groups = d.lines.filter(l => l.kind === 'power' && !(l.depth > 0) && (l.breaker || l.rcd));
    if (!groups.length) return;
    const LIM = { 1.5: 16, 2.5: 25, 4: 32, 6: 40, 10: 50, 16: 63, 25: 80 };
    const SOCK = new Set(['socket', 'socket2', 'socketP', 'socketOut']);
    const rows = [];
    for (const l of groups) {
      const sec = parseFloat(String(l.section || '').replace(',', '.').split('×').pop()), nums = String(l.breaker || '').match(/\d+(?:[.,]\d+)?/g), amp = nums ? parseFloat(nums[nums.length - 1].replace(',', '.')) : NaN;   // «3P C25» → 25
      const devs = d.items.filter(it => catItem(it.key).sym && (it.floor || d.floors[0].id) === (l.floor || d.floors[0].id) && l.pts.some(p => G.dist(it, p) < 5));   // точки линии — на её этаже
      const socks = devs.filter(it => SOCK.has(catItem(it.key).shape));
      rows.push([l.label || 'Линия', `${l.breaker || '—'}${l.rcd ? ' + УЗО ' + l.rcd : ''} · ${l.section || ''}${devs.length ? ` · ${devs.length} точ.` : ''}`]);
      const REC = { 1.5: 'C10', 2.5: 'C16', 4: 'C25', 6: 'C32', 10: 'C40', 16: 'C50', 25: 'C63' };
      if (LIM[sec] && amp > LIM[sec]) add('bad', 'Электрика', `${l.label || 'Линия'}: автомат ${l.breaker} больше допустимого для кабеля ${sec} мм² (до ${LIM[sec]} А) — кабель перегреется раньше, чем сработает автомат`, 'ПУЭ табл. 1.3.4, п. 3.1.4', l.pts[0], l.id, () => { l.breaker = (/3P/.test(l.breaker) ? '3P ' : '') + REC[sec]; });
      if (socks.length && !l.rcd) add('warn', 'Электрика', `${l.label || 'Линия'}: розетки без УЗО — поставьте УЗО или дифавтомат 30 мА`, 'ПУЭ 7.1.79, 7.1.83; СП 256.1325800.2016 п. 15.3', l.pts[0], l.id, () => { l.rcd = '30 мА'; });
    }
    // ввод в частный дом (ВЛ, система TN-C-S): повторное заземление PEN на вводе и контур у фундамента — обязательно
    const rod = d.items.find(it => catItem(it.key).shape === 'ground'), vru = d.items.find(it => it.key === 'meter') || d.items.find(it => it.key === 'panel');
    if (!rod && vru) add('warn', 'Электрика', 'Нет контура заземления: на вводе нужно повторное заземление PEN (TN-C-S) — 3 электрода Ø16 × 3 м треугольником со стороной 3 м, полоса 40×4 на глубине 0,5 м, не ближе 1 м от фундамента, R ≤ 30 Ом; от контура — к ГЗШ щита',
      'ПУЭ 1.7.61, 1.7.103, 7.1.88; СП 256.1325800.2016 п. 15.11', vru, vru.id, () => {
        const outl = (App.floorData || []).flatMap(f => f.outlines.map(o => o.outer)), inH = (p) => outl.some(o => G.pointInPoly(p, o));
        const w = d.walls.filter(x => x.kind === 'ext').map(x => ({ x, pr: G.proj(vru, x.a, x.b) })).sort((a, b) => a.pr.d - b.pr.d)[0];
        if (!w) return;
        let n = G.perp(Model.wallDir(w.x));
        if (inH(G.add(w.pr.q, G.mul(n, w.x.th / 2 + 20)))) n = G.mul(n, -1);
        const face = G.add(w.pr.q, G.mul(n, w.x.th / 2)), c = G.add(face, G.mul(n, 170)), r = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
        Model.add('items', { key: 'groundRod', x: Math.round(c.x), y: Math.round(c.y), w: 100, d: 100, h: 0, rot: 0, flip: false, floor: d.floors[0].id, label: 'Контур заземления', note: '3 электрода Ø16 × 3 м (треугольник, сторона 3 м), полоса 40×4 на глубине 0,5 м; R ≤ 30 Ом — замер после монтажа' });
        Model.add('lines', { kind: 'ground', depth: 50, section: 'Полоса 40×4 / провод ПуГВ 1×16 в щит', label: 'З-1 Контур → ВРУ (ГЗШ)', floor: d.floors[0].id, pts: [r(c), r(face), r(vru)] });
      });
    // в доме и постройках — кабель, не распространяющий горение в пучке, с низким дымо- и газовыделением
    const bad = d.lines.filter(l => l.kind === 'power' && !(l.depth > 0) && !/нг\(А\)/i.test(l.section || ''));
    if (bad.length) add('warn', 'Электрика', `${bad.length} линий в здании без индекса нг(А)-LS (${[...new Set(bad.map(l => l.section || 'марка не указана'))].join(', ')}) — для жилого дома нужен кабель ВВГнг(А)-LS: не распространяет горение в пучке, мало дыма`, 'СП 6.13130.2026; ГОСТ 31565-2012 табл. 2', bad[0].pts[0], bad[0].id, () => {
      for (const l of bad) {
        const m = String(l.section || '').match(/\d+\s*[×x]\s*\d+(?:[.,]\d+)?/);
        l.section = 'ВВГнг(А)-LS ' + (m ? m[0].replace(/\s|x/g, s => s === 'x' ? '×' : '').replace('.', ',') : '3×1,5');
      }
    });
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
    const ring = blds.slice(0, (fl ? fl.outlines.length : 0)).concat(d.items.filter(it => (it.floor || f1) === f1 && BLD_HOLLOW.has(catItem(it.key).shape) && (catItem(it.key).shape === 'garage' || it.w * it.d >= 20e4)).map(it => Model.itemPts(it)));   // подходы — к дому, гаражу и большим постройкам (сарай до 20 м² — нет)
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
        const stove = inR.find(it => ['stoveHeat', 'fireplace', 'fireplaceCorner', 'stoveMetal'].includes(catItem(it.key).shape) && it.key !== 'saunaHeater');
        const kitchen = /кухн/.test(nm), wc = /сануз|с\/у|туалет|уборн/.test(nm), bath = /ванн|душ/.test(nm) || inR.some(it => ['bath', 'bathCorner', 'shower'].includes(catItem(it.key).shape));
        const living = !!(r.tag && r.tag.living) || /спальн|гостин|детск|кабинет|комнат/.test(nm);
        const hood = inR.some(it => it.key === 'hood'), gasStove = inR.find(it => (/gas/i.test(it.key) && catItem(it.key).shape === 'stove') || (KITCHEN_SHAPES.has(catItem(it.key).shape) && it.hob === 'gas'));
        let q = 0, why = '';
        if (kitchen) { q = gasStove ? 90 : 60; why = gasStove ? 'кухня с газовой плитой — 90 м³/ч' : 'кухня — 60 м³/ч (с газовой плитой — 90)'; }
        else if (/парн|саун/.test(nm)) { q = Math.ceil(5 * A * H); why = `парная — 5 объёмов в час (${q} м³/ч): приток низко у каменки, вытяжка — под потолком с противоположной стороны`; }
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
    // гараж: хранение не должно зажимать машину — проход ≥ 0,5 м (открыть дверь, пройти); антресоль — выше крыши машины
    for (const st of d.items.filter(o => ['garageRack', 'workbench', 'tireRack', 'ceilRack'].includes(catItem(o.key).shape))) {
      const sp = Model.itemPts(st), def = catItem(st.key), fl = st.floor || f1;
      for (const car of d.items.filter(o => catItem(o.key).shape === 'car' && (o.floor || f1) === fl)) {
        const cp = Model.itemPts(car);
        if (def.shape === 'ceilRack') {
          const z0 = st.z0 ?? def.z0 ?? 180, ch = car.h || catItem(car.key).h || 150;
          if (cp.some(q => G.pointInPoly(q, sp)) || sp.some(q => G.pointInPoly(q, cp))) { if (z0 < ch + 20) add('bad', 'Гараж', `${name(st)}: низ на ${m(z0)} — над машиной высотой ${m(ch)} нужно ≥ 20 см зазора`, 'эксплуатация гаража', st, st.id); }
          continue;
        }
        const gap = Math.min(...sp.map(p => G.distPoly(p, cp)), ...cp.map(p => G.distPoly(p, sp)));
        if (gap < 49.5) add('warn', 'Гараж', `${name(st)}: до машины ${m(Math.max(0, gap))} — оставьте проход ≥ 0,5 м (дверь, багажник, пройти с инструментом)`, 'эргономика гаража (проход вдоль машины ≥ 0,5 м)', st, st.id);
      }
    }
    // кондиционер: струя (вперёд от блока, ±20°) не должна упираться в высокую мебель — сдувает пыль, срывает поток —
    // и дуть в упор на кровать, диван, рабочее место
    for (const ac of d.items.filter(o => o.key === 'ac')) {
      const fl = ac.floor || f1, zb = U.isNum(ac.z0) ? ac.z0 : 225, fwd = G.unit(G.sub(G.toWorld({ x: 0, y: 1 }, ac.x, ac.y, ac.rot || 0), ac));
      const src = G.toWorld({ x: 0, y: ac.d / 2 }, ac.x, ac.y, ac.rot || 0);
      const inJet = (p, L) => { const v = G.sub(p, src), a = G.dot(v, fwd); return a > 0 && a < L && Math.abs(G.cross(fwd, v)) <= a * Math.tan(U.rad(20)) + ac.w / 2; };
      for (const o of d.items.filter(x => x !== ac && (x.floor || f1) === fl)) {
        const od = catItem(o.key), sh = od.shape, top = o.h || od.h || 0;
        if (od.sym || od.layer === 'siteobj') continue;
        const pts = [o, ...Model.itemPts(o)];
        const tall = od.layer === 'furniture' && top >= zb - 40 && pts.some(p => inJet(p, 150));
        // блок над самим изголовьем — струя идёт под потолком над головой, это допустимое место
        const above = G.distPoly(src, Model.itemPts(o)) < 30;
        const rest = !above && ['bed', 'sofa', 'sofaL', 'armchair', 'desk', 'deskL', 'officeChair'].includes(sh) && pts.filter(p => inJet(p, 250)).length >= 2;
        if (tall) add('warn', 'Кондиционер', `${name(ac)}: струя упирается в «${name(o)}» (${m(top)} высотой) ближе 1,5 м — сдувает пыль, воздух не расходится по комнате; перевесьте блок или передвиньте мебель`, 'инструкция производителя: свободное пространство перед блоком', ac, ac.id);
        else if (rest) add('warn', 'Кондиционер', `${name(ac)}: дует на «${name(o)}» ближе 2,5 м — направьте струю вдоль комнаты (над дверью, мимо мест отдыха и работы)`, 'СП 60.13330.2020 (скорость воздуха в зоне пребывания)', ac, ac.id);
      }
    }
    for (const it of d.items) {
      const sh = catItem(it.key).shape;
      if (!['stoveHeat', 'fireplace', 'fireplaceCorner', 'stoveMetal'].includes(sh) || it.key === 'saunaHeater') continue;   // электрокаменке дымоход не нужен
      const fl = it.floor || f1, poly = Model.itemPts(it);
      const flue = d.items.find(o => catItem(o.key).stack === 'smoke' && (o.floor || f1) === fl && near(o, poly, 60));
      if (!flue) add('bad', 'Печь', `${name(it)}: нет дымохода — поставьте «Дымоход / труба» над печью или вплотную к ней`, 'СП 7.13130.2013', it, it.id);
      // дровница: не ближе 0,5 м к печи и не перед топкой (там предтопочный лист и 1,25 м свободно)
      for (const wr of d.items.filter(o => catItem(o.key).shape === 'woodRack' && (o.floor || f1) === fl)) {
        const rp = Model.itemPts(wr), gap = Math.min(...rp.map(p => G.distPoly(p, poly)), ...poly.map(p => G.distPoly(p, rp)));
        const inFront = G.toLocal(wr, it.x, it.y, it.rot || 0);
        if (inFront.y > it.d / 2 && Math.abs(inFront.x) < it.w / 2 + 10 && inFront.y < it.d / 2 + 125) add('bad', 'Печь', `${name(wr)}: стоит перед топкой — там предтопочный лист и 1,25 м свободного места; поставьте сбоку от печи`, 'СП 7.13130.2013 п. 5.21', wr, wr.id);
        else if (gap < 49) add('warn', 'Печь', `${name(wr)}: ${m(Math.max(0, gap))} до печи — дрова держат не ближе 0,5 м от нагретых стенок`, 'СП 7.13130.2013 п. 5.20; инструкция печника', wr, wr.id);
      }
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
