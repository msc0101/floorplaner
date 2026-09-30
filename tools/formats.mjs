/* Проверка экспортируемых файлов по официальным спецификациям:
   IFC 2x3 TC1 (ISO 16739:2005) в обмене STEP (ISO 10303-21), DXF R12 (AC1009, Autodesk DXF Reference),
   SVG 1.1 (синтаксис путей, уникальность id, ссылки url(#…)), Wavefront OBJ + MTL, ZIP (APPNOTE).
   Каждая функция возвращает список нарушений (пустой — файл соответствует). */

/* ---------------------------------- IFC ---------------------------------- */
// сущность → [число атрибутов, обязательные (не $), производные (*)]; IFC2x3 TC1
const IFC2X3 = {
  IFCPERSON: [8, []], IFCORGANIZATION: [5, [1]], IFCPERSONANDORGANIZATION: [3, [0, 1]], IFCAPPLICATION: [4, [0, 1, 2, 3]],
  IFCOWNERHISTORY: [8, [0, 1, 3, 7]], IFCUNITASSIGNMENT: [1, [0]], IFCSIUNIT: [4, [1, 3], [0]],
  IFCCARTESIANPOINT: [1, [0]], IFCDIRECTION: [1, [0]], IFCAXIS2PLACEMENT3D: [3, [0]], IFCAXIS2PLACEMENT2D: [2, [0]],
  IFCGEOMETRICREPRESENTATIONCONTEXT: [6, [2, 4]], IFCGEOMETRICREPRESENTATIONSUBCONTEXT: [10, [6, 8], [2, 3, 4, 5]],
  IFCPROJECT: [9, [0, 1, 2, 7, 8]], IFCLOCALPLACEMENT: [2, [1]], IFCPRODUCTDEFINITIONSHAPE: [3, [2]], IFCSHAPEREPRESENTATION: [4, [0, 3]],
  IFCEXTRUDEDAREASOLID: [4, [0, 1, 2, 3]], IFCRECTANGLEPROFILEDEF: [5, [0, 2, 3, 4]], IFCCIRCLEPROFILEDEF: [4, [0, 2, 3]],
  IFCARBITRARYCLOSEDPROFILEDEF: [3, [0, 2]], IFCPOLYLINE: [1, [0]], IFCSWEPTDISKSOLID: [5, [0, 1, 3, 4]],
  IFCSITE: [14, [0, 1, 8]], IFCBUILDING: [12, [0, 1, 8]], IFCBUILDINGSTOREY: [10, [0, 1, 8]], IFCSPACE: [11, [0, 1, 8, 9]],
  IFCRELAGGREGATES: [6, [0, 1, 4, 5]], IFCRELCONTAINEDINSPATIALSTRUCTURE: [6, [0, 1, 4, 5]], IFCRELVOIDSELEMENT: [6, [0, 1, 4, 5]],
  IFCRELFILLSELEMENT: [6, [0, 1, 4, 5]], IFCRELDEFINESBYPROPERTIES: [6, [0, 1, 4, 5]], IFCRELASSOCIATESMATERIAL: [6, [0, 1, 4, 5]],
  IFCWALLSTANDARDCASE: [8, [0, 1]], IFCBUILDINGELEMENTPROXY: [9, [0, 1]], IFCOPENINGELEMENT: [8, [0, 1]], IFCWINDOW: [10, [0, 1]], IFCDOOR: [10, [0, 1]],
  IFCSLAB: [9, [0, 1]], IFCSTAIR: [9, [0, 1, 8]], IFCCOLUMN: [8, [0, 1]], IFCFLOWTERMINAL: [8, [0, 1]], IFCFURNISHINGELEMENT: [8, [0, 1]], IFCFLOWSEGMENT: [8, [0, 1]],
  IFCROOF: [9, [0, 1, 8]], IFCFACE: [1, [0]], IFCFACEOUTERBOUND: [2, [0, 1]], IFCPOLYLOOP: [1, [0]], IFCOPENSHELL: [1, [0]], IFCSHELLBASEDSURFACEMODEL: [1, [0]],
  IFCELEMENTQUANTITY: [6, [0, 1, 5]], IFCQUANTITYAREA: [4, [0, 3]], IFCQUANTITYLENGTH: [4, [0, 3]],
  IFCMATERIAL: [1, [0]], IFCMATERIALLAYER: [3, [1]], IFCMATERIALLAYERSET: [2, [0]], IFCMATERIALLAYERSETUSAGE: [4, [0, 1, 2, 3]],
  IFCPROPERTYSET: [5, [0, 1, 4]], IFCPROPERTYSINGLEVALUE: [4, [0]],
};
const IFC_ENUMS = {   // допустимые значения перечислений: сущность → { индекс атрибута: [значения] }
  IFCOWNERHISTORY: { 3: ['NOCHANGE', 'MODIFIED', 'ADDED', 'DELETED', 'MODIFIEDADDED', 'MODIFIEDDELETED'] },
  IFCSIUNIT: { 1: ['LENGTHUNIT', 'AREAUNIT', 'VOLUMEUNIT', 'PLANEANGLEUNIT'], 2: ['MILLI', 'CENTI'], 3: ['METRE', 'SQUARE_METRE', 'CUBIC_METRE', 'RADIAN'] },
  IFCGEOMETRICREPRESENTATIONSUBCONTEXT: { 8: ['MODEL_VIEW', 'PLAN_VIEW', 'GRAPH_VIEW', 'SKETCH_VIEW', 'REFLECTED_PLAN_VIEW', 'SECTION_VIEW', 'ELEVATION_VIEW', 'USERDEFINED', 'NOTDEFINED'] },
  IFCSITE: { 8: ['COMPLEX', 'ELEMENT', 'PARTIAL'] }, IFCBUILDING: { 8: ['COMPLEX', 'ELEMENT', 'PARTIAL'] }, IFCBUILDINGSTOREY: { 8: ['COMPLEX', 'ELEMENT', 'PARTIAL'] },
  IFCSPACE: { 8: ['COMPLEX', 'ELEMENT', 'PARTIAL'], 9: ['INTERNAL', 'EXTERNAL', 'NOTDEFINED'] },
  IFCSLAB: { 8: ['FLOOR', 'ROOF', 'LANDING', 'BASESLAB', 'USERDEFINED', 'NOTDEFINED'] },
  IFCSTAIR: { 8: ['STRAIGHT_RUN_STAIR', 'TWO_STRAIGHT_RUN_STAIR', 'QUARTER_WINDING_STAIR', 'QUARTER_TURN_STAIR', 'HALF_WINDING_STAIR', 'HALF_TURN_STAIR', 'TWO_QUARTER_WINDING_STAIR', 'TWO_QUARTER_TURN_STAIR', 'THREE_QUARTER_WINDING_STAIR', 'THREE_QUARTER_TURN_STAIR', 'SPIRAL_STAIR', 'DOUBLE_RETURN_STAIR', 'CURVED_RUN_STAIR', 'TWO_CURVED_RUN_STAIR', 'USERDEFINED', 'NOTDEFINED'] },
  IFCROOF: { 8: ['FLAT_ROOF', 'SHED_ROOF', 'GABLE_ROOF', 'HIP_ROOF', 'HIPPED_GABLE_ROOF', 'GAMBREL_ROOF', 'MANSARD_ROOF', 'BARREL_ROOF', 'RAINBOW_ROOF', 'BUTTERFLY_ROOF', 'PAVILION_ROOF', 'DOME_ROOF', 'FREEFORM', 'NOTDEFINED'] },
  IFCRECTANGLEPROFILEDEF: { 0: ['AREA', 'CURVE'] }, IFCCIRCLEPROFILEDEF: { 0: ['AREA', 'CURVE'] }, IFCARBITRARYCLOSEDPROFILEDEF: { 0: ['AREA', 'CURVE'] },
  IFCMATERIALLAYERSETUSAGE: { 1: ['AXIS1', 'AXIS2', 'AXIS3'], 2: ['POSITIVE', 'NEGATIVE'] },
  IFCBUILDINGELEMENTPROXY: { 8: ['COMPLEX', 'ELEMENT', 'PARTIAL'] },
};

