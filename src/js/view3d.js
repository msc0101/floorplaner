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
  opts: { upper: true, roof: true, items: true, site: true, sun: true },

  hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    if (!m) return [0.7, 0.7, 0.7];
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  },

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
    /** Полигон 3D (выпуклый/плоский), нормаль ориентируется «наружу» от центра ref */
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
    /** Призма: многоугольник плана pts от z0 до z1 (см) */
    const prism = (pts, z0, z1, col, opt = {}) => {
      if (z1 - z0 < 0.01 || pts.length < 3) return;
      const c2 = G.polyCentroid(pts);
      const ref = [c2.x / 100, (z0 + z1) / 200, c2.y / 100];
      const top = col.map(x => x * (opt.topK ?? 1));
      const ids = earcut2(pts);
      for (let i = 0; i < ids.length; i += 3) {
        const a = pts[ids[i]], b = pts[ids[i + 1]], c = pts[ids[i + 2]];
        tri(V3(a, z1), V3(b, z1), V3(c, z1), top, [0, 1, 0]);
        if (opt.bottom) tri(V3(a, z0), V3(c, z0), V3(b, z0), col, [0, -1, 0]);
      }
      if (opt.noSides) return;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (G.dist(a, b) < 0.01) continue;
        face([V3(a, z0), V3(b, z0), V3(b, z1), V3(a, z1)], col, ref);
      }
    };
    View3D._face = face;
    const d = App.doc, active = Model.floorIdx(App.floor);
    const saveV = App.V;
    const floors = d.floors.filter((f, i) => i <= active || View3D.opts.upper);
    // участок
    if (View3D.opts.site) {
      const b = Model.contentBBox() || { x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
      const pad = 1500;
      prism([{ x: b.x0 - pad, y: b.y0 - pad }, { x: b.x1 + pad, y: b.y0 - pad }, { x: b.x1 + pad, y: b.y1 + pad }, { x: b.x0 - pad, y: b.y1 + pad }], -1, 0, View3D.hex('#9fbf7f'), { noSides: true });
      for (const a of d.areas) {
        const colr = { plot: '#b7d49a', lawn: '#8fc46e', garden: '#a88a63', paving: '#b9b9bd', road: '#9a9ca3', water: '#5d9fd8', flower: '#d99bb8', zone: '#b8c0e6', protect: '#e5b1b1' }[a.kind] || '#b7d49a';
        prism(a.pts, 0, a.kind === 'plot' ? 0.5 : 1.5, View3D.hex(colr), { noSides: true });
      }
      for (const r of d.roads) {
        const k = ROAD_KINDS[r.kind];
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b2 = r.pts[i + 1], n = G.mul(G.perp(G.unit(G.sub(b2, a))), r.width / 2);
          prism([G.add(a, n), G.add(b2, n), G.sub(b2, n), G.sub(a, n)], 0, 2, View3D.hex(k.fill), { noSides: true });
        }
      }
    }
    for (const f of floors) {
      App.V = Model.viewOf(f.id);
      const e = f.elev;
      const fd = (App.floorData || []).find(x => x.floor.id === f.id);
      // перекрытие / пол
      if (fd) {
        for (const o of fd.outlines) prism(o.outer, e - (f === d.floors[0] ? 0 : 25), e + 2, View3D.hex('#c9c3b8'), { noSides: f === d.floors[0] });
        for (const r of fd.rooms) prism(r.floor, e + 2, e + 3, View3D.hex('#dcc7a4'), { noSides: true });
      }
      // стены
      const cache = Render.endCache();
      for (const w of App.V.walls) {
        const top = e + w.h;
        if (w.kind === 'fence') {
          const M = FENCE_MATERIALS[w.mat] || FENCE_MATERIALS.profile;
          const pts = Model.wallRect({ ...w, th: Math.max(w.th, 4) });
          const gaps = App.V.openings.filter(o => o.wall === w.id).map(o => Model.opGeom(o)).filter(Boolean);
          if (!gaps.length) prism(pts, e, top, View3D.hex(M.color));
          else {
            const L = Model.wallLen(w), u = Model.wallDir(w), n = G.mul(G.perp(u), Math.max(w.th, 4) / 2);
            let s = 0;
            for (const g of gaps.sort((x, y) => x.pos - y.pos)) {
              const a0 = s, a1 = g.pos - g.width / 2;
              if (a1 - a0 > 1) { const A = G.add(w.a, G.mul(u, a0)), B = G.add(w.a, G.mul(u, a1)); prism([G.add(A, n), G.add(B, n), G.sub(B, n), G.sub(A, n)], e, top, View3D.hex(M.color)); }
              s = g.pos + g.width / 2;
            }
            if (L - s > 1) { const A = G.add(w.a, G.mul(u, s)), B = w.b; prism([G.add(A, n), G.add(B, n), G.sub(B, n), G.sub(A, n)], e, top, View3D.hex(M.color)); }
          }
          continue;
        }
        const M = WALL_MATERIALS[w.mat];
        const col = View3D.hex(M ? M.color : '#dddddd').map(x => x * 0.92);
        for (const poly of Render.wallPieces(w, cache)) prism(poly, e, top, col, { topK: 0.8 });
        for (const op of App.V.openings) {
          if (op.wall !== w.id) continue;
          const g = Model.opGeom(op); if (!g) continue;
          const t = g.th / 2;
          const P2 = (s2, k) => G.add(G.add(g.a, G.mul(g.u, s2)), G.mul(g.n, k));
          const rect = [P2(0, -t), P2(g.width, -t), P2(g.width, t), P2(0, t)];
          const sill = OPENING_TYPES[op.type].cat === 'window' ? (op.sill || 0) : 0;
          const oh = Math.min(op.h || 200, w.h - sill);
          if (sill > 0) prism(rect, e, e + sill, col, { topK: 0.85 });
          if (sill + oh < w.h) prism(rect, e + sill + oh, top, col, { topK: 0.8 });
          if (OPENING_TYPES[op.type].cat === 'window') {
            const gr = [P2(0, -1), P2(g.width, -1), P2(g.width, 1), P2(0, 1)];
            face([V3(gr[0], e + sill), V3(gr[1], e + sill), V3(gr[1], e + sill + oh), V3(gr[0], e + sill + oh)], [0.55, 0.75, 0.9], null, true);
          }
        }
      }
      // предметы
      if (View3D.opts.items) for (const it of App.V.items) {
        const def = catItem(it.key);
        if (def.sym || !(it.h > 0) || def.shape === 'rug') continue;
        const z0 = e + (def.shape === 'upper' ? 140 : 0);
        View3D.item(it, def, z0, prism);
      }
    }
    App.V = saveV;
    // крыши
    if (View3D.opts.roof) for (const r of d.roofs) {
      if (!View3D.opts.upper && Model.floorIdx(r.floor) > active) continue;
      const col = View3D.hex((ROOF_MATERIALS[r.mat] || ROOF_MATERIALS.metaltile).color);
      const fs = Roof.faces(r);
      const cx = r.x / 100, cz = r.y / 100, cy = (r.base || 0) / 100;
      for (const f of fs) {
        const vs = f.map(p => [p.x / 100, p.z / 100, p.y / 100]);
        const vertical = Math.abs(normal(vs[0], vs[1], vs[2])[1]) < 0.2;
        face(vs, vertical ? View3D.hex('#e4ddd0') : col, [cx, cy - 5, cz]);
      }
      if (r.type === 'flat') prism(G.rectPts(r.x, r.y, r.w, r.d, r.rot || 0), r.base, r.base + 20, col);
    }
    View3D.arrays = { P, N, C: Cc, GP, GN, GC };
    if (View3D.gl) {
      View3D.mesh = View3D.upload(P, N, Cc);
      View3D.glass = View3D.upload(GP, GN, GC);
    }
    View3D.dirty = false;
    return View3D.arrays;
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
  item(it, def, z0, prism) {
    const sh = def.shape;
    const cat = { furniture: '#d9c7a8', plumbing: '#f2f4f6', heating: '#c26b4f', gas: '#e5c455', electric: '#e8e8e8', siteobj: '#c9b89a' }[def.layer] || '#d0d0d0';
    const pts = Model.itemPts(it);
    const H = it.h;
    if (sh === 'tree' || sh === 'conifer' || sh === 'bush') {
      const r = Math.min(it.w, it.d) / 2;
      const trunkH = sh === 'tree' ? H * 0.35 : sh === 'conifer' ? H * 0.08 : 0;
      if (trunkH > 0) prism(G.rectPts(it.x, it.y, Math.max(15, r * 0.1), Math.max(15, r * 0.1), 0), z0, z0 + trunkH, View3D.hex('#7a5230'));
      const green = View3D.hex(sh === 'conifer' ? '#3f7d4f' : '#6aa84f');
      const n = 10;
      if (sh === 'conifer') {
        // конус из колец
        for (let k = 0; k < 4; k++) {
          const t0 = k / 4, t1 = (k + 1) / 4;
          const ring = (t) => Array.from({ length: n }, (_, i) => ({ x: it.x + Math.cos(i / n * Math.PI * 2) * r * (1 - t), y: it.y + Math.sin(i / n * Math.PI * 2) * r * (1 - t) }));
          prism(ring(t0), z0 + trunkH + (H - trunkH) * t0, z0 + trunkH + (H - trunkH) * t1, green.map(x => x * (0.9 + k * 0.03)), { topK: 1.05 });
        }
      } else {
        // крона — «шар» из стопки цилиндров
        const layers = 5, h0 = z0 + trunkH, hh = H - trunkH;
        for (let k = 0; k < layers; k++) {
          const t = (k + 0.5) / layers, rr = r * Math.sqrt(1 - (2 * t - 1) ** 2) * 1.05;
          const ring = Array.from({ length: n }, (_, i) => ({ x: it.x + Math.cos(i / n * Math.PI * 2) * rr, y: it.y + Math.sin(i / n * Math.PI * 2) * rr }));
          prism(ring, h0 + hh * k / layers, h0 + hh * (k + 1) / layers, green, { topK: 1.08 });
        }
      }
      return;
    }
    if (['round', 'boiler', 'ring', 'well', 'borehole', 'roundtable', 'columnRound', 'pump'].includes(sh)) {
      const n = 14;
      const ring = Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return G.toWorld({ x: Math.cos(a) * it.w / 2, y: Math.sin(a) * it.d / 2 }, it.x, it.y, it.rot); });
      prism(ring, z0, z0 + Math.max(2, H), View3D.hex(cat), { topK: 0.95 });
      return;
    }
    if (['building', 'garage', 'gazebo'].includes(sh)) {
      // постройка: стены + двускатная крыша
      const wallH = H * 0.7;
      prism(pts, z0, z0 + wallH, View3D.hex('#ddd3c3'));
      const rf = { x: it.x, y: it.y, w: it.w + 40, d: it.d + 40, rot: it.rot || 0, type: 'gable', pitch: U.deg(Math.atan((H - wallH) / (it.d / 2 + 20))), base: z0 + wallH };
      if (it.d > it.w) { rf.w = it.d + 40; rf.d = it.w + 40; rf.rot += 90; rf.pitch = U.deg(Math.atan((H - wallH) / (it.w / 2 + 20))); }
      const col = View3D.hex(sh === 'garage' ? '#6f7780' : '#8e3b30');
      for (const f of Roof.faces(rf)) {
        const vs = f.map(p => [p.x / 100, p.z / 100, p.y / 100]);
        View3D._face(vs, col, [it.x / 100, (z0 + wallH) / 100 - 3, it.y / 100]);
      }
      return;
    }
    if (sh === 'canopy' || sh === 'canopyLean') {
      const post = 14;
      const corners = G.rectPts(it.x, it.y, it.w - post, it.d - post, it.rot || 0);
      for (const c of corners) prism(G.rectPts(c.x, c.y, post, post, it.rot || 0), z0, z0 + H - 20, View3D.hex('#6b5a44'));
      prism(pts, z0 + H - 20, z0 + H, View3D.hex('#5d6d7c'), { bottom: true });
      return;
    }
    if (sh === 'greenhouse') { prism(pts, z0, z0 + H, [0.75, 0.88, 0.95]); return; }
    if (sh === 'pool') { prism(pts, z0, z0 + 3, View3D.hex('#4f9de0'), { noSides: true }); return; }
    const h = sh === 'hedge' ? H : Math.max(2, H);
    const col = sh === 'hedge' ? View3D.hex('#5c9a47') : sh === 'car' ? View3D.hex('#8a96a8') : View3D.hex(cat);
    prism(pts, z0, z0 + h, col, { topK: 0.95 });
  },
  _face: null,

  /* ------------------------------- WebGL ---------------------------------- */
  init() {
    const cv = $('canvas3d');
    View3D.canvas = cv;
    const gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: false }) || cv.getContext('experimental-webgl');
    if (!gl) return false;
    View3D.gl = gl;
    const vs = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 mvp; uniform vec3 L; uniform float amb;
      varying vec3 vc; void main(){ gl_Position = mvp * vec4(p, 1.0);
      float d = max(dot(normalize(n), L), 0.0); float sky = 0.5 + 0.5 * n.y;
      vc = c * (amb * (0.75 + 0.25 * sky) + (1.0 - amb) * d); }`;
    const fs = `precision mediump float; varying vec3 vc; uniform float alpha; void main(){ gl_FragColor = vec4(vc, alpha); }`;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    View3D.prog = pr;
    View3D.loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), c: gl.getAttribLocation(pr, 'c'), mvp: gl.getUniformLocation(pr, 'mvp'), L: gl.getUniformLocation(pr, 'L'), amb: gl.getUniformLocation(pr, 'amb'), alpha: gl.getUniformLocation(pr, 'alpha') };
    View3D.bindInput(cv);
    return true;
  },
  upload(P, N, C) {
    const gl = View3D.gl;
    const mk = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
    return { p: mk(P), n: mk(N), c: mk(C), count: P.length / 3 };
  },
  draw() {
    if (!View3D.active) return;
    const gl = View3D.gl, cv = View3D.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (View3D.dirty) View3D.build();
    gl.viewport(0, 0, w, h);
    const dark = Theme.isDark();
    const sky = dark ? [0.1, 0.13, 0.17] : [0.8, 0.88, 0.96];
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(View3D.prog);
    const c = View3D.cam;
    const eye = [c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    const mvp = M4.mul(M4.persp(0.8, w / Math.max(1, h), 0.1, 3000), M4.lookAt(eye, [c.tx, c.ty, c.tz], [0, 1, 0]));
    gl.uniformMatrix4fv(View3D.loc.mvp, false, mvp);
    // свет: солнце (если над горизонтом и включено) или «рассеянный день»
    let az = 200, alt = 45;
    if (View3D.opts.sun) { const s = Sun.current(); if (s.alt > 1) { az = s.az; alt = s.alt; } else { alt = 8; } }
    const dir = Sun.planDir(az), a = U.rad(alt);
    gl.uniform3f(View3D.loc.L, dir.x * Math.cos(a), Math.sin(a), dir.y * Math.cos(a));
    gl.uniform1f(View3D.loc.amb, View3D.opts.sun && Sun.current().alt <= 1 ? 0.35 : 0.5);
    const drawMesh = (m, alpha) => {
      if (!m || !m.count) return;
      const L = View3D.loc;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.p); gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.n); gl.enableVertexAttribArray(L.n); gl.vertexAttribPointer(L.n, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.c); gl.enableVertexAttribArray(L.c); gl.vertexAttribPointer(L.c, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(L.alpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    };
    gl.disable(gl.BLEND); gl.depthMask(true);
    drawMesh(View3D.mesh, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    drawMesh(View3D.glass, 0.4);
    gl.depthMask(true);
  },
  redraw() { if (View3D.active && !View3D._raf) View3D._raf = requestAnimationFrame(() => { View3D._raf = 0; View3D.draw(); }); },

  /* ------------------------------ камера ---------------------------------- */
  fit() {
    const b = Model.contentBBox() || { x0: -500, y0: -500, x1: 500, y1: 500 };
    const c = View3D.cam;
    c.tx = (b.x0 + b.x1) / 200; c.tz = (b.y0 + b.y1) / 200;
    const top = App.doc.floors.reduce((m, f) => Math.max(m, f.elev + f.h), 300);
    c.ty = top / 400;
    c.dist = Math.max(8, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 100 * 0.95);
    c.yaw = -0.75 - U.rad(App.doc.north); c.pitch = 0.5;
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
    cv.addEventListener('wheel', (e) => { e.preventDefault(); View3D.cam.dist = U.clamp(View3D.cam.dist * Math.exp(e.deltaY * 0.0012), 2, 1500); View3D.redraw(); }, { passive: false });
  },

  /* ------------------------------ вкл/выкл -------------------------------- */
  toggle(on) {
    on = on ?? !View3D.active;
    if (on && !View3D.gl) {
      try { if (!View3D.init()) { UI.toast('WebGL недоступен в этом браузере', 'err'); return; } }
      catch (e) { console.error(e); UI.toast('Не удалось запустить 3D: ' + e.message, 'err'); return; }
    }
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
