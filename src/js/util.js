'use strict';
/* ==========================================================================
   Утилиты и геометрия. Мировые единицы — САНТИМЕТРЫ, ось Y направлена вниз.
   ========================================================================== */

const U = {
  _id: 0,
  uid(prefix = 'o') {
    this._id++;
    return prefix + Date.now().toString(36).slice(-5) + this._id.toString(36) + Math.random().toString(36).slice(2, 5);
  },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  rad: (d) => d * Math.PI / 180,
  deg: (r) => r * 180 / Math.PI,
  normDeg(d) { d = d % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; },
  norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; },
  round(v, step = 1) { return Math.round(v / step) * step; },
  num(v, def = 0) { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : def; },
  isNum: (v) => typeof v === 'number' && Number.isFinite(v),
  clone: (o) => JSON.parse(JSON.stringify(o)),
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* ---- форматирование ---- */
  fmtLen(cm, units) {
    units = units || (typeof App !== 'undefined' && App.doc ? App.doc.settings.units : 'm');
    if (!Number.isFinite(cm)) return '—';
    if (units === 'cm') return Math.round(cm) + ' см';
    if (units === 'mm') return Math.round(cm * 10) + ' мм';
    return (cm / 100).toFixed(2) + ' м';
  },
  fmtLenShort(cm, units) {
    units = units || (typeof App !== 'undefined' && App.doc ? App.doc.settings.units : 'm');
    if (units === 'cm') return String(Math.round(cm));
    if (units === 'mm') return String(Math.round(cm * 10));
    return (cm / 100).toFixed(2);
  },
  fmtArea(cm2) { return (cm2 / 10000).toFixed(2) + ' м²'; },
  fmtHours(h) {
    if (!Number.isFinite(h)) return '—';
    const hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60);
    return mm === 60 ? (hh + 1) + ' ч 00 мин' : hh + ' ч ' + String(mm).padStart(2, '0') + ' мин';
  },
  fmtTime(min) {
    if (!Number.isFinite(min)) return '—';
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  },
  /** Разбор длины из строки: «350», «3.5м», «3,5 m», «350см», «3500мм» → см */
  parseLen(s) {
    s = String(s).trim().toLowerCase().replace(',', '.');
    const m = s.match(/^(-?\d*\.?\d+)\s*(мм|mm|см|cm|м|m)?$/);
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    const u = m[2];
    if (u === 'мм' || u === 'mm') return v / 10;
    if (u === 'м' || u === 'm') return v * 100;
    return v;
  },
  compass16(bearing) {
    const names = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
    return names[Math.round(U.norm360(bearing) / 22.5) % 16];
  },
  compass8(bearing) {
    const names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return names[Math.round(U.norm360(bearing) / 45) % 8];
  },

  debounce(fn, ms) {
    let t = 0;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },
  download(name, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  },
};

