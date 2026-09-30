'use strict';
/* ==========================================================================
   Смета: объёмы считаются по проекту автоматически, цены — редактируемые
   (по умолчанию — нижняя граница рынка средней полосы России, 2026, «материал + работа»;
   открывается только горячей клавишей Ctrl+Alt+S — в интерфейсе раздела не видно).
   ========================================================================== */

const PRICE_DEFAULTS = {
  // стены (за м³, каркас/СИП/ГКЛ/ПГП — за м²)
  'wall:aerated': 7100, 'wall:foam': 6400, 'wall:ceramic': 9800, 'wall:brick': 12000, 'wall:silicate': 9800,
  'wall:concrete': 14000, 'wall:claybl': 7300, 'wall:cinder': 5200, 'wall:arbolit': 7100, 'wall:timber': 22000,
  'wall:frame': 4100, 'wall:sip': 3400, 'wall:gkl': 1350, 'wall:pgp': 1300, 'wall:stone': 12000,
  'wall:insulation': 6800,
  // заборы (за м)
  'fence:profile': 2200, 'fence:euro': 2600, 'fence:picket': 1900, 'fence:wood': 2200, 'fence:mesh': 1000,
  'fence:forged': 5600, 'fence:brickF': 14000, 'fence:concreteF': 3400,
  // кровля (за м²)
  'roof:metaltile': 1100, 'roof:profile': 900, 'roof:seam': 2100, 'roof:soft': 1650, 'roof:ceramic': 2800,
  'roof:ondulin': 750, 'roof:polycarb': 800, 'roof:slate': 700, 'roof:membrane': 1650, 'roof:frame': 1900,
  // фундамент, перекрытия, полы
  'found:strip': 10000, 'found:concrete': 10000, 'found:rebar': 85, 'found:sand': 1100, 'found:xps': 500, 'found:pile': 6800, 'wall:rebar': 85, 'wall:ring': 12000, 'slab:floor': 3400, 'floor:screed': 900,
  // чистовая отделка (за м² с работой)
  'fin:porcelain': 2800, 'fin:carpet': 1200, 'fin:tile': 1950, 'fin:laminate': 1400, 'fin:topping': 700, 'fin:paint': 700, 'fin:walltile': 2400,
  'fin:stretch': 800, 'fin:gkl': 1200, 'fin:brick': 3600,
  // окна и двери
  'win:m2': 8200, 'door:int': 11000, 'door:ext': 34000, 'door:gate': 82000, 'door:slide': 19000,
  // сети (за м)
  'net:water': 800, 'net:hotwater': 700, 'net:sewer': 1200, 'net:drain': 1050, 'net:heating': 1350, 'net:warmfloor': 190,
  'net:gas': 2600, 'net:gasAir': 2100, 'net:power': 1000, 'net:overhead': 700, 'net:lowvolt': 190, 'net:ground': 500,
  // оборудование и постройки (за шт.)
  'item:septic2': 105000, 'item:septic3': 140000, 'item:septicRing': 70000, 'item:cesspool': 52000, 'item:well': 82000,
  'item:borehole': 165000, 'item:manhole': 19000, 'item:drainWell': 22000, 'item:filterField': 45000, 'item:gasholder': 340000,
  'item:pumpStation': 22000, 'item:filter': 45000, 'item:gasBoilerWall': 60000, 'item:boilerFloor': 90000, 'item:elBoiler': 30000,
  'item:indirect': 41000, 'item:radiator': 6800, 'item:radiatorLong': 10000, 'item:towel': 9000, 'item:manifold': 19000,
  'item:boiler50': 14000, 'item:boiler80': 16000, 'item:boilerFlat': 19000,
  'item:stoveRus': 260000, 'item:stoveBrick': 135000, 'item:stoveKitchen': 165000, 'item:fireplace': 135000, 'item:fireplaceCorner': 120000,
  'item:stoveMetal': 34000, 'item:saunaStove': 52000, 'item:chimney': 45000,
  'item:bath170': 26000, 'item:bath150': 22000, 'item:bath180': 34000, 'item:bathCorner': 41000, 'item:shower90': 34000, 'item:shower80': 15000,
  'item:showerWalk': 26000, 'item:toilet': 14000, 'item:toiletWall': 28000, 'item:bidet': 15000, 'item:sink': 6800, 'item:vanity': 16000,
  'item:kitchenI': 135000, 'item:kitchenL': 195000, 'item:panel': 26000, 'item:meter': 19000, 'item:pole': 34000, 'item:lightPole': 19000,
  'item:socket': 1100, 'item:socket2': 1500, 'item:socketPower': 3000, 'item:switch': 1100, 'item:switch2': 1350, 'item:lamp': 3800,
  'item:spot': 1100, 'item:wallLamp': 3000, 'item:socketOut': 2600, 'item:cctvCam': 6800, 'item:nvr': 34000, 'item:router': 19000, 'item:lanSocket': 900, 'item:wifiAp': 6800,
  'item:downspout': 4900, 'item:stormInlet': 3400, 'item:drainChannel': 2600, 'item:manifoldWF': 34000,
  'item:stairs': 110000, 'item:stairsL': 165000,
  'item:garage1': 675000, 'item:garage2': 1125000, 'item:carport': 135000, 'item:carport2': 225000, 'item:carportLean': 120000,
  'item:canopy': 150000, 'item:shed': 190000, 'item:bathhouse': 900000, 'item:gazebo': 190000, 'item:greenhouse': 52000,
  'item:woodshed': 45000, 'item:outhouse': 45000, 'item:showerOut': 30000, 'item:pool': 675000, 'item:terrace': 260000,
  // благоустройство участка (за м²)
  'site:blind': 1650, 'site:asphalt': 1100, 'site:concrete': 1900, 'site:paving': 1650, 'site:gravel': 450, 'site:lawn': 250,
  'item:cellar': 260000, 'item:cellarHouse': 340000, 'item:podpol': 68000, 'item:inspPit': 90000, 'item:pitOpen': 30000,
  // хранение в гараже (за шт.)
  'item:garageRack': 6000, 'item:workbench': 15000, 'item:tireRack': 4000, 'item:wallShelf': 1500, 'item:ceilRack': 7000,
  'item:gate': 90000, 'item:wicket': 19000, 'item:bbq': 30000,
};

