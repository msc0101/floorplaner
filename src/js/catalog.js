'use strict';
/* ==========================================================================
   Каталог объектов. Все размеры — в САНТИМЕТРАХ, типовые «как в жизни».
   w — ширина (вдоль «фасада»), d — глубина (от стены вперёд), h — высота.
   Локальные координаты: центр (0,0), «спинка»/стена — сверху (−d/2), фронт — снизу.
   ========================================================================== */

/* Слои: каждый инженерный раздел — отдельный слой (объекты + трассы). */
const LAYERS = [
  { id: 'underlay', name: 'Подложка' },
  { id: 'grid', name: 'Сетка' },
  { id: 'site', name: 'Участок и зоны' },
  { id: 'siteobj', name: 'Постройки и озеленение' },
  { id: 'walls', name: 'Стены, окна, двери' },
  { id: 'roof', name: 'Крыша' },
  { id: 'lower', name: 'Нижний этаж (подсказка)' },
  { id: 'rooms', name: 'Помещения (заливка, подписи)' },
  { id: 'furniture', name: 'Мебель и техника' },
  { id: 'plumbing', name: 'Водопровод и канализация' },
  { id: 'heating', name: 'Отопление и печи' },
  { id: 'gas', name: 'Газ' },
  { id: 'electric', name: 'Электрика' },
  { id: 'dims', name: 'Размеры и надписи' },
  { id: 'notes', name: 'Примечания' },
  { id: 'checks', name: 'Проверка отступов' },
  { id: 'shadows', name: 'Тени (солнце)' },
  { id: 'heat', name: 'Карта инсоляции' },
];

/* Виды инженерных трасс. code — буквенное обозначение по ГОСТ 21.101/21.601/21.205 (упрощённо). */
const LINE_KINDS = {
  water:    { name: 'Водопровод (ХВС)', code: 'В1', color: '#1e6fe0', dash: [], layer: 'plumbing', dia: 32, depth: 180 },
  hotwater: { name: 'Горячая вода (ГВС)', code: 'Т3', color: '#e0492f', dash: [], layer: 'plumbing', dia: 25, depth: 0 },
  sewer:    { name: 'Канализация', code: 'К1', color: '#8a5a2b', dash: [14, 6], layer: 'plumbing', dia: 110, depth: 120 },
  drain:    { name: 'Ливнёвка / дренаж', code: 'К2', color: '#0f9b9b', dash: [10, 5, 2, 5], layer: 'plumbing', dia: 110, depth: 60 },
  heating:  { name: 'Отопление (подача/обратка)', code: 'Т1', color: '#c2257e', dash: [], layer: 'heating', dia: 20, depth: 0 },
  warmfloor:{ name: 'Тёплый пол', code: 'ТП', color: '#e07b2f', dash: [4, 4], layer: 'heating', dia: 16, depth: 0 },
  gas:      { name: 'Газопровод', code: 'Г', color: '#d89b00', dash: [16, 5, 3, 5], layer: 'gas', dia: 32, depth: 100 },
  power:    { name: 'Электрокабель', code: 'Э', color: '#d21f3c', dash: [], layer: 'electric', dia: 0, depth: 70, section: 'ВВГнг 3×2.5' },
  overhead: { name: 'Воздушная ЛЭП', code: 'ВЛ', color: '#555e6b', dash: [18, 5, 3, 5, 3, 5], layer: 'electric', dia: 0, depth: 0, section: 'СИП 4×16' },
  lowvolt:  { name: 'Слаботочка (сеть, ТВ)', code: 'СС', color: '#7c3aed', dash: [6, 4], layer: 'electric', dia: 0, depth: 0, section: 'UTP cat.5e' },
  ground:   { name: 'Заземление', code: 'З', color: '#16a34a', dash: [2, 4], layer: 'electric', dia: 0, depth: 50, section: 'Полоса 40×4' },
};

/** Опоры воздушной линии: столб из библиотеки (item), крепление на стене дома (wall — ввод) или столб,
 *  который рисуем сами; промежуточные опоры — чтобы пролёт был не длиннее ~40 м */
function overheadPoles(l, items, walls) {
  const out = [], span = 4000;
  const poleAt = (p) => items.find(it => ['pole', 'lightpole'].includes(catItem(it.key).shape) && G.dist(it, p) < 80) || null;
  const wallAt = (p) => walls.find(w => w.kind !== 'fence' && G.distSeg(p, w.a, w.b) <= w.th / 2 + 40) || null;
  for (let i = 0; i < l.pts.length; i++) {
    const a = l.pts[i], end = i === 0 || i === l.pts.length - 1;
    const item = poleAt(a), wall = !item && end ? wallAt(a) : null;
    out.push({ p: a, item, wall });
    if (i === l.pts.length - 1) break;
    const b = l.pts[i + 1], n = Math.ceil(G.dist(a, b) / span);
    for (let k = 1; k < n; k++) { const q = G.add(a, G.mul(G.sub(b, a), k / n)); out.push({ p: q, item: poleAt(q), wall: null }); }
  }
  return out;
}

/* Дороги, улицы, тропинки: ширина в см */
/** Бордюр у дороги: по умолчанию — у улиц и проездов; можно выключить в свойствах */
function roadCurb(r) { return r.curb ?? (r.kind === 'street' || r.kind === 'road'); }
const ROAD_KINDS = {
  street:   { name: 'Улица', width: 600, fill: '#b9bec7', fillDark: '#4a515c', edge: '#7d8490', center: true },
  road:     { name: 'Дорога / проезд', width: 400, fill: '#c3c7ce', fillDark: '#434a55', edge: '#80868f' },
  driveway: { name: 'Подъездная дорожка', width: 300, fill: '#cfc8bb', fillDark: '#4d4840', edge: '#9a8f7c' },
  gravel:   { name: 'Гравийная дорога', width: 350, fill: '#d8d0c0', fillDark: '#565046', edge: '#a89c86', dots: true },
  path:     { name: 'Тропинка / дорожка', width: 100, fill: '#e2d5b8', fillDark: '#5c5341', edge: '#b39f75' },
  sidewalk: { name: 'Тротуар', width: 150, fill: '#d6d8dc', fillDark: '#50555d', edge: '#9aa0a8', tiles: true },
};

/* Виды стен */
const WALL_KINDS = {
  ext:   { name: 'Наружная', th: 30, h: 300, mat: 'aerated' },
  int:   { name: 'Внутренняя несущая', th: 20, h: 270, mat: 'aerated' },
  part:  { name: 'Перегородка', th: 10, h: 270, mat: 'gkl' },
  fence: { name: 'Забор', th: 5, h: 180, mat: 'profile' },
};

/* Материалы стен.
   lam — теплопроводность в условиях эксплуатации «Б», Вт/(м·°C) (СП 50.13330, справочно);
   ths — типовые толщины, см; pat — штриховка на плане;
   block — размер блока [длина, высота] см (оценка количества), brick — кирпичей на 1 м³ кладки. */
const WALL_MATERIALS = {
  aerated:  { name: 'Газобетон / газосиликат D500', lam: 0.14, ths: [10, 15, 20, 25, 30, 37.5, 40, 50], color: '#dde2e8', dark: '#566070', pat: 'dots', block: [60, 25] },
  foam:     { name: 'Пенобетон D600', lam: 0.16, ths: [20, 30, 40], color: '#e0ddd5', dark: '#5f5b53', pat: 'dots2', block: [60, 30] },
  ceramic:  { name: 'Керамический блок (поризованный)', lam: 0.17, ths: [25, 38, 44, 51], color: '#ebc3ad', dark: '#7a5646', pat: 'grid', block: [25, 21.9] },
  brick:    { name: 'Кирпич керамический', lam: 0.70, ths: [12, 25, 38, 51, 64], color: '#eaae96', dark: '#84503c', pat: 'diag', brick: 394 },
  silicate: { name: 'Кирпич силикатный', lam: 0.87, ths: [12, 25, 38, 51], color: '#ebe7de', dark: '#6b665b', pat: 'diag2', brick: 394 },
  concrete: { name: 'Монолитный железобетон', lam: 2.04, ths: [15, 20, 25, 30], color: '#cbced2', dark: '#555a60', pat: 'concrete' },
  claybl:   { name: 'Керамзитобетонный блок', lam: 0.41, ths: [19, 29, 39], color: '#d6cfc3', dark: '#5e574d', pat: 'circles', block: [39, 18.8] },
  cinder:   { name: 'Шлакоблок', lam: 0.60, ths: [20, 39], color: '#c7c4bd', dark: '#56534c', pat: 'dots3', block: [39, 18.8] },
  arbolit:  { name: 'Арболит', lam: 0.11, ths: [20, 30, 40], color: '#e3dac7', dark: '#5f5745', pat: 'dash', block: [50, 30] },
  timber:   { name: 'Брус / бревно', lam: 0.18, ths: [15, 18, 20, 22, 24], color: '#e8cfa6', dark: '#7a6240', pat: 'wood' },
  frame:    { name: 'Каркас с утеплителем', lam: 0.055, ths: [15, 20, 25, 30], color: '#f2e8c4', dark: '#6d6441', pat: 'zigzag' },
  sip:      { name: 'СИП-панель', lam: 0.045, ths: [12, 17.4, 22.4], color: '#f3ebcf', dark: '#6f6848', pat: 'zigzag' },
  gkl:      { name: 'Перегородка ГКЛ на каркасе', lam: 0.15, ths: [7.5, 10, 12.5, 15], color: '#f0f0f0', dark: '#62666c', pat: 'gkl' },
  pgp:      { name: 'Пазогребневые плиты (ПГП)', lam: 0.35, ths: [8, 10], color: '#f1eee7', dark: '#666258', pat: 'hlines', block: [66.7, 50] },
  stone:    { name: 'Камень природный', lam: 1.7, ths: [40, 50, 60], color: '#cfc7b8', dark: '#5b554b', pat: 'stone' },
};
/* Материалы заборов: цвет и штрих линии на плане */
const FENCE_MATERIALS = {
  profile: { name: 'Профлист', color: '#5f7285', dash: [] },
  euro:    { name: 'Евроштакетник', color: '#6a84a0', dash: [5, 2] },
  picket:  { name: 'Штакетник деревянный', color: '#8a6d4a', dash: [3, 2] },
  wood:    { name: 'Деревянный сплошной', color: '#8b6a44', dash: [] },
  mesh:    { name: 'Сетка-рабица', color: '#7d8a7a', dash: [7, 4] },
  forged:  { name: 'Кованый / сварной', color: '#3f444c', dash: [1.5, 3] },
  brickF:  { name: 'Кирпичный', color: '#b0624a', dash: [] },
  concreteF: { name: 'Бетонный (еврозабор)', color: '#8c9096', dash: [] },
};
/* Утеплитель (минеральная вата), Вт/(м·°C) */
const INSULATION_LAM = 0.045;
function wallMaterial(w) { return (w.kind === 'fence' ? FENCE_MATERIALS : WALL_MATERIALS)[w.mat] || null; }
function materialsFor(kind) { return kind === 'fence' ? FENCE_MATERIALS : WALL_MATERIALS; }
/** Сопротивление теплопередаче стены, м²·°C/Вт (с учётом сопротивлений поверхностей 0.158) */
function wallR(w) {
  const m = WALL_MATERIALS[w.mat];
  if (!m) return null;
  const ins = Math.max(0, Math.min(w.ins || 0, w.th));
  return (w.th - ins) / 100 / m.lam + ins / 100 / INSULATION_LAM + 0.158;
}

/* Виды площадных объектов */
const AREA_KINDS = {
  plot:    { name: 'Граница участка', fill: 'rgba(110,170,80,.07)', stroke: '#c0392b', dash: [18, 5, 3, 5], layer: 'site' },
  lawn:    { name: 'Газон', fill: 'rgba(110,190,90,.28)', stroke: '#5a9a45', dash: [], layer: 'site' },
  garden:  { name: 'Огород / грядки', fill: 'rgba(150,110,70,.25)', stroke: '#8b6a45', dash: [], layer: 'site' },
  paving:  { name: 'Мощение / отмостка', fill: 'rgba(150,150,160,.28)', stroke: '#7d8290', dash: [], layer: 'site', hatch: true },
  road:    { name: 'Проезд / парковка', fill: 'rgba(120,120,130,.30)', stroke: '#5f6470', dash: [], layer: 'site' },
  water:   { name: 'Водоём', fill: 'rgba(70,150,230,.35)', stroke: '#3a7bd5', dash: [], layer: 'site' },
  flower:  { name: 'Цветник', fill: 'rgba(230,120,170,.25)', stroke: '#c0508a', dash: [], layer: 'site' },
  zone:    { name: 'Зона (произвольная)', fill: 'rgba(120,140,220,.14)', stroke: '#5b6fd0', dash: [8, 5], layer: 'site' },
  asphalt: { name: 'Асфальт', fill: 'rgba(62,66,74,.55)', stroke: '#3d4047', dash: [], layer: 'site' },
  concrete: { name: 'Бетон', fill: 'rgba(175,175,170,.45)', stroke: '#8a8a85', dash: [], layer: 'site' },
  gravel:  { name: 'Щебень / гравий', fill: 'rgba(190,178,152,.45)', stroke: '#9a8f7a', dash: [], layer: 'site', hatch: true },
  protect: { name: 'Охранная / санитарная зона', fill: 'rgba(230,80,80,.08)', stroke: '#d64545', dash: [4, 6], layer: 'site' },
};

/* Типы проёмов */
const OPENING_TYPES = {
  door:    { cat: 'door', name: 'Дверь распашная', w: 80, h: 210, sill: 0 },
  door2:   { cat: 'door', name: 'Дверь двустворчатая', w: 140, h: 210, sill: 0 },
  door15:  { cat: 'door', name: 'Дверь полуторная', w: 120, h: 210, sill: 0 },
  slide:   { cat: 'door', name: 'Дверь раздвижная / купе', w: 90, h: 210, sill: 0 },
  arch:    { cat: 'door', name: 'Проём / арка (без двери)', w: 90, h: 210, sill: 0 },
  gate:    { cat: 'door', name: 'Ворота гаражные', w: 270, h: 220, sill: 0 },
  win1:    { cat: 'window', name: 'Окно одностворчатое', w: 60, h: 60, sill: 110 },
  win2:    { cat: 'window', name: 'Окно двухстворчатое', w: 120, h: 140, sill: 85 },
  win3:    { cat: 'window', name: 'Окно трёхстворчатое', w: 180, h: 140, sill: 85 },
  winfix:  { cat: 'window', name: 'Окно глухое', w: 100, h: 140, sill: 85 },
  balcony: { cat: 'window', name: 'Балконный блок / французское', w: 150, h: 220, sill: 0 },
};
const DOOR_WIDTHS = [60, 70, 80, 90, 100, 120, 140, 160, 250, 270, 300];
const WINDOW_WIDTHS = [50, 60, 90, 100, 120, 140, 150, 180, 210, 240];

