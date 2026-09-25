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
      for (let i = 0; i < ids.length; i += 3) {
        const a = pts[ids[i]], b = pts[ids[i + 1]], c = pts[ids[i + 2]];
        if (!opt.noTop) tri(V3(a, z1), V3(b, z1), V3(c, z1), top, [0, 1, 0], opt.glass);
        if (opt.bottom) tri(V3(a, z0), V3(c, z0), V3(b, z0), col, [0, -1, 0], opt.glass);
      }
      if (opt.noSides) return;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (G.dist(a, b) < 0.01) continue;
        face([V3(a, z0), V3(b, z0), V3(b, z1), V3(a, z1)], col, ref, opt.glass);
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
      for (let x = gx0; x < gx1; x += step) for (let y = gy0; y < gy1; y += step) {
        gv(x, y); gv(x + step, y); gv(x + step, y + step);
        gv(x, y); gv(x + step, y + step); gv(x, y + step);
      }
      for (const a of d.areas) {
        const colr = { plot: '#a9cc8a', lawn: '#86c25f', garden: '#8a6a45', paving: '#b8b8bc', road: '#8e9096', water: '#4f93d6', flower: '#d99bb8', zone: '#b8c0e6', protect: '#e5b1b1' }[a.kind] || '#a9cc8a';
        const hgt = { plot: 0.6, garden: 6, paving: 3, road: 2, water: 1.5 }[a.kind] ?? 1.5;
        prism(a.pts, 0, hgt, View3D.hex(colr), { noSides: a.kind === 'plot' || a.kind === 'lawn' });
      }
      for (const r of d.roads) {
        const k = ROAD_KINDS[r.kind];
        const z = r.kind === 'path' || r.kind === 'sidewalk' ? 4 : 2.5;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b2 = r.pts[i + 1], u = G.unit(G.sub(b2, a)), n = G.perp(u);
          const hw = r.width / 2;
          prism([G.add(a, G.mul(n, hw)), G.add(b2, G.mul(n, hw)), G.sub(b2, G.mul(n, hw)), G.sub(a, G.mul(n, hw))], 0, z, View3D.hex(k.fill));
          if (r.kind === 'street' || r.kind === 'road') {
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
        for (const r of fd.rooms) {
          const nm = (r.name || '').toLowerCase();
          const tile = /сануз|ванн|туалет|котел|котёл|душ/.test(nm), kitchen = /кухн|прихож|холл|коридор/.test(nm);
          prism(r.floor, e + 2, e + 3, View3D.hex(tile ? '#d9dde0' : kitchen ? '#cfc2ad' : '#c8a47a'), { noSides: true });
        }
      }
      const cache = Render.endCache();
      for (const w of App.V.walls) {
        const top = e + w.h;
        if (w.kind === 'fence') { View3D.fence(w, e, top); continue; }
        const M = WALL_MATERIALS[w.mat];
        const col = View3D.hex(M ? M.color : '#dddddd').map(x => x * 0.95);
        const plinthH = first && w.kind === 'ext' ? 45 : 0;
        const plinth = View3D.hex('#8a857d');
        const body = (poly, z0, z1) => {
          if (z0 < e + plinthH) { prism(poly, z0, Math.min(z1, e + plinthH), plinth, { topK: 0.9 }); z0 = e + plinthH; }
          if (z1 > z0) prism(poly, z0, z1, col, { topK: 0.85 });
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
            prism(rect(5, g.width - 5, -2, 2), z0, z1 - 5, leafCol);
            if (op.type === 'gate') for (let z = z0 + 45; z < z1 - 10; z += 45) prism(rect(5, g.width - 5, -2.5, 2.5), z, z + 1.5, View3D.hex('#7d858d'));
          }
        }
      }
      if (View3D.opts.items) for (const it of App.V.items) {
        const def = catItem(it.key);
        if (def.shape === 'rug') continue;
        View3D.item(it, def, e, top => top);
      }
      // воздушные линии — провода между опорами
      for (const l of App.V.lines) {
        if (l.kind !== 'overhead') continue;
        const hAt = (p) => { const pole = App.V.items.find(it => ['pole', 'lightpole'].includes(catItem(it.key).shape) && G.dist(it, p) < 80); return pole ? e + pole.h - 40 : e + 450; };
        for (let i = 0; i < l.pts.length - 1; i++) {
          const a = l.pts[i], b2 = l.pts[i + 1];
          for (const off of [-25, 25]) {
            const n = G.mul(G.perp(G.unit(G.sub(b2, a))), off);
            wire([a.x + n.x, a.y + n.y, hAt(a)], [b2.x + n.x, b2.y + n.y, hAt(b2)], 1.6, [0.2, 0.2, 0.22]);
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
      if (vertical) { face(vs, gableCol, [cx, cy + 1, cz]); continue; }
      face(vs, col, [cx, cy - 5, cz]);
      // толщина ската (15 см) — нижняя грань чуть светлее
      face(vs.map(v => [v[0], v[1] - 0.15, v[2]]), col.map(x => x * 0.75), [cx, cy + 50, cz]);
    }
    if (r.type === 'flat') prism(G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0), r.base, r.base + 20, col);
    else prism(G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0), r.base - 15, r.base, View3D.hex('#efece6'), { noTop: true, bottom: true });
  },
  fence(w, e, top) {
    const { prism, box } = View3D._g;
    const M = FENCE_MATERIALS[w.mat] || FENCE_MATERIALS.profile;
    const col = View3D.hex(M.color);
    const L = Model.wallLen(w), u = Model.wallDir(w), n = G.perp(u);
    const th = Math.max(w.th, 3);
    const gaps = App.V.openings.filter(o => o.wall === w.id).map(o => Model.opGeom(o)).filter(Boolean).sort((a, b) => a.pos - b.pos);
    const spans = [];
    let s = 0;
    for (const g of gaps) { if (g.pos - g.width / 2 - s > 1) spans.push([s, g.pos - g.width / 2]); s = g.pos + g.width / 2; }
    if (L - s > 1) spans.push([s, L]);
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
    const { prism, box, cyl, cone, blob, face } = View3D._g;
    const sh = def.shape, H = it.h || 0, rot = it.rot || 0;
    const C = (h) => View3D.hex(h);
    const pts = Model.itemPts(it);
    const wood = C('#b88a5a'), white = C('#f1f2f3'), fabric = C('#8a98ad'), metal = C('#9aa3ab'), dark = C('#3a3d42');
    // --- символы (электрика и т.п.): маленькие объекты на своей высоте ---
    if (def.sym) {
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
    // --- озеленение ---
    if (sh === 'tree' || sh === 'conifer' || sh === 'bush') {
      const r = Math.min(it.w, it.d) / 2;
      if (sh === 'bush') { blob(it.x, it.y, e + H * 0.5, r, H * 0.5, C('#5f9a45'), it.x); return; }
      if (sh === 'conifer') {
        cyl(it.x, it.y, Math.max(8, r * 0.07), e, e + H * 0.12, C('#5b3a22'), 8);
        const green = C('#2f6b43');
        const tiers = 4;
        for (let k = 0; k < tiers; k++) {
          const z0 = e + H * (0.08 + k * 0.2), z1 = e + H * (0.08 + k * 0.2 + 0.42);
          cone(it.x, it.y, r * (1 - k * 0.2), 0, z0, Math.min(z1, e + H), green.map(x => x * (0.9 + k * 0.05)), 12);
        }
        return;
      }
      const trunkH = H * 0.38;
      cyl(it.x, it.y, Math.max(9, r * 0.06), e, e + trunkH + H * 0.15, C('#6b4a2e'), 8);
      const green = it.key === 'fruitTree' ? C('#6fa94d') : C('#5c9c44');
      blob(it.x, it.y, e + trunkH + (H - trunkH) * 0.5, r, (H - trunkH) * 0.52, green, it.y);
      blob(it.x + r * 0.35, it.y - r * 0.2, e + trunkH + (H - trunkH) * 0.62, r * 0.6, (H - trunkH) * 0.35, green.map(x => x * 1.06), it.x);
      return;
    }
    if (sh === 'hedge') { box(it.x, it.y, it.w, it.d, rot, e, e + H * 0.85, C('#4f8a3c')); blob(it.x, it.y, e + H * 0.85, it.w / 2, it.d * 0.4, C('#5a9645'), 3); return; }
    // --- постройки ---
    if (['building', 'garage', 'bathhouse'].includes(sh) || sh === 'building') {
      const wallH = H * 0.66;
      prism(pts, e, e + 40, C('#8a857d'));
      prism(pts, e + 40, e + wallH, C(it.key === 'bathhouse' ? '#c79a64' : '#ddd3c3'), { topK: 0.8 });
      const rf = { x: it.x, y: it.y, w: it.w + 50, d: it.d + 50, rot, type: 'gable', mat: sh === 'garage' ? 'profile' : 'metaltile', base: e + wallH, pitch: 0, floor: null };
      if (it.d > it.w) { rf.w = it.d + 50; rf.d = it.w + 50; rf.rot = rot + 90; }
      rf.pitch = U.deg(Math.atan((H - wallH) / (rf.d / 2)));
      View3D.roof(rf);
      if (sh === 'garage') { const gw = Math.min(it.w - 60, 300); const q = G.toWorld({ x: 0, y: it.d / 2 }, it.x, it.y, rot); box(q.x, q.y, gw, 4, rot, e, e + Math.min(230, wallH - 20), C('#b9c0c7')); }
      else { const q = G.toWorld({ x: 0, y: it.d / 2 }, it.x, it.y, rot); box(q.x, q.y, 90, 4, rot, e, e + 205, C('#6b4a33')); }
      return;
    }
    if (sh === 'gazebo') {
      const pw = 14;
      for (const c of G.rectPts(it.x, it.y, it.w - 20, it.d - 20, rot)) box(c.x, c.y, pw, pw, rot, e, e + H * 0.7, wood);
      box(it.x, it.y, it.w, it.d, rot, e, e + 15, wood);
      View3D.roof({ x: it.x, y: it.y, w: it.w + 60, d: it.d + 60, rot, type: 'hip', pitch: 30, base: e + H * 0.7, mat: 'soft', floor: null });
      return;
    }
    if (sh === 'canopy' || sh === 'canopyLean') {
      const post = 14;
      const lean = sh === 'canopyLean';
      const corners = G.rectPts(it.x, it.y, it.w - post, it.d - post, rot);
      corners.forEach((c, i) => { if (!lean || i >= 2) box(c.x, c.y, post, post, rot, e, e + H - 20, C('#6b5a44')); });
      box(it.x, it.y, it.w, it.d, rot, e + H - 20, e + H, C('#5d6d7c'), { bottom: true });
      return;
    }
    if (sh === 'greenhouse') {
      box(it.x, it.y, it.w, it.d, rot, e, e + H * 0.65, [0.8, 0.9, 0.95], { glass: true });
      View3D.roof({ x: it.x, y: it.y, w: it.d > it.w ? it.d : it.w, d: it.d > it.w ? it.w : it.d, rot: it.d > it.w ? rot + 90 : rot, type: 'gable', pitch: 35, base: e + H * 0.65, mat: 'profile', floor: null }, [0.82, 0.9, 0.95]);
      return;
    }
    if (sh === 'pool') { box(it.x, it.y, it.w + 60, it.d + 60, rot, e, e + 8, C('#e5e1d6')); box(it.x, it.y, it.w, it.d, rot, e + 8, e + 9, C('#3f97d8')); return; }
    if (sh === 'veranda') { View3D.veranda(it, e); return; }
    if (KITCHEN_SHAPES.has(sh)) { View3D.kitchen(it, def, e); return; }
    if (sh === 'deck') { box(it.x, it.y, it.w, it.d, rot, e, e + 25, C('#a8805a')); for (let x = -it.w / 2 + 7; x < it.w / 2; x += 14) { const q = G.toWorld({ x, y: 0 }, it.x, it.y, rot); box(q.x, q.y, 1, it.d, rot, e + 25, e + 25.3, C('#8c6848')); } return; }
    if (sh === 'parking') { box(it.x, it.y, it.w, it.d, rot, e, e + 3, C('#a9abb0')); return; }
    if (sh === 'gardenbed' || sh === 'flowerbed') { box(it.x, it.y, it.w, it.d, rot, e, e + Math.max(20, H), C('#7a5a3a')); return; }
    if (sh === 'filterfield' || sh === 'ground') return;
    if (sh === 'car') {
      const body = C('#6f7f95');
      box(it.x, it.y, it.w, it.d, rot, e + 25, e + 85, body);
      const q = G.toWorld({ x: 0, y: it.d * 0.05 }, it.x, it.y, rot);
      box(q.x, q.y, it.w - 20, it.d * 0.5, rot, e + 85, e + H, C('#32393f'));
      for (const [sx, sy] of [[-1, -0.3], [1, -0.3], [-1, 0.32], [1, 0.32]]) { const w = G.toWorld({ x: sx * (it.w / 2 - 8), y: sy * it.d }, it.x, it.y, rot); box(w.x, w.y, 22, 64, rot, e, e + 60, dark); }
      return;
    }
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
    if (['round', 'boiler', 'ring', 'well', 'borehole', 'roundtable', 'columnRound', 'pump'].includes(sh)) {
      const n = 16;
      const col = sh === 'well' ? C('#b8b4ac') : sh === 'ring' || sh === 'borehole' ? C('#9d9a93') : def.layer === 'furniture' ? wood : white;
      prism(View3D._g.ring(it.x, it.y, it.w / 2, it.d / 2, n, rot), e, e + Math.max(3, H), col, { topK: 0.9 });
      if (sh === 'well') View3D.roof({ x: it.x, y: it.y, w: it.w + 40, d: it.d + 30, rot, type: 'gable', pitch: 40, base: e + 190, mat: 'soft', floor: null });
      return;
    }
    if (!(H > 0)) return;
    // --- мебель и оборудование: цвет по назначению, простые детали ---
    const upperZ = sh === 'upper' ? 140 : sh === 'hood' ? 155 : 0;
    const z0 = e + upperZ, z1 = z0 + Math.max(2, H);
    const colorOf = {
      bed: C('#f3efe7'), sofa: fabric, sofaL: fabric, armchair: fabric, officechair: dark, chair: wood, bench: wood,
      table: wood, diningtable: wood, roundtable: wood, desk: wood, deskL: wood, wardrobe: C('#c9a57a'), cabinet: C('#c9a57a'), shelf: C('#c9a57a'),
      tv: dark, piano: C('#2b2622'), counter: white, tall: C('#eef0f1'), bar: wood, hood: C('#c8ccd1'), kitchenI: white, kitchenL: white, ksink: white, upper: white, fridge: white, fridge2: C('#c8ccd1'),
      stove: C('#e2e4e6'), oven: dark, washer: white, bath: white, bathCorner: white, shower: C('#dfe9f0'), toilet: white, bidet: white, urinal: white,
      sink: white, vanity: C('#e8e2d8'), radiator: white, stoveHeat: C('#b5654a'), fireplace: C('#9c8f86'), fireplaceCorner: C('#9c8f86'), stoveMetal: dark,
      chimney: C('#8f5a45'), column: C('#d6d2ca'), septic: C('#5e7d4f'), capsule: C('#dfe3e6'), bbq: dark, gateSlide: metal, wicket: metal, labelbox: C('#d0ccc4'),
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
  /** Крыльцо / веранда / терраса: цоколь, настил, ступени, ограждение или остекление, крыша */
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
    const eave = z0 + 230;
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
      for (const q of porchPosts(g, w, d)) bx(q.x, q.y, 12, 12, z0, eave, post);
      // обвязка по верху столбов
      for (const side of o.free) { const S = PORCH_SIDES[side]; seg({ a: S.a(w, d), b: S.b(w, d), n: G.mul(S.out, -1) }, 12, eave - 15, eave, post); }
    }
    // крыша: у пристроенной — односкатная от дома, у отдельной — двускатная
    const top = Math.max(it.h || 0, o.ph + 260);
    if (o.attached) {
      const rd = d + 30, rise = Math.max(15, top - (eave - e));
      const c = L(0, 15);
      View3D.roof({ x: c.x, y: c.y, w: w + 50, d: rd, rot, type: 'shed', pitch: U.deg(Math.atan(rise / rd)), base: eave, mat: 'profile', floor: null });
    } else {
      const along = w >= d;
      View3D.roof({ x: it.x, y: it.y, w: (along ? w : d) + 50, d: (along ? d : w) + 50, rot: along ? rot : rot + 90, type: 'gable', pitch: 25, base: eave, mat: 'metaltile', floor: null });
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
        if (b) bx(b[0], b[1], b[2], b[3], e + 145, e + 215, upper);
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