/** Разбор параметров STEP: строки '…' (с удвоенным апострофом), списки (…), #ссылки, .ENUM., типизированные IFCLABEL(…) */
function stepParse(s) {
  let i = 0;
  const err = (m) => { throw new Error(m + ' @' + i + ': ' + s.slice(Math.max(0, i - 20), i + 20)); };
  const ws = () => { while (s[i] === ' ') i++; };
  const val = () => {
    ws();
    const c = s[i];
    if (c === "'") {
      let out = ''; i++;
      for (;;) {
        if (i >= s.length) err('строка не закрыта');
        if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
        const ch = s.charCodeAt(i);
        if (ch < 32 || ch > 126) err('недопустимый символ в строке (нужны \\X2\\…\\X0\\)');
        if (s[i] === '\\') {
          const m = /^\\(X2\\(?:[0-9A-F]{4})+\\X0\\|X4\\(?:[0-9A-F]{8})+\\X0\\|X\\[0-9A-F]{2}|S\\.|P[A-I]\\|\\)/.exec(s.slice(i));
          if (!m) err('неверная escape-последовательность');
          out += m[0]; i += m[0].length; continue;
        }
        out += s[i++];
      }
      return { t: 'str', v: out };
    }
    if (c === '(') { i++; const a = []; ws(); if (s[i] === ')') { i++; return { t: 'list', v: a }; } for (;;) { a.push(val()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ')') { i++; break; } err('ожидалась , или )'); } return { t: 'list', v: a }; }
    if (c === '#') { const m = /^#(\d+)/.exec(s.slice(i)); if (!m) err('ссылка'); i += m[0].length; return { t: 'ref', v: +m[1] }; }
    if (c === '$') { i++; return { t: 'null' }; }
    if (c === '*') { i++; return { t: 'derived' }; }
    if (c === '.') { const m = /^\.([A-Z_][A-Z0-9_]*)\./.exec(s.slice(i)); if (!m) err('перечисление'); i += m[0].length; return { t: 'enum', v: m[1] }; }
    let m = /^[+-]?\d+\.\d*(?:E[+-]?\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return { t: 'real', v: parseFloat(m[0]) }; }
    m = /^[+-]?\d+/.exec(s.slice(i));
    if (m) { if (/^[eE.]/.test(s[i + m[0].length] || '')) err('неверное вещественное число'); i += m[0].length; return { t: 'int', v: +m[0] }; }
    m = /^([A-Z][A-Z0-9_]*)\(/.exec(s.slice(i));
    if (m) { i += m[0].length - 1; const inner = val(); return { t: 'typed', type: m[1], v: inner.v }; }
    err('неизвестный токен');
  };
  const out = val(); ws();
  if (i !== s.length) err('лишние символы');
  return out;
}

export function validateIFC(text) {
  const E = [];
  const lines = text.split(/\r?\n/);
  const hdrOk = lines[0] === 'ISO-10303-21;' && lines.includes('HEADER;') && lines.includes('DATA;') && lines.filter(l => l === 'ENDSEC;').length === 2 && lines.filter(Boolean).pop() === 'END-ISO-10303-21;';
  if (!hdrOk) E.push('STEP: нет ISO-10303-21; / HEADER; / DATA; / ENDSEC; / END-ISO-10303-21;');
  const H = lines.slice(lines.indexOf('HEADER;') + 1, lines.indexOf('DATA;') - 1).join('');
  const hdrE = { FILE_DESCRIPTION: 2, FILE_NAME: 7, FILE_SCHEMA: 1 };
  for (const [k, n] of Object.entries(hdrE)) {
    const m = new RegExp(k + '(\\(.*?\\));').exec(H);
    if (!m) { E.push('HEADER: нет ' + k); continue; }
    try { const p = stepParse(m[1]); if (p.v.length !== n) E.push(`HEADER: ${k} — ${p.v.length} параметров вместо ${n}`); } catch (e) { E.push('HEADER ' + k + ': ' + e.message); }
  }
  if (!/FILE_SCHEMA\(\('IFC2X3'\)\)/.test(H)) E.push('HEADER: схема не IFC2X3');
  const ents = new Map(), guids = new Set();
  const data = lines.slice(lines.indexOf('DATA;') + 1, lines.lastIndexOf('ENDSEC;'));
  let prev = 0;
  for (const l of data) {
    const m = /^#(\d+)=([A-Z0-9_]+)(\(.*\));$/.exec(l);
    if (!m) { E.push('DATA: строка не по ISO 10303-21: ' + l.slice(0, 80)); continue; }
    const id = +m[1];
    if (ents.has(id)) E.push('повтор #' + id);
    if (id <= prev) E.push('номера не по возрастанию #' + id);
    prev = id;
    try { ents.set(id, { type: m[2], a: stepParse(m[3]).v }); } catch (e) { E.push(`#${id} ${m[2]}: ${e.message}`); }
  }
  const refs = (v, fn) => { if (!v) return; if (v.t === 'ref') fn(v.v); else if (v.t === 'list') v.v.forEach(x => refs(x, fn)); };
  const typeOf = (r) => (ents.get(r) || {}).type;
  for (const [id, e] of ents) {
    const S = IFC2X3[e.type];
    if (!S) { E.push(`#${id}: сущность ${e.type} не проверяется (нет в таблице IFC2x3)`); continue; }
    const [n, req, der = []] = S;
    if (e.a.length !== n) { E.push(`#${id} ${e.type}: ${e.a.length} атрибутов вместо ${n}`); continue; }
    for (const k of req) if (e.a[k].t === 'null' || e.a[k].t === 'derived') E.push(`#${id} ${e.type}: обязательный атрибут ${k + 1} не задан`);
    for (const k of der) if (e.a[k].t !== 'derived') E.push(`#${id} ${e.type}: производный атрибут ${k + 1} должен быть *`);
    e.a.forEach((v, k) => { if (v.t === 'derived' && !der.includes(k)) E.push(`#${id} ${e.type}: * в непроизводном атрибуте ${k + 1}`); });
    for (const [k, vals] of Object.entries(IFC_ENUMS[e.type] || {})) { const v = e.a[k]; if (v.t === 'enum' && !vals.includes(v.v)) E.push(`#${id} ${e.type}: .${v.v}. — нет в перечислении`); }
    e.a.forEach(v => refs(v, (r) => { if (!ents.has(r)) E.push(`#${id} ${e.type}: ссылка на несуществующий #${r}`); }));
    // IfcRoot: GlobalId — 22 символа base64 IFC, первый 0–3, уникален
    if (e.a[0] && e.a[0].t === 'str' && /^IFC(REL|PROJECT|SITE|BUILDING|SPACE|WALL|SLAB|DOOR|WINDOW|OPENING|ROOF|STAIR|COLUMN|FLOW|FURNISH|PROPERTYSET|ELEMENTQUANTITY)/.test(e.type) && e.type !== 'IFCPROPERTYSINGLEVALUE') {
      const g = e.a[0].v;
      if (!/^[0-3][0-9A-Za-z_$]{21}$/.test(g)) E.push(`#${id} ${e.type}: GlobalId «${g}» не по IfcGloballyUniqueId`);
      if (guids.has(g)) E.push(`#${id}: повтор GlobalId ${g}`);
      guids.add(g);
    }
    const pts = (r) => ((ents.get(r) || {}).a || [{ v: [] }])[0].v.map(x => ents.get(x.v).a[0].v.map(c => c.v));
    const same = (p, q) => p.every((c, j) => Math.abs(c - (q[j] || 0)) < 1e-6);
    if (e.type === 'IFCPOLYLINE') { const p = pts(id); if (p.length < 2) E.push(`#${id} IfcPolyline: меньше 2 точек`); if (p.some((q, j) => j && same(q, p[j - 1]))) E.push(`#${id} IfcPolyline: совпадающие соседние точки`); }
    if (e.type === 'IFCPOLYLOOP') { const p = pts(id); if (p.length < 3) E.push(`#${id} IfcPolyLoop: меньше 3 точек`); if (p.some((q, j) => same(q, p[(j + 1) % p.length]))) E.push(`#${id} IfcPolyLoop: совпадающие соседние точки`); }
    if (e.type === 'IFCARBITRARYCLOSEDPROFILEDEF') { const p = pts(e.a[2].v); if (p.length < 4 || !same(p[0], p[p.length - 1])) E.push(`#${id}: контур профиля не замкнут`); if (p.some(q => q.length !== 2)) E.push(`#${id}: контур профиля не 2D`); }
    if (e.type === 'IFCEXTRUDEDAREASOLID' && !(e.a[3].v > 0)) E.push(`#${id}: Depth ≤ 0`);
    if (e.type === 'IFCRECTANGLEPROFILEDEF' && !(e.a[3].v > 0 && e.a[4].v > 0)) E.push(`#${id}: размер профиля ≤ 0`);
    if (e.type === 'IFCCIRCLEPROFILEDEF' && !(e.a[3].v > 0)) E.push(`#${id}: радиус ≤ 0`);
    if (e.type === 'IFCMATERIALLAYER' && !(e.a[1].v > 0)) E.push(`#${id}: толщина слоя ≤ 0`);
    if (e.type === 'IFCAXIS2PLACEMENT3D' && (e.a[1].t === 'null') !== (e.a[2].t === 'null')) E.push(`#${id}: Axis и RefDirection — оба или ни одного`);
    if (e.type === 'IFCGEOMETRICREPRESENTATIONCONTEXT' && e.a[5].t === 'ref' && ents.get(e.a[5].v).a[0].v.length !== 2) E.push(`#${id}: TrueNorth должен быть 2D`);
    if (e.type === 'IFCSITE') for (const k of [9, 10]) { const v = e.a[k]; if (v.t === 'list' && (v.v.length < 3 || v.v.length > 4 || v.v.some(x => x.t !== 'int'))) E.push(`#${id}: RefLatitude/RefLongitude — список 3–4 целых`); }
  }
  // пространственная структура: проект → участок → здание → этажи; каждый элемент — ровно в одной структуре
  const agg = [...ents.values()].filter(e => e.type === 'IFCRELAGGREGATES');
  const kidsOf = (t) => agg.filter(e => typeOf(e.a[4].v) === t).flatMap(e => e.a[5].v.map(x => typeOf(x.v)));
  if ([...ents.values()].filter(e => e.type === 'IFCPROJECT').length !== 1) E.push('IFCPROJECT должен быть ровно один');
  if (!kidsOf('IFCPROJECT').includes('IFCSITE')) E.push('проект не агрегирует участок');
  if (!kidsOf('IFCSITE').includes('IFCBUILDING')) E.push('участок не агрегирует здание');
  if (!kidsOf('IFCBUILDING').includes('IFCBUILDINGSTOREY')) E.push('здание не агрегирует этажи');
  const contained = new Map();
  for (const e of ents.values()) if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') for (const x of e.a[4].v) contained.set(x.v, (contained.get(x.v) || 0) + 1);
  for (const [r, c] of contained) if (c > 1) E.push(`#${r}: входит в несколько пространственных структур`);
  // IfcWallStandardCase: есть IfcMaterialLayerSetUsage, сумма слоёв = толщине профиля стены
  const usageOf = new Map();
  for (const e of ents.values()) if (e.type === 'IFCRELASSOCIATESMATERIAL' && typeOf(e.a[5].v) === 'IFCMATERIALLAYERSETUSAGE') for (const x of e.a[4].v) usageOf.set(x.v, e.a[5].v);
  for (const [id, e] of ents) {
    if (e.type !== 'IFCWALLSTANDARDCASE') continue;
    const u = usageOf.get(id);
    if (!u) { E.push(`#${id} IfcWallStandardCase: нет IfcMaterialLayerSetUsage`); continue; }
    const set = ents.get(ents.get(u).a[0].v), sum = set.a[0].v.reduce((a, x) => a + ents.get(x.v).a[1].v, 0);
    const reps = ents.get(e.a[6].v).a[2].v.map(x => ents.get(x.v)), body = reps.find(r => r.a[1].v === 'Body');
    const solid = body && ents.get(body.a[3].v[0].v), prof = solid && ents.get(solid.a[0].v);
    if (prof && prof.type === 'IFCRECTANGLEPROFILEDEF' && Math.abs(prof.a[4].v - sum) > 0.5) E.push(`#${id}: сумма слоёв ${sum} мм ≠ толщине стены ${prof.a[4].v} мм`);
    const off = ents.get(u).a[3].v;
    if (Math.abs(off + sum / 2) > 0.5) E.push(`#${id}: OffsetFromReferenceLine ${off} ≠ −толщина/2`);
  }
  return E;
}

/* ---------------------------------- DXF ---------------------------------- */
const R12_HEADER = new Set(['$ACADVER', '$DWGCODEPAGE', '$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$LUNITS', '$LUPREC', '$TEXTSTYLE', '$CLAYER', '$ORTHOMODE', '$LTSCALE', '$TEXTSIZE', '$AUNITS', '$AUPREC', '$ANGBASE', '$ANGDIR', '$PDMODE', '$PDSIZE']);
export function validateDXF(text) {
  const E = [];
  const raw = text.split('\r\n');
  if (raw[raw.length - 1] === '') raw.pop();
  if (raw.length % 2) E.push('нечётное число строк: пары «код — значение» нарушены');
  const P = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const c = raw[i].trim();
    if (!/^-?\d{1,4}$/.test(c)) { E.push(`строка ${i + 1}: групповой код «${raw[i]}» не целое`); return E; }
    P.push([+c, raw[i + 1]]);
  }
  const isFloat = (c) => (c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239) || (c >= 1010 && c <= 1059);
  const isInt = (c) => (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 1060 && c <= 1071);
  for (const [c, v] of P) {
    if (isFloat(c) && !/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) E.push(`код ${c}: «${v}» — не число`);
    if (isInt(c) && !/^\s*[+-]?\d+\s*$/.test(v)) E.push(`код ${c}: «${v}» — не целое`);
    if (c === 1 && v.length > 255) E.push('строка длиннее 255 символов');
    if (c === 5 || c === 330 || c === 100) E.push(`код ${c} не существует в DXF R12`);
  }
  if (P.length < 2 || P[P.length - 1][0] !== 0 || P[P.length - 1][1] !== 'EOF') E.push('нет 0/EOF в конце');
  // секции
  const secs = []; let cur = null;
  for (let i = 0; i < P.length; i++) {
    const [c, v] = P[i];
    if (c === 0 && v === 'SECTION') { if (cur) E.push('SECTION внутри секции'); cur = { name: P[i + 1] && P[i + 1][0] === 2 ? P[i + 1][1] : '?', from: i + 2 }; }
    else if (c === 0 && v === 'ENDSEC') { if (!cur) E.push('ENDSEC без SECTION'); else { cur.to = i; secs.push(cur); cur = null; } }
  }
  if (cur) E.push('секция не закрыта');
  const order = secs.map(s => s.name), known = ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'];
  if (order.some(n => !known.includes(n))) E.push('неизвестная секция для R12: ' + order);
  if (order.join() !== known.filter(n => order.includes(n)).join()) E.push('порядок секций не HEADER, TABLES, BLOCKS, ENTITIES');
  const sec = (n) => { const s = secs.find(x => x.name === n); return s ? P.slice(s.from, s.to) : []; };
  const hdr = sec('HEADER');
  const vars = hdr.filter(([c]) => c === 9).map(([, v]) => v);
  if (!vars.includes('$ACADVER') || (hdr[hdr.findIndex(([c, v]) => c === 9 && v === '$ACADVER') + 1] || [])[1] !== 'AC1009') E.push('$ACADVER не AC1009');
  for (const v of vars) if (!R12_HEADER.has(v)) E.push(`переменная ${v} не входит в DXF R12`);
  // таблицы: 70 ≥ числа записей, имена слоёв
  const layers = new Set(), styles = new Set(), ltypes = new Set(['CONTINUOUS', 'BYLAYER', 'BYBLOCK']);
  const T = sec('TABLES');
  for (let i = 0; i < T.length; i++) {
    if (T[i][0] === 0 && T[i][1] === 'TABLE') {
      const name = T[i + 1][1], max = T[i + 2][0] === 70 ? +T[i + 2][1] : NaN;
      let n = 0, j = i + 3;
      for (; j < T.length && !(T[j][0] === 0 && T[j][1] === 'ENDTAB'); j++) if (T[j][0] === 0) { n++; if (T[j][1] !== name) E.push(`в таблице ${name} запись ${T[j][1]}`); const nm = T[j + 1][0] === 2 ? T[j + 1][1] : null; if (name === 'LAYER') layers.add(nm); if (name === 'STYLE') styles.add(nm); if (name === 'LTYPE') ltypes.add(nm); }
      if (!(max >= n)) E.push(`таблица ${name}: 70=${max} меньше числа записей ${n}`);
      i = j;
    }
  }
  for (const l of layers) if (!/^[A-Z0-9$_-]{1,31}$/.test(l)) E.push(`имя слоя «${l}» недопустимо в R12`);
  if (!layers.has('0')) E.push('нет слоя 0');
  for (let i = 0; i < T.length; i++) if (T[i][0] === 6 && !ltypes.has(T[i][1])) E.push(`тип линии ${T[i][1]} не описан в LTYPE`);
  // примитивы
  const ENT = sec('ENTITIES');
  const allowed = new Set(['LINE', 'POINT', 'CIRCLE', 'ARC', 'TRACE', 'SOLID', 'TEXT', 'SHAPE', 'INSERT', 'ATTRIB', 'POLYLINE', 'VERTEX', 'SEQEND', '3DFACE', 'DIMENSION']);
  let inPoly = false, nPoly = 0, nText = 0;
  for (let i = 0; i < ENT.length; i++) {
    if (ENT[i][0] !== 0) continue;
    const t = ENT[i][1];
    let j = i + 1; const g = {};
    for (; j < ENT.length && ENT[j][0] !== 0; j++) (g[ENT[j][0]] = g[ENT[j][0]] || []).push(ENT[j][1]);
    if (!allowed.has(t)) E.push(`примитив ${t} не из R12`);
    if (!g[8]) E.push(`${t}: нет слоя (код 8)`); else if (!layers.has(g[8][0])) E.push(`${t}: слой ${g[8][0]} не описан в LAYER`);
    if (t === 'POLYLINE') { if (inPoly) E.push('POLYLINE без SEQEND'); inPoly = true; nPoly++; if (!g[66] || g[66][0].trim() !== '1') E.push('POLYLINE: нет 66=1'); }
    else if (t === 'VERTEX') { if (!inPoly) E.push('VERTEX вне POLYLINE'); if (!g[10] || !g[20]) E.push('VERTEX без координат'); }
    else if (t === 'SEQEND') { if (!inPoly) E.push('SEQEND без POLYLINE'); inPoly = false; }
    else if (inPoly) E.push(`${t} внутри POLYLINE`);
    if (t === 'TEXT') {
      nText++;
      if (!g[10] || !g[20] || !g[40] || !g[1]) E.push('TEXT: нет 10/20/40/1');
      else if (!(parseFloat(g[40][0]) > 0)) E.push('TEXT: высота ≤ 0');
      if (((g[72] && +g[72][0]) || (g[73] && +g[73][0])) && !(g[11] && g[21])) E.push('TEXT: выравнивание без точки 11/21');
      if (g[7] && !styles.has(g[7][0])) E.push(`TEXT: стиль ${g[7][0]} не описан в STYLE`);
      if (g[72] && !(+g[72][0] >= 0 && +g[72][0] <= 5)) E.push('TEXT: 72 вне 0..5');
      if (g[73] && !(+g[73][0] >= 0 && +g[73][0] <= 3)) E.push('TEXT: 73 вне 0..3');
    }
    i = j - 1;
  }
  if (inPoly) E.push('последняя POLYLINE без SEQEND');
  if (!nPoly || !nText) E.push('нет полилиний или текстов');
  return E;
}

/* ---------------------------------- SVG ---------------------------------- */
/** Проверка без DOM: пролог, пространство имён, уникальность id, ссылки url(#…), синтаксис d, числа в атрибутах */
export function validateSVG(text) {
  const E = [];
  if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(text)) E.push('нет XML-пролога');
  if (!/<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text)) E.push('нет пространства имён SVG');
  if (/xlink:href/.test(text) && !/xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/.test(text)) E.push('xlink без объявления');
  const ids = new Map();
  for (const m of text.matchAll(/\sid="([^"]*)"/g)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
  for (const [k, n] of ids) { if (n > 1) E.push(`id «${k}» повторяется ${n} раз`); if (!/^[A-Za-z_][\w.-]*$/.test(k)) E.push(`id «${k}» — не XML Name`); }
  for (const m of text.matchAll(/url\(#([^)]+)\)/g)) if (!ids.has(m[1])) E.push(`ссылка url(#${m[1]}) на несуществующий id`);
  if (/NaN|Infinity|undefined/.test(text.replace(/<title>.*?<\/title>/s, '').replace(/>[^<]*</g, '><'))) E.push('NaN/Infinity/undefined в атрибутах');
  const num = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const dRe = new RegExp(`^(?:M${num} ${num}(?:L${num} ${num})*Z?)+$`);
  for (const m of text.matchAll(/<path d="([^"]*)"/g)) if (m[1] && !dRe.test(m[1])) { E.push('неверный синтаксис d: ' + m[1].slice(0, 60)); break; }
  // баланс тегов (упрощённо: без CDATA и комментариев)
  const stack = [];
  for (const m of text.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) { E.push('теги не сбалансированы у </' + m[2] + '>'); break; }
  }
  if (stack.length) E.push('незакрытые теги: ' + stack.slice(-3));
  if (/<text[^>]*>[^<]*[&](?!amp;|lt;|gt;|quot;|#39;)[^<]*<\/text>/.test(text)) E.push('неэкранированный & в тексте');
  return E;
}

/* ---------------------------------- OBJ ---------------------------------- */
export function validateOBJ(obj, mtl) {
  const E = [];
  const mats = new Set();
  for (const l of mtl.split('\n')) {
    const t = l.trim(); if (!t || t[0] === '#') continue;
    const [k, ...a] = t.split(/\s+/);
    if (k === 'newmtl') { if (a.length !== 1) E.push('newmtl: имя с пробелами'); mats.add(a[0]); }
    else if (['Ka', 'Kd', 'Ks'].includes(k)) { if (a.length !== 3 || a.some(x => !(+x >= 0 && +x <= 1))) E.push(`${k}: нужны 3 числа 0..1: ${t}`); }
    else if (k === 'd') { if (!(+a[0] >= 0 && +a[0] <= 1)) E.push('d вне 0..1'); }
    else if (k === 'illum') { if (!/^(10|[0-9])$/.test(a[0])) E.push('illum вне 0..10'); }
    else if (!['Ns', 'Ni', 'Tr', 'Tf', 'map_Kd'].includes(k)) E.push('MTL: неизвестный оператор ' + k);
  }
  let v = 0, vn = 0, faces = 0, mtllib = false, curMat = null;
  const fs = [];
  for (const l of obj.split('\n')) {
    const t = l.trim(); if (!t || t[0] === '#') continue;
    if (/[^\x20-\x7e]/.test(t)) { E.push('OBJ: не-ASCII вне комментария'); break; }
    const [k, ...a] = t.split(/\s+/);
    if (k === 'v') { if (a.length !== 3 && a.length !== 4) E.push('v: нужно 3 (или 4) числа: ' + t); if (a.some(x => !Number.isFinite(+x))) E.push('v: не число'); v++; }
    else if (k === 'vn') { if (a.length !== 3 || a.some(x => !Number.isFinite(+x))) E.push('vn: нужно 3 числа'); vn++; }
    else if (k === 'f') { if (a.length < 3) E.push('f: меньше 3 вершин'); if (!curMat) E.push('f до usemtl'); faces++; fs.push(a); }
    else if (k === 'usemtl') { if (!mats.has(a[0])) E.push('usemtl: материал не описан в MTL: ' + a[0]); curMat = a[0]; }
    else if (k === 'mtllib') mtllib = true;
    else if (!['o', 'g', 's', 'vt'].includes(k)) E.push('OBJ: неизвестный оператор ' + k);
    if (E.length > 20) break;
  }
  for (const a of fs) for (const x of a) {
    const m = /^(\d+)(?:\/(\d*)(?:\/(\d+))?)?$/.exec(x);
    if (!m) { E.push('f: неверная ссылка ' + x); break; }
    if (+m[1] < 1 || +m[1] > v) { E.push('f: индекс вершины вне диапазона ' + x); break; }
    if (m[3] && (+m[3] < 1 || +m[3] > vn)) { E.push('f: индекс нормали вне диапазона ' + x); break; }
  }
  if (!mtllib) E.push('нет mtllib');
  if (!faces) E.push('нет граней');
  return E;
}

/* ---------------------------------- ZIP ---------------------------------- */
export function validateZIP(bytes) {
  const E = [], b = Buffer.from(bytes), names = [];
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return ['нет конца центрального каталога'];
  const n = b.readUInt16LE(eocd + 10), cdOff = b.readUInt32LE(eocd + 16);
  let p = cdOff;
  const crcT = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (d) => { let c = 0xFFFFFFFF; for (const x of d) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  for (let i = 0; i < n; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) { E.push('неверная запись каталога'); break; }
    const size = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), lo = b.readUInt32LE(p + 42), c = b.readUInt32LE(p + 16);
    const name = b.slice(p + 46, p + 46 + nl).toString('utf8'); names.push(name);
    if (b.readUInt32LE(lo) !== 0x04034b50) E.push('нет локального заголовка ' + name);
    const ln = b.readUInt16LE(lo + 26), le = b.readUInt16LE(lo + 28), data = b.slice(lo + 30 + ln + le, lo + 30 + ln + le + size);
    if (crc(data) !== c) E.push('CRC не совпадает: ' + name);
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return { errors: E, names, file: (nm) => { let q = cdOff; for (let i = 0; i < n; i++) { const size = b.readUInt32LE(q + 20), nl = b.readUInt16LE(q + 28), lo = b.readUInt32LE(q + 42); if (b.slice(q + 46, q + 46 + nl).toString('utf8') === nm) { const ln = b.readUInt16LE(lo + 26), le = b.readUInt16LE(lo + 28); return b.slice(lo + 30 + ln + le, lo + 30 + ln + le + size).toString('utf8'); } q += 46 + nl + b.readUInt16LE(q + 30) + b.readUInt16LE(q + 32); } return null; } };
}
