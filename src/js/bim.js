'use strict';
/* ==========================================================================
   Экспорт в IFC 2x3 (ISO 16739, Coordination View 2.0) — открытый BIM-формат,
   который открывают Revit, ArchiCAD, Renga, nanoCAD BIM, Tekla, BricsCAD,
   Solibri, BIMcollab и др. Единицы — мм; ось Y плана перевёрнута (Y вверх).
   Состав: участок, здание, этажи; стены с многослойными материалами;
   проёмы с дверьми и окнами; перекрытия; помещения с площадями;
   крыши; мебель, оборудование, постройки, деревья; инженерные трассы.
   ========================================================================== */

const IFC = {
  guid() {
    const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.random() * 256 | 0));
    let n = 0n;
    for (const x of b) n = (n << 8n) | BigInt(x);
    let s = '';
    for (let i = 0; i < 22; i++) s += cs[Number((n >> BigInt(6 * (21 - i))) & 63n)];
    return s;
  },
  /** Строка STEP: апостроф удваивается, не-ASCII — \X2\hhhh\X0\ */
  str(s) {
    let out = '', run = '';
    const flush = () => { if (run) { out += '\\X2\\' + run + '\\X0\\'; run = ''; } };
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) { flush(); out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch; }
      else if (c < 0x10000) run += c.toString(16).toUpperCase().padStart(4, '0');
      else { flush(); out += '?'; }
    }
    flush();
    return "'" + out + "'";
  },
  /** Вещественное число STEP: всегда с точкой, малые — в экспоненте «1.E-05» */
  num(v) {
    if (!Number.isFinite(v)) v = 0;
    if (v !== 0 && Math.abs(v) < 1e-3) { const [m, e] = v.toExponential(6).split('e'); return (m.includes('.') ? m.replace(/0+$/, '') : m + '.') + 'E' + e; }
    const r = Math.round(v * 1e6) / 1e6;
    const s = String(r);
    if (/e/i.test(s)) { const [m, e] = s.split(/e/i); return (m.includes('.') ? m : m + '.') + 'E' + e; }
    return s.includes('.') ? s : s + '.';
  },

  build() {
    const lines = [];
    let id = 0;
    const R = (n) => ({ ref: n });
    const E = (e) => ({ e });            // перечисление .X.
    const I = (i) => ({ i });            // целое
    const RAW = (s) => ({ raw: s });
    const fmt = (v) => {
      if (v === null || v === undefined) return '$';
      if (v === '*') return '*';
      if (typeof v === 'boolean') return v ? '.T.' : '.F.';
      if (typeof v === 'number') return IFC.num(v);
      if (typeof v === 'string') return IFC.str(v);
      if (Array.isArray(v)) return '(' + v.map(fmt).join(',') + ')';
      if (v.ref) return '#' + v.ref;
      if (v.e) return '.' + v.e + '.';
      if (v.i !== undefined) return String(Math.round(v.i));
      if (v.raw) return v.raw;
      return '$';
    };
    const add = (type, ...args) => { id++; lines.push(`#${id}=${type}(${args.map(fmt).join(',')});`); return R(id); };

    const d = App.doc;
    const X = (p) => p.x * 10, Y = (p) => -p.y * 10;       // план (см, y вниз) → мм, y вверх
    const now = Math.floor(Date.now() / 1000);
    // --- владелец, приложение, единицы ---
    const person = add('IFCPERSON', null, null, 'Floorplaner', null, null, null, null, null);
    const org = add('IFCORGANIZATION', null, 'Floorplaner', null, null, null);
    const po = add('IFCPERSONANDORGANIZATION', person, org, null);
    const app = add('IFCAPPLICATION', org, '1.0', 'Floorplaner', 'Floorplaner');
    const oh = add('IFCOWNERHISTORY', po, app, null, E('ADDED'), null, null, null, I(now));
    const units = add('IFCUNITASSIGNMENT', [
      add('IFCSIUNIT', '*', E('LENGTHUNIT'), E('MILLI'), E('METRE')),
      add('IFCSIUNIT', '*', E('AREAUNIT'), null, E('SQUARE_METRE')),
      add('IFCSIUNIT', '*', E('VOLUMEUNIT'), null, E('CUBIC_METRE')),
      add('IFCSIUNIT', '*', E('PLANEANGLEUNIT'), null, E('RADIAN')),
    ]);
    // --- геометрия: общие элементы ---
    const P3 = (x, y, z) => add('IFCCARTESIANPOINT', [x, y, z]);
    const P2 = (x, y) => add('IFCCARTESIANPOINT', [x, y]);
    const D3 = (x, y, z) => add('IFCDIRECTION', [x, y, z]);
    const origin = P3(0, 0, 0), dz = D3(0, 0, 1), dx = D3(1, 0, 0);
    const A3 = (x = 0, y = 0, z = 0, xdir) => add('IFCAXIS2PLACEMENT3D', (x || y || z) ? P3(x, y, z) : origin, xdir ? dz : null, xdir || null);
    const wcs = add('IFCAXIS2PLACEMENT3D', origin, dz, dx);
    const na = U.rad(d.north);
    const ctx = add('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', I(3), 1e-5, wcs, add('IFCDIRECTION', [Math.sin(na), Math.cos(na)]));
    const body = add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'Body', 'Model', '*', '*', '*', '*', ctx, null, E('MODEL_VIEW'), null);
    const axisCtx = add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'Axis', 'Model', '*', '*', '*', '*', ctx, null, E('GRAPH_VIEW'), null);
    const fpCtx = add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'FootPrint', 'Model', '*', '*', '*', '*', ctx, null, E('PLAN_VIEW'), null);
    const project = add('IFCPROJECT', IFC.guid(), oh, d.name || 'Проект', 'Floorplaner', null, null, null, [ctx], units);
    const LP = (rel, axis) => add('IFCLOCALPLACEMENT', rel, axis);
    const shape = (reps) => add('IFCPRODUCTDEFINITIONSHAPE', null, null, reps);
    const bodyRep = (type, items) => add('IFCSHAPEREPRESENTATION', body, 'Body', type, items);
    const extrudeRect = (cx, cy, w, h, depth, z0 = 0) =>
      add('IFCEXTRUDEDAREASOLID', add('IFCRECTANGLEPROFILEDEF', E('AREA'), null, add('IFCAXIS2PLACEMENT2D', P2(cx, cy), null), Math.max(1, w), Math.max(1, h)), A3(0, 0, z0), dz, Math.max(1, depth));
    const extrudePoly = (pts2, depth, z0 = 0) => {
      const ps = pts2.map(p => P2(p[0], p[1]));
      ps.push(ps[0]);
      return add('IFCEXTRUDEDAREASOLID', add('IFCARBITRARYCLOSEDPROFILEDEF', E('AREA'), null, add('IFCPOLYLINE', ps)), A3(0, 0, z0), dz, Math.max(1, depth));
    };
    const rel = { site: [], storey: new Map() };
    const contain = (fid, el) => { if (fid === 'site') rel.site.push(el); else { if (!rel.storey.has(fid)) rel.storey.set(fid, []); rel.storey.get(fid).push(el); } };
    const psets = [];
    const pset = (el, name, props) => psets.push({ el, name, props });
    const LABEL = (s) => RAW(`IFCLABEL(${IFC.str(s)})`), BOOL = (b) => RAW(`IFCBOOLEAN(${b ? '.T.' : '.F.'})`), LEN = (v) => RAW(`IFCLENGTHMEASURE(${IFC.num(v)})`), REAL = (v) => RAW(`IFCREAL(${IFC.num(v)})`), AREA = (v) => RAW(`IFCAREAMEASURE(${IFC.num(v)})`);

    // --- участок, здание, этажи ---
    const g = d.geo;
    const dms = (v) => { const s = v < 0 ? -1 : 1; v = Math.abs(v); const dd = Math.floor(v), mm = Math.floor((v - dd) * 60), ss = Math.floor(((v - dd) * 60 - mm) * 60); return [I(s * dd), I(s * mm), I(s * ss)]; };
    const sitePl = LP(null, A3());
    const plot = d.areas.find(a => a.kind === 'plot');
    const siteRep = plot ? shape([add('IFCSHAPEREPRESENTATION', fpCtx, 'FootPrint', 'Curve2D', [add('IFCPOLYLINE', plot.pts.concat([plot.pts[0]]).map(p => P2(X(p), Y(p))))])]) : null;
    const site = add('IFCSITE', IFC.guid(), oh, 'Участок', plot ? `Площадь ${(Math.abs(G.polyArea(plot.pts)) / 1e6).toFixed(2)} сот.` : null, null, sitePl, siteRep, g.city || null, E('ELEMENT'), dms(g.lat), dms(g.lon), 0, null, null);
    const bldPl = LP(sitePl, A3());
    const building = add('IFCBUILDING', IFC.guid(), oh, 'Дом', null, null, bldPl, null, null, E('ELEMENT'), null, null, null);
    add('IFCRELAGGREGATES', IFC.guid(), oh, null, null, project, [site]);
    add('IFCRELAGGREGATES', IFC.guid(), oh, null, null, site, [building]);
    const storeys = new Map();
    for (const f of d.floors) {
      const pl = LP(bldPl, A3(0, 0, f.elev * 10));
      const st = add('IFCBUILDINGSTOREY', IFC.guid(), oh, f.name, null, null, pl, null, null, E('ELEMENT'), f.elev * 10);
      storeys.set(f.id, { st, pl, f });
    }
    add('IFCRELAGGREGATES', IFC.guid(), oh, null, null, building, [...storeys.values()].map(s => s.st));

    const matGroups = new Map();       // слои материалов стен
    const spacesBy = new Map();
    const fdAll = App.floorData || [];
    for (const f of d.floors) Drawing.onFloor(f.id, () => {
      const S = storeys.get(f.id);
      const fd = fdAll.find(x => x.floor.id === f.id);
      // ---- стены ----
      for (const w of App.V.walls) {
        const L = Model.wallLen(w) * 10;
        if (L < 1) continue;
        const a = { x: X(w.a), y: Y(w.a) }, b = { x: X(w.b), y: Y(w.b) };
        const u = G.unit(G.sub(b, a));
        const th = w.th * 10;
        // удлинение на полтолщины в узлах — без щелей в углах
        const ext = (end) => Model.wallEndsAt(w[end], new Set([w.id]), 1.2).filter(r => r.w.kind !== 'fence').length ? Math.max(...Model.wallEndsAt(w[end], new Set([w.id]), 1.2).map(r => r.w.th)) * 5 : 0;
        const eA = w.kind === 'fence' ? 0 : ext('a'), eB = w.kind === 'fence' ? 0 : ext('b');
        const pl = LP(S.pl, A3(a.x, a.y, 0, add('IFCDIRECTION', [u.x, u.y, 0])));
        const axis = add('IFCSHAPEREPRESENTATION', axisCtx, 'Axis', 'Curve2D', [add('IFCPOLYLINE', [P2(0, 0), P2(L, 0)])]);
        const solid = extrudeRect((L + eB - eA) / 2, 0, L + eA + eB, th, w.h * 10);
        const M = wallMaterial(w);
        const kindName = WALL_KINDS[w.kind].name;
        const el = w.kind === 'fence'
          ? add('IFCBUILDINGELEMENTPROXY', IFC.guid(), oh, 'Забор', M ? M.name : null, 'Забор', pl, shape([bodyRep('SweptSolid', [solid])]), w.id, null)
          : add('IFCWALLSTANDARDCASE', IFC.guid(), oh, `Стена: ${kindName.toLowerCase()}`, M ? M.name : null, kindName, pl, shape([axis, bodyRep('SweptSolid', [solid])]), w.id);
        contain(f.id, el);
        if (w.kind !== 'fence') {
          // многослойный материал: несущий слой + утеплитель снаружи
          const ins = Math.max(0, Math.min(w.ins || 0, w.th));
          let outSide = 1;
          if (ins > 0) { const n = G.perp(Model.wallDir(w)), m = G.mid(w.a, w.b); outSide = Rooms.at(G.add(m, G.mul(n, w.th / 2 + 15))) && !Rooms.at(G.sub(m, G.mul(n, w.th / 2 + 15))) ? -1 : 1; }
          const key = `${w.mat}|${w.th}|${ins}|${outSide}`;
          if (!matGroups.has(key)) matGroups.set(key, { w, ins, outSide, walls: [] });
          matGroups.get(key).walls.push(el);
          const R0 = wallR(w);
          pset(el, 'Pset_WallCommon', [['IsExternal', BOOL(w.kind === 'ext')], ['LoadBearing', BOOL(w.kind !== 'part')], ['Reference', LABEL(kindName)]]);
          pset(el, 'FP_Wall', [['Material', LABEL(M ? M.name : w.mat)], ['Thickness', LEN(th)], ['Insulation', LEN(ins * 10)], ...(R0 && w.kind === 'ext' ? [['R_value_m2K_W', REAL(R0)]] : [])]);
        }
        // ---- проёмы, двери, окна ----
        for (const op of App.V.openings) {
          if (op.wall !== w.id) continue;
          const og = Model.opGeom(op); if (!og) continue;
          const T = OPENING_TYPES[op.type];
          const win = T.cat === 'window';
          const sill = win ? (op.sill || 0) * 10 : 0;
          const oh2 = Math.min((op.h || 200) * 10, w.h * 10 - sill);
          const ow = og.width * 10;
          const x0 = (og.pos - og.width / 2) * 10;
          const opl = LP(pl, A3(x0, 0, sill));
          const opening = add('IFCOPENINGELEMENT', IFC.guid(), oh, 'Проём', null, 'Opening', opl, shape([bodyRep('SweptSolid', [extrudeRect(ow / 2, 0, ow, th + 20, oh2)])]), null);
          add('IFCRELVOIDSELEMENT', IFC.guid(), oh, null, null, el, opening);
          if (op.type === 'arch') continue;
          const fpl = LP(opl, A3());
          const frame = extrudeRect(ow / 2, 0, ow, win ? 70 : 45, oh2);
          const fill = win
            ? add('IFCWINDOW', IFC.guid(), oh, T.name, `${op.w}×${op.h} см, подоконник ${op.sill || 0} см`, T.name, fpl, shape([bodyRep('SweptSolid', [frame])]), op.id, oh2, ow)
            : add('IFCDOOR', IFC.guid(), oh, T.name, `${op.w}×${op.h} см`, T.name, fpl, shape([bodyRep('SweptSolid', [frame])]), op.id, oh2, ow);
          add('IFCRELFILLSELEMENT', IFC.guid(), oh, null, null, opening, fill);
          contain(f.id, fill);
          if (win) pset(fill, 'Pset_WindowCommon', [['Reference', LABEL(T.name)], ['IsExternal', BOOL(w.kind === 'ext')]]);
          else pset(fill, 'Pset_DoorCommon', [['Reference', LABEL(T.name)], ['IsExternal', BOOL(w.kind === 'ext')], ['HandicapAccessible', BOOL(op.w >= 90)]]);
        }
      }
      // ---- перекрытия и помещения ----
      if (fd) {
        const first = f === d.floors[0];
        for (const o of fd.outlines) {
          const t = first ? 200 : 250;
          const slab = add('IFCSLAB', IFC.guid(), oh, first ? 'Плита пола' : 'Перекрытие', null, null, LP(S.pl, A3()),
            shape([bodyRep('SweptSolid', [extrudePoly(o.outer.map(p => [X(p), Y(p)]), t, -t)])]), null, E(first ? 'BASESLAB' : 'FLOOR'));
          contain(f.id, slab);
        }
        const spaces = [];
        const hh = Math.max(200, ...App.V.walls.filter(w => w.kind !== 'fence').map(w => w.h)) * 10;
        fd.rooms.forEach((r, i) => {
          const sp = add('IFCSPACE', IFC.guid(), oh, `${Model.floorIdx(f.id) + 1}.${i + 1}`, null, null, LP(S.pl, A3()),
            shape([bodyRep('SweptSolid', [extrudePoly(r.floor.map(p => [X(p), Y(p)]), hh)])]), r.name, E('ELEMENT'), E('INTERNAL'), null);
          spaces.push(sp);
          const q = add('IFCELEMENTQUANTITY', IFC.guid(), oh, 'BaseQuantities', null, null, [
            add('IFCQUANTITYAREA', 'NetFloorArea', null, null, r.areaFloor / 1e4),
            add('IFCQUANTITYAREA', 'GrossFloorArea', null, null, r.areaAxis / 1e4),
            add('IFCQUANTITYLENGTH', 'NetPerimeter', null, null, r.perimFloor * 10),
            add('IFCQUANTITYLENGTH', 'Height', null, null, hh),
          ]);
          add('IFCRELDEFINESBYPROPERTIES', IFC.guid(), oh, null, null, [sp], q);
          pset(sp, 'Pset_SpaceCommon', [['Reference', LABEL(r.name)], ['IsExternal', BOOL(false)], ['GrossPlannedArea', AREA(r.areaFloor / 1e4)]]);
          pset(sp, 'FP_Space', [['Living', BOOL(!!(r.tag && r.tag.living))]]);
        });
        if (spaces.length) spacesBy.set(f.id, spaces);
      }
      // ---- предметы ----
      for (const it of App.V.items) {
        const def = catItem(it.key);
        if (!(it.h > 0) && !['pool', 'deck', 'parking', 'veranda'].includes(def.shape)) continue;
        const siteObj = f === d.floors[0] && ['buildings', 'green', 'water', 'gas'].includes(def.cat) && def.layer !== 'plumbing' || ['siteobj'].includes(def.layer) || ['pole', 'lightpole'].includes(def.shape);
        const base = siteObj ? sitePl : S.pl;
        const ang = U.rad(it.rot || 0);
        const xdir = add('IFCDIRECTION', [Math.cos(-ang), Math.sin(-ang), 0]);
        const z = siteObj ? f.elev * 10 : (def.shape === 'upper' ? 1400 : 0);
        const pl = LP(base, A3(X(it), Y(it), z, xdir));
        const size = def.sym ? Tools.itemDrawSize(it) : it;
        const h = Math.max(10, ((def.shape === 'veranda' ? Math.max(it.h || 0, porchOpt(it).ph) : it.h) || 2) * 10);
        const round = ['round', 'boiler', 'ring', 'well', 'borehole', 'roundtable', 'columnRound', 'tree', 'conifer', 'bush', 'pump'].includes(def.shape);
        const solid = round
          ? add('IFCEXTRUDEDAREASOLID', add('IFCCIRCLEPROFILEDEF', E('AREA'), null, add('IFCAXIS2PLACEMENT2D', P2(0, 0), null), Math.min(size.w, size.d) * 5), A3(), dz, h)
          : extrudeRect(0, 0, size.w * 10, size.d * 10, h);
        const rep = shape([bodyRep('SweptSolid', [solid])]);
        const name = it.label || def.name;
        const descr = `${Math.round(it.w)}×${Math.round(it.d)}×${Math.round(it.h)} см`;
        let el;
        if (def.shape === 'stairs' || def.shape === 'stairsL') el = add('IFCSTAIR', IFC.guid(), oh, name, descr, def.name, pl, rep, it.id, E(def.shape === 'stairs' ? 'STRAIGHT_RUN_STAIR' : 'QUARTER_TURN_STAIR'));
        else if (def.shape === 'column' || def.shape === 'columnRound') el = add('IFCCOLUMN', IFC.guid(), oh, name, descr, def.name, pl, rep, it.id);
        else if (siteObj) el = add('IFCBUILDINGELEMENTPROXY', IFC.guid(), oh, name, descr, def.name, pl, rep, it.id, null);
        else if (['plumbing', 'heating', 'electric', 'gas'].includes(def.layer)) el = add('IFCFLOWTERMINAL', IFC.guid(), oh, name, descr, def.name, pl, rep, it.id);
        else el = add('IFCFURNISHINGELEMENT', IFC.guid(), oh, name, descr, def.name, pl, rep, it.id);
        contain(siteObj ? 'site' : f.id, el);
        if (it.note) pset(el, 'FP_Note', [['Note', LABEL(it.note)]]);
      }
      // ---- инженерные трассы (трубы/кабели по оси) ----
      for (const l of App.V.lines) {
        const k = LINE_KINDS[l.kind];
        const depth = (l.depth || 0) * 10;
        const zc = f === d.floors[0] && depth > 0 ? -depth : 300;
        const dir = add('IFCPOLYLINE', l.pts.map(p => P3(X(p), Y(p), zc)));
        const rad = Math.max(8, (l.dia || 20) / 2);
        const solid = add('IFCSWEPTDISKSOLID', dir, rad, null, 0, l.pts.length - 1);
        const el = add('IFCFLOWSEGMENT', IFC.guid(), oh, k.name, `${k.code}${l.dia ? ', Ø' + l.dia + ' мм' : ''}${l.section ? ', ' + l.section : ''}`, k.code, LP(zc < 0 ? sitePl : S.pl, A3()), shape([bodyRep('AdvancedSweptSolid', [solid])]), l.id);
        contain(zc < 0 ? 'site' : f.id, el);
        pset(el, 'FP_Network', [['System', LABEL(k.name)], ['Code', LABEL(k.code)], ['Length', LEN(G.polyPerimeter(l.pts, false) * 10)], ['Depth', LEN(depth)]]);
      }
    });
    // ---- крыши ----
    for (const r of d.roofs) {
      const S = storeys.get(r.floor) || [...storeys.values()].pop();
      const faces = Roof.faces(r).map(fc => add('IFCFACE', [add('IFCFACEOUTERBOUND', add('IFCPOLYLOOP', fc.map(p => P3(X(p), Y(p), (p.z - S.f.elev) * 10))), true)]));
      const rep = shape([bodyRep('SurfaceModel', [add('IFCSHELLBASEDSURFACEMODEL', [add('IFCOPENSHELL', faces)])])]);
      const P = Roof.params(r);
      const el = add('IFCROOF', IFC.guid(), oh, 'Крыша', `${ROOF_TYPES[r.type].name}, ${Math.round(r.pitch)}°, ${(ROOF_MATERIALS[r.mat] || {}).name || ''}`, ROOF_TYPES[r.type].name, LP(S.pl, A3()), rep, r.id,
        E({ gable: 'GABLE_ROOF', hip: 'HIP_ROOF', shed: 'SHED_ROOF', flat: 'FLAT_ROOF' }[r.type]));
      contain(S.f.id, el);
      pset(el, 'Pset_RoofCommon', [['Reference', LABEL(ROOF_TYPES[r.type].name)], ['TotalArea', AREA(P.area / 1e4)], ['ProjectedArea', AREA(r.w * r.d / 1e4)]]);
      pset(el, 'FP_Roof', [['Pitch_deg', REAL(r.pitch)], ['RidgeHeight', LEN(P.top * 10)], ['Covering', LABEL((ROOF_MATERIALS[r.mat] || {}).name || r.mat)]]);
    }
    // ---- связи ----
    for (const [fid, els] of rel.storey) if (els.length) add('IFCRELCONTAINEDINSPATIALSTRUCTURE', IFC.guid(), oh, null, null, els, storeys.get(fid).st);
    if (rel.site.length) add('IFCRELCONTAINEDINSPATIALSTRUCTURE', IFC.guid(), oh, null, null, rel.site, site);
    for (const [fid, sps] of spacesBy) add('IFCRELAGGREGATES', IFC.guid(), oh, null, null, storeys.get(fid).st, sps);
    for (const { w, ins, outSide, walls } of matGroups.values()) {
      const M = WALL_MATERIALS[w.mat];
      const core = add('IFCMATERIALLAYER', add('IFCMATERIAL', M ? M.name : w.mat), (w.th - ins) * 10, null);
      const layers = [core];
      if (ins > 0) {
        const insL = add('IFCMATERIALLAYER', add('IFCMATERIAL', 'Утеплитель (минеральная вата)'), ins * 10, null);
        // локальная ось Y стены смотрит в сторону −n плана: снаружи (+n) — первый слой
        if (outSide > 0) layers.unshift(insL); else layers.push(insL);
      }
      const set = add('IFCMATERIALLAYERSET', layers, `${M ? M.name : w.mat} ${w.th} см`);
      const usage = add('IFCMATERIALLAYERSETUSAGE', set, E('AXIS2'), E('POSITIVE'), -w.th * 5);
      add('IFCRELASSOCIATESMATERIAL', IFC.guid(), oh, null, null, walls, usage);
    }
    for (const { el, name, props } of psets) {
      const ps = add('IFCPROPERTYSET', IFC.guid(), oh, name, null, props.map(([n, v]) => add('IFCPROPERTYSINGLEVALUE', n, null, v, null)));
      add('IFCRELDEFINESBYPROPERTIES', IFC.guid(), oh, null, null, [el], ps);
    }
    const file = IFC.fileName();
    const ts = new Date().toISOString().slice(0, 19);
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');",
      `FILE_NAME(${IFC.str(file)},'${ts}',(''),(''),'Floorplaner','Floorplaner','');`,
      "FILE_SCHEMA(('IFC2X3'));",
      'ENDSEC;',
      'DATA;',
      ...lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  },
  fileName() { return IO.fileName('ifc'); },
  export() {
    try {
      const txt = IFC.build();
      U.download(IFC.fileName(), txt, 'application/x-step');
      UI.toast('IFC 2x3 сохранён — откройте в Revit, ArchiCAD, Renga, nanoCAD BIM или BIM-просмотрщике');
    } catch (e) {
      console.error(e);
      UI.toast('Не удалось сформировать IFC: ' + e.message, 'err');
    }
  },
};
