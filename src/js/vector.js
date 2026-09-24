'use strict';
/* ==========================================================================
   Векторный экспорт: «записывающий» контекст с API Canvas 2D.
   Тот же Render.draw рисует в него, а результат выводится в SVG (со слоями)
   или DXF R12 (AutoCAD; миллиметры, кириллица в cp1251).
   Дуги и кривые аппроксимируются ломаными.
   ========================================================================== */

class VectorCtx {
  constructor() {
    this.isVector = true;
    this.m = [1, 0, 0, 1, 0, 0];
    this.st = [];
    this.subs = []; this.cur = null; this.last = null; this.pathVer = 0;
    this.recs = [];
    this.layer = '0';
    this.clips = 0;
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1;
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.lineCap = 'butt'; this.lineJoin = 'miter'; this.globalCompositeOperation = 'source-over';
    this.imageSmoothingEnabled = true; this.imageSmoothingQuality = 'low'; this.dash = [];
    this._mc = document.createElement('canvas').getContext('2d');
  }
  setLayer(n) { this.layer = n; }
  /* ---- трансформации ---- */
  T(x, y) { const m = this.m; return { x: m[0] * x + m[2] * y + m[4] + (this.bx || 0), y: m[1] * x + m[3] * y + m[5] + (this.by || 0) }; }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  resetTransform() { this.m = [1, 0, 0, 1, 0, 0]; }
  transform(a, b, c, d, e, f) {
    const m = this.m;
    this.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  scaleK() { const m = this.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
  save() { this.st.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, dash: this.dash.slice(), clips: this.clips }); }
  restore() {
    const s = this.st.pop();
    if (!s) return;
    while (this.clips > s.clips) { this.recs.push({ t: 'clipEnd', layer: this.layer }); this.clips--; }
    Object.assign(this, { m: s.m, fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, lineWidth: s.lineWidth, globalAlpha: s.globalAlpha, font: s.font, textAlign: s.textAlign, textBaseline: s.textBaseline, dash: s.dash });
  }
  /* ---- контур ---- */
  beginPath() { this.subs = []; this.cur = null; this.pathVer++; }
  moveTo(x, y) { this.cur = { pts: [this.T(x, y)], closed: false }; this.subs.push(this.cur); this.last = { x, y }; }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.cur.pts.push(this.T(x, y)); this.last = { x, y }; }
  closePath() { if (this.cur) { this.cur.closed = true; const p = this.cur.pts[0]; this.cur = { pts: [p], closed: false }; this.subs.push(this.cur); } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  _arcPts(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let sweep = a1 - a0;
    const TAU = Math.PI * 2;
    if (!ccw) { if (sweep >= TAU) sweep = TAU; else { while (sweep < 0) sweep += TAU; } }
    else { if (-sweep >= TAU) sweep = -TAU; else { while (sweep > 0) sweep -= TAU; } }
    const n = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * i / n;
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      const x = cx + ex * cr - ey * sr, y = cy + ex * sr + ey * cr;
      if (i === 0 && !this.cur) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  arc(x, y, r, a0, a1, ccw) { this._arcPts(x, y, r, r, 0, a0, a1, ccw); }
  ellipse(x, y, rx, ry, rot, a0, a1, ccw) { this._arcPts(x, y, rx, ry, rot, a0, a1, ccw); }
  arcTo(x1, y1, x2, y2, r) {
    const p0 = this.last || { x: x1, y: y1 };
    const v1 = { x: p0.x - x1, y: p0.y - y1 }, v2 = { x: x2 - x1, y: y2 - y1 };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    const cross = v1.x * v2.y - v1.y * v2.x;
    if (r <= 0 || l1 < 1e-9 || l2 < 1e-9 || Math.abs(cross) < 1e-9) { this.lineTo(x1, y1); return; }
    const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 };
    const ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    const d = r / Math.tan(ang / 2);
    const t1 = { x: x1 + u1.x * d, y: y1 + u1.y * d }, t2 = { x: x1 + u2.x * d, y: y1 + u2.y * d };
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y }, bl = Math.hypot(bis.x, bis.y);
    const c = { x: x1 + bis.x / bl * (r / Math.sin(ang / 2)), y: y1 + bis.y / bl * (r / Math.sin(ang / 2)) };
    this.lineTo(t1.x, t1.y);
    const a0 = Math.atan2(t1.y - c.y, t1.x - c.x), a1 = Math.atan2(t2.y - c.y, t2.x - c.x);
    this._arcPts(c.x, c.y, r, r, 0, a0, a1, cross > 0);
  }
  quadraticCurveTo(cx, cy, x, y) {
    const p0 = this.last || { x: cx, y: cy };
    for (let i = 1; i <= 10; i++) { const t = i / 10, a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t; this.lineTo(a * p0.x + b * cx + c * x, a * p0.y + b * cy + c * y); }
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    const p0 = this.last || { x: c1x, y: c1y };
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      this.lineTo(a * p0.x + b * c1x + c * c2x + d * x, a * p0.y + b * c1y + c * c2y + d * y);
    }
  }
  _subs() { return this.subs.filter(s => s.pts.length > 1).map(s => ({ pts: s.pts.slice(), closed: s.closed })); }
  _rec(kind) {
    const subs = this._subs();
    if (!subs.length) return;
    const last = this.recs[this.recs.length - 1];
    const style = kind === 'fill' ? { fill: VectorCtx.color(this.fillStyle, this.globalAlpha) } : { stroke: VectorCtx.color(this.strokeStyle, this.globalAlpha), width: this.lineWidth * this.scaleK(), dash: this.dash.map(v => v * this.scaleK()) };
    if (last && last.t === 'path' && last.ver === this.pathVer) { Object.assign(last, style); return; }
    this.recs.push({ t: 'path', ver: this.pathVer, subs, layer: this.layer, clip: this.clips > 0, ...style });
  }
  fill() { this._rec('fill'); }
  stroke() { this._rec('stroke'); }
  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.fill(); this.beginPath(); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.beginPath(); }
  clearRect() { /* фон не нужен */ }
  clip() { const subs = this._subs(); if (!subs.length) return; this.recs.push({ t: 'clip', subs, layer: this.layer }); this.clips++; }
  setLineDash(a) { this.dash = (a || []).slice(); }
  getLineDash() { return this.dash.slice(); }
  measureText(t) { this._mc.font = this.font; return this._mc.measureText(t); }
  fillText(text, x, y) {
    const p = this.T(x, y), m = this.m;
    const fm = /(\d+(?:\.\d+)?)px/.exec(this.font);
    const size = (fm ? parseFloat(fm[1]) : 10) * this.scaleK();
    this.recs.push({ t: 'text', text: String(text), x: p.x, y: p.y, size, ang: Math.atan2(m[1], m[0]), align: this.textAlign, base: this.textBaseline, bold: /\b(6|7|8|9)00\b|bold/.test(this.font), fill: VectorCtx.color(this.fillStyle, this.globalAlpha), layer: this.layer, clip: this.clips > 0 });
  }
  strokeText() { /* обводка-«ореол» не нужна в векторе */ }
  drawImage(img, a, b, c, d) {
    if (!img || !(img instanceof HTMLImageElement) || c === undefined) return;   // только подложка
    const p = this.T(a, b), m = this.m;
    this.recs.push({ t: 'image', src: img.src, x: p.x, y: p.y, w: c * this.scaleK(), h: d * this.scaleK(), ang: Math.atan2(m[1], m[0]), alpha: this.globalAlpha, layer: this.layer });
  }
  createPattern(tile) { return { fallback: (tile && tile.__color) || '#cccccc' }; }
  createLinearGradient() { const g = { fallback: '#999999', addColorStop(o, c) { if (o === 0) g.fallback = c; } }; return g; }
  getImageData() { return { data: [] }; }
  putImageData() { /* нет */ }

  /** Цвет → { hex, a } */
  static color(c, alpha = 1) {
    if (c && typeof c === 'object') c = c.fallback || '#999999';
    c = String(c || '#000').trim();
    let r = 0, g = 0, b = 0, a = 1, m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
    else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c))) { const v = parseInt(m[1], 16); r = v >> 16 & 255; g = v >> 8 & 255; b = v & 255; if (m[2]) a = parseInt(m[2], 16) / 255; }
    else if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) { const p = m[1].split(',').map(s => parseFloat(s)); [r, g, b] = p; if (p.length > 3) a = p[3]; }
    const hex = '#' + [r, g, b].map(v => Math.round(U.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
    return { hex, a: a * alpha, r, g, b };
  }
}

