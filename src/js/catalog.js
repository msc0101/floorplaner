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
  { id: 'rooms', name: 'Помещения (заливка, подписи)' },
  { id: 'furniture', name: 'Мебель и техника' },
  { id: 'plumbing', name: 'Водопровод и канализация' },
  { id: 'heating', name: 'Отопление и печи' },
  { id: 'gas', name: 'Газ' },
  { id: 'electric', name: 'Электрика' },
  { id: 'dims', name: 'Размеры и надписи' },
  { id: 'notes', name: 'Примечания' },
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

/* Дороги, улицы, тропинки: ширина в см */
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
  ext:   { name: 'Наружная', th: 30, h: 300 },
  int:   { name: 'Внутренняя несущая', th: 20, h: 270 },
  part:  { name: 'Перегородка', th: 10, h: 270 },
  fence: { name: 'Забор', th: 5, h: 180 },
};

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
    { key: 'pole', name: 'Столб ЛЭП', shape: 'pole', w: 25, d: 25, h: 1000, sym: 40, layer: 'electric', shadow: true },
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
    { key: 'terrace', name: 'Терраса / веранда', shape: 'deck', w: 600, d: 300, h: 0 },
    { key: 'bbq', name: 'Мангал / барбекю', shape: 'bbq', w: 100, d: 40, h: 90 },
    { key: 'playground', name: 'Детская площадка', shape: 'labelbox', w: 500, d: 500, h: 0, label: 'Площадка' },
    { key: 'compost', name: 'Компостер', shape: 'labelbox', w: 100, d: 100, h: 90, label: 'Компост' },
    { key: 'parking', name: 'Парковочное место', shape: 'parking', w: 250, d: 530, h: 0 },
    { key: 'car', name: 'Автомобиль', shape: 'car', w: 185, d: 460, h: 150, shadow: true },
    { key: 'gate', name: 'Ворота откатные', shape: 'gateSlide', w: 400, d: 20, h: 200, shadow: true },
    { key: 'wicket', name: 'Калитка', shape: 'wicket', w: 100, d: 10, h: 200, shadow: true },
  ]},
  { id: 'green', name: 'Озеленение', layer: 'siteobj', items: [
    { key: 'tree', name: 'Дерево лиственное', shape: 'tree', w: 600, d: 600, h: 1200, shadow: true },
    { key: 'fruitTree', name: 'Дерево плодовое', shape: 'tree', w: 400, d: 400, h: 500, shadow: true },
    { key: 'conifer', name: 'Дерево хвойное', shape: 'conifer', w: 400, d: 400, h: 1500, shadow: true },
    { key: 'thuja', name: 'Туя / можжевельник', shape: 'conifer', w: 120, d: 120, h: 300, shadow: true },
    { key: 'bush', name: 'Кустарник', shape: 'bush', w: 150, d: 150, h: 150, shadow: true },
    { key: 'hedge', name: 'Живая изгородь', shape: 'hedge', w: 500, d: 80, h: 180, shadow: true },
    { key: 'bed', name: 'Грядка', shape: 'gardenbed', w: 120, d: 400, h: 20 },
    { key: 'flowerbed', name: 'Клумба', shape: 'flowerbed', w: 200, d: 200, h: 20 },
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
  const buildingBase = (P, w, d, hatchIt = true) => {
    lw(P, 2.4);
    box(P, -w / 2, -d / 2, w, d, 0);
    if (hatchIt) {
      P.ctx.save(); P.ctx.strokeStyle = P.C.hatch; thin(P);
      hatch(P, -w / 2, -d / 2, w, d, 40);
      P.ctx.restore();
    }
  };
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
  S.building = (P, w, d) => { buildingBase(P, w, d); bldLabel(P, w, d); };
  S.garage = (P, w, d) => {
    buildingBase(P, w, d);
    const gw = Math.min(w - 60, 300);
    P.ctx.save(); P.ctx.fillStyle = P.C.bg; lw(P, 1);
    box(P, -gw / 2, d / 2 - 6, gw, 12, 0);
    P.ctx.setLineDash([10 * P.px, 5 * P.px]); line(P, [-gw / 2, d / 2 - 60, gw / 2, d / 2 - 60]); P.ctx.restore();
    bldLabel(P, w, d);
  };
  S.canopy = (P, w, d) => {
    lw(P, 1.2); P.ctx.setLineDash([12 * P.px, 6 * P.px]);
    box(P, -w / 2, -d / 2, w, d, 0);
    P.ctx.setLineDash([]);
    line(P, [-w / 2, -d / 2, w / 2, d / 2]); line(P, [w / 2, -d / 2, -w / 2, d / 2]);
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
    thin(P);
    for (let x = -w / 2 + 60; x < w / 2; x += 60) line(P, [x, -d / 2, x, d / 2]);
    P.ctx.fillStyle = P.C.ink;
    const k = Math.max(1, Math.round(w / 300));
    for (let i = 0; i <= k; i++) { const x = -w / 2 + 8 + (w - 16) * i / k; box(P, x - 7, d / 2 - 16, 14, 14, 0); }
    // стрелка ската
    lw(P, 1); line(P, [0, -d / 2 + 30, 0, d / 2 - 40]); line(P, [-8, d / 2 - 54, 0, d / 2 - 40, 8, d / 2 - 54]);
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
    thin(P);
    for (let y = -d / 2 + 100; y < d / 2; y += 100) line(P, [-w / 2, y, w / 2, y]);
    line(P, [0, -d / 2, 0, d / 2]);
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

