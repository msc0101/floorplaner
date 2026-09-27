'use strict';
/* ==========================================================================
   3D-вид на WebGL (без библиотек): стены с проёмами, перекрытия, крыши,
   мебель и постройки, участок. Освещение — по положению солнца.
   Оси: X — план x, Z — план y, Y — высота; единицы — метры.
   ========================================================================== */

const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
    return o;
  },
  persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
};

/** Триангуляция простого многоугольника (ear clipping), возвращает индексы */
function earcut2(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (G.polyArea(pts) < 0) idx.reverse();
  const out = [];
  const inTri = (p, a, b, c) => {
    const d1 = G.cross(G.sub(b, a), G.sub(p, a)), d2 = G.cross(G.sub(c, b), G.sub(p, b)), d3 = G.cross(G.sub(a, c), G.sub(p, c));
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (G.cross(G.sub(b, a), G.sub(c, b)) <= 1e-9) continue;          // вогнутая вершина
      let ok = true;
      for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inTri(pts[j], a, b, c)) { ok = false; break; }
      if (!ok) continue;
      out.push(i0, i1, i2); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);   // запасной веер
  return out;
}

const View3D = {
  active: false, gl: null, canvas: null, prog: null, dirty: true,
  mesh: null, glass: null,
  cam: { yaw: -0.75, pitch: 0.5, dist: 40, tx: 0, ty: 1, tz: 0 },
  opts: { upper: true, roof: true, items: true, site: true, sun: true, shadows: true },

  hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    if (!m) return [0.7, 0.7, 0.7];
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  },
  /** Детерминированный «шум» 0..1 по координатам — для вариаций цвета */
  noise(x, y) { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); },

  /* ------------------------------ построение ------------------------------ */
  build() {
    const P = [], N = [], Cc = [], GP = [], GN = [], GC = [];
    const tri = (a, b, c, col, n, glass) => {
      const [pp, nn, cc] = glass ? [GP, GN, GC] : [P, N, Cc];
      for (const v of [a, b, c]) { pp.push(v[0], v[1], v[2]); nn.push(n[0], n[1], n[2]); cc.push(col[0], col[1], col[2]); }
    };
    const normal = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    /** Плоский выпуклый полигон 3D; нормаль ориентируется «наружу» от точки ref */
    const face = (vs, col, ref, glass) => {
      if (vs.length < 3) return;
      let n = normal(vs[0], vs[1], vs[2]);
      if (!Number.isFinite(n[0]) || Math.hypot(...n) < 0.5) return;
      if (ref) {
        const c = vs.reduce((s, v) => [s[0] + v[0] / vs.length, s[1] + v[1] / vs.length, s[2] + v[2] / vs.length], [0, 0, 0]);
        if ((c[0] - ref[0]) * n[0] + (c[1] - ref[1]) * n[1] + (c[2] - ref[2]) * n[2] < 0) n = n.map(x => -x);
      }
      for (let i = 1; i + 1 < vs.length; i++) tri(vs[0], vs[i], vs[i + 1], col, n, glass);
    };
    const V3 = (p, z) => [p.x / 100, z / 100, p.y / 100];
    /** Призма: многоугольник плана pts (см) от z0 до z1 (см) */
    const prism = (pts, z0, z1, col, opt = {}) => {
      if (z1 - z0 < 0.01 || pts.length < 3) return;
      const c2 = G.polyCentroid(pts);
      const ref = [c2.x / 100, (z0 + z1) / 200, c2.y / 100];
      const top = col.map(x => Math.min(1, x * (opt.topK ?? 1)));
      const ids = earcut2(pts);
      // верх с вырезами (открытые ямы): треугольник у выреза дробим до ~8 см и выкидываем части внутри
      const holes = opt.holes && opt.holes.length ? opt.holes : null;
      const topTri = (a, b, c) => {
        if (holes) {
          const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
          const hs = holes.filter(h => !(h.bb.x1 < x0 || h.bb.x0 > x1 || h.bb.y1 < y0 || h.bb.y0 > y1));
          if (hs.length) {
            const m = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
            if (Math.max(x1 - x0, y1 - y0) < 8) { if (hs.some(h => G.pointInPoly(m, h.poly))) return; }
            else {
              const ab = G.mid(a, b), bc = G.mid(b, c), ca = G.mid(c, a);
              topTri(a, ab, ca); topTri(ab, b, bc); topTri(ca, bc, c); topTri(ab, bc, ca);
              return;
            }
          }
        }
        tri(V3(a, z1), V3(b, z1), V3(c, z1), top, [0, 1, 0], opt.glass);
      };
      for (let i = 0; i < ids.length; i += 3) {
        const a = pts[ids[i]], b = pts[ids[i + 1]], c = pts[ids[i + 2]];
        if (!opt.noTop) topTri(a, b, c);
        if (opt.bottom) tri(V3(a, z0), V3(c, z0), V3(b, z0), col, [0, -1, 0], opt.glass);
      }
      if (opt.noSides) return;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (G.dist(a, b) < 0.01) continue;
        face([V3(a, z0), V3(b, z0), V3(b, z1), V3(a, z1)], col, ref, opt.glass);
      }
    };
    /** Призма с переменным верхом: высота верха в каждой вершине — ztop(p) (для стен под скатом крыши) */
    const prismTop = (pts, z0, ztop, col, skipEdge) => {
      const zs = pts.map(ztop);
      if (zs.every(z => z - z0 < 0.01)) return;
      const ids = earcut2(pts);
      const top = col.map(x => Math.min(1, x * 0.85));
      for (let i = 0; i < ids.length; i += 3) {
        const [a, b, c] = [ids[i], ids[i + 1], ids[i + 2]];
        const va = V3(pts[a], zs[a]), vb = V3(pts[b], zs[b]), vc = V3(pts[c], zs[c]);
        const u1 = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]], u2 = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]];
        let nn = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
        const l = Math.hypot(...nn) || 1; nn = nn.map(x => x / l); if (nn[1] < 0) nn = nn.map(x => -x);
        tri(va, vb, vc, top, nn);
      }
      const c2 = G.polyCentroid(pts), ref = [c2.x / 100, z0 / 100, c2.y / 100];
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        if (G.dist(pts[i], pts[j]) < 0.01 || (skipEdge && skipEdge(pts[i], pts[j]))) continue;
        face([V3(pts[i], z0), V3(pts[j], z0), V3(pts[j], zs[j]), V3(pts[i], zs[i])], col, ref);
      }
    };
    /** Прямоугольный блок: центр (x,y), размеры w×d, поворот rot°, высоты z0..z1 */
    const box = (x, y, w, d, rot, z0, z1, col, opt) => prism(G.rectPts(x, y, w, d, rot || 0), z0, z1, col, opt);
    const ring = (cx, cy, rx, ry, n = 12, rot = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return G.toWorld({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }, cx, cy, rot); });
    const cyl = (cx, cy, r, z0, z1, col, n = 12) => prism(ring(cx, cy, r, r, n), z0, z1, col);
    /** Конус / усечённый конус */
    const cone = (cx, cy, r0, r1, z0, z1, col, n = 12) => {
      const ref = [cx / 100, (z0 + z1) / 200, cy / 100];
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
        const p = (a, r, z) => [(cx + Math.cos(a) * r) / 100, z / 100, (cy + Math.sin(a) * r) / 100];
        if (r1 > 0.1) face([p(a0, r0, z0), p(a1, r0, z0), p(a1, r1, z1), p(a0, r1, z1)], col, ref);
        else face([p(a0, r0, z0), p(a1, r0, z0), p(a0, 0, z1)], col, ref);
      }
      if (r1 > 0.1) prism(ring(cx, cy, r1, r1, n), z1 - 0.01, z1, col, { noSides: true });
    };
    /** Эллипсоид (низкополигональный) — кроны деревьев, кусты */
    const blob = (cx, cy, cz, rx, rz, col, seed = 0) => {
      const st = 6, sl = 10;
      const pt = (i, j) => {
        const th = i / st * Math.PI, ph = j / sl * Math.PI * 2;
        const k = 1 + (View3D.noise(cx + i * 3 + seed, cy + j * 7) - 0.5) * 0.18;
        return [(cx + Math.sin(th) * Math.cos(ph) * rx * k) / 100, (cz + Math.cos(th) * rz * k) / 100, (cy + Math.sin(th) * Math.sin(ph) * rx * k) / 100];
      };
      const ref = [cx / 100, cz / 100, cy / 100];
      for (let i = 0; i < st; i++) for (let j = 0; j < sl; j++) {
        const shade = 0.88 + View3D.noise(cx + i, cy + j + seed) * 0.2;
        const cl = col.map(x => Math.min(1, x * shade));
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), dd = pt(i, j + 1);
        if (i === 0) face([a, b, c], cl, ref); else if (i === st - 1) face([a, b, dd], cl, ref); else face([a, b, c, dd], cl, ref);
      }
    };
    /** Трубка-провод между точками 3D (см) */
    const wire = (a, b, r, col) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
      if (L < 1) return;
      const u = [dx / L, dy / L, dz / L];
      const t = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let v = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
      const vl = Math.hypot(...v); v = v.map(x => x / vl);
      const w2 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = 6;
      const P3 = (base, i) => { const a2 = i / n * Math.PI * 2; return [(base[0] + (v[0] * Math.cos(a2) + w2[0] * Math.sin(a2)) * r) / 100, (base[2] + (v[2] * Math.cos(a2) + w2[2] * Math.sin(a2)) * r) / 100, (base[1] + (v[1] * Math.cos(a2) + w2[1] * Math.sin(a2)) * r) / 100]; };
      const mid = [(a[0] + b[0]) / 200, (a[2] + b[2]) / 200, (a[1] + b[1]) / 200];
      for (let i = 0; i < n; i++) face([P3(a, i), P3(a, i + 1), P3(b, i + 1), P3(b, i)], col, mid);
    };
    View3D._g = { face, prism, box, cyl, cone, blob, ring, wire, tri, V3 };
    const d = App.doc, active = Model.floorIdx(App.floor);
    const floors = d.floors.filter((f, i) => i <= active || View3D.opts.upper);
    const bb = Model.contentBBox() || { x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
    View3D.bounds = bb;
    // ---------------- участок ----------------
    if (View3D.opts.site) {
      // газон — сетка с лёгкой вариацией цвета
      const pad = 3000, step = 250;
      const gx0 = Math.floor((bb.x0 - pad) / step) * step, gy0 = Math.floor((bb.y0 - pad) / step) * step;
      const gx1 = bb.x1 + pad, gy1 = bb.y1 + pad;
      const grass = View3D.hex('#8fb56d');
      // цвет задаётся в вершинах и плавно интерполируется — без «шахматки»
      const gcol = (x, y) => { const k = 0.95 + View3D.noise(Math.round(x / step) * 0.37, Math.round(y / step) * 0.53) * 0.08; return grass.map(c => c * k); };
      const gv = (x, y) => { const v = V3({ x, y }, 0), c = gcol(x, y); P.push(...v); N.push(0, 1, 0); Cc.push(...c); };
      // открытые ямы на участке — вырез в газоне (клетки у ямы дробятся на 10 см), покрытиях и полу построек
      const holes = View3D.pitHoles();
      const quad = (x, y, s) => { gv(x, y); gv(x + s, y); gv(x + s, y + s); gv(x, y); gv(x + s, y + s); gv(x, y + s); };
      for (let x = gx0; x < gx1; x += step) for (let y = gy0; y < gy1; y += step) {
        const hs = holes.filter(h => !(h.bb.x1 < x || h.bb.x0 > x + step || h.bb.y1 < y || h.bb.y0 > y + step));
        if (!hs.length) { quad(x, y, step); continue; }
        const sub = 10;
        for (let sx = x; sx < x + step; sx += sub) for (let sy = y; sy < y + step; sy += sub) {
          const c = { x: sx + sub / 2, y: sy + sub / 2 };
          if (!hs.some(h => G.pointInPoly(c, h.poly))) quad(sx, sy, sub);
        }
      }
      for (const a of d.areas) {
        const colr = { plot: '#a9cc8a', lawn: '#86c25f', garden: '#8a6a45', paving: '#b8b8bc', road: '#8e9096', water: '#4f93d6', flower: '#d99bb8', zone: '#b8c0e6', protect: '#e5b1b1', asphalt: '#4d5057', concrete: '#b9b8b2', gravel: '#b7ab93' }[a.kind] || '#a9cc8a';
        // покрытия — вровень с землёй, без бордюров
        const hgt = { plot: 0.6, garden: 6, paving: 3, road: 2, water: 1.5, asphalt: 2, concrete: 3, gravel: 2.5 }[a.kind] ?? 1.5;
        prism(a.pts, 0, hgt, View3D.hex(colr), { noSides: a.kind === 'plot' || a.kind === 'lawn', holes });
      }
      for (const r of d.roads) {
        const k = ROAD_KINDS[r.kind];
        const z = r.kind === 'path' || r.kind === 'sidewalk' ? 4 : 2.5;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b2 = r.pts[i + 1], u = G.unit(G.sub(b2, a)), n = G.perp(u);
          const hw = r.width / 2;
          prism([G.add(a, G.mul(n, hw)), G.add(b2, G.mul(n, hw)), G.sub(b2, G.mul(n, hw)), G.sub(a, G.mul(n, hw))], 0, z, View3D.hex(k.fill), { holes });
          if (roadCurb(r)) {
            // бордюры
            for (const s2 of [1, -1]) prism([G.add(a, G.mul(n, s2 * hw)), G.add(b2, G.mul(n, s2 * hw)), G.add(b2, G.mul(n, s2 * (hw - 15))), G.add(a, G.mul(n, s2 * (hw - 15)))], z, z + 12, View3D.hex('#c9c9c9'));
          }
          if (k.center) {
            // разметка
            const L = G.dist(a, b2);
            for (let s2 = 150; s2 + 300 < L; s2 += 600) {
              const p0 = G.add(a, G.mul(u, s2)), p1 = G.add(a, G.mul(u, s2 + 300));
              prism([G.add(p0, G.mul(n, 6)), G.add(p1, G.mul(n, 6)), G.sub(p1, G.mul(n, 6)), G.sub(p0, G.mul(n, 6))], z, z + 0.4, [0.97, 0.97, 0.95], { noSides: true });
            }
          }
        }
      }
    }
    // ---------------- этажи ----------------
    for (const f of floors) Drawing.onFloor(f.id, () => {
      const e = f.elev, first = f === d.floors[0];
      const fd = (App.floorData || []).find(x => x.floor.id === f.id);
      if (fd) {
        for (const o of fd.outlines) prism(o.outer, e - (first ? 0 : 25), e + 2, View3D.hex(first ? '#b9b4ab' : '#d8d2c6'), { noSides: first });
        // отмостка вокруг дома и построек
        if (first) for (const b of Model.blindAreas()) for (const q of b.quads) prism(q, e, e + 6, View3D.hex('#bdbab2'));
        for (const r of fd.rooms) {
          const nm = (r.name || '').toLowerCase();
          const tile = /сануз|ванн|туалет|котел|котёл|душ/.test(nm), kitchen = /кухн|прихож|холл|коридор/.test(nm);
          prism(r.floor, e + 2, e + 3, View3D.hex(tile ? '#d9dde0' : kitchen ? '#cfc2ad' : '#c8a47a'), { noSides: true });
        }
      }
      const cache = Render.endCache(), f1id = d.floors[0].id;
      for (const w of App.V.walls) {
        const top = e + w.h;
        if (w.kind === 'fence') { View3D.fence(w, e, top); continue; }
        const M = WALL_MATERIALS[w.mat];
        const col = View3D.hex(M ? M.color : '#dddddd').map(x => x * 0.95);
        const plinthH = first && w.kind === 'ext' ? 45 : 0;
        const plinth = View3D.hex('#8a857d');
        // крыши этого этажа: верх стены не выше ската (стены мансарды не протыкают кровлю)
        const wRoofs = d.roofs.filter(r => (r.floor || f1id) === (w.floor || f1id));
        const roofTop = (p) => { let z = Infinity; for (const r of wRoofs) { const h = Roof.zAt(r, p); if (h !== null) z = Math.min(z, h - 3); } return z; };
        const body = (poly, z0, z1) => {
          if (z0 < e + plinthH) { prism(poly, z0, Math.min(z1, e + plinthH), plinth, { topK: 0.9 }); z0 = e + plinthH; }
          if (!(z1 > z0)) return;
          if (!wRoofs.length || !poly.some(p => roofTop(p) < z1 - 1)) { prism(poly, z0, z1, col, { topK: 0.85 }); return; }
          // режем кусок стены поперёк на полосы ≤ 40 см, у каждой — верх по скату
          const u = Model.wallDir(w), ss = poly.map(p => G.dot(G.sub(p, w.a), u)), s0 = Math.min(...ss), s1 = Math.max(...ss);
          const n = Math.max(1, Math.ceil((s1 - s0) / 40));
          for (let i = 0; i < n; i++) {
            const a = s0 + (s1 - s0) * i / n, b = s0 + (s1 - s0) * (i + 1) / n;
            const strip = View3D.clipSlab(poly, w.a, u, a, b);
            // грани по внутренним разрезам не рисуем — иначе на стене видны швы
            const cut = (p, q) => [a, b].some(c => (i > 0 || c === b) && (i < n - 1 || c === a) && Math.abs(G.dot(G.sub(p, w.a), u) - c) < 0.01 && Math.abs(G.dot(G.sub(q, w.a), u) - c) < 0.01);
            if (strip.length >= 3) prismTop(strip, z0, (p) => Math.max(z0, Math.min(z1, roofTop(p))), col, cut);
          }
        };
        for (const poly of Render.wallPieces(w, cache)) body(poly, e, top);
        for (const op of App.V.openings) {
          if (op.wall !== w.id) continue;
          const g = Model.opGeom(op); if (!g) continue;
          const T = OPENING_TYPES[op.type], win = T.cat === 'window';
          const t = g.th / 2;
          const P2 = (s2, k) => G.add(G.add(g.a, G.mul(g.u, s2)), G.mul(g.n, k));
          const rect = (s0, s1, k0, k1) => [P2(s0, k0), P2(s1, k0), P2(s1, k1), P2(s0, k1)];
          const sill = win ? (op.sill || 0) : 0;
          const oh = Math.min(op.h || 200, w.h - sill);
          if (sill > 0) body(rect(0, g.width, -t, t), e, e + sill);
          else prism(rect(0, g.width, -t, t), e, e + 3, View3D.hex('#8f887d'));      // порог: в проёме не видно земли
          if (sill + oh < w.h) body(rect(0, g.width, -t, t), e + sill + oh, top);
          const white = [0.95, 0.95, 0.94], fr = 6;
          const ang = U.deg(Math.atan2(g.u.y, g.u.x));
          const at = (s2, k) => P2(s2, k);
          if (win) {
            const z0 = e + sill, z1 = z0 + oh;
            // рама
            for (const [s0, s1] of [[0, fr], [g.width - fr, g.width]]) prism(rect(s0, s1, -4, 4), z0, z1, white);
            prism(rect(0, g.width, -4, 4), z0, z0 + fr, white); prism(rect(0, g.width, -4, 4), z1 - fr, z1, white);
            const leaves = op.type === 'win1' || op.type === 'winfix' || op.type === 'balcony' ? 1 : op.type === 'win3' ? 3 : 2;
            for (let i = 1; i < leaves; i++) { const s2 = g.width * i / leaves; prism(rect(s2 - 3, s2 + 3, -4, 4), z0, z1, white); }
            // подоконник и отлив
            if (sill > 0) prism(rect(-4, g.width + 4, -t - 5, t + 5), z0 - 3, z0, [0.86, 0.86, 0.85]);
            // стекло
            face([V3(at(fr, 0), z0 + fr), V3(at(g.width - fr, 0), z0 + fr), V3(at(g.width - fr, 0), z1 - fr), V3(at(fr, 0), z1 - fr)], [0.55, 0.72, 0.86], null, true);
            void ang;
          } else if (op.type !== 'arch') {
            const z0 = e, z1 = e + oh;
            prism(rect(0, 5, -t, t), z0, z1, white); prism(rect(g.width - 5, g.width, -t, t), z0, z1, white); prism(rect(0, g.width, -t, t), z1 - 5, z1, white);
            const leafCol = op.type === 'gate' ? View3D.hex('#9aa3ab') : w.kind === 'ext' ? View3D.hex('#6b4a33') : View3D.hex('#b08a64');
            const W2 = g.width, chrome = [0.78, 0.8, 0.82];
            if (op.type === 'gate') {
              prism(rect(5, W2 - 5, -2, 2), z0, z1 - 5, leafCol);
              for (let z = z0 + 45; z < z1 - 10; z += 45) prism(rect(5, W2 - 5, -2.5, 2.5), z, z + 1.5, View3D.hex('#7d858d'));
            } else {
              // наличники с обеих сторон стены
              const cas = [0.93, 0.92, 0.9];
              for (const k of [-1, 1]) {
                const k0 = k * t, k1 = k * (t + 1.2);
                prism(rect(-7, 0, Math.min(k0, k1), Math.max(k0, k1)), z0, z1 + 7, cas);
                prism(rect(W2, W2 + 7, Math.min(k0, k1), Math.max(k0, k1)), z0, z1 + 7, cas);
                prism(rect(-7, W2 + 7, Math.min(k0, k1), Math.max(k0, k1)), z1, z1 + 7, cas);
              }
              // створки: двустворчатая — две равные, полуторная — широкая + узкая; между ними притвор
              const seam = op.type === 'door2' ? W2 / 2 : op.type === 'door15' ? (op.hinge ? W2 / 3 : W2 * 2 / 3) : null;
              const leaves = seam == null ? [[5, W2 - 5]] : [[5, seam - 0.4], [seam + 0.4, W2 - 5]];
              const panel = leafCol.map(x => Math.min(1, x * 1.12)), frost = [0.82, 0.87, 0.9];
              const glassy = op.type === 'door2' && w.kind !== 'ext';                  // межкомнатная двустворчатая — со стеклом
              for (const [s0, s1] of leaves) {
                prism(rect(s0, s1, -2, 2), z0 + 1, z1 - 5, leafCol);
                if (op.type === 'slide') continue;
                // филёнки с обеих сторон: нижняя и верхняя (у стеклянной — матовое стекло)
                const m = Math.min(9, (s1 - s0) * 0.18), hLeaf = z1 - 5 - z0;
                const pz = [[z0 + 12, z0 + hLeaf * 0.42], [z0 + hLeaf * 0.5, z1 - 17]];
                for (const [pa, pb] of pz) for (const k of [-1, 1]) {
                  const up = pa > z0 + hLeaf * 0.45;
                  prism(rect(s0 + m, s1 - m, Math.min(k * 2, k * 2.6), Math.max(k * 2, k * 2.6)), pa, pb, glassy && up ? frost : panel);
                }
              }
              if (seam != null) prism(rect(seam - 0.4, seam + 0.4, -1.5, 1.5), z0 + 1, z1 - 5, leafCol.map(x => x * 0.55));   // притвор
              // ручки с обеих сторон: у двустворчатой — на обеих створках у притвора, у полуторной — на широкой
              if (op.type !== 'slide') {
                const hs = op.type === 'door2' ? [[seam - 9, -1], [seam + 9, 1]] : op.type === 'door15' ? [[op.hinge ? seam + 9 : seam - 9, op.hinge ? 1 : -1]] : [op.hinge ? [14, 1] : [W2 - 14, -1]];
                for (const [hp, dir] of hs) for (const k of [-1, 1]) {
                  prism(rect(hp - 1.5, hp + 1.5, Math.min(k * 2, k * 4.5), Math.max(k * 2, k * 4.5)), z0 + 98, z0 + 104, chrome);                     // шток
                  prism(rect(Math.min(hp, hp + dir * 13), Math.max(hp, hp + dir * 13), Math.min(k * 4.5, k * 6.5), Math.max(k * 4.5, k * 6.5)), z0 + 99, z0 + 103, chrome);   // рычаг
                  prism(rect(hp - 2.5, hp + 2.5, Math.min(k * 2, k * 2.8), Math.max(k * 2, k * 2.8)), z0 + 85, z0 + 91, chrome);                       // накладка замка
                }
              } else prism(rect(W2 - 16, W2 - 12, -3.5, 3.5), z0 + 80, z0 + 120, chrome);
            }
          }
        }
      }
      if (View3D.opts.items) for (const it of App.V.items) {
        const def = catItem(it.key);
        if (def.shape === 'rug') continue;
        View3D.item(it, def, e + View3D.deckZ(it), top => top);
      }
      // надземный газопровод: жёлтая труба на высоте, стойки на участке (у стен — кронштейны)
      for (const l of App.V.lines) {
        if (l.kind !== 'gasAir') continue;
        const z = e + (l.height ?? LINE_KINDS.gasAir.height), yel = View3D.hex('#e3b000'), post = View3D.hex('#8a8f94');
        const nearWall = (p) => App.V.walls.some(w => w.kind !== 'fence' && G.distSeg(p, w.a, w.b) <= w.th / 2 + 40);
        for (let i = 0; i + 1 < l.pts.length; i++) {
          const a = l.pts[i], b2 = l.pts[i + 1];
          wire([a.x, a.y, z], [b2.x, b2.y, z], 2.8, yel);
          const L = G.dist(a, b2), n = Math.max(1, Math.ceil(L / 350));
          for (let k = 0; k <= n; k++) {
            const p = G.add(a, G.mul(G.sub(b2, a), k / n));
            if (nearWall(p)) { cyl(p.x, p.y, 2, z - 8, z + 2, post, 6); continue; }
            cyl(p.x, p.y, 4, e, z - 2, post, 8);
          }
        }
        // спуск к точке подключения и ввод — вертикальные участки на концах
        for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) wire([p.x, p.y, e + 40], [p.x, p.y, z], 2.8, yel);
      }
      // воздушные линии: опоры (свои — если нет столба из библиотеки), крюк ввода на стене, СИП с провисом
      for (const l of App.V.lines) {
        if (l.kind !== 'overhead') continue;
        const poles = overheadPoles(l, App.V.items, App.V.walls), wireC = [0.16, 0.16, 0.18];
        const tops = poles.map(q => {
          if (q.item) return e + q.item.h - 45;
          if (q.wall) { const z = e + Math.min(450, (q.wall.h || 300) - 25); cyl(q.p.x, q.p.y, 3, z - 6, z + 4, View3D.hex('#3a3d42'), 6); return z; }
          const H = 850;
          cyl(q.p.x, q.p.y, 11, e, e + H, View3D.hex('#9a958c'), 10);
          const n = poles.length > 1 ? G.perp(G.unit(G.sub(poles[Math.min(poles.indexOf(q) + 1, poles.length - 1)].p, poles[Math.max(poles.indexOf(q) - 1, 0)].p))) : { x: 1, y: 0 };
          box(q.p.x + n.x * 12, q.p.y + n.y * 12, 10, 10, 0, e + H - 60, e + H - 45, View3D.hex('#3a3d42'));   // кронштейн
          return e + H - 50;
        });
        for (let i = 0; i + 1 < poles.length; i++) {
          const a = poles[i].p, b2 = poles[i + 1].p, za = tops[i], zb = tops[i + 1];
          const L = G.dist(a, b2), sag = Math.min(80, L * 0.025), N = Math.max(2, Math.round(L / 250));
          let prev = [a.x, a.y, za];
          for (let k = 1; k <= N; k++) {
            const t = k / N, q = G.add(a, G.mul(G.sub(b2, a), t)), z = za + (zb - za) * t - 4 * sag * t * (1 - t);
            const cur = [q.x, q.y, z]; wire(prev, cur, 1.8, wireC); prev = cur;
          }
        }
      }
    });
    // ---------------- крыши ----------------
    if (View3D.opts.roof) for (const r of d.roofs) {
      if (!View3D.opts.upper && Model.floorIdx(r.floor) > active) continue;
      View3D.roof(r);
    }
    View3D.arrays = { P, N, C: Cc, GP, GN, GC };
    if (View3D.gl) {
      View3D.mesh = View3D.upload(P, N, Cc);
      View3D.glass = View3D.upload(GP, GN, GC);
    }
    View3D.dirty = false;
    return View3D.arrays;
  },
  /** Крыша: скаты с толщиной, фронтоны в цвет стен, карнизная доска */
  roof(r, colOverride) {
    const { face, prism } = View3D._g;
    const col = colOverride || View3D.hex((ROOF_MATERIALS[r.mat] || ROOF_MATERIALS.metaltile).color);
    const extW = App.doc.walls.find(w => w.floor === r.floor && w.kind === 'ext');
    const gableCol = View3D.hex(extW && WALL_MATERIALS[extW.mat] ? WALL_MATERIALS[extW.mat].color : '#e4ddd0');
    const cx = r.x / 100, cz = r.y / 100, cy = (r.base || 0) / 100;
    const n3 = (vs) => { const u = [vs[1][0] - vs[0][0], vs[1][1] - vs[0][1], vs[1][2] - vs[0][2]], v = [vs[2][0] - vs[0][0], vs[2][1] - vs[0][1], vs[2][2] - vs[0][2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; return n.map(x => x / l); };
    for (const f of Roof.faces(r)) {
      const vs = f.map(p => [p.x / 100, p.z / 100, p.y / 100]);
      const vertical = Math.abs(n3(vs)[1]) < 0.2;
      // фронтоны: у навесов их нет, у теплицы — прозрачные
      if (vertical) { if (!r.open) face(vs, r.gableGlass ? [0.8, 0.9, 0.95] : gableCol, [cx, cy + 1, cz], !!r.gableGlass); continue; }
      const glass = !!(ROOF_MATERIALS[r.mat] || {}).glass;
      face(vs, col, [cx, cy - 5, cz], glass);
      // толщина ската (15 см) — нижняя грань чуть светлее
      if (!glass) face(vs.map(v => [v[0], v[1] - 0.15, v[2]]), col.map(x => x * 0.75), [cx, cy + 50, cz]);
    }
    if (r.type === 'flat') prism(G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0), r.base, r.base + 20, col);
    else if (!(ROOF_MATERIALS[r.mat] || {}).glass) prism(G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0), r.base - 15, r.base, View3D.hex('#efece6'), { noTop: true, bottom: true });
  },
  fence(w, e, top) {
    const { prism, box } = View3D._g;
    const M = FENCE_MATERIALS[w.mat] || FENCE_MATERIALS.profile;
    const col = View3D.hex(M.color);
    const L = Model.wallLen(w), u = Model.wallDir(w), n = G.perp(u);
    const th = Math.max(w.th, 3);
    const spans = Model.fenceSpans(w);          // без проёмов, ворот и калиток
    void L;
    const see = w.mat === 'mesh' || w.mat === 'forged' || w.mat === 'picket' || w.mat === 'euro';
    for (const [s0, s1] of spans) {
      const A = G.add(w.a, G.mul(u, s0)), B = G.add(w.a, G.mul(u, s1));
      if (see) {
        // решётка / штакетник: планки
        const stepP = w.mat === 'mesh' ? 12 : 14, pw = w.mat === 'mesh' ? 1.5 : 9;
        for (let x = s0 + 5; x < s1 - 2; x += stepP) box(w.a.x + u.x * x, w.a.y + u.y * x, pw, 2, U.deg(Math.atan2(u.y, u.x)), e + 5, top - 5, col);
        for (const zz of [e + 30, top - 30]) prism([G.add(A, G.mul(n, 2)), G.add(B, G.mul(n, 2)), G.sub(B, G.mul(n, 2)), G.sub(A, G.mul(n, 2))], zz, zz + 5, col.map(x => x * 0.8));
      } else prism([G.add(A, G.mul(n, th / 2)), G.add(B, G.mul(n, th / 2)), G.sub(B, G.mul(n, th / 2)), G.sub(A, G.mul(n, th / 2))], e + 5, top, col);
      const cnt = Math.max(1, Math.round((s1 - s0) / 250));
      for (let i = 0; i <= cnt; i++) { const p = G.add(A, G.mul(u, (s1 - s0) * i / cnt)); box(p.x, p.y, w.mat === 'brickF' ? 38 : 8, w.mat === 'brickF' ? 38 : 8, U.deg(Math.atan2(u.y, u.x)), e, top + (w.mat === 'brickF' ? 15 : 5), w.mat === 'brickF' ? View3D.hex('#a4553f') : [0.3, 0.3, 0.32]); }
    }
  },
  /** Предмет в 3D. e — отметка пола этажа, см */
  item(it, def, e) {
    const { prism, box, cyl, face } = View3D._g;
    const sh = def.shape, H = it.h || 0, rot = it.rot || 0;
    const C = (h) => View3D.hex(h);
    const wood = C('#b88a5a'), white = C('#f1f2f3'), fabric = C('#8a98ad'), metal = C('#9aa3ab'), dark = C('#3a3d42');
    // --- символы (электрика и т.п.): маленькие объекты на своей высоте ---
    if (def.sym) {
      if (View3D.fixture(it, def, e, e, e + H)) return;
      if (sh === 'pole') {
        cyl(it.x, it.y, 13, e, e + H, C('#8a7a66'), 10);
        box(it.x, it.y, 180, 12, rot, e + H - 60, e + H - 48, C('#6f6254'));
        for (const dx of [-80, 0, 80]) { const q = G.toWorld({ x: dx, y: 0 }, it.x, it.y, rot); cyl(q.x, q.y, 4, e + H - 48, e + H - 32, C('#e8e2d0'), 6); }
        return;
      }
      if (sh === 'lightpole') {
        cyl(it.x, it.y, 6, e, e + H, dark, 8);
        const q = G.toWorld({ x: 35, y: 0 }, it.x, it.y, rot);
        box((it.x + q.x) / 2, (it.y + q.y) / 2, 70, 6, rot, e + H - 6, e + H, dark);
        box(q.x, q.y, 40, 22, rot, e + H - 16, e + H - 4, C('#fff3c4'));
        return;
      }
      if (sh === 'riser') { cyl(it.x, it.y, it.w / 2, e, e + Math.max(H, 250), C('#8a5a2b'), 8); return; }
      if (sh === 'lamp' || sh === 'spot') {
        const ceil = e + Math.max(220, (App.V.walls.find(w => w.kind !== 'fence') || { h: 270 }).h) - 4;
        cyl(it.x, it.y, it.w / 2, ceil - (sh === 'lamp' ? 10 : 2), ceil, C('#fff6d8'), 12);
        return;
      }
      // розетки, выключатели, щиток, счётчик, краны: коробочка на высоте монтажа
      const mountZ = e + U.clamp(H, 10, 260);
      const sz = Math.max(8, Math.min(it.w, 60)), dd = Math.max(3, Math.min(it.d, 20));
      const hh = sh === 'panel' ? 60 : sh === 'labelbox' ? 40 : 8;
      box(it.x, it.y, sz, dd, rot, mountZ - hh / 2, mountZ + hh / 2, sh === 'panel' ? C('#cfd3d8') : white);
      return;
    }
    // --- детальные модели сантехники, мебели, оборудования (см. fixture) ---
    {
      const uz = sh === 'upper' ? 140 : sh === 'hood' ? 155 : 0;
      if (View3D.fixture(it, def, e, e + uz, e + uz + Math.max(2, H))) return;
    }
    // растения, колодцы, септики, скважины — детальные модели в fixture
    // --- постройки: гараж, сарай, баня, навесы, теплица — крыша по выбору (тип, уклон, материал) ---
    if (BLD_ROOF_SHAPES.has(sh)) { View3D.building(it, def, e); return; }
    if (sh === 'pool') { box(it.x, it.y, it.w + 60, it.d + 60, rot, e, e + 8, C('#e5e1d6')); box(it.x, it.y, it.w, it.d, rot, e + 8, e + 9, C('#3f97d8')); return; }
    if (sh === 'veranda') { View3D.veranda(it, e); return; }
    if (sh === 'pit') { View3D.pit(it, e); return; }
    if (KITCHEN_SHAPES.has(sh)) { View3D.kitchen(it, def, e); return; }
    if (sh === 'deck') { box(it.x, it.y, it.w, it.d, rot, e, e + 25, C('#a8805a')); for (let x = -it.w / 2 + 7; x < it.w / 2; x += 14) { const q = G.toWorld({ x, y: 0 }, it.x, it.y, rot); box(q.x, q.y, 1, it.d, rot, e + 25, e + 25.3, C('#8c6848')); } return; }
    if (sh === 'parking') { box(it.x, it.y, it.w, it.d, rot, e, e + 3, C('#a9abb0')); return; }
    if (sh === 'gardenbed' || sh === 'flowerbed') { box(it.x, it.y, it.w, it.d, rot, e, e + Math.max(20, H), C('#7a5a3a')); return; }
    if (sh === 'filterfield' || sh === 'ground') return;
    if (sh === 'car') { View3D.car(it, e); return; }
    if (sh === 'gateSlide' || sh === 'gateSwing' || sh === 'wicket') { View3D.gate(it, def, e); return; }
    if (sh === 'stairs' || sh === 'stairsL') {
      const steps = Math.max(3, Math.round(it.d / 28));
      const rise = H / steps;
      if (sh === 'stairs') for (let i = 0; i < steps; i++) {
        // подъём от «фронта» (+d/2) к «спинке» (−d/2)
        const q = G.toWorld({ x: 0, y: it.d / 2 - (i + 0.5) * it.d / steps }, it.x, it.y, rot);
        box(q.x, q.y, it.w, it.d / steps, rot, e + i * rise, e + (i + 1) * rise, wood.map(x => x * (i % 2 ? 0.95 : 1)));
      } else box(it.x, it.y, it.w, it.d, rot, e, e + H * 0.5, wood);
      return;
    }
    if (['round', 'boiler', 'roundtable', 'columnRound', 'pump'].includes(sh)) {
      prism(View3D._g.ring(it.x, it.y, it.w / 2, it.d / 2, 16, rot), e, e + Math.max(3, H), def.layer === 'furniture' ? wood : white, { topK: 0.9 });
      return;
    }
    if (!(H > 0) && sh !== 'shower') return;       // душ с трапом — вровень с полом, но стекло и стойка есть
    // --- мебель и оборудование: цвет по назначению, простые детали ---
    const upperZ = sh === 'upper' ? 140 : sh === 'hood' ? 155 : 0;
    const z0 = e + upperZ, z1 = z0 + Math.max(2, H);
    const colorOf = {
      bed: C('#f3efe7'), sofa: fabric, sofaL: fabric, armchair: fabric, officechair: dark, chair: wood, bench: wood,
      table: wood, diningtable: wood, roundtable: wood, desk: wood, deskL: wood, wardrobe: C('#c9a57a'), cabinet: C('#c9a57a'), shelf: C('#c9a57a'),
      tv: dark, piano: C('#2b2622'), counter: white, tall: C('#eef0f1'), bar: wood, hood: C('#c8ccd1'), kitchenI: white, kitchenL: white, ksink: white, upper: white, fridge: white, fridge2: C('#c8ccd1'),
      stove: C('#e2e4e6'), oven: dark, washer: white, bath: white, bathCorner: white, shower: C('#dfe9f0'), toilet: white, bidet: white, urinal: white,
      sink: white, vanity: C('#e8e2d8'), radiator: white, stoveHeat: C('#b5654a'), fireplace: C('#9c8f86'), fireplaceCorner: C('#9c8f86'), stoveMetal: dark,
      chimney: C('#8f5a45'), column: C('#d6d2ca'), capsule: C('#dfe3e6'), bbq: dark, gateSlide: metal, wicket: metal, labelbox: C('#d0ccc4'),
    }[sh] || (def.layer === 'furniture' ? wood : C('#d0ccc4'));
    if (sh === 'bed') {
      box(it.x, it.y, it.w, it.d, rot, z0, z0 + 28, C('#9a7550'));
      box(it.x, it.y, it.w - 6, it.d - 10, rot, z0 + 28, z0 + Math.max(45, H), colorOf);
      const hb = G.toWorld({ x: 0, y: -it.d / 2 + 4 }, it.x, it.y, rot); box(hb.x, hb.y, it.w, 8, rot, z0, z0 + 100, C('#9a7550'));
      return;
    }
    if (sh === 'sofa' || sh === 'sofaL' || sh === 'armchair') {
      box(it.x, it.y, it.w, it.d, rot, z0, z0 + 42, colorOf);
      const bk = G.toWorld({ x: 0, y: -it.d / 2 + 10 }, it.x, it.y, rot); box(bk.x, bk.y, it.w, 20, rot, z0 + 42, z1, colorOf.map(x => x * 0.92));
      for (const s2 of [-1, 1]) { const ar = G.toWorld({ x: s2 * (it.w / 2 - 9), y: 0 }, it.x, it.y, rot); box(ar.x, ar.y, 18, it.d, rot, z0 + 42, z0 + 62, colorOf.map(x => x * 0.9)); }
      return;
    }
    if (['table', 'diningtable', 'desk', 'deskL', 'roundtable'].includes(sh)) {
      box(it.x, it.y, it.w, it.d, rot, z1 - 4, z1, colorOf);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = G.toWorld({ x: sx * (it.w / 2 - 6), y: sy * (it.d / 2 - 6) }, it.x, it.y, rot); box(q.x, q.y, 5, 5, rot, z0, z1 - 4, colorOf.map(x => x * 0.85)); }
      return;
    }
    if (sh === 'bath' || sh === 'bathCorner' || sh === 'sink' || sh === 'vanity') {
      box(it.x, it.y, it.w, it.d, rot, z0, z1, colorOf, { topK: 1 });
      box(it.x, it.y, it.w * 0.8, it.d * 0.7, rot, z1 - 0.5, z1 + 0.2, C('#cfe3ef'));
      return;
    }
    box(it.x, it.y, it.w, it.d, rot, z0, z1, colorOf, { topK: 0.93 });
    if (sh === 'stove' || sh === 'kitchenI') {
      const q = sh === 'kitchenI' ? G.toWorld({ x: it.w / 2 - 45, y: 0 }, it.x, it.y, rot) : it;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const b = G.toWorld({ x: sx * 13, y: sy * 12 }, q.x, q.y, rot); cyl(b.x, b.y, 8, z1, z1 + 0.6, dark, 10); }
    }
    void face;
  },
  /** Постройка с крышей: стены или столбы до карниза, крыша выбранного типа; высота объекта — до конька */
  /** Геометрия крыши объекта: top — верх (конёк), minEave — ниже карниза не опускаемся (уклон тогда меньше) */
  /** Геометрия крыши объекта: уклон соблюдается всегда; карниз — top − подъём, но не ниже minEave
   *  (тогда конёк выше top); eaveFix — карниз задан явно (высота стен постройки) */
  roofGeom(it, top, minEave, eaveFix) {
    const R = bldRoof(it), r = bldRoofRect(it, it.w, it.d);
    const run = r.type === 'gable' ? r.d / 2 : r.type === 'hip' ? Math.min(r.w, r.d) / 2 : r.type === 'shed' ? r.d : 0;
    const rise = bldRoofRise(it);
    const eave = U.isNum(eaveFix) ? eaveFix : Math.max(top - rise, minEave);
    // высота низа крыши над точкой плана (локальные координаты объекта) — для столбов
    const roofZ = (q) => {
      const v = G.toLocal(q, r.x, r.y, r.rot), D = r.d / 2;
      if (r.type === 'shed') return eave + rise * (D - v.y) / (2 * D);
      if (r.type === 'gable' || r.type === 'hip') return eave + rise * Math.max(0, 1 - Math.abs(v.y) / D);
      return eave;
    };
    return { R, r, rise, eave, pitch: run ? U.deg(Math.atan(rise / run)) : 0, roofZ };
  },
  /** Построить крышу объекта по roofGeom; opt: gableGlass, endCol, endGlass */
  itemRoof(it, g, opt = {}) {
    if (!View3D.opts.roof || g.R.type === 'none') return;            // «Крыша» выключена или её нет — видно, что внутри
    const { face } = View3D._g, C = View3D.hex, { R, r, eave, rise } = g, rot = it.rot || 0, rotW = rot + r.rot;
    const c = G.toWorld({ x: r.x, y: r.y }, it.x, it.y, rot);
    const glassRoof = !!(ROOF_MATERIALS[R.mat] || {}).glass;
    const col = glassRoof ? [0.82, 0.9, 0.95] : null;
    if (r.type === 'arch') {
      const W = r.w / 2, D = r.d / 2, n = 14, T = (u, v, z) => { const q = G.toWorld({ x: u, y: v }, c.x, c.y, rotW); return [q.x / 100, z / 100, q.y / 100]; };
      const prof = Array.from({ length: n + 1 }, (_, i) => { const t = Math.PI * i / n; return { v: -D * Math.cos(t), z: eave + rise * Math.sin(t) }; });
      const roofCol = col || C((ROOF_MATERIALS[R.mat] || {}).color || '#8f9397');
      const ref = T(0, 0, eave);
      for (let i = 0; i < n; i++) face([T(-W, prof[i].v, prof[i].z), T(W, prof[i].v, prof[i].z), T(W, prof[i + 1].v, prof[i + 1].z), T(-W, prof[i + 1].v, prof[i + 1].z)], roofCol, ref, glassRoof);
      if (!R.open) for (const u of [-W + R.over, W - R.over]) face(prof.map(p => T(u, p.v, p.z)), opt.endCol || C('#ddd3c3'), T(u > 0 ? u - 1 : u + 1, 0, eave + 1), !!opt.endGlass);
      return;
    }
    View3D.roof({ x: c.x, y: c.y, w: r.w, d: r.d, rot: rotW, type: r.type, pitch: g.pitch, base: eave, mat: R.mat, floor: null, open: R.open, gableGlass: !!opt.gableGlass }, col);
  },
  /** Часть многоугольника между плоскостями s = a и s = b (s — координата вдоль направления u от точки o) */
  clipSlab(poly, o, u, a, b) {
    const clip = (pts, keep) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], fp = keep(p), fq = keep(q);
        if (fp >= 0) out.push(p);
        if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push(G.add(p, G.mul(G.sub(q, p), t))); }
      }
      return out;
    };
    const s = (p) => G.dot(G.sub(p, o), u);
    return clip(clip(poly, p => s(p) - a), p => b - s(p));
  },
  /** Сантехника, техника, ТВ, стол со стульями — детальнее, чем «коробка». Перед — сторона +d/2, у стены — −d/2.
   *  Возвращает true, если объект нарисован */
  fixture(it, def, e, z0, z1) {
    const { box, cyl, face } = View3D._g, C = View3D.hex, sh = def.shape, rot = it.rot || 0, w = it.w, d = it.d, H = it.h || 0;
    const fx = it.flip ? -1 : 1;
    const L = (x, y) => G.toWorld({ x: x * fx, y }, it.x, it.y, rot);
    const V = (x, y, z) => { const q = L(x, y); return [q.x / 100, z / 100, q.y / 100]; };
    const bx = (x0, y0, x1, y1, za, zb, col, opt) => { const q = L((x0 + x1) / 2, (y0 + y1) / 2); box(q.x, q.y, Math.abs(x1 - x0), Math.abs(y1 - y0), rot, za, zb, col, opt); };
    const cy = (x, y, r, za, zb, col, n = 16) => { const q = L(x, y); cyl(q.x, q.y, r, za, zb, col, n); };
    // «овал» — призма по эллипсу (чаша унитаза, раковины)
    const oval = (cx, cy2, rx, ry, za, zb, col, n = 18) => View3D._g.prism(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return L(cx + Math.cos(a) * rx, cy2 + Math.sin(a) * ry); }), za, zb, col);
    const white = [0.96, 0.96, 0.95], chrome = [0.8, 0.82, 0.84], water = [0.74, 0.84, 0.9], black = [0.08, 0.08, 0.09];
    const W = w / 2, D = d / 2;
    if (sh === 'tv') {
      // на тумбе — стоит на ней, иначе — на стене (центр экрана ~115 см)
      const f1 = it.floor || App.doc.floors[0].id;
      const stand = App.doc.items.find(o => o !== it && (o.floor || f1) === f1 && ['tvstand', 'cabinet', 'shelf', 'counter'].includes(catItem(o.key).shape) && G.pointInPoly(it, Model.itemPts(o)));
      const hScr = Math.min(H || 75, w * 0.6), base = stand ? e + stand.h + 8 : e + 115 - hScr / 2;
      bx(-W, -2, W, 2, base, base + hScr, [0.12, 0.12, 0.13]);                                     // корпус
      face([V(-W + 2, 2.2, base + 2), V(W - 2, 2.2, base + 2), V(W - 2, 2.2, base + hScr - 2), V(-W + 2, 2.2, base + hScr - 2)], [0.1, 0.13, 0.18], V(0, -10, base + hScr / 2));   // экран
      if (stand) { bx(-12, -8, 12, 8, base - 8, base - 6, [0.2, 0.2, 0.22]); bx(-3, -2, 3, 1, base - 6, base + 4, [0.2, 0.2, 0.22]); }
      else bx(-W * 0.4, -4, W * 0.4, -2, base + hScr * 0.3, base + hScr * 0.7, [0.25, 0.25, 0.27]);   // кронштейн
      return true;
    }
    if (sh === 'toilet') {
      bx(-W * 0.35, -D * 0.95, W * 0.35, -D * 0.1, e, e + 38, white);                              // основание
      oval(0, D * 0.12, W * 0.92, D * 0.62, e + 20, e + 40, white);                                  // чаша
      oval(0, D * 0.12, W * 0.62, D * 0.42, e + 40, e + 40.6, water);                              // вода
      oval(0, D * 0.14, W * 0.95, D * 0.66, e + 40.6, e + 43, [0.93, 0.93, 0.92]);                // сиденье
      bx(-W, -D, W, -D + 18, e + 38, e + H, white);                                                // бачок
      cy(0, -D + 9, 3.5, e + H, e + H + 1, chrome, 10);                                              // кнопка
      return true;
    }
    if (sh === 'bidet') {
      bx(-W * 0.35, -D * 0.9, W * 0.35, 0, e, e + 30, white);
      oval(0, D * 0.05, W * 0.95, D * 0.7, e + 15, e + 40, white);
      oval(0, D * 0.05, W * 0.62, D * 0.45, e + 40, e + 40.5, water);
      cy(0, -D * 0.55, 2, e + 40, e + 50, chrome, 8);
      return true;
    }
    if (sh === 'sink') {
      const top = e + (H || 85);
      cy(0, -D * 0.25, 10, e, top - 14, white, 14);                                                 // пьедестал
      oval(0, 0, W, D * 0.95, top - 16, top, white);                                               // чаша
      oval(0, D * 0.08, W * 0.78, D * 0.65, top, top + 0.4, water);
      cy(0, -D * 0.78, 2.2, top, top + 18, chrome, 8); bx(-1.5, -D * 0.78, 1.5, -D * 0.3, top + 15, top + 18, chrome);   // смеситель
      return true;
    }
    if (sh === 'vanity') {
      const top = e + (H || 85);
      bx(-W, -D, W, D - 2, e + 10, top - 4, C('#e8e2d8'));
      bx(-W + 2, D - 2, -1, D, e + 14, top - 8, C('#efeae2')); bx(1, D - 2, W - 2, D, e + 14, top - 8, C('#efeae2'));
      bx(-W, -D, W, D, top - 4, top, white);
      oval(0, D * 0.1, W * 0.55, D * 0.55, top, top + 0.4, water);
      cy(0, -D * 0.7, 2.2, top, top + 20, chrome, 8); bx(-1.5, -D * 0.7, 1.5, -D * 0.2, top + 17, top + 20, chrome);
      return true;
    }
    if (sh === 'bath' || sh === 'bathCorner') {
      const top = e + (H || 58);
      bx(-W, -D, W, D, e, top - 8, white);                                                          // экран
      for (const [x0, y0, x1, y1] of [[-W, -D, W, -D + 7], [-W, D - 7, W, D], [-W, -D + 7, -W + 9, D - 7], [W - 9, -D + 7, W, D - 7]]) bx(x0, y0, x1, y1, top - 8, top, white);   // борта
      bx(-W + 9, -D + 7, W - 9, D - 7, top - 20, top - 19, water);                                 // вода внутри
      cy(W - 16, -D + 3.5, 2, top, top + 14, chrome, 8); bx(W - 18, -D + 3, W - 14, -D + 14, top + 11, top + 14, chrome);
      return true;
    }
    if (sh === 'shower') {
      // кабина (выше 1,5 м) — поддон и стёкла с рамой; поддон — бортик; с трапом — плитка вровень с полом.
      // Стёкла ставим только на стороны, где нет стены; на одной из открытых — проход; стойка с лейкой — на стене
      const cabin = H >= 150, tray = cabin ? 15 : H > 0 ? Math.min(H, 20) : 1.5, z = e + tray, top = e + (cabin ? H : 200);
      const glass = [0.72, 0.86, 0.94], prof = [0.75, 0.77, 0.8];
      const walls = App.V.walls.filter(q => q.kind !== 'fence');
      const nearW = (x, y) => { const p = L(x, y); return walls.some(q => G.distSeg(p, q.a, q.b) <= q.th / 2 + 8); };
      // стороны в локальных координатах: [ось, координата, длина]; «стена», если вдоль стороны есть стена
      const sides = [
        { k: 'back', y: -D, len: w }, { k: 'front', y: D, len: w }, { k: 'left', x: -W, len: d }, { k: 'right', x: W, len: d },
      ].map(sd => {
        const pts = sd.y !== undefined ? [[-W + 6, sd.y], [0, sd.y], [W - 6, sd.y]] : [[sd.x, -D + 6], [sd.x, 0], [sd.x, D - 6]];
        return { ...sd, wall: pts.every(([x, y]) => nearW(x, y)) };
      });
      if (H > 0) {
        bx(-W, -D, W, D, e, z - 3, [0.95, 0.96, 0.96]);
        bx(-W, -D, W, D, z - 3, z, [0.97, 0.97, 0.97]);
        bx(-W + 5, -D + 5, W - 5, D - 5, z, z + 0.2, [0.88, 0.9, 0.92]);
        cy(0, 0, 4, z + 0.2, z + 0.5, [0.55, 0.57, 0.6], 12);
      } else {
        bx(-W, -D, W, D, e, z, [0.5, 0.56, 0.63]);                                                     // плитка душевой зоны
        for (let x = -W + 30; x < W - 5; x += 30) bx(x - 0.3, -D, x + 0.3, D, z, z + 0.1, [0.42, 0.47, 0.53]);   // швы
        for (let y = -D + 30; y < D - 5; y += 30) bx(-W, y - 0.3, W, y + 0.3, z, z + 0.1, [0.42, 0.47, 0.53]);
      }
      const wallSide = sides.find(q => q.k === 'back' && q.wall) || sides.find(q => q.wall) || sides[0];
      // трап — вдоль стены со стойкой
      if (!(H > 0)) {
        const t = wallSide.y !== undefined ? [-W + 10, wallSide.y - Math.sign(wallSide.y) * 12, W - 10, wallSide.y - Math.sign(wallSide.y) * 6] : [wallSide.x - Math.sign(wallSide.x) * 12, -D + 10, wallSide.x - Math.sign(wallSide.x) * 6, D - 10];
        bx(Math.min(t[0], t[2]), Math.min(t[1], t[3]), Math.max(t[0], t[2]), Math.max(t[1], t[3]), z, z + 0.3, [0.72, 0.74, 0.77]);
      }
      const open = sides.filter(q => !q.wall);
      // проход: на фронте, если он открыт, иначе на самой длинной открытой стороне
      const entry = cabin ? null : (open.find(q => q.k === 'front') || open.slice().sort((p, q) => q.len - p.len)[0]);
      const pane = (sd, a0, a1) => {
        if (a1 - a0 < 5) return;
        const r = sd.y !== undefined ? [a0, sd.y - 0.6, a1, sd.y + 0.6] : [sd.x - 0.6, a0, sd.x + 0.6, a1];
        bx(r[0], r[1], r[2], r[3], z, top, glass, { glass: true });
        const e0 = sd.y !== undefined ? [a0, sd.y] : [sd.x, a0], e1 = sd.y !== undefined ? [a1, sd.y] : [sd.x, a1];
        for (const [px, py] of [e0, e1]) bx(px - 1, py - 1, px + 1, py + 1, z, top, prof);                    // вертикальные профили
        bx(r[0] - 0.4, r[1] - 0.4, r[2] + 0.4, r[3] + 0.4, top - 2, top, prof);                                 // верхний профиль
        bx(r[0] - 0.4, r[1] - 0.4, r[2] + 0.4, r[3] + 0.4, z, z + 1.5, prof);                                   // нижний профиль
      };
      for (const sd of open) {
        const half = sd.y !== undefined ? W : D;
        if (sd !== entry) { pane(sd, -half, half); continue; }
        // стекло от угла со стеной (или с соседним стеклом), проход ~65 см у другого края
        const touchLo = sd.y !== undefined ? sides.find(q => q.k === 'left') : sides.find(q => q.k === 'back');
        const gap = Math.min(65, sd.len * 0.55);
        if (touchLo.wall || !sides.find(q => q.k === (sd.y !== undefined ? 'right' : 'front')).wall) pane(sd, -half, half - gap);
        else pane(sd, -half + gap, half);
      }
      if (cabin) {
        const fr = open.find(q => q.k === 'front') || open[0];
        if (fr) { const hx = fr.y !== undefined ? [0, fr.y + Math.sign(fr.y) * 1.5] : [fr.x + Math.sign(fr.x) * 1.5, 0]; bx(hx[0] - 1, hx[1] - 1, hx[0] + 1, hx[1] + 1, z + 90, z + 125, chrome); }   // ручка двери
      }
      // смеситель-термостат, штанга и тропическая лейка — на стене
      const ws = wallSide, inward = ws.y !== undefined ? [0, -Math.sign(ws.y)] : [-Math.sign(ws.x), 0];
      const base = ws.y !== undefined ? [0, ws.y] : [ws.x, 0], at = (k) => [base[0] + inward[0] * k, base[1] + inward[1] * k];
      const hz = Math.min(top - 5, z + 205);
      const [mx, my] = at(3); bx(mx - (inward[0] ? 1.5 : 9), my - (inward[1] ? 1.5 : 9), mx + (inward[0] ? 1.5 : 9), my + (inward[1] ? 1.5 : 9), z + 100, z + 108, chrome);
      const [lx, ly] = at(6); bx(lx - 1.2, ly - 1.2, lx + 1.2, ly + 1.2, z + 101, z + 106, chrome);        // ручка смесителя
      const [rx, ry] = at(4); cy(rx, ry, 1.1, z + 108, hz, chrome, 8);
      const [ax, ay] = at(16); bx(Math.min(rx, ax) - 1, Math.min(ry, ay) - 1, Math.max(rx, ax) + 1, Math.max(ry, ay) + 1, hz - 1.5, hz, chrome);
      const [hx2, hy2] = at(26); cy(hx2, hy2, 12, hz - 2.5, hz - 0.5, chrome, 16);
      const [sx, sy] = at(8); cy(sx, sy, 3, z + 125, z + 145, chrome, 8);                                     // ручная лейка на держателе
      return true;
    }
    // --- стол для настольного тенниса: синяя столешница с белой разметкой, сетка со стойками, складное основание на колёсах ---
    if (sh === 'pingpong') {
      const top = e + (H || 76), blue = [0.12, 0.3, 0.52], wh = [0.97, 0.97, 0.97], frame = [0.2, 0.21, 0.23];
      bx(-W, -D, W, D, top - 2.5, top, blue);
      for (const [x0, y0, x1, y1] of [[-W, -D, W, -D + 2], [-W, D - 2, W, D], [-W, -D, -W + 2, D], [W - 2, -D, W, D], [-W, -0.3, W, 0.3]]) bx(x0, y0, x1, y1, top, top + 0.1, wh);
      for (const s2 of [-1, 1]) { bx(-1, s2 * (D + 15) - 1.5, 1, s2 * (D + 15) + 1.5, top - 4, top + 15.25, frame); bx(-1.5, Math.min(s2 * D, s2 * (D + 16)), 1.5, Math.max(s2 * D, s2 * (D + 16)), top - 4, top - 1, frame); }   // стойки и кронштейны сетки
      bx(-0.3, -D - 15, 0.3, D + 15, top, top + 13.5, [0.12, 0.12, 0.14], { glass: true });                       // сетка
      bx(-0.5, -D - 15, 0.5, D + 15, top + 13.5, top + 15.25, wh);                                                   // белая лента
      for (const s1 of [-1, 1]) {
        const x = s1 * (W - 35);
        for (const s2 of [-1, 1]) { cy(x, s2 * (D - 20), 2, e + 8, top - 2.5, frame, 8); cy(x, s2 * (D - 20), 4, e, e + 8, [0.1, 0.1, 0.1], 10); }
        bx(x - 1.5, -D + 20, x + 1.5, D - 20, e + 20, e + 23, frame);
        bx(x - 1.5, -D + 20, x + 1.5, D - 20, top - 8, top - 5, frame);
      }
      bx(-W + 35, -1.5, W - 35, 1.5, e + 40, e + 43, frame);                                                        // продольная связь
      return true;
    }
    if (sh === 'trampoline') {
      const zm = e + 75, R = Math.min(W, D), n = 8;
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, px = Math.cos(a) * R, py = Math.sin(a) * R; cy(px, py, 2, e, e + (H || 250), [0.25, 0.27, 0.3], 8); }
      View3D._g.prism(Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2; return L(Math.cos(a) * R, Math.sin(a) * R); }), zm - 3, zm, [0.25, 0.45, 0.75]);   // защитный мат
      View3D._g.prism(Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2; return L(Math.cos(a) * (R - 25), Math.sin(a) * (R - 25)); }), zm, zm + 0.5, [0.08, 0.08, 0.09]);   // полотно
      for (let k = 0; k < 24; k++) { const a0 = k / 24 * Math.PI * 2, a1 = (k + 1) / 24 * Math.PI * 2; face([V(Math.cos(a0) * R, Math.sin(a0) * R, zm), V(Math.cos(a1) * R, Math.sin(a1) * R, zm), V(Math.cos(a1) * R, Math.sin(a1) * R, e + (H || 250)), V(Math.cos(a0) * R, Math.sin(a0) * R, e + (H || 250))], [0.2, 0.2, 0.22], V(0, 0, zm + 50), true); }   // сетка
      return true;
    }
    // --- уличный кран на фасаде: пластина, корпус, маховик и излив вниз ---
    if (sh === 'faucetOut') {
      const z = e + (H || 50), br = [0.72, 0.62, 0.38];
      bx(-4, -D, 4, -D + 1.5, z - 5, z + 5, br);
      bx(-2, -D + 1.5, 2, -D + 10, z - 2, z + 2, br);
      bx(-1.5, -D + 8, 1.5, -D + 11, z - 7, z - 2, br);                                                             // излив
      cy(0, -D + 5, 3, z + 2, z + 3, [0.75, 0.15, 0.12], 10);                                                       // маховик
      return true;
    }
    if (sh === 'hydrant') {
      const top = e + (H || 90), gr = [0.25, 0.42, 0.3];
      bx(-12, -12, 12, 12, e, e + 1, [0.55, 0.53, 0.5]);                                                            // площадка
      cy(0, 0, 3, e, top - 8, gr, 10);
      bx(-4, -4, 4, 4, top - 8, top, gr);
      bx(-1, -4, 1, 14, top, top + 2, [0.2, 0.2, 0.22]);                                                            // рычаг
      bx(-1.5, 3, 1.5, 12, top - 25, top - 22, gr); bx(-1.5, 9, 1.5, 12, top - 32, top - 22, gr);                   // излив
      return true;
    }
    // --- уличные светильники: столбик и фасадный ---
    if (sh === 'bollard') {
      const top = e + (H || 80), dk = [0.18, 0.19, 0.2];
      cy(0, 0, W * 0.9, e, e + 3, dk, 12);
      cy(0, 0, W * 0.5, e + 3, top - 16, dk, 12);
      cy(0, 0, W * 0.55, top - 16, top - 3, [1, 0.93, 0.72], 12);                                                     // плафон
      cy(0, 0, W * 0.75, top - 3, top, dk, 12);
      return true;
    }
    if (sh === 'facadeLight') {
      const z = e + (H || 210), dk = [0.18, 0.19, 0.2];
      bx(-W * 0.5, -D, W * 0.5, -D + 2, z - 12, z + 12, dk);
      bx(-W * 0.4, -D + 2, W * 0.4, -D + D * 1.2, z - 8, z + 6, [1, 0.93, 0.72]);
      bx(-W * 0.5, -D + 2, W * 0.5, -D + D * 1.4, z + 6, z + 9, dk);
      return true;
    }
    // --- офисное кресло: пятилучье на роликах, газлифт, сиденье, спинка, подлокотники ---
    if (sh === 'officechair') {
      const blk = [0.13, 0.13, 0.15], fab = [0.2, 0.22, 0.26], seat = e + 46;
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * Math.PI * 2, r = Math.min(W, D) - 3, ex = Math.cos(a) * r, ey = Math.sin(a) * r;
        for (let t = 0; t < 1; t += 0.25) cy(ex * (t + 0.125), ey * (t + 0.125), 2.2, e + 6, e + 9, blk, 6);   // луч
        cy(ex, ey, 2.5, e, e + 5, blk, 8);                                                                          // ролик
      }
      cy(0, 0, 4, e + 6, e + 11, blk, 10);
      cy(0, 0, 2.2, e + 11, seat - 4, [0.6, 0.62, 0.65], 10);                                                      // газлифт
      bx(-W + 6, -D + 8, W - 6, D - 4, seat - 4, seat + 4, fab);                                                  // сиденье
      bx(-W + 8, -D + 3, W - 8, -D + 8, seat + 8, e + (H || 110), fab);                                           // спинка
      bx(-4, -D + 5, 4, -D + 9, seat - 2, seat + 10, blk);                                                         // кронштейн спинки
      for (const s2 of [-1, 1]) {
        bx(s2 * (W - 7) - 1.5, -2, s2 * (W - 7) + 1.5, 2, seat + 2, seat + 20, blk);
        bx(s2 * (W - 7) - 3, -12, s2 * (W - 7) + 3, 12, seat + 20, seat + 23, blk);                                 // подлокотники
      }
      return true;
    }
    // --- шкафы: цоколь, корпус, карниз; распашные двери с ручками или купе с профилями и зеркалом ---
    if (sh === 'wardrobe') {
      const body = it.color ? View3D.hex(it.color) : C('#c9a57a'), door = body.map(x => Math.min(1, x * 1.07)), seam = body.map(x => x * 0.6);
      const top = e + (H || 220), coupe = /купе/i.test(def.name) || it.key === 'wardrobe3';
      bx(-W + 2, -D + 2, W - 2, D - 4, e, e + 8, [0.25, 0.23, 0.22]);                                             // цоколь
      bx(-W, -D, W, D - (coupe ? 5 : 2), e + 8, top - 4, body);
      bx(-W - 1, -D, W + 1, D, top - 4, top, body.map(x => x * 0.92));                                           // карниз
      if (coupe) {
        const n = Math.max(2, Math.round(w / 90)), pw = w / n;
        for (let i = 0; i < n; i++) {
          const x0 = -W + i * pw, x1 = x0 + pw + (i < n - 1 ? 3 : 0), fy = i % 2 ? D - 2.4 : D - 0.2;          // створки на двух направляющих
          const mirror = n >= 3 ? i === Math.floor(n / 2) : i === 0;
          bx(x0, fy - 1.6, x1, fy, e + 10, top - 6, mirror ? [0.84, 0.88, 0.91] : door);
          for (const px of [x0, x1]) bx(px - 1, fy - 2, px + 1, fy + 0.2, e + 10, top - 6, [0.72, 0.74, 0.77]);   // профили
        }
        bx(-W, D - 3, W, D + 0.4, top - 7, top - 5, [0.72, 0.74, 0.77]); bx(-W, D - 3, W, D + 0.4, e + 8, e + 10, [0.72, 0.74, 0.77]);   // направляющие
      } else {
        const n = Math.max(1, Math.round(w / 50)), dw = w / n;
        for (let i = 0; i < n; i++) {
          const x0 = -W + i * dw + 0.3, x1 = -W + (i + 1) * dw - 0.3;
          bx(x0, D - 2, x1, D, e + 9, top - 5, door);
          bx(x0 - 0.3, D - 2, x0, D - 0.5, e + 9, top - 5, seam);
          const hxp = i % 2 === 0 ? x1 - 4 : x0 + 4;                                                                // ручки у стыка створок
          bx(hxp - 0.8, D, hxp + 0.8, D + 2.5, e + 95, e + 125, chrome);
        }
        if (H > 200) bx(-W, D - 2.2, W, D + 0.2, top - 45, top - 44, seam);                                         // антресоль
      }
      return true;
    }
    // --- тумбы и комоды: ящики с ручками, ножки; ТВ-тумба — открытая ниша и дверцы ---
    if (sh === 'cabinet') {
      const body = it.color ? View3D.hex(it.color) : C(it.key === 'tvstand' ? '#8a6a4c' : '#c9a57a'), front = body.map(x => Math.min(1, x * 1.08));
      const top = e + (H || 60), leg = H > 60 ? 8 : 10;
      for (const [px, py] of [[-W + 4, -D + 4], [W - 4, -D + 4], [W - 4, D - 4], [-W + 4, D - 4]]) bx(px - 1.5, py - 1.5, px + 1.5, py + 1.5, e, e + leg, black);
      bx(-W, -D, W, D - 1.5, e + leg, top - 2, body);
      bx(-W - 0.5, -D, W + 0.5, D, top - 2, top, body.map(x => x * 0.9));                                         // столешница
      const handle = (xc, zc, len = 12) => bx(xc - len / 2, D, xc + len / 2, D + 2, zc - 0.7, zc + 0.7, chrome);
      const hh = top - 2 - (e + leg);
      if (it.key === 'tvstand') {
        bx(-W + 2, D - 1.5, W - 2, D - 1.2, e + leg + 2, top - 4, black.map(x => x + 0.05));                        // ниша для техники
        for (const s2 of [-1, 1]) { const x0 = s2 < 0 ? -W + 1 : W * 0.35, x1 = s2 < 0 ? -W * 0.35 : W - 1; bx(x0, D - 1.5, x1, D, e + leg + 1, top - 3, front); handle((x0 + x1) / 2, top - 10); }
      } else if (it.key === 'shoeRack') {
        const n = 2, rh = hh / n;
        for (let i = 0; i < n; i++) { const z0 = e + leg + i * rh; bx(-W + 1, D - 1.5, W - 1, D, z0 + 0.5, z0 + rh - 0.5, front); handle(0, z0 + rh - 6, 20); }   // откидные секции
      } else {
        const rows = it.key === 'dresser' || w >= 90 ? Math.max(3, Math.round(hh / 20)) : Math.max(1, Math.round(hh / 20)), rh = hh / rows;
        const cols = w >= 90 && it.key !== 'dresser' ? 2 : 1;
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
          const z0 = e + leg + i * rh, x0 = -W + j * w / cols + 1, x1 = -W + (j + 1) * w / cols - 1;
          bx(x0, D - 1.5, x1, D, z0 + 0.5, z0 + rh - 0.5, front); handle((x0 + x1) / 2, z0 + rh * 0.6, Math.min(16, (x1 - x0) * 0.3));
        }
      }
      return true;
    }
    // --- стеллаж: боковины, задняя стенка, полки и книги ---
    if (sh === 'shelf') {
      const body = it.color ? View3D.hex(it.color) : C('#c9a57a'), top = e + (H || 200);
      const n = Math.max(2, Math.round((top - e) / 38)), step = (top - e - 4) / n;
      bx(-W, -D, W, -D + 1.5, e, top, body.map(x => x * 0.85));
      for (const s2 of [-1, 1]) bx(s2 * W - (s2 > 0 ? 2 : 0), -D, s2 * W + (s2 < 0 ? 2 : 0), D, e, top, body);
      const cols = [[0.55, 0.2, 0.18], [0.2, 0.33, 0.5], [0.85, 0.78, 0.6], [0.25, 0.42, 0.3], [0.45, 0.4, 0.55], [0.7, 0.45, 0.2]];
      for (let i = 0; i <= n; i++) {
        const z0 = e + i * step;
        bx(-W + 2, -D + 1.5, W - 2, D, z0, z0 + 2, body);
        if (i === n || i === 0 && H < 60) continue;
        let x = -W + 3, k = Math.floor(View3D.noise(it.x + i, it.y) * 6);
        while (x < W - 8) {
          const bw = 2.5 + View3D.noise(x + i * 7, it.x) * 3, bh = step * (0.6 + View3D.noise(x, i + it.y) * 0.3);
          if (View3D.noise(x * 3, i) < 0.12) { x += 6; continue; }                                                   // промежуток
          bx(x, -D + 3, Math.min(W - 3, x + bw), D - 5, z0 + 2, z0 + 2 + bh, cols[k++ % cols.length]);
          x += bw + 0.3;
        }
      }
      return true;
    }
    if (sh === 'washer') {
      const top = e + (H || 85);
      bx(-W, -D, W, D, e, top, white);
      bx(-W, D - 0.3, W, D, top - 14, top - 2, [0.88, 0.88, 0.88]);                               // панель
      const n = 22, R = Math.min(W, (H || 85) / 2) * 0.62, zc = e + (H || 85) * 0.45;
      face(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return V(Math.cos(a) * R, D + 0.4, zc + Math.sin(a) * R); }), [0.55, 0.57, 0.6], V(0, 0, zc));
      face(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return V(Math.cos(a) * R * 0.72, D + 0.8, zc + Math.sin(a) * R * 0.72); }), [0.3, 0.38, 0.46], V(0, 0, zc), true);
      cy(W * 0.55, D - 4, 3, top - 11, top - 5, [0.6, 0.6, 0.62], 10);
      return true;
    }
    if (sh === 'fridge' || sh === 'fridge2') {
      const top = e + (H || 180), col = sh === 'fridge2' ? [0.78, 0.8, 0.82] : white;
      bx(-W, -D, W, D - 2, e, top, col);
      if (sh === 'fridge2') { bx(-W, D - 2, -0.5, D, e + 2, top - 2, col); bx(0.5, D - 2, W, D, e + 2, top - 2, col); for (const s of [-1, 1]) bx(s * 4 - 1, D, s * 4 + 1, D + 3, e + 70, e + 150, chrome); }
      else { bx(-W, D - 2, W, D, e + 2, e + (H || 180) * 0.62, col); bx(-W, D - 2, W, D, e + (H || 180) * 0.63, top - 2, col); for (const [za, zb] of [[e + 40, e + 100], [e + 125, e + 160]]) bx(W - 8, D, W - 6, D + 3, za, zb, chrome); }
      return true;
    }
    if (sh === 'stove') {
      const top = e + (H || 85);
      bx(-W, -D, W, D, e, top - 2, white);
      bx(-W, -D, W, D, top - 2, top, black);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cy(sx * W * 0.45, sy * D * 0.4, 8, top, top + 0.6, [0.2, 0.2, 0.22], 12);
      face([V(-W + 6, D + 0.3, e + 15), V(W - 6, D + 0.3, e + 15), V(W - 6, D + 0.3, top - 25), V(-W + 6, D + 0.3, top - 25)], [0.15, 0.15, 0.17], V(0, 0, e + 40), true);
      bx(-W + 8, D, W - 8, D + 3, top - 22, top - 19, chrome);
      return true;
    }
    if (sh === 'diningtable') {
      // стол и стулья вокруг — как на плане
      bx(-W, -D, W, D, e + (H || 75) - 4, e + (H || 75), C('#b88a5a'));
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bx(sx * (W - 6) - 2.5, sy * (D - 6) - 2.5, sx * (W - 6) + 2.5, sy * (D - 6) + 2.5, e, e + (H || 75) - 4, C('#9a7550'));
      const seats = def.seats || 4, per = Math.max(1, Math.round((seats - (w > 140 ? 2 : 0)) / 2));
      const chair = (x, y, dir) => {
        // dir — куда смотрит спинка (наружу от стола): вектор в локальных осях стола
        const cw = 44, cd = 42, ch = C('#8a6a4c'), seat = C('#c2b5a0');
        const along = Math.abs(dir.x) > 0.5;
        const X0 = x - (along ? cd : cw) / 2, X1 = x + (along ? cd : cw) / 2, Y0 = y - (along ? cw : cd) / 2, Y1 = y + (along ? cw : cd) / 2;
        for (const [px, py] of [[X0 + 3, Y0 + 3], [X1 - 3, Y0 + 3], [X1 - 3, Y1 - 3], [X0 + 3, Y1 - 3]]) bx(px - 1.5, py - 1.5, px + 1.5, py + 1.5, e, e + 44, ch);
        bx(X0, Y0, X1, Y1, e + 44, e + 48, seat);
        const bxX = dir.x > 0 ? [X1 - 3, X1] : dir.x < 0 ? [X0, X0 + 3] : [X0, X1], bxY = dir.y > 0 ? [Y1 - 3, Y1] : dir.y < 0 ? [Y0, Y0 + 3] : [Y0, Y1];
        bx(bxX[0], bxY[0], bxX[1], bxY[1], e + 48, e + 92, ch);
      };
      for (let i = 0; i < per; i++) { const x = -W + w * (i + 0.5) / per; chair(x, -D - 21 + 12, { x: 0, y: -1 }); chair(x, D + 21 - 12, { x: 0, y: 1 }); }
      if (w > 140) { chair(-W - 21 + 12, 0, { x: -1, y: 0 }); chair(W + 21 - 12, 0, { x: 1, y: 0 }); }
      return true;
    }
    if (sh === 'chair') {
      const ch = C('#8a6a4c');
      for (const [px, py] of [[-W + 3, -D + 3], [W - 3, -D + 3], [W - 3, D - 3], [-W + 3, D - 3]]) bx(px - 1.5, py - 1.5, px + 1.5, py + 1.5, e, e + 44, ch);
      bx(-W, -D, W, D, e + 44, e + 48, C('#c2b5a0')); bx(-W, -D, W, -D + 3, e + 48, e + (H || 90), ch);
      return true;
    }
    if (sh === 'round' && it.key === 'barstool') {
      cy(0, 0, 3, e, e + (H || 75) - 5, chrome, 8); cy(0, 0, 18, e, e + 2, chrome, 14); cy(0, 0, W, e + (H || 75) - 5, e + (H || 75), C('#5a4636'), 16); cy(0, 0, W * 0.8, e + 25, e + 27, chrome, 14);
      return true;
    }
    // --- дымоход и вентканал: внутри дома оштукатурен, над крышей — кирпичный оголовок с колпаком; вентстояк — с дефлектором ---
    if (def.stack) {
      const top = e + Checks.stackH(it), st = Checks.stack(it), roofZ = st ? Math.min(st.roofZ, top) : top;
      if (sh === 'ventPipe') {
        cy(0, 0, W, e, top, [0.88, 0.89, 0.9], 14);
        cy(0, 0, W + 3, Math.max(e, roofZ - 5), top - 4, [0.55, 0.57, 0.6], 14);          // утеплённая часть над кровлей
        for (const a of [0, 1, 2, 3]) { const q = { x: Math.cos(a * Math.PI / 2) * W, y: Math.sin(a * Math.PI / 2) * W }; cy(q.x, q.y, 0.8, top, top + 12, chrome, 4); }
        cy(0, 0, W * 1.7, top + 12, top + 15, [0.72, 0.74, 0.77], 16);                     // дефлектор
        return true;
      }
      const brick = C(sh === 'chimney' ? '#8f5a45' : '#a86a52'), plaster = C('#e8e4dc');
      bx(-W, -D, W, D, e, roofZ, plaster);
      if (top > roofZ + 1) {
        bx(-W, -D, W, D, roofZ - 2, top - 10, brick);
        bx(-W - 4, -D - 4, W + 4, D + 4, top - 10, top - 4, brick.map(x => x * 0.88));    // выступ оголовка
        bx(-W, -D, W, D, top - 4, top, brick);
        for (const [px, py] of [[-W, -D], [W, -D], [W, D], [-W, D]]) bx(px - 1.5, py - 1.5, px + 1.5, py + 1.5, top, top + 16, [0.3, 0.31, 0.33]);
        bx(-W - 8, -D - 8, W + 8, D + 8, top + 16, top + 18, [0.4, 0.42, 0.45]);            // колпак
      }
      return true;
    }
    // --- печи и камины: цоколь, кладка, дверца топки со стеклом и отсветом огня, предтопочный лист ---
    const fire = [1, 0.55, 0.18], glassDark = [0.16, 0.1, 0.08], iron = [0.16, 0.16, 0.17];
    const door = (x0, x1, za, zb, glow) => {
      bx(x0 - 2, D, x1 + 2, D + 1.5, za - 2, zb + 2, iron);
      face([V(x0, D + 1.6, za), V(x1, D + 1.6, za), V(x1, D + 1.6, zb), V(x0, D + 1.6, zb)], glow ? glassDark : iron, V(0, 0, (za + zb) / 2));
      if (glow) face([V(x0 + 4, D + 1.7, za + 2), V(x1 - 4, D + 1.7, za + 2), V(x1 - 8, D + 1.7, za + (zb - za) * 0.55), V(x0 + 8, D + 1.7, za + (zb - za) * 0.55)], fire, V(0, 0, (za + zb) / 2));
      bx(x1 - 4, D + 1.5, x1 - 2, D + 4, (za + zb) / 2 - 5, (za + zb) / 2 + 5, chrome);   // ручка
    };
    const sheet = (fw) => bx(-fw / 2, D, fw / 2, D + 50, e, e + 0.6, [0.62, 0.63, 0.65]);    // лист 50×70 перед топкой
    if (sh === 'stoveHeat') {
      const brick = C('#b5654a'), top = e + (H || 200);
      bx(-W - 2, -D - 2, W + 2, D + 2, e, e + 10, brick.map(x => x * 0.75));
      bx(-W, -D, W, D, e + 10, top - 14, brick);
      for (let z = e + 40; z < top - 30; z += 45) bx(-W - 0.4, -D - 0.4, W + 0.4, D + 0.4, z, z + 1.2, brick.map(x => x * 0.8));   // швы-пояса
      bx(-W - 4, -D - 4, W + 4, D + 4, top - 14, top - 6, brick.map(x => x * 0.9));                                             // карниз
      bx(-W, -D, W, D, top - 6, top, brick);
      const fw = Math.min(46, w * 0.45);
      if (it.key === 'stoveKitchen') {
        bx(-W, D - 1, W, D + 1, e + 78, e + 80, iron);                                                     // варочная плита на уровне стола
        bx(-W + 6, -D + 6, W - 6, D - 20, e + 78, e + 80, iron);
      }
      door(-fw / 2, fw / 2, e + 32, e + 70, true);
      door(-fw * 0.35, fw * 0.35, e + 14, e + 26, false);                                                    // поддувало
      door(-fw * 0.3, fw * 0.3, top - 50, top - 38, false);                                                  // прочистка
      sheet(70);
      return true;
    }
    if (sh === 'fireplace' || sh === 'fireplaceCorner') {
      const stone = C('#cfc6ba'), top = e + (H || 120), fw = Math.min(w * 0.55, 80), fh = Math.min(70, (H || 120) * 0.6);
      bx(-W, -D, W, D, e + 8, top, stone);
      bx(-W - 6, -D, W + 6, D + 6, top, top + 6, stone.map(x => x * 0.9));                     // полка
      bx(-W - 4, -D, W + 4, D + 45, e, e + 8, C('#8e867c'));                                    // подиум перед топкой
      face([V(-fw / 2, D + 0.3, e + 8), V(fw / 2, D + 0.3, e + 8), V(fw / 2, D + 0.3, e + 8 + fh), V(-fw / 2, D + 0.3, e + 8 + fh)], glassDark, V(0, 0, e + 40));
      face([V(-fw / 3, D + 0.4, e + 10), V(fw / 3, D + 0.4, e + 10), V(fw / 6, D + 0.4, e + 8 + fh * 0.6), V(-fw / 6, D + 0.4, e + 8 + fh * 0.6)], fire, V(0, 0, e + 40));
      for (const x of [-fw / 2 - 6, fw / 2]) bx(x, D, x + 6, D + 2, e + 8, e + 8 + fh + 6, stone.map(v => v * 0.85));   // портал
      bx(-fw / 2 - 6, D, fw / 2 + 6, D + 2, e + 8 + fh, e + 14 + fh, stone.map(v => v * 0.85));
      return true;
    }
    if (sh === 'stoveMetal') {
      const top = e + (H || 80), fw = Math.min(w - 10, 36);
      for (const [px, py] of [[-W + 4, -D + 4], [W - 4, -D + 4], [W - 4, D - 4], [-W + 4, D - 4]]) bx(px - 2, py - 2, px + 2, py + 2, e, e + 12, iron);
      bx(-W, -D, W, D, e + 12, top, [0.2, 0.2, 0.21]);
      door(-fw / 2, fw / 2, e + 22, e + 22 + Math.min(40, (H || 80) * 0.45), true);
      if (it.key === 'saunaStove') { bx(-W + 3, -D + 3, W - 3, D - 3, top, top + 25, [0.26, 0.26, 0.27]); for (let k = 0; k < 7; k++) cy(-W / 2 + (k % 3) * W / 2, -D / 2 + Math.floor(k / 3) * D / 2, 7, top + 18, top + 30, [0.45, 0.43, 0.41], 7); }
      sheet(70);
      return true;
    }
    // --- растения: ствол с ветками, крона из нескольких «облаков»; у плодовых — плоды; хвойные — ярусами ---
    const { cone, blob, wire, prism } = View3D._g;
    const rnd = (k) => View3D.noise(it.x * 0.37 + k * 1.7, it.y * 0.53 + k * 2.3);
    const tint = (c, k) => c.map(x => Math.min(1, x * (0.9 + rnd(k) * 0.2)));
    if (sh === 'tree') {
      const R = Math.min(W, D), Ht = H || 500, fruit = it.key === 'fruitTree';
      const bark = [0.4, 0.29, 0.19], trunkH = Ht * (fruit ? 0.3 : 0.38), tr = Math.max(6, R * (fruit ? 0.05 : 0.055));
      cone(it.x, it.y, tr * 1.3, tr * 0.7, e, e + trunkH + Ht * 0.15, bark, 9);
      const nb = fruit ? 4 : 5, zc = e + trunkH + (Ht - trunkH) * 0.48, rz = (Ht - trunkH) * 0.5;
      for (let k = 0; k < nb; k++) {
        const a = (k + rnd(k)) / nb * Math.PI * 2, rr = R * (0.35 + rnd(k + 9) * 0.15);
        wire([it.x, it.y, e + trunkH * (0.8 + rnd(k + 3) * 0.3)], [it.x + Math.cos(a) * rr, it.y + Math.sin(a) * rr, zc + rz * (0.1 + rnd(k + 5) * 0.3)], tr * 0.4, bark);
      }
      const green = fruit ? [0.42, 0.66, 0.3] : [0.36, 0.6, 0.27];
      blob(it.x, it.y, zc, R * 0.72, rz * 0.85, tint(green, 1), it.x);
      for (let k = 0; k < 5; k++) {
        const a = (k + rnd(k + 20)) / 5 * Math.PI * 2, off = R * 0.38;
        blob(it.x + Math.cos(a) * off, it.y + Math.sin(a) * off, zc + rz * (rnd(k + 30) * 0.5 - 0.2), R * (0.42 + rnd(k + 40) * 0.12), rz * 0.55, tint(green, k + 50).map(x => x * (0.92 + 0.08 * (k % 2))), it.y + k);
      }
      if (fruit) {
        const fc = rnd(99) > 0.5 ? [0.82, 0.18, 0.12] : [0.9, 0.72, 0.18];
        for (let k = 0; k < 14; k++) {
          const a = rnd(k + 60) * Math.PI * 2, t = rnd(k + 70) * 0.9 - 0.45;
          const rr = R * 0.8 * Math.sqrt(1 - t * t);
          View3D._g.cyl(it.x + Math.cos(a) * rr, it.y + Math.sin(a) * rr, 4.5, zc + t * rz * 0.9 - 4, zc + t * rz * 0.9 + 4, fc, 6);
        }
      }
      return true;
    }
    if (sh === 'conifer') {
      const R = Math.min(W, D), Ht = H || 600, thuja = it.key === 'thuja', dark = [0.18, 0.4, 0.26];
      View3D._g.cyl(it.x, it.y, Math.max(4, R * 0.07), e, e + Ht * 0.14, [0.36, 0.25, 0.16], 8);
      if (thuja) {
        cone(it.x, it.y, R * 0.55, R * 0.8, e + Ht * 0.05, e + Ht * 0.45, tint(dark, 1), 14);
        cone(it.x, it.y, R * 0.8, R * 0.45, e + Ht * 0.45, e + Ht * 0.82, tint(dark, 2), 14);
        cone(it.x, it.y, R * 0.45, 0, e + Ht * 0.82, e + Ht, tint(dark, 3), 14);
        return true;
      }
      const tiers = 7;
      for (let k = 0; k < tiers; k++) {
        const z0 = e + Ht * (0.1 + k * 0.12), z1 = Math.min(e + Ht, z0 + Ht * 0.24), r = R * (1 - k / tiers * 0.88);
        cone(it.x, it.y, r, r * 0.12, z0, z1, tint(dark, k).map(x => x * (0.88 + k * 0.03)), 14);
      }
      cone(it.x, it.y, R * 0.12, 0, e + Ht * 0.92, e + Ht, tint(dark, 9), 8);
      return true;
    }
    if (sh === 'bush') {
      const R = Math.min(W, D), Ht = H || 150, green = [0.37, 0.6, 0.28];
      blob(it.x, it.y, e + Ht * 0.48, R * 0.8, Ht * 0.48, tint(green, 1), it.x);
      for (let k = 0; k < 3; k++) {
        const a = (k + rnd(k)) / 3 * Math.PI * 2, off = R * 0.35;
        blob(it.x + Math.cos(a) * off, it.y + Math.sin(a) * off, e + Ht * (0.35 + rnd(k + 5) * 0.15), R * 0.58, Ht * 0.36, tint(green, k + 3), it.y + k);
      }
      return true;
    }
    if (sh === 'hedge') {
      const Ht = H || 180, green = [0.31, 0.54, 0.24];
      bx(-W + 10, -D * 0.7, W - 10, D * 0.7, e, e + Ht * 0.85, green.map(x => x * 0.85));
      const n = Math.max(2, Math.round(w / 60));
      for (let k = 0; k < n; k++) {
        const x = -W + (k + 0.5) * w / n, q = L(x, 0);
        blob(q.x, q.y, e + Ht * (0.55 + rnd(k) * 0.08), Math.max(D, w / n * 0.62), Ht * 0.48, tint(green, k), q.x + k);
      }
      return true;
    }
    // --- беседка: восьмигранная, на фундаменте с настилом, столбы, перила с балясинами, скамьи и стол внутри,
    //     шатровая восьмискатная крыша со свесом и навершием; вход — спереди (+d/2) ---
    if (sh === 'gazebo') {
      const n = 8, sec = 1 / Math.cos(Math.PI / n), Ht = H || 300;
      const vx = (i, k = 1) => { const a = (i + 0.5) * Math.PI * 2 / n; return { x: Math.cos(a) * W * sec * k, y: Math.sin(a) * D * sec * k }; };
      const wood = [0.62, 0.44, 0.27], dk = wood.map(x => x * 0.78), deckC = [0.7, 0.53, 0.35], stone = [0.62, 0.6, 0.56];
      const eave = e + Math.max(220, Ht * 0.7), fl = e + 17;
      const oct = (k) => Array.from({ length: n }, (_, i) => { const p = vx(i, k); return L(p.x, p.y); });
      prism(oct(1.03), e, e + 12, stone);                                                              // фундамент
      prism(oct(1), e + 12, fl, deckC);                                                                 // настил
      // брус от a до b (локальные точки) — повёрнут по направлению в плане
      const beam = (a, b, z0, zz, t, col) => { const qa = L(a.x, a.y), qb = L(b.x, b.y); View3D._g.box((qa.x + qb.x) / 2, (qa.y + qb.y) / 2, G.dist(qa, qb), t, U.deg(Math.atan2(qb.y - qa.y, qb.x - qa.x)), z0, zz, col); };
      const posts = Array.from({ length: n }, (_, i) => vx(i, 0.95));
      for (const p of posts) { const q = L(p.x, p.y); View3D._g.box(q.x, q.y, 12, 12, rot + U.deg(Math.atan2(p.y, p.x)), fl, eave, wood); }
      const entry = 1;                                                                                  // сторона между вершинами 1 и 2 — спереди
      for (let i = 0; i < n; i++) {
        const a = posts[i], b = posts[(i + 1) % n];
        beam(a, b, eave - 16, eave, 11, wood);                                                          // обвязка
        beam(a, b, eave - 34, eave - 30, 4, dk);                                                        // фриз
        const len = G.dist(a, b), u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        for (const t of [0.12, 0.88]) { const p = { x: a.x + u.x * len * t, y: a.y + u.y * len * t }; beam(p, p, eave - 30, eave - 16, 3, dk); }   // стойки фриза
        if (i === entry) { const s2 = { x: 0, y: D * 1.02 }; beam({ x: -45, y: s2.y + 15 }, { x: 45, y: s2.y + 15 }, e, e + 8, 30, stone); continue; }   // ступень у входа
        beam(a, b, fl + 8, fl + 14, 6, dk); beam(a, b, fl + 78, fl + 86, 8, wood);                   // низ и поручень
        const nb = Math.max(2, Math.floor(len / 13));
        for (let k = 1; k < nb; k++) { const p = { x: a.x + u.x * len * k / nb, y: a.y + u.y * len * k / nb }; const q = L(p.x, p.y); View3D._g.box(q.x, q.y, 3.5, 3.5, rot, fl + 14, fl + 78, wood); }   // балясины
        // скамья вдоль стороны, внутри
        const inn = { x: -(u.y), y: u.x }, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const sgn = (m.x * inn.x + m.y * inn.y) > 0 ? -1 : 1, off = 24 * sgn;
        const sa = { x: a.x + u.x * 14 + inn.x * off, y: a.y + u.y * 14 + inn.y * off }, sb = { x: b.x - u.x * 14 + inn.x * off, y: b.y - u.y * 14 + inn.y * off };
        beam(sa, sb, fl + 40, fl + 45, 36, deckC);
        for (const p of [sa, sb]) beam(p, p, fl, fl + 40, 5, dk);
      }
      // стол по центру
      View3D._g.prism(Array.from({ length: n }, (_, i) => { const p = vx(i, 0.3); return L(p.x, p.y); }), fl + 71, fl + 75, deckC);
      View3D._g.cyl(it.x, it.y, 6, fl, fl + 71, dk, 8);
      View3D._g.prism(Array.from({ length: n }, (_, i) => { const p = vx(i, 0.14); return L(p.x, p.y); }), fl, fl + 3, dk);
      // крыша: восемь скатов от карниза со свесом к навершию
      const R2 = 1.22, apex = eave + Math.max(W, D) * sec * R2 * Math.tan(U.rad(33));
      const roofC = View3D.hex((ROOF_MATERIALS.soft || { color: '#7d4b3a' }).color), under = [0.72, 0.58, 0.42];
      for (let i = 0; i < n; i++) {
        const a = vx(i, R2), b = vx((i + 1) % n, R2);
        face([V(a.x, a.y, eave), V(b.x, b.y, eave), V(0, 0, apex)], roofC, V(0, 0, eave - 60));
        face([V(a.x, a.y, eave - 3), V(b.x, b.y, eave - 3), V(0, 0, apex - 3)], under, V(0, 0, apex + 80));     // подшивка изнутри
        beam(a, b, eave - 12, eave - 2, 3, dk);                                                         // лобовая доска
      }
      View3D._g.cyl(it.x, it.y, 4, apex - 6, apex + 28, dk, 8); View3D._g.cyl(it.x, it.y, 7, apex + 28, apex + 36, dk, 10);   // навершие
      return true;
    }
    // --- мангал: короб на ножках с поддувалами, угли с отсветом, шампуры с мясом, полка внизу ---
    if (sh === 'bbq') {
      const top = e + (H || 90), zt = top - 20, steel = [0.17, 0.17, 0.18];
      for (const [px, py] of [[-W + 3, -D + 3], [W - 3, -D + 3], [W - 3, D - 3], [-W + 3, D - 3]]) bx(px - 1.5, py - 1.5, px + 1.5, py + 1.5, e, zt, steel);
      bx(-W + 3, -D + 3, W - 3, D - 3, e + 22, e + 23.5, steel);                                       // полка для дров
      for (let x = -W + 10; x < W - 8; x += 11) bx(x, -D + 6, x + 8, D - 6, e + 23.5, e + 29, [0.52, 0.36, 0.22]);   // поленья
      bx(-W, -D, W, D, zt, zt + 1.5, steel);                                                            // дно
      for (const [x0, y0, x1, y1] of [[-W, -D, W, -D + 1.2], [-W, D - 1.2, W, D], [-W, -D, -W + 1.2, D], [W - 1.2, -D, W, D]]) bx(x0, y0, x1, y1, zt, top, steel);
      for (let x = -W + 8; x < W - 5; x += 10) for (const y of [-D - 0.1, D - 0.1]) bx(x, y, x + 5, y + 0.3, zt + 4, zt + 8, [0.05, 0.05, 0.05]);   // поддувала
      bx(-W + 2, -D + 2, W - 2, D - 2, zt + 1.5, zt + 6, [0.16, 0.1, 0.08]);                           // угли
      for (let k = 0; k < 9; k++) { const x = -W + 6 + (w - 12) * View3D.noise(it.x + k, it.y), y = -D + 5 + (d - 10) * View3D.noise(it.y + k, it.x); bx(x - 2, y - 2, x + 2, y + 2, zt + 6, zt + 6.5, [0.95, 0.42, 0.12]); }   // жар
      const n2 = Math.max(3, Math.floor((w - 12) / 10)), meat = [0.55, 0.28, 0.17];
      for (let k = 0; k < n2; k++) {
        const x = -W + 8 + k * (w - 16) / Math.max(1, n2 - 1);
        bx(x - 0.35, -D - 4, x + 0.35, D + 4, top + 1, top + 1.6, chrome);                              // шампур
        bx(x - 1, -D - 14, x + 1, -D - 4, top + 0.5, top + 2.2, [0.45, 0.3, 0.18]);                     // ручка
        for (const t of [-0.25, 0, 0.25]) bx(x - 2.2, t * d - 2.5, x + 2.2, t * d + 2.5, top - 0.5, top + 3.5, meat);
      }
      for (const s2 of [-1, 1]) bx(s2 > 0 ? W : -W - 4, -5, s2 > 0 ? W + 4 : -W, 5, top - 6, top - 4, steel);   // ручки по бокам
      return true;
    }
    // --- колодцы и ёмкости на участке ---
    // кольцо из бетонных сегментов (стенка с толщиной t)
    const ringWall = (R, t, za, zb, col, n = 18) => {
      for (let k = 0; k < n; k++) {
        // без зеркала (кольцо симметрично): иначе у «Зеркально» положение сегмента отражено, а поворот — нет
        const a = (k + 0.5) / n * Math.PI * 2, q = G.toWorld({ x: Math.cos(a) * (R - t / 2), y: Math.sin(a) * (R - t / 2) }, it.x, it.y, rot);
        View3D._g.box(q.x, q.y, 2 * Math.PI * R / n + 1, t, rot + U.deg(a) + 90, za, zb, col);
      }
    };
    const conc = [0.68, 0.67, 0.64];
    if (sh === 'ring') {
      const R = Math.min(W, D), top = e + Math.max(12, H || 10), septicK = it.key === 'septicRing' || it.key === 'cesspool';
      ringWall(R, 9, e - 10, top - 6, conc);
      cy(0, 0, R, top - 6, top, conc.map(x => x * 0.95), 20);                                           // плита перекрытия
      const hatch = septicK ? [0.24, 0.42, 0.28] : [0.2, 0.2, 0.22];
      cy(0, 0, 34, top, top + 2.5, hatch, 18);                                                            // люк
      for (let k = -2; k <= 2; k++) bx(-28, k * 9 - 0.8, 28, k * 9 + 0.8, top + 2.5, top + 3, hatch.map(x => x * 0.75));   // рифление
      bx(-6, 26, 6, 29, top + 2.5, top + 4, hatch.map(x => x * 0.7));                                     // ручка
      if (septicK) { cy(R * 0.62, 0, 5.5, top, top + 60, [0.86, 0.87, 0.88], 10); cy(R * 0.62, 0, 8, top + 60, top + 64, [0.86, 0.87, 0.88], 10); }   // вентиляционный стояк
      return true;
    }
    if (sh === 'septic') {
      const ch = def.chambers || 2, body = [0.36, 0.44, 0.34], lid = [0.28, 0.46, 0.3];
      bx(-W, -D, W, D, e, e + 4, body);
      for (let k = 0; k < ch; k++) {
        const x = -W + (k + 0.5) * w / ch, r = Math.min(D * 0.38, 32);
        cy(x, 0, r, e + 4, e + 16, lid.map(v => v * 0.85), 16); cy(x, 0, r + 2, e + 16, e + 19, lid, 16);
        bx(x - 5, r - 4, x + 5, r - 1, e + 19, e + 20.5, lid.map(v => v * 0.7));
      }
      const vx = W - 18;
      cy(vx, -D + 18, 5.5, e + 4, e + 70, [0.86, 0.87, 0.88], 10); cy(vx, -D + 18, 8, e + 70, e + 74, [0.86, 0.87, 0.88], 10);
      return true;
    }
    if (sh === 'borehole') {
      const R = Math.min(W, D);
      bx(-R, -R, R, R, e, e + 2, [0.72, 0.71, 0.68]);                                                    // отмостка у люка
      const neck = it.key === 'boreholeArt' ? [0.55, 0.58, 0.62] : [0.22, 0.4, 0.62];
      cy(0, 0, R * 0.42, e + 2, e + 38, neck, 20);                                                        // горловина кессона
      cy(0, 0, R * 0.47, e + 38, e + 43, neck.map(x => x * 0.85), 20);                                    // крышка
      bx(-8, R * 0.3, 8, R * 0.34, e + 43, e + 45, [0.2, 0.2, 0.22]);
      cy(-R * 0.3, -R * 0.3, 2.5, e + 43, e + 80, [0.85, 0.86, 0.87], 8); bx(-R * 0.3 - 5, -R * 0.3 - 2, -R * 0.3 + 1, -R * 0.3 + 2, e + 76, e + 80, [0.85, 0.86, 0.87]);   // вентиляция кессона
      return true;
    }
    if (sh === 'well') {
      const R = Math.min(W, D), top = e + Math.max(60, H || 80), wood = [0.55, 0.4, 0.26];
      ringWall(R, 10, e - 5, top, conc);
      bx(-R, -R, R, R, e, e + 1.5, [0.6, 0.58, 0.55]);
      prism(View3D._g.ring(it.x, it.y, R - 10, R - 10, 16, rot), top - 70, top - 69, [0.12, 0.2, 0.28]);   // вода в глубине
      const roofZ = Math.max(e + 190, top + 70);                                                          // крыша выше ворота
      for (const s2 of [-1, 1]) bx(s2 * (R + 4) - 4, -4, s2 * (R + 4) + 4, 4, e, roofZ, wood);            // стойки
      bx(-R - 2, -7, R + 2, 7, top + 40, top + 54, wood.map(x => x * 0.9));                                // ворот
      bx(R + 8, -1.5, R + 11, 1.5, top + 45, top + 60, [0.3, 0.3, 0.32]); bx(R + 8, -1.5, R + 25, 1.5, top + 58, top + 61, [0.3, 0.3, 0.32]);   // ручка
      cy(R * 0.45, R * 0.45, 11, top, top + 22, [0.6, 0.62, 0.65], 12);                                    // ведро на срубе
      View3D.roof({ x: it.x, y: it.y, w: w + 40, d: d + 30, rot, type: 'gable', pitch: 40, base: roofZ, mat: 'soft', floor: null });
      return true;
    }
    // --- котельная: котлы, баки, водоподготовка, газовый счётчик и кран, коллектор, щит ---
    const red = [0.78, 0.18, 0.14], blue = [0.2, 0.4, 0.75], yellow = [0.93, 0.75, 0.1], grey = [0.62, 0.64, 0.67];
    if (it.key === 'gasBoilerWall' || it.key === 'elBoiler') {
      const gas = it.key === 'gasBoilerWall', hb = gas ? Math.max(60, H || 72) : Math.max(45, H || 60), zb = e + (gas ? 95 : 110), zt = zb + hb;
      bx(-W, -D, W, D, zb, zt, [0.95, 0.95, 0.94]);
      bx(-W + 3, D, W - 3, D + 0.4, zb + 6, zb + hb * 0.28, [0.84, 0.85, 0.87]);                                    // панель управления
      bx(-6, D + 0.4, 6, D + 0.7, zb + hb * 0.14, zb + hb * 0.24, [0.08, 0.14, 0.2]);                             // дисплей
      const cols = gas ? [red, blue, yellow, blue, red] : [red, red.map(x => x * 0.8), blue];
      cols.forEach((c2, i) => { const x = -W * 0.6 + i * (W * 1.2 / Math.max(1, cols.length - 1)); cy(x, -D + 9, 1.1, zb - 30, zb, c2, 8); bx(x - 2, -D + 7, x + 2, -D + 11, zb - 16, zb - 12, c2.map(v => v * 0.8)); });
      if (gas) { cy(0, -D + 10, 5, zt, zt + 18, [0.92, 0.92, 0.92], 14); bx(-5, -D, 5, -D + 15, zt + 10, zt + 20, [0.92, 0.92, 0.92]); }   // коаксиальный дымоход в стену / канал
      else bx(W - 6, -D, W - 2, -D + 3, zb - 40, zb, [0.15, 0.15, 0.16]);                                          // кабель
      return true;
    }
    if (it.key === 'boilerFloor') {
      const top = e + (H || 85);
      bx(-W, -D, W, D, e, top, [0.93, 0.93, 0.92]);
      bx(-W + 3, D, W - 3, D + 0.4, top - 18, top - 4, [0.84, 0.85, 0.87]); bx(-7, D + 0.4, 7, D + 0.7, top - 14, top - 8, [0.08, 0.14, 0.2]);
      cy(0, -D + 12, 7, top, top + 30, grey, 14);
      for (const [x, c2] of [[-W + 8, red], [W - 8, blue]]) cy(x, -D + 5, 1.5, top, top + 25, c2, 8);
      return true;
    }
    if (sh === 'boiler') {
      const k = it.key, R = Math.min(W, D) - 1, white = [0.94, 0.94, 0.93];
      if (k === 'expansionTank') {
        const zb = e + 60, zt = zb + (H || 50);
        cy(0, 0, R, zb, zt, red, 18); cy(0, 0, R * 0.3, zt, zt + 3, grey, 8);
        cy(0, 0, 1.2, zb - 25, zb, grey, 8); bx(-3, -D, 3, -D + 2, zb + 10, zt - 10, grey);                           // подводка и кронштейн
        return true;
      }
      if (k === 'hydroTank') {
        for (const [px, py] of [[-R * 0.6, -R * 0.6], [R * 0.6, -R * 0.6], [0, R * 0.7]]) cy(px, py, 1.5, e, e + 10, grey, 6);
        cy(0, 0, R, e + 10, e + (H || 85) - 8, blue, 20); cy(0, 0, R * 0.8, e + (H || 85) - 8, e + (H || 85) - 4, blue.map(x => x * 0.85), 18);
        const zt = e + (H || 85) - 4;
        cy(0, 0, 2, zt, zt + 10, grey, 8); bx(-6, -3, 6, 3, zt + 10, zt + 13, grey);                               // штуцер и коллектор
        bx(-9, -3, -5, 3, zt + 13, zt + 20, [0.2, 0.2, 0.22]); cy(6, 0, 3, zt + 13, zt + 14, white, 12);         // реле давления и манометр
        return true;
      }
      if (k === 'filter') {
        cy(0, 0, R * 0.62, e, e + (H || 150) - 22, [0.22, 0.32, 0.55], 18);
        bx(-9, -9, 9, 9, e + (H || 150) - 22, e + (H || 150), [0.14, 0.14, 0.16]);                                   // блок управления
        bx(-3, D - 10, 3, D - 2, e + (H || 150) - 10, e + (H || 150) - 4, [0.3, 0.6, 0.9]);
        for (const x of [-12, 12]) cy(x, 0, 1.2, e + (H || 150) - 16, e + 200, grey, 8);
        return true;
      }
      if (k === 'indirect') {
        for (const [px, py] of [[-R * 0.6, -R * 0.6], [R * 0.6, -R * 0.6], [0, R * 0.7]]) cy(px, py, 2, e, e + 6, grey, 6);
        cy(0, 0, R, e + 6, e + (H || 120) - 6, white, 22); cy(0, 0, R * 0.85, e + (H || 120) - 6, e + (H || 120), white.map(x => x * 0.95), 20);
        for (const [z, c2] of [[0.25, blue], [0.45, red], [0.62, blue], [0.8, red]]) bx(-3, R - 2, 3, R + 6, e + (H || 120) * z - 1.5, e + (H || 120) * z + 1.5, c2);
        cy(0, 0, 1.5, e + (H || 120), e + (H || 120) + 12, grey, 8);
        return true;
      }
      // водонагреватель — на стене
      const zb = e + 110, zt = zb + (H || 60);
      cy(0, 0, R, zb, zt, white, 20); cy(0, 0, R * 0.3, zb - 3, zb, grey, 10);
      for (const [x, c2] of [[-8, blue], [8, red]]) cy(x, 0, 1.1, zb - 35, zb - 3, c2, 8);
      return true;
    }
    if (it.key === 'pumpStation') {
      const top = e + (H || 60);
      cy(0, 0, Math.min(W, D) - 2, e + 5, top - 22, blue, 18);                                                       // бак
      bx(-12, -8, 12, 8, top - 22, top - 8, [0.3, 0.32, 0.36]); cy(0, 0, 7, top - 8, top, [0.3, 0.32, 0.36], 12);   // насос
      bx(8, -3, 14, 3, top - 20, top - 12, [0.2, 0.2, 0.22]);
      return true;
    }
    if (it.key === 'pump') {
      const z = e + 45;
      cy(0, 0, 1.6, z - 20, z + 25, grey, 8);
      bx(-5, -6, 5, 6, z - 4, z + 4, [0.8, 0.2, 0.15]); cy(0, 0, 5.5, z + 4, z + 11, [0.8, 0.2, 0.15], 12);
      return true;
    }
    if (it.key === 'manifold') {
      const zb = e + 50;
      for (const [z, c2] of [[zb + 30, red], [zb + 8, blue]]) {
        bx(-W, -D + 4, W, -D + 8, z - 2, z + 2, c2.map(x => x * 0.9));
        for (let x = -W + 8; x <= W - 8; x += Math.max(8, (w - 16) / 5)) cy(x, -D + 6, 1, z - 18, z - 2, grey, 6);
      }
      bx(-W - 3, -D, -W - 1, -D + 6, zb, zb + 40, grey); bx(W + 1, -D, W + 3, -D + 6, zb, zb + 40, grey);           // кронштейны
      return true;
    }
    if (it.key === 'gasMeter') {
      const zc = e + ((H || 0) < 100 ? 160 : H);
      bx(-W, -D, W, D, zc - 17, zc + 17, [0.78, 0.8, 0.8]);
      bx(-W + 5, D, W - 5, D + 0.4, zc + 2, zc + 10, [0.12, 0.13, 0.15]);                                         // окошко с цифрами
      for (const x of [-W + 6, W - 6]) cy(x, 0, 1.6, zc + 17, e + 225, yellow, 8);                                  // газ вход / выход
      return true;
    }
    if (it.key === 'gasValve') {
      const z = e + (H || 150);
      cy(0, 0, 1.6, z - 30, z + 30, yellow, 8);
      bx(-2.5, -2.5, 2.5, 2.5, z - 3, z + 3, yellow.map(x => x * 0.8));
      bx(-1, 0, 1, 12, z + 3, z + 5, [0.85, 0.15, 0.1]);                                                            // рычаг
      return true;
    }
    if (it.key === 'waterIn') {
      cy(0, 0, 1.8, e, e + 110, blue, 8);
      bx(-3, -3, 3, 3, e + 40, e + 46, [0.72, 0.62, 0.38]); bx(-1, 0, 1, 10, e + 46, e + 48, [0.85, 0.15, 0.1]);   // кран
      cy(0, 5, 3.5, e + 70, e + 71, [0.96, 0.96, 0.96], 12);                                                        // манометр
      return true;
    }
    if (sh === 'panel') {
      const zb = e + 120, zt = zb + Math.max(40, it.h || 60);
      bx(-W, -D, W, D, zb, zt, [0.88, 0.89, 0.9]);
      bx(-W + 2, D, W - 2, D + 0.4, zb + 2, zt - 2, [0.84, 0.85, 0.87]);
      bx(-W + 6, D + 0.4, W - 6, D + 0.6, zt - 22, zt - 8, [0.3, 0.35, 0.4]);                                      // окошко автоматов
      bx(W - 5, D + 0.4, W - 3, D + 2, zb + 20, zb + 30, [0.2, 0.2, 0.22]);
      return true;
    }
    void z0; void z1;
    return false;
  },
  /** Ворота и калитка: столбы, рама, полотно с рёбрами; у откатных — противовес и рельс */
  gate(it, def, e) {
    const { box } = View3D._g, C = View3D.hex, rot = it.rot || 0, w = it.w, H = it.h || 200, sh = def.shape;
    const L = (x, y) => G.toWorld({ x: it.flip ? -x : x, y }, it.x, it.y, rot);
    const bx = (x, y, bw, bd, z0, z1, col) => { const q = L(x, y); box(q.x, q.y, bw, bd, rot, z0, z1, col); };
    const metal = C('#6f7880'), frame = C('#474d53'), post = C('#3d4247');
    const leaf = (x0, x1) => {
      const cx = (x0 + x1) / 2, lw = Math.abs(x1 - x0) - 2;
      bx(cx, 0, lw, 3, e + 8, e + H - 4, metal);
      for (const z of [e + 8, e + H / 2, e + H - 10]) bx(cx, 0, lw, 5, z, z + 6, frame);
      for (const x of [x0, x1]) bx(x + Math.sign(x1 - x0) * 3 * (x === x0 ? 1 : -1), 0, 6, 5, e + 8, e + H - 4, frame);
    };
    if (sh === 'wicket') { for (const x of [-w / 2, w / 2]) bx(x, 0, 8, 8, e, e + H + 10, post); leaf(-w / 2 + 4, w / 2 - 4); return; }
    if (sh === 'gateSlide') {
      const z = gateZone(it, w), tail = w * 0.45;
      for (const x of [-w / 2, w / 2]) bx(x, 0, 12, 12, e, e + H + 10, post);
      leaf(-w / 2 + 6, w / 2 - 6);
      const t0 = z.dir > 0 ? w / 2 : -w / 2 - tail;
      bx(t0 + tail / 2, 0, tail, 4, e + 8, e + 16, frame);                 // противовес
      bx((z.x0 + z.x1) / 2, 0, z.len, 6, e, e + 2, C('#8b8f93'));          // линия отката (фундамент под балку)
      return;
    }
    const wk = def.wicket ? Math.min(100, w * 0.25) : 0, gw = w - wk, x0 = -w / 2;
    for (const x of [x0, x0 + gw, ...(wk ? [w / 2] : [])]) bx(x, 0, 12, 12, e, e + H + 10, post);
    if (def.leaves === 1) leaf(x0 + 6, x0 + gw - 6);
    else { leaf(x0 + 6, x0 + gw / 2 - 1); leaf(x0 + gw / 2 + 1, x0 + gw - 6); }
    if (wk) leaf(x0 + gw + 6, w / 2 - 6);
  },
  /** Автомобиль: кузов со скруглёнными углами, салон-трапеция со стёклами, круглые колёса, фары и фонари */
  car(it, e) {
    const { prism, face, box } = View3D._g, C = View3D.hex, rot = it.rot || 0, w = it.w, d = it.d, H = it.h || 150;
    const L = (x, y) => G.toWorld({ x, y }, it.x, it.y, rot), V = (x, y, z) => { const q = L(x, y); return [q.x / 100, z / 100, q.y / 100]; };
    const body = it.color ? C(it.color) : C('#5d7898'), glass = [0.16, 0.2, 0.26], trim = C('#2b2e33');
    // кузов: скруглённый прямоугольник в плане
    const rr = (hw, hd, r, n = 5) => { const pts = []; for (const [cx, cy, a0] of [[hw - r, hd - r, 0], [-hw + r, hd - r, 90], [-hw + r, -hd + r, 180], [hw - r, -hd + r, 270]]) for (let i = 0; i <= n; i++) { const a = U.rad(a0 + 90 * i / n); pts.push(L(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } return pts; };
    prism(rr(w / 2, d / 2, Math.min(40, w * 0.22)), e + 24, e + 70, body, { topK: 1.08 });
    prism(rr(w / 2 - 2, d / 2 - 2, Math.min(38, w * 0.2)), e + 18, e + 24, trim);      // пороги / бамперы снизу
    // салон: низ шире, верх уже; перед −d/2 — лобовое наклонное
    const zb = e + 70, zt = e + H;
    const b = [[-w / 2 + 8, -d * 0.2], [w / 2 - 8, -d * 0.2], [w / 2 - 8, d * 0.3], [-w / 2 + 8, d * 0.3]];
    const t = [[-w / 2 + 22, -d * 0.06], [w / 2 - 22, -d * 0.06], [w / 2 - 22, d * 0.22], [-w / 2 + 22, d * 0.22]];
    const ref = V(0, d * 0.05, (zb + zt) / 2);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face([V(...b[i], zb), V(...b[j], zb), V(...t[j], zt), V(...t[i], zt)], glass, ref); }
    face(t.map(p => V(...p, zt)), body.map(x => Math.min(1, x * 1.1)), V(0, d * 0.08, zt - 50));
    // стойки между стёклами (светлее кузова по краям крыши)
    for (const sx of [-1, 1]) face([V(sx * (w / 2 - 8), -d * 0.2 + 1, zb), V(sx * (w / 2 - 8), -d * 0.2 + 12, zb), V(sx * (w / 2 - 22), -d * 0.06 + 8, zt), V(sx * (w / 2 - 22), -d * 0.06, zt)], body, V(0, 0, zb));
    // колёса — цилиндры поперёк машины
    const wheel = (cx, cy) => {
      const R = 32, n = 12, zc = e + R, sx = Math.sign(cx), tyre = C('#1c1d20');
      const ring = (r, m) => Array.from({ length: m }, (_, k) => { const a = k / m * Math.PI * 2; return [cy + Math.cos(a) * r, zc + Math.sin(a) * r]; });
      for (const xs of [cx - 11, cx + 11]) face(ring(R, n).map(([y, z]) => V(xs, y, z)), tyre, V(cx, cy, zc));
      const rg = ring(R, n);
      for (let k = 0; k < n; k++) { const [y0, z0] = rg[k], [y1, z1] = rg[(k + 1) % n]; face([V(cx - 11, y0, z0), V(cx + 11, y0, z0), V(cx + 11, y1, z1), V(cx - 11, y1, z1)], tyre, V(cx, cy, zc)); }
      face(ring(17, 10).map(([y, z]) => V(cx + sx * 11.4, y, z)), C('#a9aeb5'), V(cx, cy, zc));    // диск
    };
    for (const cy of [-d * 0.31, d * 0.3]) for (const sx of [-1, 1]) wheel(sx * (w / 2 - 12), cy);
    // фары, фонари, решётка, номера
    for (const sx of [-1, 1]) {
      const f = L(sx * w * 0.33, -d / 2 + 2), r = L(sx * w * 0.36, d / 2 - 2);
      box(f.x, f.y, w * 0.2, 4, rot, e + 52, e + 62, [1, 0.97, 0.82]);
      box(r.x, r.y, w * 0.18, 4, rot, e + 52, e + 62, C('#c4362c'));
    }
    const g = L(0, -d / 2 + 1), n2 = L(0, d / 2 - 1);
    box(g.x, g.y, w * 0.3, 3, rot, e + 36, e + 48, trim);
    box(n2.x, n2.y, 52, 3, rot, e + 36, e + 47, [0.95, 0.95, 0.95]);
  },
  BLD_FLOOR: 10,
  /** Постройка «как дом», внутри которой стоит объект (погреб/яма) — или null */
  bldHost(it) {
    const f1 = App.doc.floors[0].id, fid = it.floor || f1;
    return App.doc.items.find(b => b !== it && (b.floor || f1) === fid && BLD_HOLLOW.has(catItem(b.key).shape) && G.pointInPoly(it, Model.itemPts(b))) || null;
  },
  /** Открытые ямы первого этажа (контуры по наружным стенкам) — вырезы в земле, покрытиях и полу построек */
  pitHoles() {
    const f1 = App.doc.floors[0].id;
    return App.doc.items.filter(it => catItem(it.key).shape === 'pit' && (it.floor || f1) === f1 && pitGeom(it, it.w, it.d).cover === 'open')
      .map(it => { const poly = G.rectPts(it.x, it.y, it.w, it.d, it.rot || 0); return { poly, bb: G.bbox(poly) }; });
  },
  /** Пол постройки (прямоугольник r в её локальных координатах) с вырезами под открытые ямы внутри */
  slab(it, r, z0, z1, col) {
    const pts = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }].map(q => G.toWorld(q, it.x, it.y, it.rot || 0));
    View3D._g.prism(pts, z0, z1, col, { holes: View3D.pitHoles() });
  },
  building(it, def, e) {
    const { box } = View3D._g, C = View3D.hex, sh = def.shape, rot = it.rot || 0, H = it.h || 250;
    // карниз не ниже 1.5 м (у навесов 1.8 м) — иначе уклон уменьшаем
    const hollow = BLD_HOLLOW.has(sh);
    const g0 = View3D.roofGeom(it, e + H, e + (bldRoof(it).open ? 180 : 150), hollow ? e + bldWallH(it) : undefined);
    // пристройка у дома с односкатной крышей — скат упирается под кровлю дома (без свеса и «ступеньки»)
    const g = View3D.leanJoin(it, g0, { world: (q) => G.toWorld(q, it.x, it.y, rot), eave: g0.eave }) || g0;   // как itemRoof: крыша без зеркала
    const { eave, roofZ } = g;
    if (hollow) {
      // «как дом»: пол, стены с толщиной, ворота/дверь; внутри — пусто (погреб, яма, машина, мебель видны без крыши)
      const s = bldShell(it, it.w, it.d);
      const bx = (r, z0, z1, col, opt) => { const q = bldWorld(it, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }); box(q.x, q.y, r.x1 - r.x0, r.y1 - r.y0, rot, z0, z1, col, opt); };
      View3D.slab(it, s.inner, e, e + View3D.BLD_FLOOR, C(sh === 'garage' ? '#b9b8b2' : '#b08a64'));
      const wallC = C(it.key === 'bathhouse' ? '#c79a64' : '#ddd3c3'), baseC = C('#8a857d');
      const band = (r, z0, z1, col, opt) => { if (z1 - z0 > 0.5) { bx(r, z0, Math.min(z1, e + 40), baseC); bx(r, Math.max(z0, e + 40), z1, col, opt); } };
      const piece = (r, z0, z1, col, opt) => { if (z1 - z0 < 0.5) return; if (z0 < e + 40) band(r, z0, z1, col, opt); else bx(r, z0, z1, col, opt); };
      for (const r of s.walls) { bx(r, e, e + 40, baseC); bx(r, e + 40, eave, wallC, { topK: 0.8 }); }
      const F0 = e + View3D.BLD_FLOOR;
      for (const o of s.ops) {
        const top = Math.min(e + o.sill + o.h, eave - 5), bot = e + o.sill;
        piece(o.rect, top, eave, wallC);                                                        // перемычка
        if (o.cat === 'window') {
          piece(o.rect, e, bot, wallC);                                                         // под окном
          const F = o.F, m = G.mul(G.add(G.add(F.c, G.mul(F.u, o.s0)), G.add(F.c, G.mul(F.u, o.s1))), 0.5), half = (o.s1 - o.s0) / 2;
          const along = Math.abs(F.u.x) > 0.5;
          const q = (hw, hd) => along ? { x0: m.x - hw, y0: m.y - hd, x1: m.x + hw, y1: m.y + hd } : { x0: m.x - hd, y0: m.y - hw, x1: m.x + hd, y1: m.y + hw };
          bx(q(half, 2), bot, top, [0.8, 0.9, 0.95], { glass: true });
          bx(q(half, 4), bot, bot + 5, C('#eeeeea')); bx(q(half, 4), top - 5, top, C('#eeeeea'));
          bx(q(2.5, 4), bot, top, C('#eeeeea'));
        } else if (o.type !== 'arch') {
          const F = o.F, m = G.mul(G.add(G.add(F.c, G.mul(F.u, o.s0)), G.add(F.c, G.mul(F.u, o.s1))), 0.5), half = (o.s1 - o.s0) / 2;
          const along = Math.abs(F.u.x) > 0.5, gate = o.type === 'gate';
          const q = (hw, hd, off = 0) => { const c2 = G.add(m, G.mul(F.n, off)); return along ? { x0: c2.x - hw, y0: c2.y - hd, x1: c2.x + hw, y1: c2.y + hd } : { x0: c2.x - hd, y0: c2.y - hw, x1: c2.x + hd, y1: c2.y + hw }; };
          bx(q(half, 2), F0, top, C(gate ? '#b9c0c7' : '#6b4a33'));
          bx(o.rect, e, F0, C('#9b958b'));                                                    // порог
          if (gate) for (let z = e + 50; z < top - 10; z += 50) bx(q(half - 3, 1, -s.t / 2 + 1), z, z + 1.5, C('#9aa3ab'));
        }
      }
    } else if (sh === 'greenhouse') {
      box(it.x, it.y, it.w, it.d, rot, e, eave, [0.8, 0.9, 0.95], { glass: true });
      box(it.x, it.y, it.w, it.d, rot, e, e + 25, C('#8a857d'));
    } else {
      // навес: столбы по углам (у пристроенного — только спереди) и через ~3 м
      const post = 14, lean = sh === 'canopyLean', k = Math.max(1, Math.round(it.w / 300));
      const posts = [];
      for (let i = 0; i <= k; i++) { const x = -it.w / 2 + post / 2 + (it.w - post) * i / k; posts.push({ x, y: it.d / 2 - post / 2 }); if (!lean) posts.push({ x, y: -it.d / 2 + post / 2 }); }
      for (const q of posts) { const wq = G.toWorld(q, it.x, it.y, rot); box(wq.x, wq.y, post, post, rot, e, roofZ(q) - 2, C('#6b5a44')); }
    }
    const gh = sh === 'greenhouse';
    View3D.itemRoof(it, g, { gableGlass: gh, endGlass: gh, endCol: gh ? [0.8, 0.9, 0.95] : null });
  },
  /** Крыльцо / веранда / терраса: цоколь, настил, ступени, ограждение или остекление, крыша */
  /** Предмет на веранде, крыльце или настиле — стоит на их полу, а не на земле */
  deckZ(it) {
    const sh = catItem(it.key).shape;
    if (sh === 'veranda' || sh === 'deck' || sh === 'pit' || BLD_ROOF_SHAPES.has(sh)) return 0;
    const f1 = App.doc.floors[0].id;
    for (const v of App.V.items) {
      if (v === it || (v.floor || f1) !== (it.floor || f1)) continue;
      const vs = catItem(v.key).shape;
      if (vs !== 'veranda' && vs !== 'deck') continue;
      if (!G.pointInPoly(it, Model.itemPts(v))) continue;
      return vs === 'deck' ? 25 : Math.max(porchGeom(v, v.w, v.d).o.ph, 10) + 0.3;
    }
    return 0;
  },
  /** Односкатная крыша пристройки (веранда, гараж, сарай, навес у дома) высокой стороной к дому: край ската
   *  упирается в стену прямо под кровлей дома, свеса с этой стороны нет — крыши не наезжают, нет «ступеньки».
   *  opt.world(q) — локальная точка → план; opt.eave — карниз низкой стороны (у построек — по стенам);
   *  opt.follow — у веранды: уклон как у дома, но карниз не ниже opt.minEave (иначе — перелом ската). */
  leanJoin(it, rg, opt) {
    const R = rg.R, r = rg.r;
    if (R.type !== 'shed' || it.roofJoin === false) return null;
    const W = it.w / 2, D = it.d / 2;
    const edge = { back: (t) => ({ x: t * (W - 10), y: -D }), front: (t) => ({ x: t * (W - 10), y: D }), left: (t) => ({ x: -W, y: t * (D - 10) }), right: (t) => ({ x: W, y: t * (D - 10) }) }[R.shedDir];
    let zb = Infinity, pitch = 0, mat = null;
    for (const t of [-1, 0, 1]) {
      const p = opt.world(edge(t));
      let best = null;
      for (const hr of App.doc.roofs) { const z = Roof.zAt(hr, p); if (z != null && (best == null || z > best.z)) best = { z, r: hr }; }
      if (!best) return null;                                          // над стыком нет крыши дома — крыша как выбрана
      if (best.z < zb) { zb = best.z; pitch = best.r.type === 'flat' ? 0 : best.r.pitch || 0; mat = best.r.mat; }
    }
    zb -= 3;                                                           // чуть ниже кровли дома
    // прямоугольник крыши без свеса со стороны дома (в осях ската высокая сторона — −v)
    const sHigh = R.sides[{ back: 'b', front: 'f', left: 'l', right: 'r' }[R.shedDir]] || 0;
    const sh = G.toWorld({ x: 0, y: sHigh / 2 }, 0, 0, r.rot), c2 = { x: r.x + sh.x, y: r.y + sh.y }, run = r.d - sHigh;
    const front = opt.follow ? Math.max(opt.minEave, zb - Math.tan(U.rad(pitch)) * run) : opt.eave;
    if (!(run > 10) || zb < front + 5) return null;                    // карниз дома ниже стен пристройки — не подвести
    const rise = zb - front, r2 = { x: c2.x, y: c2.y, w: r.w, d: run, rot: r.rot, type: 'shed' };
    const roofZ = (q) => { const v = G.toLocal(q, c2.x, c2.y, r.rot); return front + rise * U.clamp((run / 2 - v.y) / run, 0, 1); };
    // у веранды кровля — как у дома (если свой материал не выбран), у построек — своя
    return { R: { ...R, type: 'shed', mat: it.roofMat || (opt.follow && mat) || R.mat }, r: r2, rise, eave: front, pitch: U.deg(Math.atan(rise / run)), roofZ, joined: true };
  },
  /** Крыша пристроенной веранды — от карниза дома (см. leanJoin) */
  porchJoin(it, rg, z0) {
    if (!porchOpt(it).attached) return null;
    return View3D.leanJoin(it, rg, { world: (q) => G.toWorld(q, it.x, it.y, it.rot || 0), follow: true, minEave: z0 + 215 });
  },
  veranda(it, e) {
    const { box } = View3D._g, C = View3D.hex, rot = it.rot || 0;
    const w = it.w, d = it.d, g = porchGeom(it, w, d), o = g.o;
    const L = (x, y) => G.toWorld({ x, y }, it.x, it.y, rot);
    const bx = (x, y, bw, bd, z0, z1, col, opt) => { const q = L(x, y); box(q.x, q.y, bw, bd, rot, z0, z1, col, opt); };
    const ph = Math.max(o.ph, 10);
    const deck = C('#a8805a'), base = C('#9b958b'), post = C('#6b5a44'), frame = C('#eeeeea'), wall = C('#ddd3c3'), glass = [0.8, 0.9, 0.95];
    // цоколь и настил
    if (ph > 20) bx(0, 0, w - 8, d - 8, e, e + ph - 4, base);
    bx(0, 0, w, d, e + ph - 4, e + ph, deck);
    for (let x = -w / 2 + 7; x < w / 2; x += 14) bx(x, 0, 1, d, e + ph, e + ph + 0.3, C('#8c6848'));
    // ступени: от площадки вниз, наружу
    for (const f of g.flights) for (let i = 1; i < g.steps; i++) {
      const m = G.add(G.mid(f.a, f.b), G.mul(f.out, (i - 0.5) * g.tread)), across = Math.abs(f.out.y) > 0.5;
      bx(m.x, m.y, across ? f.sw : g.tread, across ? g.tread : f.sw, e, e + ph - i * g.rise, i % 2 ? base.map(x => x * 1.05) : base);
    }
    const z0 = e + ph;
    // крыша — как у построек (тип, уклон, материал на выбор); верх — высота объекта, карниз не ниже 2.1 м над настилом
    let rg = o.roofed ? View3D.roofGeom(it, e + Math.max(it.h || 0, o.ph + 260), z0 + 210) : null;
    if (rg) rg = View3D.porchJoin(it, rg, z0) || rg;
    const eave = rg ? rg.eave : z0 + 230;
    // сегмент стороны: построить «ленту» элементов вдоль неё (локальные координаты)
    const seg = (s, t, za, zb, col, opt) => {
      const m = G.add(G.mid(s.a, s.b), G.mul(s.n, t / 2)), L2 = G.dist(s.a, s.b);
      const horiz = Math.abs(s.a.y - s.b.y) < 0.5;
      bx(m.x, m.y, horiz ? L2 : t, horiz ? t : L2, za, zb, col, opt);
    };
    const pts = (s, step) => { const L2 = G.dist(s.a, s.b), k = Math.max(1, Math.round(L2 / step)), u = G.unit(G.sub(s.b, s.a)); return Array.from({ length: k + 1 }, (_, i) => G.add(G.add(s.a, G.mul(u, L2 * i / k)), G.mul(s.n, 4))); };
    if (o.encl === 'rail') for (const s of g.segs) {
      seg(s, 6, z0 + 88, z0 + 95, post);
      for (const q of pts(s, 15)) bx(q.x, q.y, 3, 3, z0, z0 + 88, post);
    }
    if (o.encl === 'glazed' || o.encl === 'closed') for (const s of g.segs) {
      const closed = o.encl === 'closed';
      seg(s, closed ? 15 : 8, z0, z0 + 85, closed ? wall : frame);            // парапет
      if (closed) {
        seg(s, 15, z0 + 205, eave, wall);                                        // над окнами
        const L2 = G.dist(s.a, s.b), u = G.unit(G.sub(s.b, s.a)), k = Math.floor(L2 / 200);
        const wins = Array.from({ length: k }, (_, i) => (i + 0.5) * L2 / k);
        // простенки между окнами (окна 100 см)
        let from = 0;
        for (const m of [...wins, L2 + 50]) {
          const to = Math.min(L2, m - 50);
          if (to - from > 1) seg({ a: G.add(s.a, G.mul(u, from)), b: G.add(s.a, G.mul(u, to)), n: s.n }, 15, z0 + 85, z0 + 205, wall);
          from = m + 50;
        }
        for (const m of wins) seg({ a: G.add(s.a, G.mul(u, m - 50)), b: G.add(s.a, G.mul(u, m + 50)), n: s.n }, 4, z0 + 85, z0 + 205, glass, { glass: true });
      } else {
        seg(s, 3, z0 + 85, eave - 12, glass, { glass: true });
        for (const q of pts(s, 90)) bx(q.x, q.y, 6, 6, z0, eave, frame);
        seg(s, 8, eave - 12, eave, frame);
      }
    }
    // двери в проходах к ступеням
    if (o.encl === 'glazed' || o.encl === 'closed') for (const f of g.doors) {
      const sd = { a: f.a, b: f.b, n: G.mul(f.out, -1) }, closed = o.encl === 'closed';
      seg(sd, 4, z0, z0 + 205, closed ? C('#7a5236') : glass, closed ? undefined : { glass: true });
      seg(sd, closed ? 15 : 8, z0 + 205, eave, closed ? wall : frame);
    }
    if (!o.roofed) return;
    // столбы у открытых
    if (o.encl === 'open' || o.encl === 'rail') {
      for (const q of porchPosts(g, w, d)) bx(q.x, q.y, 12, 12, z0, rg.roofZ(q) - 2, post);
      // обвязка по верху столбов
      for (const side of o.free) { const S = PORCH_SIDES[side]; seg({ a: S.a(w, d), b: S.b(w, d), n: G.mul(S.out, -1) }, 12, eave - 15, eave, post); }
    }
    // крыша: по умолчанию у пристроенной — односкатная от дома, у отдельной — двускатная
    const glazed = o.encl === 'glazed';
    View3D.itemRoof(it, rg, { gableGlass: glazed, endGlass: glazed, endCol: glazed ? glass : wall });
  },
  /** Погреб / подпол / смотровая яма: стенки и дно внутри, ступени или стремянка, бортик, люк или погребница */
  pit(it, e) {
    const { face, box, wire } = View3D._g, C = View3D.hex, rot = it.rot || 0, g = pitGeom(it, it.w, it.d);
    const L = (x, y) => G.toWorld({ x, y }, it.x, it.y, rot);
    const V = (x, y, z) => { const q = L(x, y); return [q.x / 100, z / 100, q.y / 100]; };
    const bx = (r, z0, z1, col, opt) => { const q = L((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); box(q.x, q.y, r.x1 - r.x0, r.y1 - r.y0, rot, z0, z1, col, opt); };
    const top = e, bot = e - g.depth, iw = g.iw / 2, id = g.id / 2, w = it.w / 2, d = it.d / 2;
    const wallC = C('#9d9a93'), floorC = C('#6f6a62'), stepC = C('#8f8a82'), wood = C('#9a7550');
    // в помещении (пол дома поверх) — видно только люк
    const fid = it.floor || App.doc.floors[0].id;
    const fd = (App.floorData || []).find(f => f.floor.id === fid);
    const inRoom = !!(fd && fd.rooms.some(r => G.pointInPoly(it, r.axis)));
    const inBld = !inRoom && !!View3D.bldHost(it);                   // в гараже/сарае: пол постройки вырезан под открытую яму
    const lift = inRoom ? 3 : inBld ? View3D.BLD_FLOOR : 0;
    // стенки изнутри и дно
    const cs = [[-iw, -id], [iw, -id], [iw, id], [-iw, id]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = cs[k], [bx2, by2] = cs[(k + 1) % 4];
      face([V(ax, ay, top), V(bx2, by2, top), V(bx2, by2, bot), V(ax, ay, bot)], wallC.map(x => x * (0.82 + 0.06 * k)), V((ax + bx2) * 1.5, (ay + by2) * 1.5, (top + bot) / 2));
    }
    face(cs.map(([x, y]) => V(x, y, bot)), floorC, V(0, 0, bot - 100));
    // бортик по краю (у открытой ямы и погребницы)
    if (g.cover !== 'hatch') {
      const t = g.t;
      for (const r of [{ x0: -w, y0: -d, x1: w, y1: -d + t }, { x0: -w, y0: d - t, x1: w, y1: d }, { x0: -w, y0: -d + t, x1: -w + t, y1: d - t }, { x0: w - t, y0: -d + t, x1: w, y1: d - t }]) bx(r, top - 20, top + 3 + lift, wallC);
    }
    // лестница
    if (g.flight && g.stair === 'stairs') for (let i = 0; i < g.n; i++) bx(g.rect(i * g.tread, (i + 1) * g.tread, g.sw), bot, top - (i + 1) * g.rise, i % 2 ? stepC : stepC.map(x => x * 0.93));
    if (g.flight && g.stair === 'ladder') {
      const hw = g.sw / 2 - 4, P3 = (along, s2, z) => { const q = L(g.edge.x + g.dir.x * along + g.across.x * hw * s2, g.edge.y + g.dir.y * along + g.across.y * hw * s2); return [q.x, q.y, z]; };
      for (const s2 of [-1, 1]) wire(P3(Math.max(10, g.L - 5), s2, bot), P3(4, s2, top + 90), 2.5, wood);
      for (let z = bot + 30; z < top + 80; z += 30) { const k = (z - bot) / (top + 90 - bot), along = Math.max(10, g.L - 5) + (4 - Math.max(10, g.L - 5)) * k; wire(P3(along, -1, z), P3(along, 1, z), 1.8, wood); }
    }
    // сверху: люк или погребница
    if (g.cover === 'hatch') {
      bx(g.lid, top + lift, top + lift + 3, wood);
      const c = G.add(G.mul({ x: g.lid.x0 + g.lid.x1, y: g.lid.y0 + g.lid.y1 }, 0.5), { x: 0, y: 0 });
      bx({ x0: c.x - 8, y0: c.y - 2, x1: c.x + 8, y1: c.y + 2 }, top + lift + 3, top + lift + 5, C('#3a3d42'));
      if (!inRoom) bx({ x0: -w, y0: -d, x1: w, y1: d }, top - 1, top + 0.5, C('#8a8f86'));   // перекрытие погреба на участке
    } else if (g.cover === 'house') {
      const h = g.house, H = 180;
      bx(h, top, top + H, C('#ddd3c3'));
      const along = Math.abs(g.dir.y) > 0.5;
      const c = L((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2);
      View3D.roof({ x: c.x, y: c.y, w: (along ? h.y1 - h.y0 : h.x1 - h.x0) + 30, d: (along ? h.x1 - h.x0 : h.y1 - h.y0) + 30, rot: rot + (along ? 90 : 0), type: 'gable', pitch: 35, base: top + H, mat: 'metaltile', floor: null });
      // дверь — со стороны, где начинается спуск
      const dm = G.add(g.edge, G.mul(g.dir, -g.t - 10));
      const dw = Math.min(70, (along ? h.x1 - h.x0 : h.y1 - h.y0) - 20);
      bx(along ? { x0: dm.x - dw / 2, y0: dm.y - 3, x1: dm.x + dw / 2, y1: dm.y + 3 } : { x0: dm.x - 3, y0: dm.y - dw / 2, x1: dm.x + 3, y1: dm.y + dw / 2 }, top, top + 165, C('#6b4a33'));
    } else if (inRoom) {
      // открытая яма в помещении: пол дома её перекрывает — показываем тёмный проём
      face([V(-iw, -id, top + 3.4), V(iw, -id, top + 3.4), V(iw, id, top + 3.4), V(-iw, id, top + 3.4)], [0.12, 0.12, 0.13], V(0, 0, top - 100));
    }
  },
  /** Кухонный гарнитур: цоколь, корпуса, столешница, мойка, варочная панель, навесные шкафы, пеналы */
  kitchen(it, def, e) {
    const { box, cyl } = View3D._g, C = View3D.hex, rot = it.rot || 0;
    const K = kitchenLayout(def.shape, it.w, it.d);
    const fx = it.flip ? -1 : 1;
    const L = (x, y) => G.toWorld({ x: x * fx, y }, it.x, it.y, rot);
    const bx = (x0, y0, x1, y1, z0, z1, col, opt) => { const q = L((x0 + x1) / 2, (y0 + y1) / 2); box(q.x, q.y, Math.abs(x1 - x0), Math.abs(y1 - y0), rot, z0, z1, col, opt); };
    const facade = C('#eef0f1'), plinth = C('#4a4d52'), top = C('#8d8478'), upper = C('#f5f6f7');
    const H = it.h || 90;
    for (const r of K.runs) {
      const h = r.h || H;
      // цоколь утоплен от фасада на 5 см
      const inset = { down: [0, 0, 0, -5], up: [0, 5, 0, 0], left: [5, 0, 0, 0], right: [0, 0, -5, 0] }[r.front] || [0, 0, 0, 0];
      bx(r.x0 + inset[0], r.y0 + inset[1], r.x1 + inset[2], r.y1 + inset[3], e, e + 10, plinth);
      bx(r.x0, r.y0, r.x1, r.y1, e + 10, e + h - 4, r.h ? C('#b88a5a') : facade);
      bx(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1, e + h - 4, e + h, top);
      // навесные шкафы над рядом у стены — у задней кромки
      if (r.wall && !r.h) {
        const b = { down: [r.x0, r.y0, r.x1, r.y0 + 35], up: [r.x0, r.y1 - 35, r.x1, r.y1], left: [r.x1 - 35, r.y0, r.x1, r.y1], right: [r.x0, r.y0, r.x0 + 35, r.y1] }[r.front];
        if (!b) continue;
        // над окном в стене за рядом шкафов не вешаем: режем ленту по ширине окна (+5 см)
        const alongX = r.front === 'down' || r.front === 'up', back = { down: r.y0, up: r.y1, left: r.x1, right: r.x0 }[r.front];
        const cuts = [];
        for (const o of App.V.openings) {
          if ((OPENING_TYPES[o.type] || {}).cat !== 'window' || (o.sill || 0) >= 215) continue;
          const g = Model.opGeom(o);
          if (!g) continue;
          const pa = G.toLocal(g.a, it.x, it.y, rot), pb = G.toLocal(g.b, it.x, it.y, rot);
          pa.x *= fx; pb.x *= fx;
          const off = (p) => Math.abs((alongX ? p.y : p.x) - back);
          if (off(pa) > g.th / 2 + 15 || off(pb) > g.th / 2 + 15) continue;
          const [c0, c1] = alongX ? [Math.min(pa.x, pb.x), Math.max(pa.x, pb.x)] : [Math.min(pa.y, pb.y), Math.max(pa.y, pb.y)];
          cuts.push([c0 - 5, c1 + 5]);
        }
        let segs = [[alongX ? b[0] : b[1], alongX ? b[2] : b[3]]];
        for (const [c0, c1] of cuts) segs = segs.flatMap(([s0, s1]) => (c1 <= s0 || c0 >= s1) ? [[s0, s1]] : [[s0, Math.max(s0, c0)], [Math.min(s1, c1), s1]].filter(q => q[1] - q[0] > 8));
        for (const [s0, s1] of segs) alongX ? bx(s0, b[1], s1, b[3], e + 145, e + 215, upper) : bx(b[0], s0, b[2], s1, e + 145, e + 215, upper);
      }
    }
    for (const r of K.tall || []) bx(r.x0, r.y0, r.x1, r.y1, e, e + 215, facade);
    if (K.sink) { const s = K.sink; bx(s.x - 22, s.y - 18, s.x + 22, s.y + 18, e + H - 0.5, e + H + 0.3, C('#b9c3cc')); }
    if (K.hob) {
      const hb = K.hob, hw = hb.v ? 25 : 28, hd = hb.v ? 28 : 25;
      bx(hb.x - hw, hb.y - hd, hb.x + hw, hb.y + hd, e + H, e + H + 0.6, C('#1f2226'));
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const q = L(hb.x + sx * hw * 0.5, hb.y + sy * hd * 0.5); cyl(q.x, q.y, 7, e + H + 0.6, e + H + 1, C('#3a3d42'), 10); }
    }
  },
  _g: null,

  /* ------------------------------- WebGL ---------------------------------- */
  init() {
    const cv = $('canvas3d');
    View3D.canvas = cv;
    const gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: false }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    View3D.gl = gl;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs) => { const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr)); return pr; };
    const hp = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0 ? 'highp' : 'mediump';
    // основная программа: полусферическое освещение, солнце с тенями (PCF), дымка
    View3D.prog = prog(
      `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 uVP; uniform mat4 uLVP;
       varying vec3 vN; varying vec3 vC; varying vec3 vW; varying vec4 vL;
       void main(){ vN = n; vC = c; vW = p; vL = uLVP * vec4(p, 1.0); gl_Position = uVP * vec4(p, 1.0); }`,
      `precision ${hp} float;
       varying vec3 vN; varying vec3 vC; varying vec3 vW; varying vec4 vL;
       uniform vec3 uL; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uEye; uniform vec3 uSunCol;
       uniform float uFog; uniform float uSunK; uniform float uAmb; uniform float uUseShadow; uniform float uTexel; uniform float uAlpha; uniform sampler2D uShadow;
       float unpack(vec4 v){ return dot(v, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
       float shadowAt(vec3 n){
         vec3 s = vL.xyz / vL.w * 0.5 + 0.5;
         if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
         float bias = max(0.0025 * (1.0 - dot(n, uL)), 0.0006);
         float sum = 0.0;
         for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
           float d = unpack(texture2D(uShadow, s.xy + vec2(float(i), float(j)) * uTexel));
           sum += (s.z - bias > d) ? 0.0 : 1.0;
         }
         return sum / 9.0;
       }
       void main(){
         vec3 n = normalize(vN);
         float dif = max(dot(n, uL), 0.0) * uSunK;
         float sh = (uUseShadow > 0.5 && dif > 0.0) ? shadowAt(n) : 1.0;
         vec3 amb = mix(uGround, uSky, 0.5 + 0.5 * n.y) * uAmb;
         vec3 col = vC * (amb + dif * sh * uSunCol);
         float dist = length(vW - uEye);
         col = mix(col, uSky * 1.02, clamp(1.0 - exp(-dist * uFog), 0.0, 0.8));
         gl_FragColor = vec4(pow(col, vec3(0.95)), uAlpha);
       }`);
    const pr = View3D.prog;
    View3D.loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), c: gl.getAttribLocation(pr, 'c') };
    for (const u of ['uAmb', 'uVP', 'uLVP', 'uL', 'uSky', 'uGround', 'uEye', 'uSunCol', 'uFog', 'uSunK', 'uUseShadow', 'uTexel', 'uAlpha', 'uShadow']) View3D.loc[u] = gl.getUniformLocation(pr, u);
    // карта теней: глубина, упакованная в RGBA
    View3D.depthProg = prog(
      `attribute vec3 p; uniform mat4 uLVP; void main(){ gl_Position = uLVP * vec4(p, 1.0); }`,
      `precision ${hp} float;
       vec4 pack(float d){ vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * d); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); return e; }
       void main(){ gl_FragColor = pack(gl_FragCoord.z); }`);
    View3D.dloc = { p: gl.getAttribLocation(View3D.depthProg, 'p'), uLVP: gl.getUniformLocation(View3D.depthProg, 'uLVP') };
    const SM = 2048;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SM, SM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SM, SM);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    View3D.shadowOK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    View3D.sm = { tex, fb, size: SM };
    // небо: вертикальный градиент на весь экран
    View3D.skyProg = prog(
      `attribute vec2 q; varying float t; void main(){ t = q.y * 0.5 + 0.5; gl_Position = vec4(q, 0.9999, 1.0); }`,
      `precision mediump float; varying float t; uniform vec3 uTop; uniform vec3 uHor; void main(){ gl_FragColor = vec4(mix(uHor, uTop, pow(t, 0.6)), 1.0); }`);
    View3D.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, View3D.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    View3D.bindInput(cv);
    return true;
  },
  upload(P, N, C) {
    const gl = View3D.gl;
    const mk = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
    return { p: mk(P), n: mk(N), c: mk(C), count: P.length / 3 };
  },
  /** Освещение по солнцу: направление, цвета неба, сила */
  light() {
    let az = 200, alt = 42;
    const s = Sun.current();
    const useSun = View3D.opts.sun;
    if (useSun) { az = s.az; alt = s.alt; }
    const day = !useSun || alt > 1;
    const a = U.rad(Math.max(alt, 2)), dir = Sun.planDir(az);
    const L = [dir.x * Math.cos(a), Math.sin(a), dir.y * Math.cos(a)];
    const low = U.clamp((alt - 2) / 20, 0, 1);            // низкое солнце — теплее
    return {
      L, day,
      sunK: day ? 0.55 + 0.45 * low : 0,
      sunCol: [1.0, 0.86 + 0.12 * low, 0.72 + 0.24 * low],
      sky: day ? [0.62 + 0.1 * (1 - low), 0.76, 0.93] : [0.16, 0.2, 0.3],
      top: day ? [0.33, 0.55, 0.86] : [0.05, 0.07, 0.14],
      hor: day ? [0.86, 0.9, 0.95] : [0.22, 0.25, 0.34],
      ground: day ? [0.42, 0.44, 0.36] : [0.12, 0.13, 0.14],
    };
  },
  draw() {
    if (!View3D.active) return;
    const gl = View3D.gl, cv = View3D.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (View3D.dirty) { View3D.build(); Walk.invalidate(); }
    const lt = View3D.light();
    const bb = View3D.bounds;
    const cx = (bb.x0 + bb.x1) / 200, cz = (bb.y0 + bb.y1) / 200;
    const R = Math.max(10, Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 200 + 8);
    const L = View3D.loc;
    const bind = (m, locs) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.p); gl.enableVertexAttribArray(locs.p); gl.vertexAttribPointer(locs.p, 3, gl.FLOAT, false, 0, 0);
      if (locs.n !== undefined) { gl.bindBuffer(gl.ARRAY_BUFFER, m.n); gl.enableVertexAttribArray(locs.n); gl.vertexAttribPointer(locs.n, 3, gl.FLOAT, false, 0, 0); }
      if (locs.c !== undefined) { gl.bindBuffer(gl.ARRAY_BUFFER, m.c); gl.enableVertexAttribArray(locs.c); gl.vertexAttribPointer(locs.c, 3, gl.FLOAT, false, 0, 0); }
    };
    // 1) карта теней с позиции солнца
    const shadows = View3D.opts.shadows && View3D.shadowOK && lt.day && View3D.mesh && View3D.mesh.count;
    const up = Math.abs(lt.L[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const lEye = [cx + lt.L[0] * R * 2, lt.L[1] * R * 2, cz + lt.L[2] * R * 2];
    const LVP = M4.mul(M4.ortho(-R, R, -R, R, 0.5, R * 4.5), M4.lookAt(lEye, [cx, 0, cz], up));
    if (shadows) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, View3D.sm.fb);
      gl.viewport(0, 0, View3D.sm.size, View3D.sm.size);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(View3D.depthProg);
      gl.uniformMatrix4fv(View3D.dloc.uLVP, false, LVP);
      if (L.n >= 0) gl.disableVertexAttribArray(L.n);
      if (L.c >= 0) gl.disableVertexAttribArray(L.c);
      bind(View3D.mesh, { p: View3D.dloc.p });
      gl.drawArrays(gl.TRIANGLES, 0, View3D.mesh.count);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // 2) небо
    gl.viewport(0, 0, w, h);
    gl.clearColor(lt.hor[0], lt.hor[1], lt.hor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(View3D.skyProg);
    const qloc = gl.getAttribLocation(View3D.skyProg, 'q');
    gl.bindBuffer(gl.ARRAY_BUFFER, View3D.skyBuf); gl.enableVertexAttribArray(qloc); gl.vertexAttribPointer(qloc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(gl.getUniformLocation(View3D.skyProg, 'uTop'), lt.top);
    gl.uniform3fv(gl.getUniformLocation(View3D.skyProg, 'uHor'), lt.hor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 3) сцена
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(View3D.prog);
    const c = View3D.cam;
    // прогулка — камера на уровне глаз; иначе — орбита вокруг цели
    const wc = Walk.on ? Walk.camera() : null;
    const eye = wc ? wc.eye : [c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    const VP = M4.mul(M4.persp(wc ? wc.fov : 0.8, w / Math.max(1, h), wc ? 0.05 : 0.1, 4000), M4.lookAt(eye, wc ? wc.at : [c.tx, c.ty, c.tz], [0, 1, 0]));
    gl.uniformMatrix4fv(L.uVP, false, VP);
    gl.uniformMatrix4fv(L.uLVP, false, LVP);
    gl.uniform3fv(L.uL, lt.L); gl.uniform3fv(L.uSky, lt.sky); gl.uniform3fv(L.uGround, lt.ground); gl.uniform3fv(L.uEye, eye); gl.uniform3fv(L.uSunCol, lt.sunCol);
    gl.uniform1f(L.uFog, 0.35 / (R * 6)); gl.uniform1f(L.uSunK, lt.sunK);
    gl.uniform1f(L.uAmb, Walk.on ? 0.82 : 0.62);   // на прогулке внутри дома светлее
    gl.uniform1f(L.uUseShadow, shadows ? 1 : 0); gl.uniform1f(L.uTexel, 1 / View3D.sm.size);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, View3D.sm.tex); gl.uniform1i(L.uShadow, 0);
    const drawMesh = (m, alpha) => {
      if (!m || !m.count) return;
      bind(m, L);
      gl.uniform1f(L.uAlpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    };
    gl.disable(gl.BLEND); gl.depthMask(true);
    drawMesh(View3D.mesh, 1);
    gl.uniform1f(L.uUseShadow, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    drawMesh(View3D.glass, 0.42);
    gl.depthMask(true); gl.disable(gl.BLEND);
  },
  redraw() { if (View3D.active && !View3D._raf) View3D._raf = requestAnimationFrame(() => { View3D._raf = 0; View3D.draw(); }); },
  /** Готовые ракурсы: с юга/севера/востока/запада (по компасу) и сверху */
  view(kind) {
    const c = View3D.cam;
    // камера «смотрит с» стороны света: yaw — угол позиции камеры вокруг цели
    const byBearing = (b) => { const d = Sun.planDir(b); return Math.atan2(d.x, d.y); };
    if (kind === 'top') c.pitch = 1.5;
    else if (kind === 'eye') { c.pitch = 0.08; c.ty = 1.6; c.dist = Math.max(12, c.dist * 0.6); }
    else { c.yaw = byBearing({ s: 180, n: 0, e: 90, w: 270 }[kind]); c.pitch = 0.35; }
    View3D.redraw();
  },
  /** OBJ с цветами вершин (Blender, MeshLab, SketchUp через плагин, Twinmotion) */
  exportOBJ() {
    const { P, N, C, GP, GN, GC } = View3D.build();
    const L = ['# Floorplaner 3D: ' + App.doc.name, '# единицы — метры, ось Y вверх, план: X — вправо, Z — вниз по плану', 'o model'];
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    let n = 0;
    const add = (pp, nn, cc, name) => {
      if (!pp.length) return;
      L.push('g ' + name);
      for (let i = 0; i < pp.length; i += 3) {
        L.push(`v ${f(pp[i])} ${f(pp[i + 1])} ${f(pp[i + 2])} ${f(cc[i])} ${f(cc[i + 1])} ${f(cc[i + 2])}`);
        L.push(`vn ${f(nn[i])} ${f(nn[i + 1])} ${f(nn[i + 2])}`);
      }
      for (let i = 0; i < pp.length / 3; i += 3) { const a = n + i + 1, b = a + 1, c = a + 2; L.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`); }
      n += pp.length / 3;
    };
    add(P, N, C, 'building'); add(GP, GN, GC, 'glass');
    U.download(IO.fileName('obj'), L.join('\n'), 'text/plain');
    UI.toast('OBJ сохранён (метры, цвета в вершинах)');
  },

  /* ------------------------------ камера ---------------------------------- */
  fit() {
    const b = Model.contentBBox() || { x0: -500, y0: -500, x1: 500, y1: 500 };
    const c = View3D.cam;
    c.tx = (b.x0 + b.x1) / 200; c.tz = (b.y0 + b.y1) / 200;
    const top = App.doc.floors.reduce((m, f) => Math.max(m, f.elev + f.h), 300);
    c.ty = top / 400;
    c.dist = Math.max(8, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 100 * 0.95);
    // смотрим сбоку от солнца, чтобы тени падали в кадр, а не прятались за объектами
    const az = View3D.opts.sun ? Sun.current().az : 200;
    const d = Sun.planDir((az + 250) % 360);
    c.yaw = Math.atan2(d.x, d.y); c.pitch = 0.5;
  },
  bindInput(cv) {
    let drag = null;
    const pts = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey, pinch: null };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; drag.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = View3D.cam;
      if (pts.size === 2 && drag.pinch) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        c.dist = U.clamp(c.dist * drag.pinch / d, 2, 1500); drag.pinch = d; View3D.redraw(); return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (Walk.on) { Walk.look(dx, dy); return; }
      if (drag.pan) {
        const k = c.dist / 700;
        c.tx -= (Math.cos(c.yaw) * dx) * k; c.tz += (Math.sin(c.yaw) * dx) * k;
        c.ty = U.clamp(c.ty + dy * k, -5, 60);
      } else {
        c.yaw -= dx * 0.008; c.pitch = U.clamp(c.pitch + dy * 0.006, -0.1, 1.55);
      }
      View3D.redraw();
    });
    const end = (e) => { pts.delete(e.pointerId); if (!pts.size) drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // прогулка: отпущенные клавиши, потеря фокуса окна
    window.addEventListener('keyup', (e) => { if (Walk.on) Walk.key(e, false); });
    window.addEventListener('blur', () => Walk.keys.clear());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (Walk.on) return; View3D.cam.dist = U.clamp(View3D.cam.dist * Math.exp(e.deltaY * 0.0012), 2, 1500); View3D.redraw(); }, { passive: false });
  },

  /* ------------------------------ вкл/выкл -------------------------------- */
  toggle(on) {
    on = on ?? !View3D.active;
    if (on && !View3D.gl) {
      try { if (!View3D.init()) { UI.toast('WebGL недоступен в этом браузере', 'err'); return; } }
      catch (e) { console.error(e); UI.toast('Не удалось запустить 3D: ' + e.message, 'err'); return; }
    }
    if (!on && Walk.on) Walk.stop();
    View3D.active = on;
    document.body.classList.toggle('mode-3d', on);
    $('btn3d').classList.toggle('on', on);
    if (on) { View3D.dirty = true; if (!View3D._fitted) { View3D.fit(); View3D._fitted = true; } UI.render3dPanel(); View3D.redraw(); }
    else App.redraw();
  },
  snapshot() {
    View3D.draw();
    View3D.canvas.toBlob((b) => b && U.download(IO.fileName('png').replace('.png', '-3d.png'), b));
  },
};