/* ------------------------------- каталог -------------------------------- */
const CATALOG = [
  { id: 'living', name: 'Гостиная', layer: 'furniture', items: [
    { key: 'sofa3', name: 'Диван 3-местный', shape: 'sofa', w: 220, d: 95, h: 85 },
    { key: 'sofa2', name: 'Диван 2-местный', shape: 'sofa', w: 160, d: 90, h: 85 },
    { key: 'sofaL', name: 'Диван угловой', shape: 'sofaL', w: 260, d: 170, h: 85, flip: true },
    { key: 'armchair', name: 'Кресло', shape: 'armchair', w: 85, d: 85, h: 85 },
    { key: 'coffeetable', name: 'Журнальный столик', shape: 'table', w: 110, d: 60, h: 45 },
    { key: 'tvstand', name: 'ТВ-тумба', shape: 'cabinet', w: 180, d: 45, h: 50 },
    { key: 'tv', name: 'Телевизор 55″', shape: 'tv', w: 125, d: 10, h: 75 },
    { key: 'bookcase', name: 'Стеллаж', shape: 'shelf', w: 80, d: 35, h: 200 },
    { key: 'pouf', name: 'Пуф', shape: 'round', w: 50, d: 50, h: 45 },
    { key: 'piano', name: 'Пианино', shape: 'piano', w: 150, d: 60, h: 125 },
    { key: 'rug', name: 'Ковёр', shape: 'rug', w: 200, d: 300, h: 1 },
  ]},
  { id: 'bedroom', name: 'Спальня и детская', layer: 'furniture', items: [
    { key: 'bed90', name: 'Кровать 90×200', shape: 'bed', w: 100, d: 210, h: 50 },
    { key: 'bed120', name: 'Кровать 120×200', shape: 'bed', w: 130, d: 210, h: 50 },
    { key: 'bed140', name: 'Кровать 140×200', shape: 'bed', w: 150, d: 215, h: 50 },
    { key: 'bed160', name: 'Кровать 160×200', shape: 'bed', w: 170, d: 215, h: 50 },
    { key: 'bed180', name: 'Кровать 180×200', shape: 'bed', w: 190, d: 215, h: 50 },
    { key: 'bunk', name: 'Кровать двухъярусная', shape: 'bed', w: 100, d: 210, h: 170 },
    { key: 'crib', name: 'Детская кроватка', shape: 'crib', w: 65, d: 125, h: 90 },
    { key: 'nightstand', name: 'Тумбочка прикроватная', shape: 'cabinet', w: 45, d: 40, h: 50 },
    { key: 'wardrobe2', name: 'Шкаф 2-дверный', shape: 'wardrobe', w: 100, d: 60, h: 220 },
    { key: 'wardrobe3', name: 'Шкаф-купе', shape: 'wardrobe', w: 200, d: 60, h: 240 },
    { key: 'dresser', name: 'Комод', shape: 'cabinet', w: 100, d: 50, h: 85 },
    { key: 'vanitytable', name: 'Туалетный столик', shape: 'table', w: 100, d: 45, h: 75 },
  ]},
  { id: 'kitchen', name: 'Кухня и столовая', layer: 'furniture', items: [
    { key: 'kitchenI', name: 'Кухонный гарнитур прямой', shape: 'kitchenI', w: 240, d: 60, h: 90 },
    { key: 'kitchenL', name: 'Кухонный гарнитур угловой', shape: 'kitchenL', w: 240, d: 180, h: 90, flip: true },
    { key: 'kitchenMini', name: 'Мини-кухня 120 см', shape: 'kitchenI', w: 120, d: 60, h: 90 },
    { key: 'kitchenI180', name: 'Кухня прямая 180 см', shape: 'kitchenI', w: 180, d: 60, h: 90 },
    { key: 'kitchenI300', name: 'Кухня прямая 300 см', shape: 'kitchenI', w: 300, d: 60, h: 90 },
    { key: 'kitchenTall', name: 'Кухня прямая с пеналами', shape: 'kitchenTall', w: 360, d: 60, h: 90 },
    { key: 'kitchenL300', name: 'Кухня угловая большая', shape: 'kitchenL', w: 300, d: 240, h: 90, flip: true },
    { key: 'kitchenU', name: 'Кухня П-образная', shape: 'kitchenU', w: 300, d: 240, h: 90 },
    { key: 'kitchenII', name: 'Кухня параллельная (2 ряда)', shape: 'kitchenII', w: 270, d: 240, h: 90 },
    { key: 'kitchenIsland', name: 'Кухня с островом', shape: 'kitchenIsland', w: 300, d: 300, h: 90 },
    { key: 'kitchenBar', name: 'Кухня с барной стойкой', shape: 'kitchenBar', w: 270, d: 220, h: 90 },
    { key: 'kitchenPen', name: 'Кухня угловая с полуостровом', shape: 'kitchenPen', w: 300, d: 250, h: 90, flip: true },
    { key: 'tallUnit', name: 'Пенал / шкаф-колонна', shape: 'tall', w: 60, d: 60, h: 215, label: 'П' },
    { key: 'ovenTower', name: 'Колонна под духовку и СВЧ', shape: 'tall', w: 60, d: 60, h: 215, label: 'Д' },
    { key: 'cornerUnit', name: 'Угловой нижний модуль', shape: 'kitchenL', w: 100, d: 100, h: 90, flip: true },
    { key: 'barCounter', name: 'Барная стойка', shape: 'bar', w: 150, d: 50, h: 110 },
    { key: 'hood', name: 'Вытяжка', shape: 'hood', w: 60, d: 50, h: 60 },
    { key: 'counter60', name: 'Нижний модуль 60 см', shape: 'counter', w: 60, d: 60, h: 90 },
    { key: 'counter40', name: 'Нижний модуль 40 см', shape: 'counter', w: 40, d: 60, h: 90 },
    { key: 'upper', name: 'Навесной шкаф', shape: 'upper', w: 80, d: 32, h: 70 },
    { key: 'ksink', name: 'Мойка кухонная (модуль)', shape: 'ksink', w: 60, d: 60, h: 90, layer: 'plumbing' },
    { key: 'island', name: 'Кухонный остров', shape: 'counter', w: 120, d: 90, h: 90 },
    { key: 'table4', name: 'Стол обеденный (4 чел.)', shape: 'diningtable', w: 120, d: 80, h: 75, seats: 4 },
    { key: 'table6', name: 'Стол обеденный (6 чел.)', shape: 'diningtable', w: 160, d: 90, h: 75, seats: 6 },
    { key: 'tableRound', name: 'Стол круглый Ø100', shape: 'roundtable', w: 100, d: 100, h: 75 },
    { key: 'chair', name: 'Стул', shape: 'chair', w: 45, d: 50, h: 90 },
    { key: 'stool', name: 'Табурет', shape: 'round', w: 35, d: 35, h: 45 },
    { key: 'barstool', name: 'Барный стул', shape: 'round', w: 40, d: 40, h: 75 },
  ]},
  { id: 'appliances', name: 'Бытовая техника', layer: 'furniture', items: [
    { key: 'fridge', name: 'Холодильник', shape: 'fridge', w: 60, d: 65, h: 200 },
    { key: 'fridgeSbs', name: 'Холодильник Side-by-Side', shape: 'fridge2', w: 91, d: 72, h: 178 },
    { key: 'stove', name: 'Плита 4-конфорочная', shape: 'stove', w: 60, d: 60, h: 85, layer: 'gas' },
    { key: 'hob', name: 'Варочная панель', shape: 'stove', w: 58, d: 51, h: 5 },
    { key: 'oven', name: 'Духовой шкаф', shape: 'oven', w: 60, d: 57, h: 60 },
    { key: 'dishwasher', name: 'Посудомоечная машина', shape: 'labelbox', w: 60, d: 60, h: 85, label: 'ПММ', layer: 'plumbing' },
    { key: 'dishwasher45', name: 'Посудомойка узкая', shape: 'labelbox', w: 45, d: 60, h: 85, label: 'ПММ', layer: 'plumbing' },
    { key: 'washer', name: 'Стиральная машина', shape: 'washer', w: 60, d: 60, h: 85, layer: 'plumbing' },
    { key: 'washerNarrow', name: 'Стиральная машина узкая', shape: 'washer', w: 60, d: 45, h: 85, layer: 'plumbing' },
    { key: 'dryer', name: 'Сушильная машина', shape: 'washer', w: 60, d: 60, h: 85 },
    { key: 'microwave', name: 'Микроволновка', shape: 'oven', w: 48, d: 36, h: 28 },
    { key: 'ac', name: 'Кондиционер (внутр. блок)', shape: 'labelbox', w: 80, d: 25, h: 28, label: 'К', layer: 'electric' },
    { key: 'acout', name: 'Кондиционер (наруж. блок)', shape: 'fan', w: 80, d: 30, h: 55, layer: 'electric' },
  ]},
  { id: 'bath', name: 'Ванная и санузел', layer: 'plumbing', items: [
    { key: 'bath170', name: 'Ванна 170×70', shape: 'bath', w: 170, d: 70, h: 60 },
    { key: 'bath150', name: 'Ванна 150×70', shape: 'bath', w: 150, d: 70, h: 60 },
    { key: 'bath180', name: 'Ванна 180×80', shape: 'bath', w: 180, d: 80, h: 60 },
    { key: 'bathCorner', name: 'Ванна угловая', shape: 'bathCorner', w: 150, d: 150, h: 60, flip: true },
    { key: 'shower90', name: 'Душевая кабина 90×90', shape: 'shower', w: 90, d: 90, h: 215 },
    { key: 'shower80', name: 'Душевой поддон 80×80', shape: 'shower', w: 80, d: 80, h: 15 },
    { key: 'showerWalk', name: 'Душ с трапом 120×90', shape: 'shower', w: 120, d: 90, h: 0 },
    { key: 'toilet', name: 'Унитаз напольный', shape: 'toilet', w: 38, d: 65, h: 80 },
    { key: 'toiletWall', name: 'Унитаз подвесной', shape: 'toilet', w: 36, d: 54, h: 40 },
    { key: 'bidet', name: 'Биде', shape: 'bidet', w: 36, d: 55, h: 40 },
    { key: 'urinal', name: 'Писсуар', shape: 'urinal', w: 35, d: 30, h: 60 },
    { key: 'sink', name: 'Раковина', shape: 'sink', w: 60, d: 45, h: 85 },
    { key: 'sinkSmall', name: 'Раковина малая', shape: 'sink', w: 45, d: 35, h: 85 },
    { key: 'vanity', name: 'Тумба с раковиной', shape: 'vanity', w: 80, d: 48, h: 85 },
    { key: 'towel', name: 'Полотенцесушитель', shape: 'radiator', w: 50, d: 10, h: 80, layer: 'heating' },
    { key: 'boiler50', name: 'Водонагреватель 50 л', shape: 'boiler', w: 45, d: 45, h: 60 },
    { key: 'boiler80', name: 'Водонагреватель 80 л', shape: 'boiler', w: 45, d: 45, h: 80 },
    { key: 'boilerFlat', name: 'Водонагреватель плоский', shape: 'labelbox', w: 55, d: 30, h: 90, label: 'ВН' },
  ]},
  { id: 'heating', name: 'Отопление, печи, камины', layer: 'heating', items: [
    { key: 'stoveRus', name: 'Печь русская', shape: 'stoveHeat', w: 150, d: 200, h: 220 },
    { key: 'stoveBrick', name: 'Печь отопительная (кирпич)', shape: 'stoveHeat', w: 102, d: 89, h: 210 },
    { key: 'stoveKitchen', name: 'Печь отопит.-варочная', shape: 'stoveHeat', w: 128, d: 89, h: 200 },
    { key: 'fireplace', name: 'Камин с порталом', shape: 'fireplace', w: 150, d: 55, h: 120 },
    { key: 'fireplaceCorner', name: 'Камин угловой', shape: 'fireplaceCorner', w: 110, d: 110, h: 120 },
    { key: 'stoveMetal', name: 'Печь металлическая', shape: 'stoveMetal', w: 50, d: 70, h: 80 },
    { key: 'saunaStove', name: 'Печь банная', shape: 'stoveMetal', w: 50, d: 85, h: 90 },
    { key: 'chimney', name: 'Дымоход / труба', shape: 'chimney', w: 25, d: 25, h: 600 },
    { key: 'gasBoilerWall', name: 'Газовый котёл настенный', shape: 'labelbox', w: 40, d: 30, h: 70, label: 'КГ' },
    { key: 'boilerFloor', name: 'Котёл напольный', shape: 'labelbox', w: 50, d: 60, h: 85, label: 'К' },
    { key: 'elBoiler', name: 'Электрокотёл', shape: 'labelbox', w: 30, d: 20, h: 60, label: 'ЭК', layer: 'electric' },
    { key: 'indirect', name: 'Бойлер косвенного нагрева', shape: 'boiler', w: 60, d: 60, h: 120 },
    { key: 'radiator', name: 'Радиатор', shape: 'radiator', w: 80, d: 10, h: 50 },
    { key: 'radiatorLong', name: 'Радиатор длинный', shape: 'radiator', w: 140, d: 10, h: 50 },
    { key: 'manifold', name: 'Коллектор', shape: 'labelbox', w: 50, d: 12, h: 40, label: 'Кол' },
    { key: 'pump', name: 'Циркуляционный насос', shape: 'pump', w: 18, d: 18, h: 15 },
  ]},
  { id: 'hall', name: 'Прихожая, кабинет, прочее', layer: 'furniture', items: [
    { key: 'hallWardrobe', name: 'Шкаф в прихожую', shape: 'wardrobe', w: 120, d: 40, h: 220 },
    { key: 'shoeRack', name: 'Обувница', shape: 'cabinet', w: 80, d: 30, h: 90 },
    { key: 'bench', name: 'Банкетка / скамья', shape: 'bench', w: 100, d: 35, h: 45 },
    { key: 'desk', name: 'Письменный стол', shape: 'desk', w: 120, d: 60, h: 75 },
    { key: 'deskCorner', name: 'Стол угловой', shape: 'deskL', w: 150, d: 120, h: 75, flip: true },
    { key: 'officeChair', name: 'Кресло офисное', shape: 'officechair', w: 60, d: 60, h: 110 },
    { key: 'stairs', name: 'Лестница прямая', shape: 'stairs', w: 100, d: 360, h: 280 },
    { key: 'stairsL', name: 'Лестница Г-образная', shape: 'stairsL', w: 200, d: 260, h: 280, flip: true },
    { key: 'column', name: 'Колонна', shape: 'column', w: 30, d: 30, h: 280 },
    { key: 'column', name: 'Колонна круглая', shape: 'columnRound', w: 30, d: 30, h: 280, key2: 'columnRound' },
  ]},
  { id: 'electric', name: 'Электрика', layer: 'electric', items: [
    { key: 'socket', name: 'Розетка', shape: 'socket', w: 8, d: 4, h: 30, sym: 22 },
    { key: 'socket2', name: 'Розетка двойная', shape: 'socket2', w: 15, d: 4, h: 30, sym: 26 },
    { key: 'socketPower', name: 'Силовая розетка 32А', shape: 'socketP', w: 10, d: 5, h: 30, sym: 24 },
    { key: 'switch', name: 'Выключатель', shape: 'switch', w: 8, d: 4, h: 90, sym: 22 },
    { key: 'switch2', name: 'Выключатель 2-клавишный', shape: 'switch2', w: 8, d: 4, h: 90, sym: 22 },
    { key: 'lamp', name: 'Светильник потолочный', shape: 'lamp', w: 40, d: 40, h: 250, sym: 26 },
    { key: 'spot', name: 'Точечный светильник', shape: 'spot', w: 9, d: 9, h: 270, sym: 16 },
    { key: 'wallLamp', name: 'Бра', shape: 'wallLamp', w: 25, d: 15, h: 180, sym: 22 },
    { key: 'jbox', name: 'Распаечная коробка', shape: 'jbox', w: 10, d: 10, h: 250, sym: 16 },
    { key: 'panel', name: 'Электрощит', shape: 'panel', w: 40, d: 15, h: 60, sym: 30 },
    { key: 'meter', name: 'Счётчик / ВРУ', shape: 'labelbox', w: 30, d: 20, h: 50, label: 'Wh', sym: 28 },
    { key: 'fan', name: 'Вытяжной вентилятор', shape: 'fan', w: 20, d: 20, h: 250, sym: 20 },
    { key: 'pole', name: 'Столб ЛЭП', kw: 'опора лэп вл электричество', shape: 'pole', w: 25, d: 25, h: 1000, sym: 40, layer: 'electric', shadow: true },
    { key: 'lightPole', name: 'Фонарь уличный', shape: 'lightpole', w: 20, d: 20, h: 350, sym: 36, shadow: true },
    { key: 'groundRod', name: 'Контур заземления', shape: 'ground', w: 100, d: 100, h: 0 },
    { key: 'generator', name: 'Генератор', shape: 'labelbox', w: 70, d: 55, h: 55, label: 'ГЕН' },
  ]},
  { id: 'water', name: 'Водоснабжение и канализация', layer: 'plumbing', items: [
    { key: 'septic2', name: 'Септик 2-камерный', shape: 'septic', w: 200, d: 120, h: 30, chambers: 2 },
    { key: 'septic3', name: 'Септик 3-камерный', shape: 'septic', w: 250, d: 120, h: 30, chambers: 3 },
    { key: 'septicRing', name: 'Септик (ж/б кольца)', shape: 'ring', w: 116, d: 116, h: 20, label: 'С' },
    { key: 'cesspool', name: 'Выгребная яма', shape: 'ring', w: 150, d: 150, h: 20, label: 'ВЯ' },
    { key: 'well', name: 'Колодец питьевой', shape: 'well', w: 116, d: 116, h: 80, shadow: true },
    { key: 'borehole', name: 'Скважина (кессон)', shape: 'borehole', w: 120, d: 120, h: 20 },
    { key: 'manhole', name: 'Колодец смотровой', shape: 'ring', w: 70, d: 70, h: 10, label: 'КК' },
    { key: 'drainWell', name: 'Дренажный колодец', shape: 'ring', w: 100, d: 100, h: 10, label: 'ДК' },
    { key: 'filterField', name: 'Поле фильтрации', shape: 'filterfield', w: 300, d: 400, h: 0 },
    { key: 'riser', name: 'Стояк канализации Ø110', shape: 'riser', w: 12, d: 12, h: 300, sym: 16 },
    { key: 'waterIn', name: 'Ввод воды', shape: 'labelbox', w: 20, d: 20, h: 50, label: 'В1', sym: 24 },
    { key: 'pumpStation', name: 'Насосная станция', shape: 'pump', w: 50, d: 30, h: 60 },
    { key: 'filter', name: 'Фильтр / водоподготовка', shape: 'boiler', w: 40, d: 40, h: 150 },
    { key: 'tap', name: 'Кран поливочный', shape: 'tap', w: 10, d: 10, h: 60, sym: 18 },
    { key: 'rainBarrel', name: 'Бочка / ёмкость', shape: 'round', w: 80, d: 80, h: 100, shadow: true },
  ]},
  { id: 'gas', name: 'Газ', layer: 'gas', items: [
    { key: 'gasholder', name: 'Газгольдер', shape: 'capsule', w: 250, d: 120, h: 20 },
    { key: 'gasMeter', name: 'Газовый счётчик', shape: 'labelbox', w: 30, d: 20, h: 40, label: 'ГС', sym: 26 },
    { key: 'gasValve', name: 'Кран газовый', shape: 'valve', w: 10, d: 10, h: 150, sym: 18 },
    { key: 'gasCabinet', name: 'Шкаф ГРПШ / баллоны', shape: 'labelbox', w: 100, d: 50, h: 150, label: 'Г', shadow: true },
  ]},
  { id: 'buildings', name: 'Постройки на участке', layer: 'siteobj', items: [
    { key: 'house', name: 'Дом (контур)', shape: 'building', w: 1000, d: 900, h: 750, shadow: true },
    { key: 'garage1', name: 'Гараж на 1 машину', shape: 'garage', w: 400, d: 600, h: 300, shadow: true },
    { key: 'garage2', name: 'Гараж на 2 машины', shape: 'garage', w: 650, d: 650, h: 320, shadow: true },
    { key: 'carport', name: 'Навес для авто (1 машина)', shape: 'canopy', w: 350, d: 600, h: 280, shadow: true, roof: true },
    { key: 'carport2', name: 'Навес для авто (2 машины)', shape: 'canopy', w: 600, d: 600, h: 290, shadow: true, roof: true },
    { key: 'carportLean', name: 'Навес пристроенный (односкатный)', shape: 'canopyLean', w: 350, d: 600, h: 300, shadow: true, roof: true },
    { key: 'shed', name: 'Сарай / хозблок', shape: 'building', w: 300, d: 400, h: 280, shadow: true },
    { key: 'bathhouse', name: 'Баня', shape: 'building', w: 400, d: 500, h: 380, shadow: true },
    { key: 'gazebo', name: 'Беседка', shape: 'gazebo', w: 300, d: 300, h: 300, shadow: true },
    { key: 'greenhouse', name: 'Теплица', shape: 'greenhouse', w: 300, d: 600, h: 220, shadow: true },
    { key: 'woodshed', name: 'Дровник', shape: 'canopy', w: 250, d: 120, h: 200, shadow: true },
    { key: 'canopy', name: 'Навес / перголa', shape: 'canopy', w: 400, d: 400, h: 280, shadow: true, roof: true },
    { key: 'outhouse', name: 'Туалет уличный', shape: 'building', w: 100, d: 130, h: 230, shadow: true },
    { key: 'showerOut', name: 'Душ летний', shape: 'building', w: 100, d: 120, h: 230, shadow: true },
    { key: 'pool', name: 'Бассейн', shape: 'pool', w: 400, d: 800, h: 0 },
    { key: 'bbq', name: 'Мангал / барбекю', shape: 'bbq', w: 100, d: 40, h: 90 },
    { key: 'playground', name: 'Детская площадка', shape: 'labelbox', w: 500, d: 500, h: 0, label: 'Площадка' },
    { key: 'compost', name: 'Компостер', shape: 'labelbox', w: 100, d: 100, h: 90, label: 'Компост' },
    { key: 'parking', name: 'Парковочное место', shape: 'parking', w: 250, d: 530, h: 0 },
    { key: 'car', name: 'Автомобиль', shape: 'car', w: 185, d: 460, h: 150, shadow: true },
  ]},
  { id: 'pits', name: 'Погреба и ямы', layer: 'siteobj', items: [
    { key: 'cellar', name: 'Погреб с лестницей', kw: 'подвал кессон яма', shape: 'pit', w: 200, d: 250, h: 0, pitDepth: 250, stair: 'stairs', stairSide: 'back', stairW: 70, cover: 'hatch' },
    { key: 'cellarHouse', name: 'Погреб с погребницей', kw: 'подвал кессон яма домик', shape: 'pit', w: 200, d: 250, h: 0, pitDepth: 250, stair: 'stairs', stairSide: 'back', stairW: 70, cover: 'house' },
    { key: 'podpol', name: 'Подпол (под полом, с люком)', kw: 'погреб подвал люк', shape: 'pit', w: 150, d: 150, h: 0, pitDepth: 170, stair: 'ladder', stairSide: 'back', stairW: 50, cover: 'hatch' },
    { key: 'inspPit', name: 'Смотровая яма (гараж)', kw: 'яма гараж ремонт', shape: 'pit', w: 80, d: 350, h: 0, pitDepth: 170, stair: 'stairs', stairSide: 'back', stairW: 60, cover: 'open' },
    { key: 'pitOpen', name: 'Яма / приямок (открытая)', kw: 'котлован приямок', shape: 'pit', w: 150, d: 150, h: 0, pitDepth: 120, stair: 'ladder', stairSide: 'back', stairW: 50, cover: 'open' },
  ]},
  { id: 'green', name: 'Озеленение', layer: 'siteobj', items: [
    { key: 'tree', name: 'Дерево лиственное', shape: 'tree', w: 600, d: 600, h: 1200, shadow: true },
    { key: 'fruitTree', name: 'Дерево плодовое', shape: 'tree', w: 400, d: 400, h: 500, shadow: true },
    { key: 'conifer', name: 'Дерево хвойное', shape: 'conifer', w: 400, d: 400, h: 1500, shadow: true },
    { key: 'thuja', name: 'Туя / можжевельник', shape: 'conifer', w: 120, d: 120, h: 300, shadow: true },
    { key: 'bush', name: 'Кустарник', shape: 'bush', w: 150, d: 150, h: 150, shadow: true },
    { key: 'hedge', name: 'Живая изгородь', kw: 'забор ограда кусты', shape: 'hedge', w: 500, d: 80, h: 180, shadow: true },
    { key: 'bed', name: 'Грядка', shape: 'gardenbed', w: 120, d: 400, h: 20 },
    { key: 'flowerbed', name: 'Клумба', shape: 'flowerbed', w: 200, d: 200, h: 20 },
  ]},
  // заборы рисуются инструментом «Забор» (как стены): элемент библиотеки включает его с нужным материалом
  { id: 'fences', name: 'Заборы и ворота', layer: 'siteobj', items: [
    { key: 'fenceProfile', name: 'Забор из профлиста', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'profile', w: 300, d: 10, h: 200 },
    { key: 'fenceEuro', name: 'Забор из евроштакетника', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'euro', w: 300, d: 10, h: 180 },
    { key: 'fencePicket', name: 'Штакетник деревянный', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'picket', w: 300, d: 10, h: 150 },
    { key: 'fenceWood', name: 'Забор деревянный сплошной', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'wood', w: 300, d: 10, h: 180 },
    { key: 'fenceMesh', name: 'Сетка-рабица', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'mesh', w: 300, d: 10, h: 150 },
    { key: 'fenceForged', name: 'Забор кованый / сварной', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'forged', w: 300, d: 10, h: 170 },
    { key: 'fenceBrick', name: 'Забор кирпичный', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'brickF', w: 300, d: 10, h: 200 },
    { key: 'fenceConcrete', name: 'Еврозабор (бетонный)', shape: 'fenceIcon', kw: 'забор ограда ограждение изгородь', tool: 'fence', mat: 'concreteF', w: 300, d: 10, h: 200 },
    { key: 'fenceAround', name: 'Забор по границе участка', shape: 'fenceAroundIcon', kw: 'забор ограда ограждение периметр', action: 'fenceAround', w: 300, d: 300, h: 180 },
    { key: 'gate', name: 'Ворота откатные', kw: 'въезд забор ограда', shape: 'gateSlide', w: 400, d: 20, h: 200, shadow: true },
    { key: 'wicket', name: 'Калитка', kw: 'вход дверь забор ограда', shape: 'wicket', w: 100, d: 10, h: 200, shadow: true },
  ]},
  // трассы: клик — инструмент «Сети» с этим видом (рисуется по точкам)
  { id: 'networks', name: 'Сети и коммуникации', layer: 'electric', items: Object.entries({
    water: 'вода водопровод трубы скважина хвс', hotwater: 'вода гвс горячая трубы', sewer: 'канализация септик стоки трубы',
    drain: 'ливнёвка ливневка дренаж водоотвод', heating: 'отопление трубы тепло', warmfloor: 'тёплый теплый пол отопление',
    gas: 'газ газопровод', power: 'электричество кабель электрика ввод', overhead: 'лэп вл провод столб опора электричество воздушная линия сип',
    lowvolt: 'интернет сеть тв кабель слаботочка', ground: 'заземление контур',
  }).map(([k, kw]) => ({ key: 'net_' + k, name: LINE_KINDS[k].name, shape: 'netIcon', kw: 'сети трасса коммуникации ' + kw, tool: 'line', lineKind: k, w: 100, d: 100, h: 0 })) },
  { id: 'porch', name: 'Крыльцо, веранда, терраса', layer: 'siteobj', items: [
    { key: 'porch', name: 'Крыльцо с козырьком', shape: 'veranda', w: 200, d: 150, h: 300, ph: 60, encl: 'rail', roofed: true, attached: true, stepW: 120, shadow: true },
    { key: 'porchOpen', name: 'Крыльцо открытое (площадка + ступени)', shape: 'veranda', w: 160, d: 120, h: 60, ph: 45, encl: 'open', roofed: false, attached: true, stepW: 120 },
    { key: 'veranda', name: 'Веранда остеклённая', shape: 'veranda', w: 600, d: 300, h: 330, ph: 45, encl: 'glazed', roofed: true, attached: true, stepW: 100, shadow: true },
    { key: 'verandaWarm', name: 'Веранда закрытая утеплённая', shape: 'veranda', w: 600, d: 300, h: 330, ph: 45, encl: 'closed', roofed: true, attached: true, stepW: 100, shadow: true },
    { key: 'verandaOpen', name: 'Веранда открытая (под крышей)', shape: 'veranda', w: 600, d: 300, h: 330, ph: 45, encl: 'rail', roofed: true, attached: true, stepW: 150, shadow: true },
    { key: 'terraceRoof', name: 'Терраса под навесом', shape: 'veranda', w: 500, d: 400, h: 300, ph: 15, encl: 'open', roofed: true, attached: false, steps: 'none', stepW: 150, shadow: true },
    { key: 'terrace', name: 'Терраса открытая (настил)', shape: 'veranda', w: 600, d: 300, h: 0, ph: 20, encl: 'open', roofed: false, attached: true, steps: 'none', stepW: 150 },
    { key: 'terraceRail', name: 'Терраса с ограждением', shape: 'veranda', w: 600, d: 300, h: 0, ph: 60, encl: 'rail', roofed: false, attached: true, stepW: 120 },
  ]},
  { id: 'misc', name: 'Произвольные', layer: 'furniture', items: [
    { key: 'box', name: 'Прямоугольник (произвольный)', shape: 'labelbox', w: 100, d: 100, h: 100, label: '' },
    { key: 'circle', name: 'Круг (произвольный)', shape: 'round', w: 100, d: 100, h: 100 },
  ]},
];
/* Уникализация ключа «колонна круглая» */
for (const c of CATALOG) for (const it of c.items) if (it.key2) { it.key = it.key2; delete it.key2; }