/* ------------------------------ геометрия ------------------------------- */
const G = {
  pt: (x, y) => ({ x, y }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, k) => ({ x: a.x * k, y: a.y * k }),
  mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  len: (a) => Math.hypot(a.x, a.y),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  dist2: (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2,
  unit(a) { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
  perp: (a) => ({ x: -a.y, y: a.x }),
  eq: (a, b, eps = 0.5) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps,
  angle: (a, b) => Math.atan2(b.y - a.y, b.x - a.x),
  fromAngle: (ang, l = 1) => ({ x: Math.cos(ang) * l, y: Math.sin(ang) * l }),
  rotate(p, c, ang) {
    const s = Math.sin(ang), co = Math.cos(ang);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
  },
  /** Проекция точки на отрезок: t (0..1), расстояние, ближайшая точка */
  proj(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    const tc = U.clamp(t, 0, 1);
    const q = { x: a.x + dx * tc, y: a.y + dy * tc };
    return { t, tc, q, d: Math.hypot(p.x - q.x, p.y - q.y), perp: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / (Math.sqrt(l2) || 1) };
  },
  distSeg(p, a, b) { return G.proj(p, a, b).d; },
  /** Пересечение отрезков (строгое внутри, с допуском) */
  segInter(a, b, c, d) {
    const r = G.sub(b, a), s = G.sub(d, c);
    const den = G.cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = G.cross(G.sub(c, a), s) / den;
    const u = G.cross(G.sub(c, a), r) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: a.x + r.x * t, y: a.y + r.y * t, t, u };
  },
  lineInter(a, b, c, d) {
    const r = G.sub(b, a), s = G.sub(d, c);
    const den = G.cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = G.cross(G.sub(c, a), s) / den;
    return { x: a.x + r.x * t, y: a.y + r.y * t, t };
  },
  /** Луч p + dir*t (t>0) против отрезка c-d → t или null */
  raySeg(p, dir, c, d) {
    const s = G.sub(d, c);
    const den = G.cross(dir, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = G.cross(G.sub(c, p), s) / den;
    const u = G.cross(G.sub(c, p), dir) / den;
    if (t <= 1e-6 || u < -1e-9 || u > 1 + 1e-9) return null;
    return t;
  },
  polyArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  },
  polyPerimeter(pts, closed = true) {
    let s = 0;
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) s += G.dist(pts[i], pts[(i + 1) % n]);
    return s;
  },
  polyCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    if (Math.abs(a) < 1e-9) {
      const b = G.bbox(pts);
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  },
  pointInPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },
  /** Точка внутри полигона, удобная для подписи (центроид или поиск по горизонтальным сканлиниям) */
  labelPoint(pts) {
    const c = G.polyCentroid(pts);
    if (G.pointInPoly(c, pts)) return c;
    const b = G.bbox(pts);
    let best = null, bestW = -1;
    for (let k = 1; k < 12; k++) {
      const y = b.y0 + (b.y1 - b.y0) * k / 12;
      const xs = [];
      for (let i = 0, n = pts.length; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        if ((p.y > y) !== (q.y > y)) xs.push(p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y));
      }
      xs.sort((a, b2) => a - b2);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > bestW) { bestW = xs[i + 1] - xs[i]; best = { x: (xs[i] + xs[i + 1]) / 2, y }; }
      }
    }
    return best || c;
  },
  bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  },
  bboxUnion(a, b) {
    if (!a) return b; if (!b) return a;
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  },
  bboxValid: (b) => b && Number.isFinite(b.x0) && b.x1 >= b.x0,
  hull(points) {
    const pts = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  },
  /** Углы прямоугольника с центром (x,y), размерами w×d и поворотом rot (градусы) */
  rectPts(x, y, w, d, rot = 0) {
    const a = U.rad(rot), c = Math.cos(a), s = Math.sin(a);
    const hw = w / 2, hd = d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => ({ x: x + u * c - v * s, y: y + u * s + v * c }));
  },
  toLocal(p, x, y, rot) {
    const a = -U.rad(rot), c = Math.cos(a), s = Math.sin(a);
    const dx = p.x - x, dy = p.y - y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  },
  toWorld(p, x, y, rot) {
    const a = U.rad(rot), c = Math.cos(a), s = Math.sin(a);
    return { x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c };
  },
  /** Смещение полигона внутрь (для положительной площади в y-вниз), с miter-ограничением */
  inset(pts, dFn) {
    const n = pts.length;
    if (n < 3) return pts;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      const d1 = typeof dFn === 'function' ? dFn((i - 1 + n) % n) : dFn;
      const d2 = typeof dFn === 'function' ? dFn(i) : dFn;
      const e1 = G.unit(G.sub(cur, prev)), e2 = G.unit(G.sub(next, cur));
      const n1 = { x: -e1.y, y: e1.x }, n2 = { x: -e2.y, y: e2.x };
      const a1 = G.add(prev, G.mul(n1, d1)), b1 = G.add(cur, G.mul(n1, d1));
      const a2 = G.add(cur, G.mul(n2, d2)), b2 = G.add(next, G.mul(n2, d2));
      const ip = G.lineInter(a1, b1, a2, b2);
      const lim = Math.max(Math.abs(d1), Math.abs(d2)) * 4 + 5;
      out.push(ip && G.dist(ip, cur) <= lim ? { x: ip.x, y: ip.y } : G.mid(b1, a2));
    }
    return out;
  },
};
