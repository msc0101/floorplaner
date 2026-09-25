'use strict';
/* ==========================================================================
   Смета: объёмы считаются по проекту автоматически, цены — редактируемые
   (по умолчанию — ориентировочные для средней полосы России, «материал + работа»).
   ========================================================================== */

const PRICE_DEFAULTS = {
  // стены (за м³, каркас/СИП/ГКЛ/ПГП — за м²)
  'wall:aerated': 9500, 'wall:foam': 8500, 'wall:ceramic': 13000, 'wall:brick': 16000, 'wall:silicate': 13000,
  'wall:concrete': 18000, 'wall:claybl': 8500, 'wall:cinder': 7000, 'wall:arbolit': 9500, 'wall:timber': 30000,
  'wall:frame': 5500, 'wall:sip': 4500, 'wall:gkl': 1800, 'wall:pgp': 1700, 'wall:stone': 16000,
  'wall:insulation': 9000,
  // заборы (за м)
  'fence:profile': 3000, 'fence:euro': 3500, 'fence:picket': 2500, 'fence:wood': 3000, 'fence:mesh': 1300,
  'fence:forged': 7500, 'fence:brickF': 18000, 'fence:concreteF': 4500,
  // кровля (за м²)
  'roof:metaltile': 1500, 'roof:profile': 1200, 'roof:seam': 2800, 'roof:soft': 2200, 'roof:ceramic': 3800,
  'roof:ondulin': 1000, 'roof:polycarb': 1100, 'roof:slate': 900, 'roof:membrane': 2200, 'roof:frame': 2500,
  // фундамент, перекрытия, полы
  'found:strip': 14000, 'slab:floor': 4500, 'floor:screed': 1200,
  // окна и двери
  'win:m2': 11000, 'door:int': 15000, 'door:ext': 45000, 'door:gate': 110000, 'door:slide': 25000,
  // сети (за м)
  'net:water': 1100, 'net:hotwater': 900, 'net:sewer': 1600, 'net:drain': 1400, 'net:heating': 1800, 'net:warmfloor': 250,
  'net:gas': 3500, 'net:power': 1300, 'net:overhead': 900, 'net:lowvolt': 250, 'net:ground': 700,
  // оборудование и постройки (за шт.)
  'item:septic2': 140000, 'item:septic3': 190000, 'item:septicRing': 90000, 'item:cesspool': 70000, 'item:well': 110000,
  'item:borehole': 220000, 'item:manhole': 25000, 'item:drainWell': 30000, 'item:filterField': 60000, 'item:gasholder': 450000,
  'item:pumpStation': 30000, 'item:filter': 60000, 'item:gasBoilerWall': 80000, 'item:boilerFloor': 120000, 'item:elBoiler': 40000,
  'item:indirect': 55000, 'item:radiator': 9000, 'item:radiatorLong': 14000, 'item:towel': 12000, 'item:manifold': 25000,
  'item:boiler50': 18000, 'item:boiler80': 22000, 'item:boilerFlat': 25000,
  'item:stoveRus': 350000, 'item:stoveBrick': 180000, 'item:stoveKitchen': 220000, 'item:fireplace': 180000, 'item:fireplaceCorner': 160000,
  'item:stoveMetal': 45000, 'item:saunaStove': 70000, 'item:chimney': 60000,
  'item:bath170': 35000, 'item:bath150': 30000, 'item:bath180': 45000, 'item:bathCorner': 55000, 'item:shower90': 45000, 'item:shower80': 20000,
  'item:showerWalk': 35000, 'item:toilet': 18000, 'item:toiletWall': 38000, 'item:bidet': 20000, 'item:sink': 9000, 'item:vanity': 22000,
  'item:kitchenI': 180000, 'item:kitchenL': 260000, 'item:panel': 35000, 'item:meter': 25000, 'item:pole': 45000, 'item:lightPole': 25000,
  'item:socket': 1500, 'item:socket2': 2000, 'item:socketPower': 4000, 'item:switch': 1500, 'item:switch2': 1800, 'item:lamp': 5000,
  'item:spot': 1500, 'item:wallLamp': 4000,
  'item:stairs': 150000, 'item:stairsL': 220000,
  'item:garage1': 900000, 'item:garage2': 1500000, 'item:carport': 180000, 'item:carport2': 300000, 'item:carportLean': 160000,
  'item:canopy': 200000, 'item:shed': 250000, 'item:bathhouse': 1200000, 'item:gazebo': 250000, 'item:greenhouse': 70000,
  'item:woodshed': 60000, 'item:outhouse': 60000, 'item:showerOut': 40000, 'item:pool': 900000, 'item:terrace': 350000,
  // благоустройство участка (за м²)
  'site:asphalt': 1500, 'site:concrete': 2500, 'site:paving': 2200, 'site:gravel': 600, 'site:lawn': 350,
  'item:cellar': 350000, 'item:cellarHouse': 450000, 'item:podpol': 90000, 'item:inspPit': 120000, 'item:pitOpen': 40000,
  'item:gate': 120000, 'item:wicket': 25000, 'item:bbq': 40000,
};