const CAT_INDEX = {};
for (const c of CATALOG) for (const it of c.items) {
  it.cat = c.id;
  it.layer = it.layer || c.layer;
  CAT_INDEX[it.key] = it;
}
function catItem(key) { return CAT_INDEX[key] || CAT_INDEX.box; }

/* ======================= КРЫЛЬЦО / ВЕРАНДА / ТЕРРАСА ======================== */
const PORCH_ENCL = {
  open:   { name: 'Открытая', short: 'открытая' },
  rail:   { name: 'Открытая с ограждением', short: 'с ограждением' },
  glazed: { name: 'Закрытая остеклённая', short: 'остеклённая' },
  closed: { name: 'Закрытая утеплённая (стены и окна)', short: 'утеплённая' },
};
const PORCH_KEYS = ['encl', 'roofed', 'attached', 'ph', 'steps', 'stepSides', 'railSides', 'stepPos', 'stepW'];
/** Стороны площадки в локальных координатах: «спереди» — +d/2, «сзади» — −d/2 (у дома, если пристроена).
 *  «Слева/справа» — если смотреть на площадку спереди. out — внешняя нормаль. Каждая сторона идёт
 *  от левого края к правому (боковые — от переда к заду): так «start/end» у ступеней понятны. */
const PORCH_SIDES = {
  front: { name: 'спереди', a: (w, d) => ({ x: -w / 2, y: d / 2 }), b: (w, d) => ({ x: w / 2, y: d / 2 }), out: { x: 0, y: 1 } },
  left:  { name: 'слева', a: (w, d) => ({ x: -w / 2, y: d / 2 }), b: (w, d) => ({ x: -w / 2, y: -d / 2 }), out: { x: -1, y: 0 } },
  right: { name: 'справа', a: (w, d) => ({ x: w / 2, y: d / 2 }), b: (w, d) => ({ x: w / 2, y: -d / 2 }), out: { x: 1, y: 0 } },
  back:  { name: 'сзади', a: (w, d) => ({ x: -w / 2, y: -d / 2 }), b: (w, d) => ({ x: w / 2, y: -d / 2 }), out: { x: 0, y: -1 } },
};
/** Параметры веранды: из объекта, иначе — из каталога */
function porchOpt(it) {
  const d = catItem(it.key), g = (k, def) => it[k] ?? d[k] ?? def;
  const attached = !!g('attached', true);
  const free = Object.keys(PORCH_SIDES).filter(k => !(attached && k === 'back'));
  // ступени: список сторон (старые проекты — steps: 'front' / 'none')
  let stepSides = it.stepSides ?? d.stepSides ?? (g('steps', 'front') === 'none' ? [] : ['front']);
  stepSides = stepSides.filter(k => free.includes(k));
  const railSides = (it.railSides ?? d.railSides ?? free).filter(k => free.includes(k));
  return { encl: g('encl', 'open'), roofed: !!g('roofed', false), attached, ph: Math.max(0, +g('ph', 0) || 0), stepSides, railSides, free, stepPos: g('stepPos', 'center'), stepW: Math.max(60, +g('stepW', 120) || 120) };
}
/** Геометрия в локальных координатах: стороны с ограждением (без проходов к ступеням), проходы, ступени */
function porchGeom(it, w, d) {
  const o = porchOpt(it);
  const n = o.ph >= 15 ? Math.max(2, Math.round(o.ph / 17)) : 0;
  const tread = 30;
  const gaps = {}, flights = [];
  for (const k of o.stepSides) {
    const S = PORCH_SIDES[k], a = S.a(w, d), b = S.b(w, d), L = G.dist(a, b), u = G.unit(G.sub(b, a));
    const sw = Math.min(o.stepW, L - 20);
    const s0 = o.stepPos === 'start' ? 10 : o.stepPos === 'end' ? L - 10 - sw : (L - sw) / 2;
    gaps[k] = [s0, s0 + sw];
    flights.push({ side: k, a: G.add(a, G.mul(u, s0)), b: G.add(a, G.mul(u, s0 + sw)), u, out: S.out, sw });
  }
  const segs = [];
  for (const k of o.railSides) {
    const S = PORCH_SIDES[k], a = S.a(w, d), b = S.b(w, d), L = G.dist(a, b), u = G.unit(G.sub(b, a));
    const inn = G.mul(S.out, -1);
    const parts = gaps[k] ? [[0, gaps[k][0]], [gaps[k][1], L]] : [[0, L]];
    for (const [t0, t1] of parts) if (t1 - t0 > 5) segs.push({ side: k, a: G.add(a, G.mul(u, t0)), b: G.add(a, G.mul(u, t1)), n: inn });
  }
  // двери — в проходах к ступеням на сторонах с ограждением/стенами
  const doors = flights.filter(f => o.railSides.includes(f.side));
  return { o, segs, flights, doors, steps: flights.length ? n : 0, rise: n ? o.ph / n : 0, tread, sw: flights[0] ? flights[0].sw : Math.min(o.stepW, w - 20) };
}