const Estimate = {
  /** Открывали ли смету в этом сеансе (раздел скрыт; до этого — нигде в интерфейсе не показывается) */
  shown: false,
  price(key) {
    const p = (App.doc.settings.prices || {})[key];
    return U.isNum(p) ? p : (PRICE_DEFAULTS[key] ?? 0);
  },
  /** Строки сметы с автоматическими объёмами */
  rows() {
    const d = App.doc, rows = [];
    const ov = d.settings.estQty || {}, off = d.settings.estOff || {};
    const add = (group, key, name, unit, qtyAuto, priceKey = key) => {
      if (!(qtyAuto > 0) && !U.isNum(ov[key])) return;
      const qty = U.isNum(ov[key]) ? ov[key] : qtyAuto;
      const price = Estimate.price(priceKey);
      rows.push({ group, key, priceKey, name, unit, qtyAuto, qty, price, sum: off[key] ? 0 : qty * price, off: !!off[key], manual: U.isNum(ov[key]) });
    };
    // фундамент и перекрытия
    const fd = App.floorData || [];
    const perim = fd.length ? fd[0].outlines.reduce((s, o) => s + G.polyPerimeter(o.outer), 0) / 100 : 0;
    // фундамент — по авторасчёту (тип, объёмы, арматура); без стен — по периметру
    const Fs = Struct.all(), Fd = Fs[0];
    for (const F of Fs) {
      const g = 'Фундамент, перекрытия, полы', k = F.house ? 'found' : 'found:' + F.id, who = F.house ? '' : ` (${F.name.toLowerCase()})`;
      add(g, k + ':concrete', `Фундамент${who}: ${FOUND_TYPES[F.type][0].toLowerCase() + FOUND_TYPES[F.type].slice(1)} — бетон B20 W6 F150 с работой`, 'м³', F.concrete, 'found:concrete');
      add(g, k + ':rebar', `Арматура фундамента${who} А500/А240`, 'кг', F.rebar, 'found:rebar');
      if (F.sand) add(g, k + ':sand', `Песчаная подушка с трамбованием${who}`, 'м³', F.sand, 'found:sand');
      add(g, k + ':xps', `Утепление фундамента XPS 50–100 мм${who}`, 'м²', F.xps, 'found:xps');
      if (F.piles) add(g, k + ':pile', `Сваи с монтажом${who}`, 'шт.', F.piles, 'found:pile');
    }
    if (Fd) {
      const ms = Struct.masonry();
      add('Стены и перегородки', 'wall:rebar', 'Армирование кладки (штробы, сетка)', 'кг', ms.reduce((a, r) => a + r.rebar, 0));
      add('Стены и перегородки', 'wall:ring', 'Армопояс монолитный с арматурой', 'м³', ms.reduce((a, r) => a + (r.ring ? r.ring.vol : 0), 0));
    } else add('Фундамент, перекрытия, полы', 'found:strip', 'Фундамент ленточный (по периметру наружных стен)', 'м.п.', perim);
    const slabs = fd.slice(1).reduce((s, x) => s + x.outlines.reduce((a, o) => a + o.area, 0), 0) / 1e4;
    add('Фундамент, перекрытия, полы', 'slab:floor', 'Межэтажные перекрытия', 'м²', slabs);
    add('Фундамент, перекрытия, полы', 'floor:screed', 'Стяжка / черновой пол (площадь помещений)', 'м²', fd.reduce((s, x) => s + x.rooms.reduce((a, r) => a + r.areaFloor, 0), 0) / 1e4);
    // стены
    for (const m of Rooms.materials().rows) {
      if (m.fence) continue;
      const key = m.mat ? 'wall:' + m.mat : 'wall:insulation';
      const byArea = ['frame', 'sip', 'gkl', 'pgp'].includes(m.mat);
      const rowKey = key + ':' + (m.th || 0);
      add('Стены и перегородки', rowKey, m.name + (m.count ? ` (≈${m.count} ${m.unit})` : ''), byArea ? 'м²' : 'м³', byArea ? m.area / 1e4 : m.vol / 1e6, key);
    }
    // кровля
    for (const r of d.roofs) {
      const P = Roof.params(r);
      add('Кровля', 'roof:' + r.id, `Кровля: ${(ROOF_MATERIALS[r.mat] || {}).name || r.mat}, ${ROOF_TYPES[r.type].name.toLowerCase()}`, 'м²', P.area / 1e4, 'roof:' + r.mat);
      if (r.type !== 'flat') add('Кровля', 'roofFrame:' + r.id, 'Стропильная система с утеплением', 'м²', P.area / 1e4, 'roof:frame');
    }
    // окна и двери
    let winArea = 0, doorsInt = 0, doorsExt = 0, gates = 0, slides = 0;
    for (const op of d.openings) {
      const w = Model.get(op.wall);
      if (!w) continue;
      const T = OPENING_TYPES[op.type];
      if (T.cat === 'window') winArea += op.w * op.h / 1e4;
      else if (op.type === 'gate') gates++;
      else if (op.type === 'arch') continue;
      else if (w.kind === 'fence') continue;
      else if (op.type === 'slide') slides++;
      else if (w.kind === 'ext') doorsExt++;
      else doorsInt++;
    }
    add('Окна и двери', 'win:m2', 'Окна (площадь проёмов)', 'м²', winArea);
    add('Окна и двери', 'door:ext', 'Двери входные', 'шт.', doorsExt);
    add('Окна и двери', 'door:int', 'Двери межкомнатные', 'шт.', doorsInt);
    add('Окна и двери', 'door:slide', 'Двери раздвижные', 'шт.', slides);
    add('Окна и двери', 'door:gate', 'Ворота', 'шт.', gates);
    // чистовая отделка: полы, стены, потолки по помещениям; облицовка фасада
    const FQ = Finish.quantities();
    for (const [k, v] of Object.entries(FQ.floor)) { const M = FIN_FLOORS[k]; if (M) add('Чистовая отделка', 'fin:floor:' + k, 'Пол: ' + M.name, 'м²', v, M.price); }
    for (const [k, v] of Object.entries(FQ.walls)) { const M = FIN_WALLS[k]; if (M) add('Чистовая отделка', 'fin:walls:' + k, 'Стены: ' + M.name, 'м²', v, M.price); }
    for (const [k, v] of Object.entries(FQ.ceil)) { const M = FIN_CEIL[k]; if (M) add('Чистовая отделка', 'fin:ceil:' + k, 'Потолок: ' + M.name, 'м²', v, M.price); }
    if (FQ.facade > 0) add('Чистовая отделка', 'fin:facade', `Фасад: ${FIN_FACADE[Finish.opt().facade].name} (≈ ${FQ.bricks} шт.)`, 'м²', FQ.facade, 'fin:brick');
    // благоустройство: покрытия зон участка
    const cover = { asphalt: 'Асфальтирование', concrete: 'Бетонная площадка', paving: 'Мощение плиткой / отмостка', gravel: 'Отсыпка щебнем / гравием', lawn: 'Газон' };
    const byKind = {};
    for (const a of d.areas) if (cover[a.kind]) byKind[a.kind] = (byKind[a.kind] || 0) + Math.abs(G.polyArea(a.pts)) / 1e4;
    for (const [k, m2] of Object.entries(byKind)) add('Благоустройство участка', 'site:' + k, cover[k], 'м²', m2);
    const blind = Model.blindAreas().reduce((s, b) => s + b.area / 1e4, 0);
    if (blind) add('Благоустройство участка', 'site:blind', 'Отмостка бетонная (с подготовкой и утеплением)', 'м²', blind);
    // сети
    const net = {};
    for (const l of d.lines) net[l.kind] = (net[l.kind] || 0) + G.polyPerimeter(l.pts, false) / 100;
    for (const [k, len] of Object.entries(net)) add('Инженерные сети', 'net:' + k, `${LINE_KINDS[k].code} ${LINE_KINDS[k].name}`, 'м', len);
    // оборудование и постройки
    const cnt = {};
    for (const it of d.items) if (PRICE_DEFAULTS['item:' + it.key] !== undefined || U.isNum((d.settings.prices || {})['item:' + it.key])) cnt[it.key] = (cnt[it.key] || 0) + 1;
    for (const [k, n] of Object.entries(cnt)) {
      const def = catItem(k);
      add(def.layer === 'siteobj' ? 'Постройки на участке' : 'Оборудование', 'item:' + k, def.name + (Fs.some(F => F.item && F.item.key === k) ? ' — коробка, крыша, ворота (фундамент — отдельной строкой)' : ''), 'шт.', n);
    }
    // заборы
    for (const m of Rooms.materials().rows) if (m.fence) {
      add('Заборы', 'fence:' + (m.mat || 'profile'), m.name, 'м', m.len / 100);
    }
    // свои строки
    for (const c of d.estimateCustom || []) rows.push({ group: 'Прочее', key: c.id, custom: c, name: c.name, unit: c.unit, qtyAuto: c.qty, qty: c.qty, price: c.price, sum: c.qty * c.price, off: false });
    // строки одного раздела — подряд (раздел упоминается в нескольких местах расчёта), порядок разделов — по первому появлению
    const order = [...new Set(rows.map(r => r.group))];
    return rows.map((r, i) => ({ r, i })).sort((a, b) => order.indexOf(a.r.group) - order.indexOf(b.r.group) || a.i - b.i).map(x => x.r);
  },
  totals(rows) {
    const sub = rows.reduce((s, r) => s + r.sum, 0);
    const pct = U.isNum(App.doc.settings.estReserve) ? App.doc.settings.estReserve : 10;
    return { sub, pct, reserve: sub * pct / 100, total: sub * (1 + pct / 100) };
  },
  money(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; },

  /* --------------------------------- UI ----------------------------------- */
  open() { Estimate.render(); $('dlgEstimate').showModal(); },
  render() {
    const box = $('estBody'), tot = $('estTot');
    box.textContent = ''; tot.textContent = '';
    const s = App.doc.settings;
    s.prices = s.prices || {}; s.estQty = s.estQty || {}; s.estOff = s.estOff || {};
    const rows = Estimate.rows();
    const T = Estimate.totals(rows);
    const tbl = U.el('table', { class: 'tbl est' }, U.el('tr', {}, U.el('th', {}, ''), U.el('th', {}, 'Наименование'), U.el('th', {}, 'Кол-во'), U.el('th', {}, 'Ед.'), U.el('th', {}, 'Цена, ₽'), U.el('th', {}, 'Сумма, ₽')));
    let group = null;
    const save = () => { Model.commit(); Estimate.render(); };
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        const gs = rows.filter(x => x.group === group).reduce((a, x) => a + x.sum, 0);
        tbl.append(U.el('tr', { class: 'floor-row' }, U.el('td', { colspan: 5 }, group), U.el('td', { class: 'num' }, Estimate.money(gs))));
      }
      const on = U.el('input', { type: 'checkbox', checked: !r.off, title: 'Включить в смету' });
      on.onchange = () => { if (r.custom) return; if (on.checked) delete s.estOff[r.key]; else s.estOff[r.key] = true; save(); };
      const qty = U.el('input', { type: 'number', value: Math.round(r.qty * 100) / 100, step: 0.1, min: 0, title: r.manual ? `Авто: ${r.qtyAuto.toFixed(2)}` : 'Посчитано по проекту' });
      qty.onchange = () => { const v = U.num(qty.value, NaN); if (!Number.isFinite(v)) return; if (r.custom) r.custom.qty = v; else s.estQty[r.key] = v; save(); };
      const price = U.el('input', { type: 'number', value: r.price, step: 100, min: 0 });
      price.onchange = () => { const v = U.num(price.value, NaN); if (!Number.isFinite(v)) return; if (r.custom) r.custom.price = v; else s.prices[r.priceKey] = v; save(); };
      const nameCell = r.custom
        ? U.el('td', {}, (() => { const i = U.el('input', { type: 'text', value: r.name }); i.onchange = () => { r.custom.name = i.value; save(); }; return i; })(), U.el('button', { type: 'button', class: 'mini danger', title: 'Удалить строку', onclick: () => { App.doc.estimateCustom = App.doc.estimateCustom.filter(c => c !== r.custom); save(); } }, '✕'))
        : U.el('td', {}, r.name, r.manual ? U.el('button', { type: 'button', class: 'mini', title: 'Вернуть объём по проекту', onclick: () => { delete s.estQty[r.key]; save(); } }, '↺') : null);
      tbl.append(U.el('tr', { class: r.off ? 'off' : '' }, U.el('td', {}, r.custom ? '' : on), nameCell, U.el('td', {}, qty), U.el('td', {}, r.custom ? (() => { const i = U.el('input', { type: 'text', value: r.unit, class: 'unit' }); i.onchange = () => { r.custom.unit = i.value; save(); }; return i; })() : r.unit), U.el('td', {}, price), U.el('td', { class: 'num' }, Estimate.money(r.sum))));
    }
    const res = U.el('input', { type: 'number', value: T.pct, step: 1, min: 0, max: 100 });
    res.onchange = () => { s.estReserve = U.clamp(U.num(res.value, 10), 0, 100); save(); };
    box.append(rows.length ? tbl : U.el('p', { class: 'note' }, 'В проекте пока нечего считать: нарисуйте стены, крышу, проёмы, сети или добавьте оборудование.'));
    tot.append(
      U.el('div', { class: 'est-tot' },
        U.el('div', {}, U.el('span', {}, 'Итого по позициям'), U.el('b', {}, Estimate.money(T.sub))),
        U.el('div', {}, U.el('span', {}, 'Непредвиденные расходы, %'), res, U.el('b', {}, Estimate.money(T.reserve))),
        U.el('div', { class: 'big' }, U.el('span', {}, 'Всего'), U.el('b', {}, Estimate.money(T.total)))),
      U.el('p', { class: 'note' }, 'Цены — по нижней границе рынка (материал + работа, средняя полоса России, 2026) — замените на свои. Объёмы берутся из проекта и пересчитываются при изменениях; изменённый вручную объём можно вернуть кнопкой ↺. Цены и правки сохраняются в проекте.'));
  },
  addCustom() {
    App.doc.estimateCustom = App.doc.estimateCustom || [];
    App.doc.estimateCustom.push({ id: U.uid('e'), name: 'Новая позиция', unit: 'шт.', qty: 1, price: 0 });
    Model.commit(); Estimate.render();
  },
  resetPrices() {
    if (!confirm('Вернуть цены и объёмы по умолчанию?')) return;
    const s = App.doc.settings; s.prices = {}; s.estQty = {}; s.estOff = {};
    Model.commit(); Estimate.render();
  },
  csv() {
    const rows = Estimate.rows(), T = Estimate.totals(rows);
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const n = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const L = [['Раздел', 'Наименование', 'Кол-во', 'Ед.', 'Цена, руб', 'Сумма, руб'].map(q).join(';')];
    for (const r of rows) if (!r.off) L.push([q(r.group), q(r.name), n(r.qty), q(r.unit), n(r.price), n(r.sum)].join(';'));
    L.push(['', q('Итого'), '', '', '', n(T.sub)].join(';'), ['', q(`Непредвиденные ${T.pct}%`), '', '', '', n(T.reserve)].join(';'), ['', q('Всего'), '', '', '', n(T.total)].join(';'));
    U.download(IO.fileName('csv').replace('.csv', '-смета.csv'), '﻿' + L.join('\r\n'), 'text/csv');
    UI.toast('Смета сохранена в CSV (открывается в Excel)');
  },
  print() {
    const rows = Estimate.rows().filter(r => !r.off), T = Estimate.totals(rows);
    const area = $('printArea');
    area.textContent = '';
    const tb = U.el('table', {}, U.el('tr', {}, ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена, ₽', 'Сумма, ₽'].map(h => U.el('th', {}, h))));
    let g = null, i = 0;
    for (const r of rows) {
      if (r.group !== g) { g = r.group; tb.append(U.el('tr', {}, U.el('th', { colspan: 6 }, g))); }
      tb.append(U.el('tr', {}, U.el('td', {}, String(++i)), U.el('td', {}, r.name), U.el('td', {}, (Math.round(r.qty * 100) / 100).toLocaleString('ru-RU')), U.el('td', {}, r.unit), U.el('td', {}, Math.round(r.price).toLocaleString('ru-RU')), U.el('td', {}, Math.round(r.sum).toLocaleString('ru-RU'))));
    }
    for (const [t, v] of [['Итого', T.sub], [`Непредвиденные расходы ${T.pct}%`, T.reserve], ['Всего', T.total]]) tb.append(U.el('tr', {}, U.el('td', { colspan: 5 }, U.el('b', {}, t)), U.el('td', {}, U.el('b', {}, Math.round(v).toLocaleString('ru-RU')))));
    area.append(U.el('style', {}, '@page { size: 210mm 297mm; margin: 0; }'),
      U.el('div', { class: 'sheet report', style: { width: '210mm', minHeight: '297mm', padding: '12mm' } },
        U.el('div', { class: 'sheet-head' }, U.el('b', {}, 'Смета: ' + (App.doc.name || '')), U.el('span', {}, new Date().toLocaleDateString('ru-RU'))),
        U.el('div', { class: 'rep' }, tb),
        U.el('p', {}, 'Цены — нижняя граница рынка; объёмы рассчитаны по проекту Floorplaner.')));
    document.body.classList.add('printing');
    $('dlgEstimate').close();
    const done = () => { document.body.classList.remove('printing'); area.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  },
};