const LAYER_DXF = {
  FRAME: 7,
  GRID: 9, UNDERLAY: 8, SITE: 3, ROADS: 8, ROOMS: 2, ITEMS: 5, WALLS: 7, OPENINGS: 7, NETWORKS: 4, ROOF: 1, DIMS: 1, TEXT: 7, LABELS: 7, NOTES: 30, CHECKS: 1, COMPASS: 7,
};

const Vector = {
  /** Нарисовать область плана в VectorCtx. scaleN — масштаб 1:N (для толщины линий и шрифтов) */
  /** Комплект листов-чертежей: генплан + планы этажей с авторазмерами, рядом друг с другом */
  recordSheets(scaleN, o = {}) {
    const ctx = new VectorCtx();
    const k = scaleN / 10;                       // единиц чертежа (см) на 1 мм листа
    let x = 0, Hmax = 0, page = 0;
    const sheets = IO.drawingSheets(o);
    for (const sh of sheets) {
      page++;
      const reg = sh.region, W = reg.x1 - reg.x0, H = reg.y1 - reg.y0;
      const mL = 20 * k, m = 5 * k, tb = 45 * k;
      ctx.bx = x + mL; ctx.by = m;
      Drawing.onFloor(sh.fid, () => (sh.dims ? (fn) => Drawing.withAutoDims(sh.fid, fn) : (fn) => fn())(() => Vector.record(reg, scaleN, { ...o, lower: false, planOnly: sh.dims }, ctx)));
      // рамка (поле слева 20 мм) и штамп в правом нижнем углу под планом
      ctx.bx = x; ctx.by = 0;
      ctx.setLayer('FRAME');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 0.7 * k;
      const fx0 = mL - 3 * k, fy0 = m - 3 * k, fx1 = mL + W + 3 * k, fy1 = m + H + tb;
      ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
      Drawing.vectorTitleBlock(ctx, fx1, fy1, k, { project: App.doc.name || 'Проект', sheet: sh.title, scale: '1:' + scaleN, page: `${page}/${sheets.length}`, note: sh.note });
      const FW = fx1 + m, FH = fy1;
      x += FW + 30 * k;
      Hmax = Math.max(Hmax, FH + m);
      ctx.bx = 0; ctx.by = 0;
    }
    return { ctx, W: x - 30 * k, H: Hmax, sheets: true };
  },
  record(region, scaleN, o = {}, into = null) {
    const ctx = into || new VectorCtx();
    const W = region.x1 - region.x0, H = region.y1 - region.y0;
    const prevC = Theme.C;
    Theme.C = Theme.light;
    const layers = { ...App.doc.settings.layers, grid: !!o.grid, shadows: false, heat: false, lower: o.lower ?? false, checks: false, underlay: !!o.underlay && App.doc.settings.layers.underlay, ...(o.planOnly ? { site: false, siteobj: false, fence: false, roof: false } : {}) };
    try {
      // 1 единица = 1 см; «экранный пиксель» ≈ 0.27 мм на бумаге при масштабе 1:N
      Render.draw({ ctx, w: W, h: H, dpr: 1, fs: 0.027 * scaleN, scale: 1, ox: region.x0, oy: region.y0, C: Theme.light, exporting: true, printGrid: !!o.grid, layers });
      ctx.setLayer('COMPASS');
      const k = 0.027 * scaleN;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const env = { ctx, C: Theme.light, w: W / k, h: H / k, scale: 1 / k, layers: { ...layers, shadows: false, heat: false } };
      const saveCw = App.cw; App.cw = W / k;
      Render.compass(env); Render.scaleBar(env);
      App.cw = saveCw;
    } finally { Theme.C = prevC; }
    return { ctx, W, H };
  },
  svg(region, scaleN, o = {}) {
    const { ctx, W, H } = o.drawing ? Vector.recordSheets(scaleN, o) : Vector.record(region, scaleN, o);
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const pathD = (subs) => subs.map(s => 'M' + s.pts.map(p => f(p.x) + ' ' + f(p.y)).join('L') + (s.closed ? 'Z' : '')).join('');
    const out = [];
    const mm = (v) => (v * 10 / scaleN).toFixed(1);
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${mm(W)}mm" height="${mm(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`,
      `<title>${U.esc(App.doc.name)} — 1:${scaleN}</title>`,
      `<rect width="100%" height="100%" fill="#ffffff"/>`);
    let layer = null, clipN = 0, openClips = 0;
    const names = { FRAME: 'Рамка и штамп', GRID: 'Сетка', UNDERLAY: 'Подложка', SITE: 'Участок', ROADS: 'Дороги', ROOMS: 'Помещения', ITEMS: 'Предметы', WALLS: 'Стены', OPENINGS: 'Проёмы', NETWORKS: 'Сети', ROOF: 'Крыша', DIMS: 'Размеры', TEXT: 'Надписи', LABELS: 'Подписи', NOTES: 'Примечания', CHECKS: 'Отступы', COMPASS: 'Компас' };
    for (const r of ctx.recs) {
      if (r.layer !== layer && !openClips) {
        if (layer !== null) out.push('</g>');
        layer = r.layer;
        out.push(`<g id="${layer}" inkscape:groupmode="layer" inkscape:label="${names[layer] || layer}">`);
      }
      if (r.t === 'clip') { clipN++; openClips++; out.push(`<clipPath id="c${clipN}"><path d="${pathD(r.subs)}"/></clipPath><g clip-path="url(#c${clipN})">`); continue; }
      if (r.t === 'clipEnd') { if (openClips) { out.push('</g>'); openClips--; } continue; }
      if (r.t === 'path') {
        const fill = r.fill ? `fill="${r.fill.hex}"${r.fill.a < 1 ? ` fill-opacity="${r.fill.a.toFixed(3)}"` : ''} fill-rule="nonzero"` : 'fill="none"';
        const stroke = r.stroke ? ` stroke="${r.stroke.hex}"${r.stroke.a < 1 ? ` stroke-opacity="${r.stroke.a.toFixed(3)}"` : ''} stroke-width="${f(r.width)}" stroke-linejoin="round"${r.dash && r.dash.length ? ` stroke-dasharray="${r.dash.map(f).join(' ')}"` : ''}` : '';
        out.push(`<path d="${pathD(r.subs)}" ${fill}${stroke}/>`);
      } else if (r.t === 'text') {
        const anchor = r.align === 'center' ? 'middle' : (r.align === 'right' || r.align === 'end') ? 'end' : 'start';
        const base = r.base === 'middle' ? 'central' : r.base === 'top' ? 'hanging' : 'alphabetic';
        const rot = Math.abs(r.ang) > 1e-4 ? ` transform="rotate(${f(U.deg(r.ang))} ${f(r.x)} ${f(r.y)})"` : '';
        out.push(`<text x="${f(r.x)}" y="${f(r.y)}" font-family="Arial, sans-serif" font-size="${f(r.size)}"${r.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" dominant-baseline="${base}" fill="${r.fill.hex}"${r.fill.a < 1 ? ` fill-opacity="${r.fill.a.toFixed(3)}"` : ''}${rot}>${U.esc(r.text)}</text>`);
      } else if (r.t === 'image') {
        out.push(`<image x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" opacity="${r.alpha.toFixed(2)}" xlink:href="${r.src}" transform="rotate(${f(U.deg(r.ang))} ${f(r.x)} ${f(r.y)})"/>`);
      }
    }
    while (openClips--) out.push('</g>');
    if (layer !== null) out.push('</g>');
    out.push('</svg>');
    return out.join('\n');
  },
  /** DXF R12: полилинии и тексты по слоям, мм, ось Y вверх */
  dxf(region, scaleN, o = {}) {
    const { ctx, sheets } = o.drawing ? Vector.recordSheets(scaleN, o) : Vector.record(region, scaleN, o);
    const L = [];
    const g = (code, val) => { L.push(String(code), String(val)); };
    // мм; одиночный план — в координатах проекта, комплект листов — от левого верхнего угла
    const X = (p) => (p.x + (sheets ? 0 : region.x0)) * 10, Y = (p) => -(p.y + (sheets ? 0 : region.y0)) * 10;
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    const used = new Set(ctx.recs.map(r => r.layer));
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 4);
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, used.size);
    for (const n of used) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, LAYER_DXF[n] || 7); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const r of ctx.recs) {
      if (r.clip) continue;                 // штриховки внутри клипа — пропускаем
      if (r.t === 'path' && (r.layer === 'LABELS' || r.layer === 'GRID') && !r.stroke) continue;   // подложки под подписями
      if (r.t === 'path') {
        for (const s of r.subs) {
          const pts = s.pts.filter((p, i) => i === 0 || Math.hypot(p.x - s.pts[i - 1].x, p.y - s.pts[i - 1].y) > 1e-4);
          if (pts.length < 2) continue;
          const closed = s.closed || (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-4);
          if (closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-4) pts.pop();
          g(0, 'POLYLINE'); g(8, r.layer); g(66, 1); g(70, closed ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
          for (const p of pts) { g(0, 'VERTEX'); g(8, r.layer); g(10, f(X(p))); g(20, f(Y(p))); g(30, 0); }
          g(0, 'SEQEND'); g(8, r.layer);
        }
      } else if (r.t === 'text' && r.text.trim()) {
        const h = r.size * 10 * 0.72;      // высота прописных ≈ 0.72 кегля
        const hAlign = r.align === 'center' ? 1 : (r.align === 'right' || r.align === 'end') ? 2 : 0;
        const vAlign = r.base === 'middle' ? 2 : r.base === 'top' ? 3 : 0;
        g(0, 'TEXT'); g(8, r.layer); g(10, f(X(r))); g(20, f(Y(r))); g(30, 0); g(40, f(h)); g(1, r.text.replace(/\n/g, ' '));
        g(50, f(-U.deg(r.ang))); g(72, hAlign); g(11, f(X(r))); g(21, f(Y(r))); g(31, 0); g(73, vAlign);
      }
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return Vector.cp1251(L.join('\r\n') + '\r\n');
  },
  cp1251(s) {
    const out = new Uint8Array(s.length);
    const extra = { 'Ё': 0xA8, 'ё': 0xB8, '№': 0xB9, '°': 0xB0, '«': 0xAB, '»': 0xBB, '—': 0x97, '–': 0x96, '·': 0xB7, '±': 0xB1, '…': 0x85, '×': 0xD7 };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], c = s.charCodeAt(i);
      if (c < 128) out[i] = c;
      else if (c >= 0x410 && c <= 0x44F) out[i] = c - 0x410 + 0xC0;
      else if (extra[ch] !== undefined) out[i] = extra[ch] === 0xD7 ? 0x78 : extra[ch];
      else if (ch === '²') out[i] = 0x32;
      else if (ch === '≈') out[i] = 0x7E;
      else out[i] = 0x3F;
    }
    return out;
  },
  exportFile(kind, o = {}) {
    const region = IO.regionFor(o.area || 'all');
    const N = o.scale && o.scale !== 'fit' ? +o.scale : 100;
    const suffix = o.drawing ? '-чертежи' : '';
    if (kind === 'svg') { U.download(IO.fileName('svg').replace('.svg', suffix + '.svg'), Vector.svg(region, N, o), 'image/svg+xml'); UI.toast(`SVG сохранён (масштаб 1:${N}${o.drawing ? ', листы с размерами и штампом' : ''})`); }
    else { U.download(IO.fileName('dxf').replace('.dxf', suffix + '.dxf'), Vector.dxf(region, N, o), 'application/dxf'); UI.toast(`DXF сохранён: мм, слои по разделам${o.drawing ? ', листы рядом' : ''}`); }
  },
};