/** Столбы под крышей открытой веранды: по углам (кроме стороны дома) и не реже чем через ~3 м,
 *  но не в проходах к ступеням */
function porchPosts(g, w, d) {
  const o = g.o, out = [], k = 7;
  const corners = [{ x: -w / 2 + k, y: d / 2 - k }, { x: w / 2 - k, y: d / 2 - k }];
  if (!o.attached) corners.push({ x: -w / 2 + k, y: -d / 2 + k }, { x: w / 2 - k, y: -d / 2 + k });
  out.push(...corners);
  for (const side of o.free) {
    const S = PORCH_SIDES[side], a = S.a(w, d), b = S.b(w, d), L = G.dist(a, b), u = G.unit(G.sub(b, a));
    const n = Math.max(1, Math.round(L / 300)), inn = G.mul(S.out, -k);
    const f = g.flights.find(x => x.side === side);
    for (let i = 1; i < n; i++) {
      const t = L * i / n;
      if (f) { const t0 = G.dist(a, f.a), t1 = G.dist(a, f.b); if (t > t0 - 15 && t < t1 + 15) continue; }
      out.push(G.add(G.add(a, G.mul(u, t)), inn));
    }
  }
  return out;
}

/* ===================== ПОГРЕБ / ПОДПОЛ / СМОТРОВАЯ ЯМА ===================== */
const PIT_KEYS = ['pitDepth', 'stair', 'stairSide', 'stairW', 'cover'];
const PIT_STAIRS = { stairs: 'Лестница со ступенями', ladder: 'Стремянка (приставная)', none: 'Без лестницы' };
const PIT_COVERS = { hatch: 'Люк (закрыта сверху)', open: 'Открытая', house: 'Погребница (домик над входом)' };
/** Геометрия ямы в локальных координатах: стенки t, лестница вдоль стороны stairSide (от неё вниз, в глубь ямы) */
function pitGeom(it, w, d) {
  const def = catItem(it.key), g = (k, v) => it[k] ?? def[k] ?? v;
  const t = 12, depth = U.clamp(+g('pitDepth', 200) || 200, 30, 600);
  const stair = PIT_STAIRS[g('stair', 'stairs')] ? g('stair', 'stairs') : 'stairs';
  const cover = PIT_COVERS[g('cover', 'hatch')] ? g('cover', 'hatch') : 'hatch';
  const side = ['back', 'front', 'left', 'right'].includes(g('stairSide', 'back')) ? g('stairSide', 'back') : 'back';
  // направление спуска (от стороны внутрь), поперёк — «across»; размеры ямы внутри
  const dir = { back: { x: 0, y: 1 }, front: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 } }[side];
  const iw = w - 2 * t, id = d - 2 * t;
  const along = dir.y ? id : iw, acrossLen = dir.y ? iw : id;
  const sw = Math.min(Math.max(40, +g('stairW', 70) || 70), acrossLen);
  // ступени: подъём ~20 см, проступь 20–25 см; если не влезает — круче
  const n = Math.max(2, Math.round(depth / 20)), rise = depth / n;
  let tread = stair === 'ladder' ? 0 : Math.min(25, (along - 30) / n);
  if (stair === 'stairs' && tread < 12) tread = Math.max(8, (along - 10) / n);
  const L = stair === 'stairs' ? tread * n : stair === 'ladder' ? 40 : 0;
  const edge = { x: -dir.x * along / 2, y: -dir.y * along / 2 };                // середина стороны спуска (внутри)
  const across = { x: Math.abs(dir.y), y: Math.abs(dir.x) };
  const rect = (from, to, width) => {                                             // прямоугольник вдоль спуска
    const a = G.add(edge, G.mul(dir, from)), b = G.add(edge, G.mul(dir, to)), hw = width / 2;
    const xs = [a.x - across.x * hw, a.x + across.x * hw, b.x - across.x * hw, b.x + across.x * hw], ys = [a.y - across.y * hw, a.y + across.y * hw, b.y - across.y * hw, b.y + across.y * hw];
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  return {
    t, depth, stair, cover, side, dir, across, edge, sw, n, rise, tread, L, iw, id,
    flight: stair === 'none' ? null : rect(0, Math.max(L, 20), sw),
    lid: rect(0, Math.min(Math.max(L, 60), along), Math.min(sw + 16, acrossLen)),              // люк над лестницей
    house: rect(-t - 10, Math.min(Math.max(L, 80), along) + 10, Math.min(sw + 60, acrossLen + 2 * t + 20)), // погребница
    volume: w * d * depth / 1e6,
    rect,
  };
}

/* ===================== КРЫШИ ПОСТРОЕК (гараж, сарай, навес, теплица) ===================== */
const BLD_ROOF_SHAPES = new Set(['building', 'garage', 'canopy', 'canopyLean', 'greenhouse']);
const ITEM_ROOF_TYPES = {
  gable: { name: 'Двускатная', pitch: 30 },
  hip:   { name: 'Вальмовая (четырёхскатная)', pitch: 25 },
  shed:  { name: 'Односкатная', pitch: 12 },
  flat:  { name: 'Плоская', pitch: 0 },
  arch:  { name: 'Арочная (полукруглая)', pitch: 0 },
};
/** Крыша постройки: тип, материал, уклон, направление конька/ската; значения по умолчанию — от вида постройки */
function bldRoof(it) {
  const def = catItem(it.key), sh = def.shape;
  const po = sh === 'veranda' ? porchOpt(it) : null;
  const dType = po ? (po.attached ? 'shed' : 'gable') : sh === 'canopyLean' || def.key === 'woodshed' ? 'shed' : sh === 'canopy' ? 'flat' : 'gable';
  const type = ITEM_ROOF_TYPES[it.roofType] ? it.roofType : dType;
  const dMat = sh === 'greenhouse' ? 'polycarb' : po ? (po.attached ? 'profile' : 'metaltile') : sh === 'garage' || sh === 'canopy' || sh === 'canopyLean' ? 'profile' : def.key === 'bathhouse' ? 'soft' : 'metaltile';
  const mat = ROOF_MATERIALS[it.roofMat] ? it.roofMat : dMat;
  const pitch = U.isNum(it.roofPitch) ? U.clamp(it.roofPitch, 0, 60) : sh === 'greenhouse' && type === 'gable' ? 35 : ITEM_ROOF_TYPES[type].pitch;
  const open = sh === 'canopy' || sh === 'canopyLean' || (po && (po.encl === 'open' || po.encl === 'rail'));
  // свесы по сторонам: у пристроенной веранды со стороны дома свеса нет
  const over = sh === 'canopy' || sh === 'canopyLean' ? 10 : sh === 'greenhouse' ? 5 : 25;
  const sides = { l: over, r: over, f: over, b: po && po.attached ? 0 : over };
  return { type, mat, pitch, ridge: it.roofRidge === 'short' ? 'short' : 'long', shedDir: ['back', 'front', 'left', 'right'].includes(it.roofShed) ? it.roofShed : 'back', over, sides, open, veranda: !!po };
}
/** Прямоугольник крыши в локальных координатах постройки: {w, d, rot} (rot — относительно постройки);
 *  у двускатной/вальмовой/арочной конёк вдоль u, у односкатной высокая сторона — −v. */
function bldRoofRect(it, w, d) {
  const R = bldRoof(it), s = R.sides;
  // габарит крыши со свесами (в осях постройки) и его центр
  const W = w + s.l + s.r, D = d + s.f + s.b, x = (s.r - s.l) / 2, y = (s.f - s.b) / 2;
  if (R.type === 'shed') {
    const t = { back: [0, W, D], front: [180, W, D], left: [-90, D, W], right: [90, D, W] }[R.shedDir];
    return { x, y, rot: t[0], w: t[1], d: t[2], type: 'shed', pitch: R.pitch };
  }
  const alongW = (w >= d) === (R.ridge === 'long');
  return { x, y, rot: alongW ? 0 : 90, w: alongW ? W : D, d: alongW ? D : W, type: R.type, pitch: R.pitch };
}