const Estimate = {
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
    add('Фундамент, перекрытия, полы', 'found:strip', 'Фундамент ленточный (по периметру наружных стен)', 'м.п.', perim);
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
    // благоустройство: покрытия зон участка
    const cover = { asphalt: 'Асфальтирование', concrete: 'Бетонная площадка', paving: 'Мощение плиткой / отмостка', gravel: 'Отсыпка щебнем / гравием', lawn: 'Газон' };
    const byKind = {};
    for (const a of d.areas) if (cover[a.kind]) byKind[a.kind] = (byKind[a.kind] || 0) + Math.abs(G.polyArea(a.pts)) / 1e4;
    for (const [k, m2] of Object.entries(byKind)) add('Благоустройство участка', 'site:' + k, cover[k], 'м²', m2);
    // сети
    const net = {};
    for (const l of d.lines) net[l.kind] = (net[l.kind] || 0) + G.polyPerimeter(l.pts, false) / 100;
    for (const [k, len] of Object.entries(net)) add('Инженерные сети', 'net:' + k, `${LINE_KINDS[k].code} ${LINE_KINDS[k].name}`, 'м', len);
    // оборудование и постройки
    const cnt = {};
    for (const it of d.items) if (PRICE_DEFAULTS['item:' + it.key] !== undefined || U.isNum((d.settings.prices || {})['item:' + it.key])) cnt[it.key] = (cnt[it.key] || 0) + 1;
    for (const [k, n] of Object.entries(cnt)) {
      const def = catItem(k);
      add(def.layer === 'siteobj' ? 'Постройки на участке' : 'Оборудование', 'item:' + k, def.name, 'шт.', n);
    }
    // заборы
    for (const m of Rooms.materials().rows) if (m.fence) {
      add('Заборы', 'fence:' + (m.mat || 'profile'), m.name, 'м', m.len / 100);
    }
    // свои строки
    for (const c of d.estimateCustom || []) rows.push({ group: 'Прочее', key: c.id, custom: c, name: c.name, unit: c.unit, qtyAuto: c.qty, qty: c.qty, price: c.price, sum: c.qty * c.price, off: false });
    return rows;
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
      U.el('p', { class: 'note' }, 'Цены ориентировочные (материал + работа, средняя полоса России) — замените на свои. Объёмы берутся из проекта и пересчитываются при изменениях; изменённый вручную объём можно вернуть кнопкой ↺. Цены и правки сохраняются в проекте.'));
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
        U.el('p', {}, 'Цены ориентировочные; объёмы рассчитаны по проекту Floorplaner.')));
    document.body.classList.add('printing');
    $('dlgEstimate').close();
    const done = () => { document.body.classList.remove('printing'); area.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  },
};