/* ===================== ПОСТРОЙКИ «КАК ДОМ»: стены с толщиной, внутри — пусто ===================== */
const BLD_HOLLOW = new Set(['building', 'garage']);
const BLD_SIDES = { front: 'спереди (+Г)', back: 'сзади (−Г)', left: 'слева (−Ш)', right: 'справа (+Ш)' };
/** Толщина стен постройки */
function bldWallT(it) {
  const def = catItem(it.key), w = it.w, d = it.d;
  const tDef = def.key === 'house' ? 40 : def.shape === 'garage' ? 25 : Math.min(w, d) < 160 ? 5 : 15;
  return U.clamp(+(it.wallT ?? def.wallT ?? tDef) || tDef, 3, Math.max(3, Math.min(w, d) / 4));
}
/** Сторона постройки: ось стены (u — вдоль, n — внутрь), допустимый диапазон проёмов lo..hi (без углов) */
function bldSide(side, w, d, t) {
  const F = {
    front: { c: { x: 0, y: d / 2 - t / 2 }, u: { x: 1, y: 0 }, n: { x: 0, y: -1 }, L: w },
    back:  { c: { x: 0, y: -d / 2 + t / 2 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, L: w },
    left:  { c: { x: -w / 2 + t / 2, y: 0 }, u: { x: 0, y: 1 }, n: { x: 1, y: 0 }, L: d },
    right: { c: { x: w / 2 - t / 2, y: 0 }, u: { x: 0, y: 1 }, n: { x: -1, y: 0 }, L: d },
  }[side];
  F.lo = -F.L / 2 + t; F.hi = F.L / 2 - t;
  // прямоугольник стены от s0 до s1 вдоль стороны (локальные координаты постройки)
  F.rect = (s0, s1) => {
    const a = G.add(F.c, G.mul(F.u, s0)), b = G.add(F.c, G.mul(F.u, s1)), h = t / 2;
    const xs = [a.x - F.n.x * h, a.x + F.n.x * h, b.x - F.n.x * h, b.x + F.n.x * h], ys = [a.y - F.n.y * h, a.y + F.n.y * h, b.y - F.n.y * h, b.y + F.n.y * h];
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  return F;
}
/** Проёмы постройки (по умолчанию — ворота у гаража, дверь у сарая/бани спереди по центру) */
function bldOps(it) {
  if (Array.isArray(it.ops)) return it.ops;
  const def = catItem(it.key), t = bldWallT(it), gate = def.shape === 'garage';
  const w = Math.max(0, gate ? Math.min(it.w - 2 * t - 20, 300) : Math.min(90, it.w - 2 * t - 10));
  if (w < 30) return [];
  const T = OPENING_TYPES[gate ? 'gate' : 'door'];
  return [{ type: gate ? 'gate' : 'door', side: 'front', pos: 0, w, h: T.h, sill: 0, hinge: 0 }];
}
/** Локальные координаты постройки ↔ план (с учётом зеркального отражения, как на плане) */
function bldWorld(it, q) { return G.toWorld({ x: it.flip ? -q.x : q.x, y: q.y }, it.x, it.y, it.rot || 0); }
function bldLocal(it, p) { const q = G.toLocal(p, it.x, it.y, it.rot || 0); return { x: it.flip ? -q.x : q.x, y: q.y }; }
/** Стены постройки в локальных координатах: толщина t, куски стен между проёмами, проёмы ops (с rect, s0, s1, cat),
 *  внутренний контур inner. Внутрь можно ставить погреб, смотровую яму, мебель — всё видно. */
function bldShell(it, w, d) {
  const t = bldWallT(it);
  const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const ops = [];
  for (const o of bldOps(it)) {
    const T = OPENING_TYPES[o.type] || OPENING_TYPES.door, S = BLD_SIDES[o.side] ? o.side : 'front', F = bldSide(S, w, d, t);
    const ow = Math.min(+o.w || T.w, F.hi - F.lo), c = U.clamp(+o.pos || 0, F.lo + ow / 2, F.hi - ow / 2);
    if (!(ow > 5)) continue;
    ops.push({ ...o, type: OPENING_TYPES[o.type] ? o.type : 'door', side: S, cat: T.cat, w: ow, h: +o.h || T.h, sill: T.cat === 'door' ? 0 : (o.sill ?? T.sill), s0: c - ow / 2, s1: c + ow / 2, F, rect: F.rect(c - ow / 2, c + ow / 2) });
  }
  const walls = [];
  for (const side of Object.keys(BLD_SIDES)) {
    const F = bldSide(side, w, d, t), full = side === 'front' || side === 'back';
    const gaps = ops.filter(o => o.side === side).sort((a, b) => a.s0 - b.s0);
    let from = full ? -F.L / 2 : F.lo;
    for (const g of gaps) { if (g.s0 - from > 0.5) walls.push(F.rect(from, g.s0)); from = Math.max(from, g.s1); }
    const to = full ? F.L / 2 : F.hi;
    if (to - from > 0.5) walls.push(F.rect(from, to));
  }
  return { t, ops, walls, inner: R(-w / 2 + t, -d / 2 + t, w / 2 - t, d / 2 - t) };
}

/* ============================ КУХОННЫЕ ГАРНИТУРЫ ============================ */
const KITCHEN_SHAPES = new Set(['kitchenI', 'kitchenL', 'kitchenU', 'kitchenII', 'kitchenIsland', 'kitchenBar', 'kitchenPen', 'kitchenTall']);
/** Ленты модулей в локальных координатах (центр — 0,0; y вниз). front — сторона фасада,
 *  wall — ряд у стены (над ним навесные шкафы), h — своя высота (барная стойка), tall — пеналы. */
function kitchenLayout(shape, w, d) {
  const D = Math.min(60, d), R = (x0, y0, x1, y1, front, wall = true, h) => ({ x0, y0, x1, y1, front, wall, h });
  const back = R(-w / 2, -d / 2, w / 2, -d / 2 + D, 'down');
  const bc = -d / 2 + D / 2;
  switch (shape) {
    case 'kitchenL': return { runs: [back, R(w / 2 - D, -d / 2 + D, w / 2, d / 2, 'left')], sink: w >= 180 ? { x: -w / 2 + 40, y: bc } : null, hob: d >= 150 ? { x: w / 2 - D / 2, y: d / 2 - 40, v: true } : null };
    case 'kitchenU': return { runs: [back, R(-w / 2, -d / 2 + D, -w / 2 + D, d / 2, 'right'), R(w / 2 - D, -d / 2 + D, w / 2, d / 2, 'left')], sink: { x: 0, y: bc }, hob: { x: -w / 2 + D / 2, y: (d / 2 + D - d / 2) / 2 + 10, v: true } };
    case 'kitchenII': return { runs: [back, R(-w / 2, d / 2 - D, w / 2, d / 2, 'up')], sink: { x: -w / 2 + 50, y: bc }, hob: { x: 0, y: d / 2 - D / 2 } };
    case 'kitchenIsland': { const iw = Math.min(w * 0.6, 240); return { runs: [back, R(-iw / 2, d / 2 - 90, iw / 2, d / 2, 'up', false)], sink: { x: 0, y: d / 2 - 45 }, hob: { x: w / 2 - 50, y: bc } }; }
    case 'kitchenBar': { const bw = Math.min(w * 0.7, 200); return { runs: [back, R(-bw / 2, d / 2 - 50, bw / 2, d / 2, 'up', false, 110)], sink: { x: -w / 2 + 50, y: bc }, hob: { x: w / 2 - 50, y: bc }, bar: true }; }
    case 'kitchenPen': return { runs: [back, R(w / 2 - 90, -d / 2 + D, w / 2, d / 2, 'left', false)], sink: { x: -w / 2 + 50, y: bc }, hob: { x: 0, y: bc } };
    case 'kitchenTall': { const tw = Math.min(120, w / 3); return { runs: [R(-w / 2 + tw, -d / 2, w / 2, d / 2, 'down')], tall: [R(-w / 2, -d / 2, -w / 2 + tw, d / 2, 'down')], sink: { x: -w / 2 + tw + 45, y: 0 }, hob: { x: w / 2 - 45, y: 0 } }; }
    default: return { runs: [R(-w / 2, -d / 2, w / 2, d / 2, 'down')], sink: w >= 120 ? { x: -w / 2 + 40, y: 0 } : null, hob: w >= 120 ? { x: w / 2 - 45, y: 0 } : null };
  }
}

/* ============================ ОТРИСОВКА ================================= */
/* P — контекст отрисовки: ctx (уже в локальных координатах предмета), px — 1 экранный пиксель в см,
   C — цвета темы, it — объект, def — описание из каталога. */
const Painters = (() => {
  const rr = (ctx, x, y, w, h, r) => {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const box = (P, x, y, w, h, r = 0, fill = true) => {
    rr(P.ctx, x, y, w, h, r);
    if (fill) P.ctx.fill();
    P.ctx.stroke();
  };
  const circle = (P, x, y, r, fill = true) => {
    P.ctx.beginPath(); P.ctx.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2);
    if (fill) P.ctx.fill();
    P.ctx.stroke();
  };
  const line = (P, pts, close = false) => {
    const c = P.ctx;
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    if (close) c.closePath();
    c.stroke();
  };
  const ell = (P, x, y, rx, ry, fill = true) => {
    P.ctx.beginPath(); P.ctx.ellipse(x, y, Math.max(rx, .1), Math.max(ry, .1), 0, 0, Math.PI * 2);
    if (fill) P.ctx.fill();
    P.ctx.stroke();
  };
  const text = (P, s, x, y, sizeCm, opts = {}) => {
    if (!s) return;
    const c = P.ctx;
    const pxSize = sizeCm / P.px;
    if (pxSize < 6) return;
    c.save();
    c.fillStyle = opts.color || P.C.ink;
    c.font = `${opts.bold ? '600 ' : ''}${Math.min(sizeCm, opts.maxCm || 1e9)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (P.upright) {
      // держим надпись читаемой при любом повороте и зеркалировании
      c.translate(x, y);
      if (P.flip) c.scale(-1, 1);
      c.rotate(-P.rotRad);
      c.translate(-x, -y);
    }
    c.fillText(s, x, y);
    c.restore();
  };
  const hatch = (P, x, y, w, h, step, ang = 45) => {
    const c = P.ctx;
    c.save();
    rr(c, x, y, w, h, 0); c.clip();
    c.beginPath();
    const L = w + h;
    const k = Math.tan(U.rad(ang));
    for (let s = -L; s < L; s += step) {
      c.moveTo(x + s, y); c.lineTo(x + s + h / k, y + h);
    }
    c.stroke();
    c.restore();
  };
  const lw = (P, px) => { P.ctx.lineWidth = px * P.px; };
  const thin = (P) => lw(P, 0.8);

  const S = {};

  S.labelbox = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0);
    const lbl = P.it.label ?? P.def.label ?? '';
    text(P, lbl, 0, 0, Math.min(d * 0.5, w / Math.max(lbl.length, 1) * 1.1, 60), { bold: true });
  };
  S.rug = (P, w, d) => {
    P.ctx.setLineDash([6 * P.px, 4 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 4, false);
    P.ctx.setLineDash([]);
    box(P, -w / 2 + 8, -d / 2 + 8, w - 16, d - 16, 3, false);
  };
  S.round = (P, w, d) => ell(P, 0, 0, w / 2, d / 2);
  S.table = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 3); thin(P); box(P, -w / 2 + 4, -d / 2 + 4, w - 8, d - 8, 2, false); };
  S.cabinet = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 1);
    thin(P); line(P, [-w / 2, d / 2 - 4, w / 2, d / 2 - 4]);
    if (w >= 60) line(P, [0, -d / 2, 0, d / 2 - 4]);
  };
  S.shelf = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0);
    thin(P);
    const n = Math.max(1, Math.round(w / 40));
    for (let i = 1; i < n; i++) line(P, [-w / 2 + w * i / n, -d / 2, -w / 2 + w * i / n, d / 2]);
    line(P, [-w / 2, -d / 2, w / 2, d / 2]);
  };
  S.tv = (P, w, d) => { P.ctx.fillStyle = P.C.inkSoft; box(P, -w / 2, -d / 2, w, d, 1); };
  S.piano = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2);
    thin(P); box(P, -w / 2 + 5, d / 2 - 20, w - 10, 14, 0, false);
    for (let x = -w / 2 + 10; x < w / 2 - 5; x += 6) line(P, [x, d / 2 - 20, x, d / 2 - 6]);
  };
  S.sofa = (P, w, d) => {
    const arm = Math.min(20, w * 0.12), back = Math.min(22, d * 0.25);
    box(P, -w / 2, -d / 2, w, d, 8);
    thin(P);
    box(P, -w / 2 + arm, -d / 2, w - arm * 2, back, 4, false);
    const n = Math.max(1, Math.round((w - arm * 2) / 65));
    const sw = (w - arm * 2) / n;
    for (let i = 0; i < n; i++) box(P, -w / 2 + arm + i * sw + 1.5, -d / 2 + back + 2, sw - 3, d - back - 6, 5, false);
  };
  S.sofaL = (P, w, d) => {
    const c = P.ctx, D = Math.min(95, d * 0.6), arm = 18, back = 22;
    c.beginPath();
    c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2); c.lineTo(w / 2 - D, d / 2);
    c.lineTo(w / 2 - D, -d / 2 + D); c.lineTo(-w / 2, -d / 2 + D); c.closePath(); c.fill(); c.stroke();
    thin(P);
    box(P, -w / 2 + arm, -d / 2, w - arm - back, back, 4, false);
    box(P, w / 2 - back, -d / 2, back, d - arm, 4, false);
    const n = Math.max(1, Math.round((w - D - arm) / 65)), sw = (w - D - arm) / n;
    for (let i = 0; i < n; i++) box(P, -w / 2 + arm + i * sw + 1.5, -d / 2 + back + 2, sw - 3, D - back - 4, 5, false);
    box(P, w / 2 - D + 2, -d / 2 + back + 2, D - back - 4, D - back - 4, 5, false);
    box(P, w / 2 - D + 2, -d / 2 + D + 1, D - back - 4, d - D - arm - 3, 5, false);
    line(P, [w / 2 - D, d / 2 - arm, w / 2 - back, d / 2 - arm]);
  };
  S.armchair = (P, w, d) => {
    const arm = Math.min(16, w * 0.2), back = Math.min(20, d * 0.25);
    box(P, -w / 2, -d / 2, w, d, 8);
    thin(P);
    box(P, -w / 2 + arm, -d / 2 + back, w - arm * 2, d - back - 3, 5, false);
    line(P, [-w / 2 + arm, -d / 2 + back, -w / 2 + arm, d / 2 - 2]);
    line(P, [w / 2 - arm, -d / 2 + back, w / 2 - arm, d / 2 - 2]);
  };
  S.officechair = (P, w, d) => {
    circle(P, 0, 0, Math.min(w, d) / 2 - 4);
    thin(P); box(P, -w * 0.3, -d / 2, w * 0.6, 10, 4);
  };
  S.chair = (P, w, d) => {
    box(P, -w / 2, -d / 2 + 6, w, d - 6, 5);
    lw(P, 1.6); line(P, [-w / 2 + 3, -d / 2 + 3, w / 2 - 3, -d / 2 + 3]);
  };
  S.bench = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 4); thin(P); line(P, [-w / 2 + 5, 0, w / 2 - 5, 0]); };
  S.diningtable = (P, w, d) => {
    const seats = P.def.seats || 4, cw = 44, cd = 42;
    thin(P);
    const perSide = Math.max(1, Math.round((seats - (w > 140 ? 2 : 0)) / 2));
    for (let i = 0; i < perSide; i++) {
      const x = -w / 2 + w * (i + 0.5) / perSide;
      box(P, x - cw / 2, -d / 2 - cd + 12, cw, cd, 5);
      box(P, x - cw / 2, d / 2 - 12, cw, cd, 5);
    }
    if (w > 140) { box(P, -w / 2 - cd + 12, -cw / 2, cd, cw, 5); box(P, w / 2 - 12, -cw / 2, cd, cw, 5); }
    lw(P, 1.4);
    box(P, -w / 2, -d / 2, w, d, 3);
  };
  S.roundtable = (P, w) => {
    thin(P);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, r = w / 2 + 8;
      P.ctx.save(); P.ctx.translate(Math.cos(a) * r, Math.sin(a) * r); P.ctx.rotate(a + Math.PI / 2);
      box(P, -22, -21, 44, 42, 5); P.ctx.restore();
    }
    lw(P, 1.4); circle(P, 0, 0, w / 2);
  };
  S.desk = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 2); thin(P); box(P, w / 2 - 45, -d / 2 + 2, 42, d - 4, 1, false); };
  S.deskL = (P, w, d) => {
    const c = P.ctx, D = Math.min(65, d * 0.6);
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2);
    c.lineTo(w / 2 - D, d / 2); c.lineTo(w / 2 - D, -d / 2 + D); c.lineTo(-w / 2, -d / 2 + D); c.closePath(); c.fill(); c.stroke();
  };
  S.wardrobe = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 1);
    thin(P);
    line(P, [-w / 2, d / 2 - 5, w / 2, d / 2 - 5]);
    P.ctx.setLineDash([5 * P.px, 3 * P.px]);
    line(P, [-w / 2 + 5, -d / 2 + d * 0.45, w / 2 - 5, -d / 2 + d * 0.45]);
    P.ctx.setLineDash([]);
    for (let x = -w / 2 + 12; x < w / 2 - 8; x += 14) line(P, [x - 5, -d / 2 + d * 0.45 - 8, x + 5, -d / 2 + d * 0.45 + 8]);
  };
  S.bed = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 3);
    thin(P);
    box(P, -w / 2, -d / 2, w, 8, 2);           // изголовье
    const two = w >= 120;
    const pw = two ? (w - 30) / 2 : w - 24;
    if (two) { box(P, -w / 2 + 10, -d / 2 + 14, pw, 32, 8, false); box(P, 5, -d / 2 + 14, pw, 32, 8, false); }
    else box(P, -pw / 2, -d / 2 + 14, pw, 32, 8, false);
    const fy = -d / 2 + 58;
    line(P, [-w / 2 + 3, fy, w / 2 - 3, fy]);
    line(P, [-w / 2 + 3, fy + 12, w / 2 - 3, fy + 12]);
    line(P, [w / 2 - 3, fy + 12, w / 2 - 35, d / 2 - 3]);
  };
  S.crib = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2);
    thin(P);
    for (let y = -d / 2 + 8; y < d / 2 - 4; y += 9) { line(P, [-w / 2, y, -w / 2 + 4, y]); line(P, [w / 2 - 4, y, w / 2, y]); }
    box(P, -w / 2 + 8, -d / 2 + 8, w - 16, 20, 6, false);
  };
  S.counter = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0);
    thin(P); line(P, [-w / 2, d / 2 - 4, w / 2, d / 2 - 4]);
    const n = Math.max(1, Math.round(w / 60));
    for (let i = 1; i < n; i++) line(P, [-w / 2 + w * i / n, d / 2 - 4, -w / 2 + w * i / n, d / 2]);
  };
  S.upper = (P, w, d) => {
    P.ctx.setLineDash([6 * P.px, 4 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 0, false);
    line(P, [-w / 2, -d / 2, w / 2, d / 2]); line(P, [w / 2, -d / 2, -w / 2, d / 2]);
    P.ctx.setLineDash([]);
  };
  const sinkBowl = (P, x, y, w, d) => { thin(P); box(P, x - w / 2, y - d / 2, w, d, 6, false); circle(P, x, y, 2.5, false); };
  const burners = (P, x, y, w, d) => {
    thin(P);
    const rx = w / 4, ry = d / 4;
    circle(P, x - rx, y - ry, Math.min(w, d) * 0.15, false); circle(P, x + rx, y - ry, Math.min(w, d) * 0.12, false);
    circle(P, x - rx, y + ry, Math.min(w, d) * 0.12, false); circle(P, x + rx, y + ry, Math.min(w, d) * 0.15, false);
  };
  S.ksink = (P, w, d) => { S.counter(P, w, d); sinkBowl(P, 0, -2, w - 16, d - 20); };
  S.kitchenI = (P, w, d) => {
    S.counter(P, w, d);
    if (w >= 120) {
      sinkBowl(P, -w / 2 + 40, -2, 44, d - 20);
      P.ctx.fillStyle = P.C.itemFill;
      burners(P, w / 2 - 45, 0, 54, d - 12);
    }
  };
  S.kitchenL = (P, w, d) => {
    const c = P.ctx, D = 60;
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2);
    c.lineTo(w / 2 - D, d / 2); c.lineTo(w / 2 - D, -d / 2 + D); c.lineTo(-w / 2, -d / 2 + D); c.closePath(); c.fill(); c.stroke();
    thin(P);
    line(P, [-w / 2, -d / 2 + D - 4, w / 2 - D + 4, -d / 2 + D - 4, w / 2 - D + 4, d / 2]);
    for (let x = -w / 2 + 60; x < w / 2 - D - 10; x += 60) line(P, [x, -d / 2 + D - 4, x, -d / 2 + D]);
    for (let y = -d / 2 + D + 60; y < d / 2 - 10; y += 60) line(P, [w / 2 - D + 4, y, w / 2 - D, y]);
    if (w >= 180) sinkBowl(P, -w / 2 + 40, -d / 2 + D / 2 - 2, 44, D - 20);
    if (d >= 150) burners(P, w / 2 - D / 2 - 2, d / 2 - 40, D - 12, 54);
  };
  /** Гарнитуры из «лент» модулей (П-образная, параллельная, с островом и т. д.) */
  const kitchenRuns = (P, w, d) => {
    const K = kitchenLayout(P.def.shape, w, d);
    const run = (r, tall) => {
      const rw = r.x1 - r.x0, rd = r.y1 - r.y0;
      P.ctx.fillStyle = P.C.itemFill; lw(P, 1.4); box(P, r.x0, r.y0, rw, rd, 0);
      thin(P);
      if (tall) { line(P, [r.x0, r.y0, r.x1, r.y1]); line(P, [r.x1, r.y0, r.x0, r.y1]); return; }
      const f = r.front, vert = f === 'left' || f === 'right';
      const L = vert ? rd : rw, n = Math.max(1, Math.round(L / 60));
      if (f === 'down') line(P, [r.x0, r.y1 - 4, r.x1, r.y1 - 4]);
      if (f === 'up') line(P, [r.x0, r.y0 + 4, r.x1, r.y0 + 4]);
      if (f === 'left') line(P, [r.x0 + 4, r.y0, r.x0 + 4, r.y1]);
      if (f === 'right') line(P, [r.x1 - 4, r.y0, r.x1 - 4, r.y1]);
      for (let i = 1; i < n; i++) {
        if (vert) { const y = r.y0 + rd * i / n, x = f === 'left' ? r.x0 : r.x1 - 4; line(P, [x, y, x + 4, y]); }
        else { const x = r.x0 + rw * i / n, y = f === 'down' ? r.y1 - 4 : r.y0; line(P, [x, y, x, y + 4]); }
      }
      if (r.h > 100) { P.ctx.setLineDash([4 * P.px, 3 * P.px]); box(P, r.x0 + 6, r.y0 + 6, rw - 12, rd - 12, 0, false); P.ctx.setLineDash([]); }
    };
    for (const r of K.runs) run(r);
    for (const r of K.tall || []) { run(r, true); text(P, 'пеналы', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 11); }
    if (K.sink) sinkBowl(P, K.sink.x, K.sink.y, K.sink.v ? 40 : 44, K.sink.v ? 44 : 40);
    if (K.hob) { P.ctx.fillStyle = P.C.itemFill; burners(P, K.hob.x, K.hob.y, K.hob.v ? 46 : 54, K.hob.v ? 54 : 46); }
  };
  for (const k of ['kitchenU', 'kitchenII', 'kitchenIsland', 'kitchenBar', 'kitchenPen', 'kitchenTall']) S[k] = kitchenRuns;
  S.tall = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 0); thin(P); line(P, [-w / 2, -d / 2, w / 2, d / 2]); line(P, [w / 2, -d / 2, -w / 2, d / 2]); text(P, P.it.label || P.def.label || 'П', 0, 0, Math.min(w, d) * 0.35, { bold: true }); };
  S.bar = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 3); thin(P); P.ctx.setLineDash([4 * P.px, 3 * P.px]); line(P, [-w / 2 + 5, 0, w / 2 - 5, 0]); P.ctx.setLineDash([]); };
  S.hood = (P, w, d) => {
    P.ctx.setLineDash([6 * P.px, 4 * P.px]); box(P, -w / 2, -d / 2, w, d, 0, false); P.ctx.setLineDash([]);
    thin(P); box(P, -w / 4, -d / 2, w / 2, d * 0.45, 0, false); text(P, 'В', 0, d * 0.15, Math.min(w, d) * 0.3, { bold: true });
  };
  S.fridge = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2); thin(P);
    line(P, [-w / 2, d / 2 - 6, w / 2, d / 2 - 6]);
    text(P, 'ХОЛ', 0, -4, Math.min(w / 4, 16), { bold: true });
  };
  S.fridge2 = (P, w, d) => { S.fridge(P, w, d); line(P, [0, d / 2 - 6, 0, d / 2]); };
  S.stove = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 2); burners(P, 0, 0, w - 8, d - 8); };
  S.oven = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 2); thin(P); box(P, -w / 2 + 6, -d / 2 + 6, w - 12, d - 14, 3, false); };
  S.washer = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 3); thin(P);
    line(P, [-w / 2, -d / 2 + 10, w / 2, -d / 2 + 10]);
    circle(P, 0, 5, Math.min(w, d - 10) * 0.33, false);
    circle(P, 0, 5, Math.min(w, d - 10) * 0.22, false);
  };
  S.fan = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2); thin(P);
    const r = Math.min(w, d) * 0.38;
    circle(P, 0, 0, r, false);
    for (let i = 0; i < 3; i++) { const a = i * 2.094; line(P, [0, 0, Math.cos(a) * r, Math.sin(a) * r]); }
  };
  S.bath = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 6); thin(P);
    box(P, -w / 2 + 7, -d / 2 + 7, w - 14, d - 14, Math.min(d, w) / 2 - 8, false);
    circle(P, -w / 2 + 20, 0, 3, false);
  };
  S.bathCorner = (P, w, d) => {
    const c = P.ctx;
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, -d / 2 + 50);
    c.quadraticCurveTo(w / 2 - 10, d / 2 - 10, -w / 2 + 50, d / 2); c.lineTo(-w / 2, d / 2); c.closePath(); c.fill(); c.stroke();
    thin(P);
    c.beginPath(); c.moveTo(-w / 2 + 10, -d / 2 + 10); c.lineTo(w / 2 - 10, -d / 2 + 10); c.lineTo(w / 2 - 10, -d / 2 + 45);
    c.quadraticCurveTo(w / 2 - 25, d / 2 - 25, -w / 2 + 45, d / 2 - 10); c.lineTo(-w / 2 + 10, d / 2 - 10); c.closePath(); c.stroke();
    circle(P, -w / 2 + 25, -d / 2 + 25, 3, false);
  };
  S.shower = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2); thin(P);
    line(P, [-w / 2, -d / 2, w / 2, d / 2]); line(P, [w / 2, -d / 2, -w / 2, d / 2]);
    P.ctx.fillStyle = P.C.itemFill; circle(P, 0, 0, 4);
  };
  S.toilet = (P, w, d) => {
    const tank = Math.min(18, d * 0.3);
    box(P, -w / 2, -d / 2, w, tank, 3);
    ell(P, 0, -d / 2 + tank + (d - tank) / 2, w / 2 - 2, (d - tank) / 2);
    thin(P); ell(P, 0, -d / 2 + tank + (d - tank) / 2 + 2, w / 2 - 8, (d - tank) / 2 - 7, false);
  };
  S.bidet = (P, w, d) => { ell(P, 0, 0, w / 2, d / 2); thin(P); ell(P, 0, 3, w / 2 - 7, d / 2 - 10, false); circle(P, 0, -d / 2 + 8, 2, false); };
  S.urinal = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, d / 2); thin(P); ell(P, 0, 2, w / 2 - 6, d / 2 - 8, false); };
  S.sink = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 6); thin(P);
    ell(P, 0, 3, w / 2 - 7, d / 2 - 9, false); circle(P, 0, -d / 2 + 6, 2, false);
  };
  S.vanity = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 2); thin(P); ell(P, 0, 2, Math.min(w, 60) / 2 - 7, d / 2 - 9, false); circle(P, 0, -d / 2 + 6, 2, false); };
  S.boiler = (P, w, d) => {
    ell(P, 0, 0, w / 2, d / 2); thin(P);
    ell(P, 0, 0, w / 2 - 5, d / 2 - 5, false);
    text(P, P.def.key === 'filter' ? 'Ф' : 'Б', 0, 0, Math.min(w, d) * 0.4, { bold: true });
  };
  S.radiator = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 1); thin(P);
    for (let x = -w / 2 + 8; x < w / 2; x += 8) line(P, [x, -d / 2, x, d / 2]);
  };
  S.pump = (P, w, d) => {
    circle(P, 0, 0, Math.min(w, d) / 2); thin(P);
    const r = Math.min(w, d) / 2;
    line(P, [-r * 0.5, -r * 0.6, r * 0.7, 0, -r * 0.5, r * 0.6], true);
  };
  S.stoveHeat = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0);
    thin(P); hatch(P, -w / 2, -d / 2, w, d, 10);
    P.ctx.fillStyle = P.C.itemFill;
    lw(P, 1.2); box(P, -Math.min(w, 60) / 4, d / 2 - 6, Math.min(w, 60) / 2, 6, 0);
    lw(P, 1.2); box(P, w / 2 - 30, -d / 2 + 6, 22, 22, 0);
  };
  S.fireplace = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 1);
    thin(P);
    const c = P.ctx, fw = Math.min(w * 0.5, 80);
    c.beginPath(); c.moveTo(-fw / 2, d / 2); c.lineTo(-fw / 2 + 10, -d / 2 + 10); c.lineTo(fw / 2 - 10, -d / 2 + 10); c.lineTo(fw / 2, d / 2); c.stroke();
    hatch(P, -w / 2, -d / 2, (w - fw) / 2, d, 8);
    hatch(P, fw / 2, -d / 2, (w - fw) / 2, d, 8);
  };
  S.fireplaceCorner = (P, w, d) => {
    const c = P.ctx;
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, -d / 2 + 30); c.lineTo(-w / 2 + 30, d / 2); c.lineTo(-w / 2, d / 2); c.closePath(); c.fill(); c.stroke();
    thin(P);
    c.beginPath(); c.moveTo(-w / 2 + 15, -d / 2 + 15); c.lineTo(w / 2 - 35, -d / 2 + 15); c.lineTo(-w / 2 + 15, d / 2 - 35); c.closePath(); c.stroke();
  };
  S.stoveMetal = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 4); thin(P);
    box(P, -w / 2 + 8, d / 2 - 8, w - 16, 5, 1, false);
    circle(P, 0, -d / 2 + Math.min(w, d) * 0.3, Math.min(w, d) * 0.18, false);
  };
  S.chimney = (P, w, d) => { P.ctx.fillStyle = P.C.inkSoft; box(P, -w / 2, -d / 2, w, d, 0); thin(P); P.ctx.fillStyle = P.C.itemFill; box(P, -w / 2 + 5, -d / 2 + 5, w - 10, d - 10, 0); };
  S.column = (P, w, d) => { P.ctx.fillStyle = P.C.wallExt; box(P, -w / 2, -d / 2, w, d, 0); };
  S.columnRound = (P, w, d) => { P.ctx.fillStyle = P.C.wallExt; ell(P, 0, 0, w / 2, d / 2); };
  S.stairs = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0); thin(P);
    const n = Math.max(2, Math.round(d / 28));
    for (let i = 1; i < n; i++) line(P, [-w / 2, -d / 2 + d * i / n, w / 2, -d / 2 + d * i / n]);
    lw(P, 1.2);
    line(P, [0, d / 2 - 10, 0, -d / 2 + 14]);
    line(P, [-8, -d / 2 + 26, 0, -d / 2 + 12, 8, -d / 2 + 26]);
  };
  S.stairsL = (P, w, d) => {
    const c = P.ctx, W = Math.min(w / 2, 100);
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, -d / 2 + W); c.lineTo(-w / 2 + W, -d / 2 + W); c.lineTo(-w / 2 + W, d / 2); c.lineTo(-w / 2, d / 2); c.closePath(); c.fill(); c.stroke();
    thin(P);
    line(P, [-w / 2 + W, -d / 2, -w / 2 + W, -d / 2 + W]); line(P, [-w / 2, -d / 2 + W, -w / 2 + W, -d / 2 + W]);
    for (let y = -d / 2 + W + 28; y < d / 2; y += 28) line(P, [-w / 2, y, -w / 2 + W, y]);
    for (let x = -w / 2 + W + 28; x < w / 2; x += 28) line(P, [x, -d / 2, x, -d / 2 + W]);
    lw(P, 1.2);
    line(P, [-w / 2 + W / 2, d / 2 - 10, -w / 2 + W / 2, -d / 2 + W / 2, w / 2 - 14, -d / 2 + W / 2]);
    line(P, [w / 2 - 26, -d / 2 + W / 2 - 8, w / 2 - 12, -d / 2 + W / 2, w / 2 - 26, -d / 2 + W / 2 + 8]);
  };

  /* --- электрика: условные графические обозначения --- */
  S.socket = (P, w, d, dbl) => {
    const s = Math.max(w, 14) * 0.5;
    const c = P.ctx;
    c.beginPath(); c.arc(0, 0, s, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
    line(P, [0, 0, 0, s * 0.9]);
    if (dbl) line(P, [-s * 0.4, 0, -s * 0.4, s * 0.8]);
    line(P, [-s * 1.1, -s * 0.001, s * 1.1, -s * 0.001]);
  };
  S.socket2 = (P, w, d) => S.socket(P, w, d, true);
  S.socketP = (P, w, d) => { S.socket(P, w, d); const s = Math.max(w, 14) * 0.5; P.ctx.fillStyle = P.C.ink; P.ctx.beginPath(); P.ctx.arc(0, 0, s * 0.5, Math.PI, 0); P.ctx.fill(); };
  S.switch = (P, w, d, two) => {
    const r = Math.max(w, 10) * 0.45;
    circle(P, 0, 0, r);
    line(P, [r * 0.7, -r * 0.7, r * 2, -r * 2]);
    if (two) line(P, [r * 0.95, -r * 0.2, r * 2.3, -r * 1.5]);
  };
  S.switch2 = (P, w, d) => S.switch(P, w, d, true);
  S.lamp = (P, w) => {
    const r = w / 2;
    circle(P, 0, 0, r);
    line(P, [-r * 0.7, -r * 0.7, r * 0.7, r * 0.7]); line(P, [r * 0.7, -r * 0.7, -r * 0.7, r * 0.7]);
  };
  S.spot = (P, w) => { circle(P, 0, 0, w / 2); P.ctx.fillStyle = P.C.ink; circle(P, 0, 0, w / 5); };
  S.wallLamp = (P, w, d) => {
    const c = P.ctx;
    c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.arc(0, -d / 2, w / 2, 0, Math.PI); c.fill(); c.stroke();
    line(P, [-w * 0.3, -d / 2 + w * 0.15, w * 0.3, -d / 2 + w * 0.4]);
  };
  S.jbox = (P, w) => { circle(P, 0, 0, w / 2); P.ctx.fillStyle = P.C.ink; circle(P, 0, 0, w / 6); };
  S.panel = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0);
    const c = P.ctx; c.fillStyle = P.C.ink;
    c.beginPath(); c.moveTo(-w / 2, d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2); c.closePath(); c.fill();
  };
  S.pole = (P, w) => {
    circle(P, 0, 0, w / 2);
    P.ctx.fillStyle = P.C.ink; circle(P, 0, 0, w / 4);
    line(P, [-w * 0.9, 0, w * 0.9, 0]);
    text(P, 'ЛЭП', 0, w * 1.05, w * 0.6, { bold: true });
  };
  /** Значок трассы в библиотеке: ломаная цветом и штрихом вида сети + обозначение */
  S.netIcon = (P, w, d) => {
    const k = LINE_KINDS[P.it.lineKind] || LINE_KINDS.water, c = P.ctx;
    c.save(); c.strokeStyle = k.color; lw(P, 3.2); c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash(k.dash.map(v => v * P.px * 0.8));
    line(P, [-w * 0.42, d * 0.3, -w * 0.1, d * 0.3, -w * 0.1, -d * 0.1, w * 0.42, -d * 0.1]);
    c.setLineDash([]);
    if (P.it.lineKind === 'overhead') { c.fillStyle = P.C.itemFill; c.strokeStyle = k.color; lw(P, 1.6); for (const [x, y] of [[-w * 0.42, d * 0.3], [-w * 0.1, -d * 0.1], [w * 0.42, -d * 0.1]]) circle(P, x, y, w * 0.07); }
    c.restore();
    text(P, k.code, w * 0.12, d * 0.3, d * 0.3, { bold: true, color: k.color });
  };
  S.lightpole = (P, w) => {
    circle(P, 0, 0, w / 2);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(P, [Math.cos(a) * w * 0.6, Math.sin(a) * w * 0.6, Math.cos(a) * w * 0.95, Math.sin(a) * w * 0.95]); }
  };
  S.ground = (P, w, d) => {
    P.ctx.setLineDash([3 * P.px, 3 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 0, false);
    P.ctx.setLineDash([]);
    for (const [x, y] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) { P.ctx.fillStyle = LINE_KINDS.ground.color; circle(P, x, y, 5); }
    text(P, '⏚', 0, 0, Math.min(w, d) * 0.3);
  };
  S.riser = (P, w) => { circle(P, 0, 0, w / 2); P.ctx.fillStyle = LINE_KINDS.sewer.color; circle(P, 0, 0, w / 3); };
  S.tap = (P, w) => { circle(P, 0, 0, w / 2); line(P, [0, 0, w, 0, w, w * 0.6]); };
  S.valve = (P, w) => { const r = w / 2; line(P, [-r, -r, r, r, r, -r, -r, r], true); };

  /* --- водоснабжение/канализация на участке --- */
  S.septic = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, Math.min(w, d) * 0.25);
    thin(P);
    const n = P.def.chambers || 2;
    for (let i = 1; i < n; i++) line(P, [-w / 2 + w * i / n, -d / 2 + 4, -w / 2 + w * i / n, d / 2 - 4]);
    for (let i = 0; i < n; i++) circle(P, -w / 2 + w * (i + 0.5) / n, 0, Math.min(w / n, d) * 0.22, false);
    text(P, 'СЕПТИК', 0, d / 2 + 12, 14, { bold: true });
  };
  S.ring = (P, w, d) => {
    ell(P, 0, 0, w / 2, d / 2); thin(P); ell(P, 0, 0, w / 2 - 8, d / 2 - 8, false);
    text(P, P.it.label ?? P.def.label ?? '', 0, 0, Math.min(w, d) * 0.28, { bold: true });
  };
  S.well = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 2);
    ell(P, 0, 0, w / 2 - 6, d / 2 - 6); thin(P); ell(P, 0, 0, w / 2 - 16, d / 2 - 16, false);
    text(P, 'КЛ', 0, 0, Math.min(w, d) * 0.25, { bold: true });
  };
  S.borehole = (P, w, d) => {
    ell(P, 0, 0, w / 2, d / 2); thin(P);
    P.ctx.fillStyle = LINE_KINDS.water.color; circle(P, 0, 0, 8);
    text(P, 'СКВ', 0, d / 4 + 6, Math.min(w, d) * 0.18, { bold: true });
  };
  S.filterfield = (P, w, d) => {
    P.ctx.setLineDash([8 * P.px, 5 * P.px]); box(P, -w / 2, -d / 2, w, d, 0, false); P.ctx.setLineDash([]);
    thin(P);
    for (let x = -w / 2 + w / 4; x < w / 2; x += w / 4) line(P, [x, -d / 2 + 15, x, d / 2 - 15]);
    text(P, 'Поле фильтрации', 0, 0, 18, { bold: true });
  };
  S.capsule = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, d / 2); thin(P); circle(P, 0, 0, d * 0.2, false);
    text(P, 'ГАЗГОЛЬДЕР', 0, d / 2 + 14, 16, { bold: true });
  };

  /* --- постройки и благоустройство --- */
  const bldLabel = (P, w, d) => {
    const name = P.it.label || P.def.name;
    // «вниз по экрану» в локальных координатах — чтобы строки не менялись местами при повороте
    const a = -P.rotRad;
    let v = { x: -Math.sin(a), y: Math.cos(a) };
    if (P.flip) v = { x: -v.x, y: v.y };
    const across = Math.abs(v.x) > Math.abs(v.y) ? w : d, along = Math.abs(v.x) > Math.abs(v.y) ? d : w;
    const sz = Math.min(along / Math.max(6, name.length) * 1.4, across * 0.18, 60);
    text(P, name, -v.x * sz * 0.35, -v.y * sz * 0.35, sz, { bold: true });
    text(P, (w / 100).toFixed(1).replace(/\.0$/, '') + '×' + (d / 100).toFixed(1).replace(/\.0$/, '') + ' м', v.x * sz * 0.8, v.y * sz * 0.8, sz * 0.75, { color: P.C.muted });
  };
  /** Линии крыши постройки на плане: конёк, рёбра вальм, стрелки ската, рёбра арки; контур свеса */
  const roofPlan = (P, w, d) => {
    const r = bldRoofRect(P.it, w, d), R = bldRoof(P.it), c = P.ctx;
    c.save(); c.strokeStyle = P.C.inkSoft; lw(P, 1); c.setLineDash([9 * P.px, 5 * P.px]);
    if (R.over > 5) { const q = G.rectPts(r.x, r.y, r.w, r.d, r.rot); line(P, [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y], true); }
    c.setLineDash([]);
    const L = (a, b) => line(P, [a.x, a.y, b.x, b.y]);
    if (r.type === 'arch') {
      const W = r.w / 2, D = r.d / 2, T = (u, v) => G.toWorld({ x: u, y: v }, r.x, r.y, r.rot);
      L(T(-W, 0), T(W, 0));
      for (let u = -W + 100; u < W - 20; u += 100) L(T(u, -D), T(u, D));
    } else for (const [a, b] of Roof.planLines(r)) L(a, b);
    for (const [a, b] of Roof.slopeArrows(r)) {
      L(a, b);
      const u = G.unit(G.sub(b, a)), n = G.perp(u), k = Math.min(18, G.dist(a, b) * 0.3);
      line(P, [b.x - u.x * k + n.x * k * 0.5, b.y - u.y * k + n.y * k * 0.5, b.x, b.y, b.x - u.x * k - n.x * k * 0.5, b.y - u.y * k - n.y * k * 0.5]);
    }
    c.restore();
  };
  /** Постройка «как дом»: пол, стены с толщиной, ворота, двери и окна; крыша — отдельно, в слое «Крыша» (S._roof) */
  const shell = (P, w, d) => {
    const s = bldShell(P.it, w, d), c = P.ctx;
    c.save();
    c.fillStyle = P.it.color || P.C.itemFill; thin(P); box(P, -w / 2, -d / 2, w, d, 0);   // пол
    c.fillStyle = P.C.wallExt; c.strokeStyle = P.C.wallStroke; lw(P, 0.8);
    for (const r of s.walls) box(P, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0);
    c.strokeStyle = P.C.ink;
    for (const o of s.ops) {
      const F = o.F, at = (sv, k) => G.add(G.add(F.c, G.mul(F.u, sv)), G.mul(F.n, k));   // k — смещение внутрь от оси стены
      const L = (a, b) => line(P, [a.x, a.y, b.x, b.y]);
      if (o.cat === 'window') {
        c.fillStyle = P.C.opening; thin(P); box(P, o.rect.x0, o.rect.y0, o.rect.x1 - o.rect.x0, o.rect.y1 - o.rect.y0, 0);
        L(at(o.s0, 0), at(o.s1, 0)); L(at(o.s0, -s.t / 4), at(o.s1, -s.t / 4));
      } else if (o.type === 'gate') {
        lw(P, 1.2); L(at(o.s0, -2), at(o.s1, -2)); L(at(o.s0, 2), at(o.s1, 2));
        c.setLineDash([10 * P.px, 5 * P.px]); thin(P); L(at(o.s0, s.t / 2 + 50), at(o.s1, s.t / 2 + 50)); c.setLineDash([]);
      } else if (o.type === 'arch') {
        thin(P); L(at(o.s0, -s.t / 2), at(o.s0, s.t / 2)); L(at(o.s1, -s.t / 2), at(o.s1, s.t / 2));
      } else {
        // дверь: полотно и дуга открывания внутрь, петли — у начала (hinge 0) или конца проёма
        const h0 = o.hinge ? o.s1 : o.s0, h1 = o.hinge ? o.s0 : o.s1, r = o.s1 - o.s0;
        const pv = at(h0, s.t / 2), leaf = G.add(pv, G.mul(F.n, r)), jamb = at(h1, s.t / 2);
        thin(P); L(pv, leaf);
        const a0 = Math.atan2(leaf.y - pv.y, leaf.x - pv.x), a1 = Math.atan2(jamb.y - pv.y, jamb.x - pv.x);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        c.beginPath(); c.arc(pv.x, pv.y, r, a0, a1, da < 0); c.stroke();
      }
    }
    c.restore();
  };
  S.building = (P, w, d) => shell(P, w, d);
  S.garage = S.building;
  S._roof = (P, w, d) => roofPlan(P, w, d);
  S._label = (P, w, d) => bldLabel(P, w, d);     // подпись — поверх того, что внутри
  S.canopy = (P, w, d) => {
    lw(P, 1.2); P.ctx.setLineDash([12 * P.px, 6 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 0);
    P.ctx.setLineDash([]);
    roofPlan(P, w, d);
    P.ctx.fillStyle = P.C.ink;
    const k = Math.max(1, Math.ceil(d / 300));
    for (let i = 0; i <= k; i++) { const y = -d / 2 + 9 + (d - 18) * i / k; box(P, -w / 2 + 2, y - 7, 14, 14, 0); box(P, w / 2 - 16, y - 7, 14, 14, 0); }
    P.ctx.fillStyle = P.C.itemFill;
    bldLabel(P, w, d);
  };
  S.canopyLean = (P, w, d) => {
    // односкатный: сторона «спинки» (−d/2) примыкает к стене дома, столбы только спереди
    lw(P, 1.2); P.ctx.setLineDash([12 * P.px, 6 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 0);
    P.ctx.setLineDash([]);
    lw(P, 2.2); line(P, [-w / 2, -d / 2, w / 2, -d / 2]);
    roofPlan(P, w, d);
    P.ctx.fillStyle = P.C.ink;
    const k = Math.max(1, Math.round(w / 300));
    for (let i = 0; i <= k; i++) { const x = -w / 2 + 8 + (w - 16) * i / k; box(P, x - 7, d / 2 - 16, 14, 14, 0); }
    P.ctx.fillStyle = P.C.itemFill;
    bldLabel(P, w, d);
  };
  S.gazebo = (P, w, d) => {
    const c = P.ctx, n = 8;
    lw(P, 2);
    c.beginPath();
    for (let i = 0; i < n; i++) { const a = (i + 0.5) * Math.PI * 2 / n; c.lineTo(Math.cos(a) * w / 2 / Math.cos(Math.PI / n), Math.sin(a) * d / 2 / Math.cos(Math.PI / n)); }
    c.closePath(); c.fill(); c.stroke();
    thin(P);
    for (let i = 0; i < n; i++) { const a = (i + 0.5) * Math.PI * 2 / n; line(P, [0, 0, Math.cos(a) * w / 2 / Math.cos(Math.PI / n), Math.sin(a) * d / 2 / Math.cos(Math.PI / n)]); }
    bldLabel(P, w, d);
  };
  S.greenhouse = (P, w, d) => {
    lw(P, 1.6); P.ctx.fillStyle = P.C.glass;
    box(P, -w / 2, -d / 2, w, d, 0);
    roofPlan(P, w, d);
    bldLabel(P, w, d);
  };

  S.pool = (P, w, d) => {
    P.ctx.fillStyle = P.C.water; box(P, -w / 2, -d / 2, w, d, 30);
    thin(P); box(P, -w / 2 + 15, -d / 2 + 15, w - 30, d - 30, 20, false);
    line(P, [w / 2 - 60, -d / 2 + 15, w / 2 - 60, -d / 2 + 60]); line(P, [w / 2 - 30, -d / 2 + 15, w / 2 - 30, -d / 2 + 60]);
    text(P, 'Бассейн', 0, 0, Math.min(40, w / 6), { bold: true });
  };
  S.deck = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, 0); P.ctx.save(); P.ctx.strokeStyle = P.C.hatch; thin(P);
    for (let x = -w / 2 + 14; x < w / 2; x += 14) line(P, [x, -d / 2, x, d / 2]);
    P.ctx.restore(); text(P, P.it.label || 'Терраса', 0, 0, Math.min(40, w / 8), { bold: true });
  };
  /** Крыльцо / веранда / терраса: настил, ограждение или остекление, крыша, ступени */
  S.veranda = (P, w, d) => {
    const c = P.ctx, g = porchGeom(P.it, w, d), o = g.o;
    // крыша: контур со свесом (у пристроенной — без свеса со стороны дома), конёк, скаты
    // ступени — наружу от выбранных сторон
    const quad = (p0, p1, p2, p3) => { c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.lineTo(p3.x, p3.y); c.closePath(); c.fill(); c.stroke(); };
    if (g.steps) for (const f of g.flights) {
      c.fillStyle = P.C.itemFill; thin(P);
      for (let i = 0; i < g.steps - 1; i++) {
        const o0 = G.mul(f.out, i * g.tread), o1 = G.mul(f.out, (i + 1) * g.tread);
        quad(G.add(f.a, o0), G.add(f.b, o0), G.add(f.b, o1), G.add(f.a, o1));
      }
    }
    // площадка и доски настила
    c.fillStyle = P.C.itemFill; lw(P, 1.4); box(P, -w / 2, -d / 2, w, d, 0);
    c.save(); rr(c, -w / 2, -d / 2, w, d, 0); c.clip(); c.strokeStyle = P.C.hatch; thin(P);
    for (let x = -w / 2 + 14; x < w / 2; x += 14) line(P, [x, -d / 2, x, d / 2]);
    c.restore();
    if (o.attached) { lw(P, 2.4); line(P, [-w / 2, -d / 2, w / 2, -d / 2]); }
    // ограждающие элементы по сторонам
    const band = (s, t, fill) => {
      const a2 = G.add(s.a, G.mul(s.n, t)), b2 = G.add(s.b, G.mul(s.n, t));
      c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); c.lineTo(b2.x, b2.y); c.lineTo(a2.x, a2.y); c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      c.stroke();
    };
    const along = (s, step, fn) => { const L = G.dist(s.a, s.b), k = Math.max(1, Math.round(L / step)), u = G.unit(G.sub(s.b, s.a)); for (let i = 1; i < k; i++) fn(G.add(s.a, G.mul(u, L * i / k)), u); };
    thin(P);
    if (o.encl === 'rail') for (const s of g.segs) { band(s, 6, null); }
    if (o.encl === 'glazed') for (const s of g.segs) { lw(P, 1); band(s, 8, P.C.glass); thin(P); along(s, 90, (q) => line(P, [q.x, q.y, q.x + s.n.x * 8, q.y + s.n.y * 8])); }
    if (o.encl === 'closed') for (const s of g.segs) {
      lw(P, 1.2); band(s, 15, P.C.inkSoft);
      // окна в стене
      const L = G.dist(s.a, s.b), u = G.unit(G.sub(s.b, s.a)), k = Math.floor(L / 200);
      c.fillStyle = P.C.glass; thin(P);
      for (let i = 0; i < k; i++) {
        const m = (i + 0.5) * L / k, p0 = G.add(s.a, G.mul(u, m - 50)), p1 = G.add(s.a, G.mul(u, m + 50));
        band({ a: p0, b: p1, n: s.n }, 15, P.C.opening);
        line(P, [p0.x + s.n.x * 7.5, p0.y + s.n.y * 7.5, p1.x + s.n.x * 7.5, p1.y + s.n.y * 7.5]);
      }
    }
    // дверь в проходе к ступеням у закрытой веранды
    if (o.encl === 'glazed' || o.encl === 'closed') for (const f of g.doors) {
      const dw = Math.min(90, f.sw), inn = G.mul(f.out, -1);
      const a1 = Math.atan2(inn.y, inn.x), a2 = Math.atan2(f.u.y, f.u.x);
      thin(P); line(P, [f.a.x, f.a.y, f.a.x + inn.x * dw, f.a.y + inn.y * dw]);
      c.beginPath(); c.arc(f.a.x, f.a.y, dw, a1, a2, G.cross(inn, f.u) < 0); c.stroke();
    }
    // столбы под крышей у открытых
    if (o.roofed && (o.encl === 'open' || o.encl === 'rail')) {
      c.fillStyle = P.C.ink;
      for (const q of porchPosts(g, w, d)) box(P, q.x - 6, q.y - 6, 12, 12, 0);
      c.fillStyle = P.C.itemFill;
    }
    if (o.roofed) roofPlan(P, w, d);
    const nm = P.it.label || P.def.name.split(' ')[0];
    const sz = Math.min(28, w / 9, d / 4);
    // «вниз по экрану» в локальных координатах — чтобы вторая строка шла под первой при любом повороте
    const dn = { x: Math.sin(P.rotRad) * (P.flip ? -1 : 1), y: Math.cos(P.rotRad) };
    text(P, nm, -dn.x * sz * 0.35, -dn.y * sz * 0.35, sz, { bold: true });
    text(P, PORCH_ENCL[o.encl] ? PORCH_ENCL[o.encl].short + (o.roofed && o.encl !== 'closed' && o.encl !== 'glazed' ? ', под крышей' : '') : '', dn.x * sz * 0.75, dn.y * sz * 0.75, sz * 0.55, { color: P.C.muted });
  };
  /** Погреб / подпол / смотровая яма: стенки, углубление, лестница со стрелкой «вниз», люк или погребница */
  S.pit = (P, w, d) => {
    const c = P.ctx, g = pitGeom(P.it, w, d), t = g.t;
    const R = (r, fill) => box(P, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, fill);
    // стенки — с штриховкой, внутри — затемнение (ниже уровня пола/земли)
    c.fillStyle = P.C.itemFill; lw(P, 1.4); box(P, -w / 2, -d / 2, w, d, 0);
    c.save(); c.strokeStyle = P.C.hatch; thin(P); hatch(P, -w / 2, -d / 2, w, d, 10); c.restore();
    c.save(); c.fillStyle = 'rgba(40,50,70,.16)'; thin(P); box(P, -w / 2 + t, -d / 2 + t, w - 2 * t, d - 2 * t, 0); c.restore();
    const hidden = g.cover !== 'open';          // закрытое сверху — линии штрихом
    c.save(); if (hidden) c.setLineDash([6 * P.px, 4 * P.px]); thin(P);
    if (g.flight && g.stair === 'stairs') {
      c.fillStyle = P.C.itemFill; R(g.flight, true);
      for (let i = 1; i < g.n; i++) {
        const a = G.add(g.edge, G.mul(g.dir, i * g.tread)), hw = g.sw / 2;
        line(P, [a.x - g.across.x * hw, a.y - g.across.y * hw, a.x + g.across.x * hw, a.y + g.across.y * hw]);
      }
    }
    if (g.flight && g.stair === 'ladder') {
      const hw = g.sw / 2 - 4, a = g.edge, b = G.add(g.edge, G.mul(g.dir, g.L));
      for (const s2 of [-1, 1]) line(P, [a.x + g.across.x * hw * s2, a.y + g.across.y * hw * s2, b.x + g.across.x * hw * s2, b.y + g.across.y * hw * s2]);
      for (let k = 8; k < g.L; k += 12) { const q = G.add(g.edge, G.mul(g.dir, k)); line(P, [q.x - g.across.x * hw, q.y - g.across.y * hw, q.x + g.across.x * hw, q.y + g.across.y * hw]); }
    }
    c.restore();
    // стрелка «вниз» — от верха лестницы в глубь ямы
    if (g.flight) {
      const a = G.add(g.edge, G.mul(g.dir, 6)), b = G.add(g.edge, G.mul(g.dir, Math.max(g.L, 30) - 6)), n = { x: g.dir.y, y: -g.dir.x }, k = Math.min(12, g.sw * 0.2);
      lw(P, 1.1); line(P, [a.x, a.y, b.x, b.y]); line(P, [b.x - g.dir.x * k + n.x * k * 0.6, b.y - g.dir.y * k + n.y * k * 0.6, b.x, b.y, b.x - g.dir.x * k - n.x * k * 0.6, b.y - g.dir.y * k - n.y * k * 0.6]);
    }
    // люк или погребница
    if (g.cover === 'hatch') { c.fillStyle = 'rgba(160,120,70,.18)'; lw(P, 1.3); R(g.lid, true); thin(P); line(P, [g.lid.x0, g.lid.y0, g.lid.x1, g.lid.y1]); line(P, [g.lid.x1, g.lid.y0, g.lid.x0, g.lid.y1]); }
    if (g.cover === 'house') { c.fillStyle = P.C.itemFill; lw(P, 2); R(g.house, true); thin(P); const hc = { x: (g.house.x0 + g.house.x1) / 2, y: (g.house.y0 + g.house.y1) / 2 }; if (g.dir.y) line(P, [g.house.x0, hc.y, g.house.x1, hc.y]); else line(P, [hc.x, g.house.y0, hc.x, g.house.y1]); }
    // подпись: название и глубина — по центру, «вниз по экрану» при любом повороте
    const nm = P.it.label || P.def.name.split(' (')[0];
    // подпись — по ширине ямы «поперёк экрана»
    const acrossW = Math.abs(Math.cos(P.rotRad)) > 0.7 ? w : d;
    const sz = Math.min(20, acrossW * 1.6 / Math.max(6, nm.length), d / 5, w / 3);
    const dn = { x: Math.sin(P.rotRad) * (P.flip ? -1 : 1), y: Math.cos(P.rotRad) };
    text(P, nm, -dn.x * sz * 0.4, -dn.y * sz * 0.4, sz, { bold: true });
    text(P, 'гл. ' + (g.depth / 100).toFixed(2).replace(/0$/, '') + ' м', dn.x * sz * 0.75, dn.y * sz * 0.75, sz * 0.75, { color: P.C.muted });
  };
  S.bbq = (P, w, d) => { box(P, -w / 2, -d / 2, w, d, 2); thin(P); for (let x = -w / 2 + 10; x < w / 2; x += 8) line(P, [x, -d / 2 + 5, x, d / 2 - 5]); };
  S.parking = (P, w, d) => {
    P.ctx.setLineDash([10 * P.px, 6 * P.px]); box(P, -w / 2, -d / 2, w, d, 0, false); P.ctx.setLineDash([]);
    text(P, 'P', 0, 0, Math.min(w, d) * 0.4, { bold: true, color: P.C.accent });
  };
  S.car = (P, w, d) => {
    box(P, -w / 2, -d / 2, w, d, w * 0.25);
    thin(P);
    box(P, -w / 2 + 14, -d / 2 + d * 0.27, w - 28, d * 0.18, 10, false);   // лобовое
    box(P, -w / 2 + 16, d / 2 - d * 0.22, w - 32, d * 0.1, 8, false);      // заднее
    line(P, [-w / 2 + 14, -d / 2 + d * 0.45, -w / 2 + 16, d / 2 - d * 0.22]);
    line(P, [w / 2 - 14, -d / 2 + d * 0.45, w / 2 - 16, d / 2 - d * 0.22]);
  };
  S.gateSlide = (P, w, d) => {
    lw(P, 2); box(P, -w / 2, -d / 2, w, d, 0, false); thin(P);
    for (let x = -w / 2; x < w / 2; x += 25) line(P, [x, -d / 2, x + 25, d / 2]);
    lw(P, 1.2); line(P, [-w / 2 + 30, d / 2 + 20, w / 2 - 30, d / 2 + 20]); line(P, [-w / 2 + 50, d / 2 + 10, -w / 2 + 30, d / 2 + 20, -w / 2 + 50, d / 2 + 30]);
  };
  /** Значки заборов для библиотеки: полотно цвета материала и столбы */
  S.fenceIcon = (P, w) => {
    const m = FENCE_MATERIALS[P.def.mat] || {}, c = P.ctx;
    c.save(); c.strokeStyle = m.color || P.C.ink; lw(P, 5); c.setLineDash((m.dash || []).map(v => v * 3 * P.px));
    line(P, [-w / 2, 0, w / 2, 0]); c.restore();
    c.fillStyle = m.color || P.C.ink; for (let x = -w / 2; x <= w / 2 + 1; x += w / 3) box(P, x - 9, -9, 18, 18, 0);
  };
  S.fenceAroundIcon = (P, w, d) => {
    const c = P.ctx;
    c.save(); c.setLineDash([12 * P.px, 6 * P.px]); lw(P, 1); box(P, -w / 2 + 20, -d / 2 + 20, w - 40, d - 40, 0, false); c.restore();
    c.save(); c.strokeStyle = FENCE_MATERIALS.profile.color; lw(P, 5); box(P, -w / 2 + 20, -d / 2 + 20, w - 40, d - 40, 0, false); c.restore();
    c.fillStyle = P.C.ink; for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(P, x * (w / 2 - 20) - 10, y * (d / 2 - 20) - 10, 20, 20, 0);
  };
  S.wicket = (P, w, d) => {
    lw(P, 2); line(P, [-w / 2, 0, w / 2, 0]);
    thin(P); P.ctx.beginPath(); P.ctx.arc(-w / 2, 0, w, 0, Math.PI / 2); P.ctx.stroke();
    line(P, [-w / 2, 0, -w / 2, w]);
  };
  S.tree = (P, w, d) => {
    const c = P.ctx, n = 11, r = Math.min(w, d) / 2;
    c.save(); c.fillStyle = P.C.tree;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const a0 = i * Math.PI * 2 / n, a1 = (i + 0.5) * Math.PI * 2 / n;
      const p0 = [Math.cos(a0) * r * 0.86, Math.sin(a0) * r * 0.86];
      if (i === 0) c.moveTo(p0[0] * w / 2 / r, p0[1] * d / 2 / r);
      else c.quadraticCurveTo(Math.cos(a1 - Math.PI / n) * r * 1.12 * w / 2 / r, Math.sin(a1 - Math.PI / n) * r * 1.12 * d / 2 / r, p0[0] * w / 2 / r, p0[1] * d / 2 / r);
    }
    c.closePath(); c.fill(); c.stroke();
    thin(P);
    for (let i = 0; i < 5; i++) { const a = i * 1.256 + 0.3; line(P, [0, 0, Math.cos(a) * w * 0.25, Math.sin(a) * d * 0.25]); }
    c.fillStyle = P.C.trunk; circle(P, 0, 0, Math.max(6, r * 0.06));
    c.restore();
  };
  S.conifer = (P, w, d) => {
    const c = P.ctx, n = 16;
    c.save(); c.fillStyle = P.C.conifer;
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = i * Math.PI / n, k = i % 2 ? 0.72 : 1;
      c.lineTo(Math.cos(a) * w / 2 * k, Math.sin(a) * d / 2 * k);
    }
    c.closePath(); c.fill(); c.stroke();
    thin(P);
    for (let i = 0; i < n; i += 2) { const a = i * Math.PI / n; line(P, [0, 0, Math.cos(a) * w * 0.35, Math.sin(a) * d * 0.35]); }
    c.fillStyle = P.C.trunk; circle(P, 0, 0, Math.max(5, w * 0.04));
    c.restore();
  };
  S.bush = (P, w, d) => {
    const c = P.ctx; c.save(); c.fillStyle = P.C.tree;
    c.beginPath();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      c.moveTo(Math.cos(a) * w * 0.3 + w * 0.2, Math.sin(a) * d * 0.3);
      c.arc(Math.cos(a) * w * 0.3, Math.sin(a) * d * 0.3, Math.min(w, d) * 0.2, 0, Math.PI * 2);
    }
    c.fill(); c.stroke(); c.restore();
  };
  S.hedge = (P, w, d) => {
    const c = P.ctx; c.save(); c.fillStyle = P.C.tree;
    box(P, -w / 2, -d / 2, w, d, d / 2);
    thin(P);
    for (let x = -w / 2 + d / 2; x < w / 2 - d / 4; x += d * 0.7) circle(P, x, 0, d * 0.3, false);
    c.restore();
  };
  S.gardenbed = (P, w, d) => {
    P.ctx.save(); P.ctx.fillStyle = P.C.soil; box(P, -w / 2, -d / 2, w, d, 0);
    thin(P); for (let x = -w / 2 + 25; x < w / 2; x += 25) line(P, [x, -d / 2 + 8, x, d / 2 - 8]);
    P.ctx.restore();
  };
  S.flowerbed = (P, w, d) => {
    P.ctx.save(); P.ctx.fillStyle = P.C.flower; ell(P, 0, 0, w / 2, d / 2); thin(P);
    for (let i = 0; i < 9; i++) { const a = i * 0.7, r = (i / 9) * Math.min(w, d) * 0.35; circle(P, Math.cos(a) * r, Math.sin(a) * r, 5, false); }
    P.ctx.restore();
  };

  S.generic = S.labelbox;

  return { S, text, rr };
})();

