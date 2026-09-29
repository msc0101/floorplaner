'use strict';
/* ==========================================================================
   Строительные чертежи для прораба: разрез дома (фундамент → стены → чердак →
   кровля) со всеми слоями, узлы (фундамент, карниз) — тот же разрез крупно,
   раскладка кладки по стенам (ряды блоков, перевязка, армирование, перемычки,
   армопояс) и план стропильной системы. Всё строится из модели проекта.
   Условные обозначения материалов — по ГОСТ 2.306 / ГОСТ 21.101 (упрощённо).
   ========================================================================== */

const Detail = {
  /* ------------------------------- модель ------------------------------- */
  /** Сводная модель дома для разреза: уровни, стены по разрезу, фундамент, крыша */
  model() {
    const d = App.doc, f1 = d.floors[0], F = Struct.foundation(), r = d.roofs.find(x => (x.floor || f1.id) === f1.id) || d.roofs[0];
    const ext = d.walls.filter(w => (w.floor || f1.id) === f1.id && w.kind === 'ext');
    const w0 = ext[0] || { th: 40, h: 300, mat: 'aerated', ins: 0 };
    const o = Struct.opt();
    const lay = Detail.layers(w0);
    // уровни, см (0 — чистый пол 1 этажа)
    const top = r ? (r.base || f1.h || 300) : Math.max(...ext.map(w => w.h), 270);
    const lv = { fin: 0, screed: -6, slab: -16, xps: -26, sand: -56, stripTop: -6, gnd: -6 - (o.plinth || 40) };
    lv.stripBot = lv.gnd - (F ? F.depth * 100 : 50);
    lv.cushion = lv.stripBot - 20;
    lv.wallTop = top;
    lv.ring = WALL_REINF[w0.mat] && WALL_REINF[w0.mat].ring ? 25 : 0;
    lv.ceil = top - 10;                                                        // натяжной потолок
    const fr = r ? Roof.frame(r) : null;
    return { F, r, fr, w0, lay, lv, o, top, ext };
  },
  /** Слои наружной стены изнутри наружу: [{name, th, kind}] */
  layers(w) {
    const clad = w.clad || 0, gap = clad ? (w.gap ?? 3) : 0, ins = w.ins || 0, core = Math.max(10, w.th - clad - gap - ins);
    const L = [{ kind: 'block', th: core, name: (WALL_MATERIALS[w.mat] || {}).name || 'Кладка', mat: w.mat }];
    if (ins) L.push({ kind: 'ins', th: ins, name: 'Минвата фасадная 100 кг/м³' });
    if (gap) L.push({ kind: 'gap', th: gap, name: 'Вентзазор' });
    if (clad) L.push({ kind: 'brick', th: clad, name: 'Облицовочный кирпич' });
    return L;
  },
  /** Разрез поперёк конька посередине самого широкого окна (чтобы попала перемычка) */
  cut(M) {
    const r = M.r;
    if (!r) return null;
    const along = (w) => Math.abs(G.dot(G.unit(G.sub(w.b, w.a)), { x: Math.cos(U.rad(r.rot || 0)), y: Math.sin(U.rad(r.rot || 0)) })) > 0.95;
    let best = null;
    const S = Roof.support(r);
    for (const w of M.ext.filter(along)) for (const op of App.doc.openings.filter(x => x.wall === w.id && OPENING_TYPES[x.type] && OPENING_TYPES[x.type].cat === 'window')) {
      const c = G.add(w.a, G.mul(G.unit(G.sub(w.b, w.a)), op.pos)), u = G.toLocal(c, r.x, r.y, r.rot || 0).x;
      // разрез должен пройти через обе наружные стены по краям дома (не через крыльцо или нишу)
      const ex = Detail.cutWalls(M, u).filter(x => x.kind === 'ext'), full = ex.length >= 2 && Math.abs(ex[0].v - S.v0) < 30 && Math.abs(ex[ex.length - 1].v - S.v1) < 30;
      const score = (full ? 1000 : 0) + op.w;
      if (!best || score > best.score) best = { op, c, score };
    }
    const u = best ? G.toLocal(best.c, r.x, r.y, r.rot || 0).x : 0;
    return { u, at: best ? best.c : { x: r.x, y: r.y } };
  },
  /** Стены, пересекающие линию разреза: положение по v, толщина, вид, проём в разрезе */
  cutWalls(M, u) {
    const r = M.r, out = [];
    const P0 = G.toWorld({ x: u, y: -r.d }, r.x, r.y, r.rot || 0), P1 = G.toWorld({ x: u, y: r.d }, r.x, r.y, r.rot || 0);
    for (const w of App.doc.walls) {
      if ((w.floor || App.doc.floors[0].id) !== App.doc.floors[0].id || w.kind === 'fence') continue;
      const x = G.segInter(P0, P1, w.a, w.b);
      if (!x) continue;
      const v = G.toLocal(x, r.x, r.y, r.rot || 0).y, s = G.dist(w.a, x);
      const op = App.doc.openings.find(o2 => o2.wall === w.id && Math.abs(o2.pos - s) < o2.w / 2);
      // наружная сторона: там, где нет дома
      const n = G.perp(G.unit(G.sub(w.b, w.a))), fd = (App.floorData || [])[0];
      const inside = (p) => fd && fd.outlines.some(o2 => G.pointInPoly(p, o2.outer));
      const outN = w.kind === 'ext' ? (inside(G.add(x, G.mul(n, w.th))) ? -1 : 1) : 0;
      const outV = outN ? Math.sign(G.toLocal(G.add(x, G.mul(n, outN * 50)), r.x, r.y, r.rot || 0).y - v) : 0;
      out.push({ w, v, th: w.th, kind: w.kind, h: w.h, op, outV });
    }
    return out.sort((a, b) => a.v - b.v);
  },

  /* ------------------------------- рисование ------------------------------- */
  /** Холст с масштабом: s (см) → x, z (см, вверх) → y */
  kit(ctx, k, ox, oy, dpmm) {
    const D = { ctx, k, dpmm, X: (s) => ox + s * k, Y: (z) => oy - z * k, mm: (v) => v * dpmm };
    D.pat = Detail.patterns(ctx, dpmm);
    D.rect = (s0, z0, s1, z1, fill, stroke = '#111', lw = 0.25) => {
      const x = D.X(Math.min(s0, s1)), y = Math.min(D.Y(z0), D.Y(z1)), w = Math.abs(s1 - s0) * k, h = Math.abs(z1 - z0) * k;
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = D.mm(lw); ctx.strokeRect(x, y, w, h); }
    };
    D.poly = (pts, fill, stroke = '#111', lw = 0.25) => {
      ctx.beginPath(); pts.forEach(([s, z], i) => i ? ctx.lineTo(D.X(s), D.Y(z)) : ctx.moveTo(D.X(s), D.Y(z))); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = D.mm(lw); ctx.stroke(); }
    };
    D.line = (s0, z0, s1, z1, color = '#111', lw = 0.25, dash) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = D.mm(lw); if (dash) ctx.setLineDash(dash.map(D.mm));
      ctx.beginPath(); ctx.moveTo(D.X(s0), D.Y(z0)); ctx.lineTo(D.X(s1), D.Y(z1)); ctx.stroke(); ctx.restore();
    };
    D.dot = (s, z, rmm, color = '#111') => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(D.X(s), D.Y(z), D.mm(rmm), 0, Math.PI * 2); ctx.fill(); };
    D.text = (txt, s, z, o = {}) => {
      ctx.save(); ctx.fillStyle = o.color || '#111'; ctx.font = `${o.bold ? 700 : 400} ${D.mm(o.size || 2.4)}px Arial, sans-serif`;
      ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'middle';
      if (o.rot) { ctx.translate(D.X(s), D.Y(z)); ctx.rotate(o.rot); ctx.fillText(txt, 0, 0); } else ctx.fillText(txt, D.X(s), D.Y(z));
      ctx.restore();
    };
    /** Выноска: точка на элементе → полка с текстом (строки) в точке (ts, tz) */
    D.leader = (s, z, ts, tz, lines, o = {}) => {
      const L = Array.isArray(lines) ? lines : [lines], fs = o.size || 2.3, right = ts >= s;
      ctx.save(); ctx.font = `${D.mm(fs)}px Arial, sans-serif`;
      const w = Math.max(...L.map(t => ctx.measureText(t).width));
      ctx.strokeStyle = '#111'; ctx.lineWidth = D.mm(0.2);
      ctx.beginPath(); ctx.moveTo(D.X(s), D.Y(z)); ctx.lineTo(D.X(ts), D.Y(tz)); ctx.lineTo(D.X(ts) + (right ? w + D.mm(1) : -w - D.mm(1)), D.Y(tz)); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(D.X(s), D.Y(z), D.mm(0.5), 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'bottom';
      L.forEach((t, i) => ctx.fillText(t, D.X(ts) + (right ? D.mm(0.5) : -D.mm(0.5)), D.Y(tz) - D.mm(0.6) + i * D.mm(fs * 1.25) + (i ? D.mm(fs * 0.25) : 0)));
      ctx.restore();
    };
    /** Позиция: выноска к кружку с номером (расшифровка — в панели листа) */
    D.notes = [];
    D.callout = (s, z, ts, tz, text) => {
      const n = D.notes.length + 1, r = D.mm(2.6);
      D.notes.push(text);
      ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = D.mm(0.2);
      const cx = D.X(ts), cy = D.Y(tz), dx = cx - D.X(s), dy = cy - D.Y(z), L = Math.hypot(dx, dy) || 1;
      ctx.beginPath(); ctx.moveTo(D.X(s), D.Y(z)); ctx.lineTo(cx - dx / L * r, cy - dy / L * r); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(D.X(s), D.Y(z), D.mm(0.55), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = `700 ${D.mm(2.8)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), cx, cy + D.mm(0.1));
      ctx.restore();
    };
    /** Размер по горизонтали на высоте z (текст — в см) */
    D.dimH = (s0, s1, z, txt) => {
      const y = D.Y(z), x0 = D.X(s0), x1 = D.X(s1), t = D.mm(1.2);
      ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = D.mm(0.18);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      for (const x of [x0, x1]) { ctx.moveTo(x - t, y + t); ctx.lineTo(x + t, y - t); ctx.moveTo(x, y - t * 1.6); ctx.lineTo(x, y + t * 1.6); }
      ctx.stroke(); ctx.fillStyle = '#111'; ctx.font = `${D.mm(2.2)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(txt ?? String(Math.round(Math.abs(s1 - s0) * 10)), (x0 + x1) / 2, y - D.mm(0.6)); ctx.restore();
    };
    D.dimV = (z0, z1, s, txt) => {
      const x = D.X(s), y0 = D.Y(z0), y1 = D.Y(z1), t = D.mm(1.2);
      ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = D.mm(0.18);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      for (const y of [y0, y1]) { ctx.moveTo(x - t, y + t); ctx.lineTo(x + t, y - t); ctx.moveTo(x - t * 1.6, y); ctx.lineTo(x + t * 1.6, y); }
      ctx.stroke(); ctx.translate(x - D.mm(0.8), (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#111'; ctx.font = `${D.mm(2.2)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(txt ?? String(Math.round(Math.abs(z1 - z0) * 10)), 0, 0); ctx.restore();
    };
    /** Высотная отметка: треугольник и значение в метрах */
    D.level = (s, z, label, left) => {
      const x = D.X(s), y = D.Y(z), a = D.mm(1.6), dir = left ? -1 : 1;
      ctx.save(); ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = D.mm(0.2);
      ctx.beginPath(); ctx.moveTo(x - a, y - a); ctx.lineTo(x, y); ctx.lineTo(x + a, y - a); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - a * 2.2); ctx.lineTo(x + dir * D.mm(14), y - a * 2.2); ctx.stroke();
      const v = z / 100, t = (v > 0.0005 ? '+' : v < -0.0005 ? '−' : '±') + Math.abs(v).toFixed(3);
      ctx.font = `${D.mm(2.3)}px Arial, sans-serif`; ctx.textAlign = left ? 'right' : 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(t + (label ? '  ' + label : ''), x + dir * D.mm(1), y - a * 2.2 - D.mm(0.4)); ctx.restore();
    };
    return D;
  },
  /** Штриховки материалов (размер — в мм листа) */
  patterns(ctx, dpmm) {
    const mk = (wmm, hmm, fn, bg) => { const c = document.createElement('canvas'); c.width = Math.max(4, Math.round(wmm * dpmm)); c.height = Math.max(4, Math.round(hmm * dpmm)); const g = c.getContext('2d'); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); } g.strokeStyle = '#333'; g.fillStyle = '#333'; g.lineWidth = Math.max(1, dpmm * 0.15); fn(g, c.width, c.height); return ctx.createPattern(c, 'repeat'); };
    return {
      earth: mk(4, 4, (g, w, h) => { g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke(); }, '#efe8dc'),
      sand: mk(3, 3, (g, w, h) => { g.beginPath(); g.arc(w * 0.3, h * 0.3, dpmm * 0.18, 0, 7); g.arc(w * 0.8, h * 0.75, dpmm * 0.14, 0, 7); g.fill(); }, '#f6ecd0'),
      concrete: mk(5, 5, (g, w, h) => { g.beginPath(); g.moveTo(w * 0.2, h * 0.3); g.lineTo(w * 0.35, h * 0.1); g.lineTo(w * 0.45, h * 0.35); g.closePath(); g.stroke(); g.beginPath(); g.arc(w * 0.7, h * 0.7, dpmm * 0.2, 0, 7); g.fill(); }, '#e4e4e2'),
      ins: mk(5, 2.5, (g, w, h) => { g.beginPath(); for (let x = 0; x <= w; x += 1) g.lineTo(x, h / 2 + Math.sin(x / w * Math.PI * 2) * h * 0.4); g.stroke(); }, '#fbf3b8'),
      xps: mk(3, 3, (g, w, h) => { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke(); }, '#d9ecf7'),
      brick: mk(3, 3, (g, w, h) => { g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke(); }, '#f1c7b3'),
      block: mk(4, 4, (g, w, h) => { g.beginPath(); g.arc(w * 0.3, h * 0.35, dpmm * 0.35, 0, 7); g.stroke(); g.beginPath(); g.arc(w * 0.75, h * 0.8, dpmm * 0.25, 0, 7); g.stroke(); }, '#e9e2d6'),
      wood: mk(4, 1.5, (g, w, h) => { g.beginPath(); g.moveTo(0, h / 2); g.bezierCurveTo(w * 0.3, 0, w * 0.6, h, w, h / 2); g.stroke(); }, '#f0dcb8'),
      tile: mk(6, 1, () => {}, '#c9c6c0'),
    };
  },

  /* ------------------------------- разрез ------------------------------- */
  /** Нарисовать разрез: полная сцена (узлы — её фрагменты крупно) */
  drawSection(D, M, mode) {
    const { lv, F, r, fr } = M, P = D.pat, C = Detail.cut(M), walls = Detail.cutWalls(M, C.u);
    const t = Math.tan(U.rad(r.pitch || 0)), Dh = r.d / 2, zr = (v) => (r.base || lv.wallTop) + t * Math.max(0, Dh - Math.abs(v));
    const ext = walls.filter(w => w.kind === 'ext'), vMin = -Dh - 150, vMax = Dh + 150;
    const bw = F ? F.width * 100 : 50;
    // 1) грунт и засыпка
    D.rect(vMin, lv.cushion - 40, vMax, lv.gnd, P.earth, null);
    D.line(vMin, lv.gnd, vMax, lv.gnd, '#111', 0.5);
    const inner = ext.length >= 2 ? [ext[0].v + ext[0].th / 2, ext[ext.length - 1].v - ext[ext.length - 1].th / 2] : [-Dh + 100, Dh - 100];
    // 2) пирог пола по грунту между лентами
    D.rect(inner[0], lv.sand, inner[1], lv.xps, P.sand, '#555', 0.15);
    D.rect(inner[0], lv.xps, inner[1], lv.slab, P.xps, '#333', 0.2);
    D.rect(inner[0], lv.slab, inner[1], lv.screed, P.concrete, '#333', 0.25);
    D.line(inner[0] + 5, lv.slab + 3, inner[1] - 5, lv.slab + 3, '#b00', 0.25, [1.5, 0.8]);                   // сетка Ø8
    D.rect(inner[0], lv.screed, inner[1], lv.fin - 1, '#eeeeea', '#555', 0.15);
    for (let v = inner[0] + 15; v < inner[1] - 5; v += 15) D.dot(v, lv.screed + 2.5, 0.35, '#e07b2f');           // трубы ТП
    D.rect(inner[0], lv.fin - 1, inner[1], lv.fin, P.tile, '#333', 0.2);
    // 3) ленты фундамента, подушка, утепление, отмостка — под каждой наружной стеной
    for (const W of ext) {
      const out = W.outV || (W.v < 0 ? -1 : 1), axis = W.v, s0 = axis - bw / 2, s1 = axis + bw / 2;
      D.rect(s0 - 20, lv.cushion, s1 + 20, lv.stripBot, P.sand, '#555', 0.2);                                // подушка
      D.rect(s0, lv.stripBot, s1, lv.stripTop, P.concrete, '#111', 0.35);                                   // лента
      const nb = F && F.width <= 0.4 ? 2 : 3;
      for (const zz of [lv.stripBot + 5, lv.stripTop - 5]) for (let i = 0; i < nb; i++) D.dot(s0 + 5 + i * (bw - 10) / (nb - 1), zz, 0.55, '#b00');
      D.rect(s0 + 4, lv.stripBot + 4, s1 - 4, lv.stripTop - 4, null, '#b00', 0.18);                          // хомуты Ø8
      D.line(s0, lv.stripTop + 0.5, s1, lv.stripTop + 0.5, '#000', 0.8);                                     // гидроизоляция
      const face = out > 0 ? s1 : s0;
      D.rect(face, lv.stripBot, face + out * 10, lv.stripTop - 2, P.xps, '#333', 0.2);                       // XPS 100 по боковой грани
      // утеплённая отмостка: XPS 50 юбка 1,2 м, песок, бетон с уклоном
      const oFace = W.v + out * W.th / 2;
      D.rect(oFace + out * 10, lv.gnd - 35, oFace + out * 130, lv.gnd - 30, P.xps, '#333', 0.2);
      D.poly([[oFace, lv.gnd + 10], [oFace + out * 100, lv.gnd + 8], [oFace + out * 100, lv.gnd - 2], [oFace, lv.gnd]], P.concrete, '#111', 0.3);
      D.rect(oFace, lv.gnd - 30, oFace + out * 100, lv.gnd, P.sand, '#777', 0.15);
    }
    // 4) стены в разрезе: слои (кладка рядами, минвата, зазор, кирпич), армопояс, проём с перемычкой
    for (const W of walls) {
      const top = W.kind === 'ext' ? lv.wallTop : lv.fin + (W.h || 270), bot = W.kind === 'ext' ? lv.stripTop + 1 : lv.screed;
      const out = W.outV || 1, v0 = W.v - W.th / 2 * out;                                                    // от внутренней грани наружу
      const L = W.kind === 'ext' ? M.lay : [{ kind: 'block', th: W.th, mat: W.w.mat }];
      let at = W.kind === 'ext' ? v0 : W.v - W.th / 2, dir = W.kind === 'ext' ? out : 1;
      for (const l of L) {
        const a = at, b = at + dir * l.th;
        if (l.kind === 'block') Detail.courses(D, Math.min(a, b), Math.max(a, b), bot, top - (W.kind === 'ext' ? lv.ring : 0), l.mat, W.op && W.kind === 'ext' ? W.op : null);
        else if (l.kind === 'ins') D.rect(a, bot + 20, b, top - 2, P.ins, '#333', 0.2);
        else if (l.kind === 'brick') { D.rect(a, bot, b, top - 5, P.brick, '#111', 0.3); for (let z = bot + 7.7; z < top - 5; z += 7.7) D.line(a, z, b, z, '#8a4a36', 0.1); for (let z = bot + 30; z < top - 10; z += 50) D.line(at - dir * (L[0].th / 2), z, b - dir * 3, z, '#555', 0.15, [0.6, 0.4]); }
        at = b;
      }
      if (W.kind === 'ext' && lv.ring) {                                                                    // армопояс
        const a = v0, b = v0 + out * M.lay[0].th;
        D.rect(a, top - lv.ring, b, top, P.concrete, '#111', 0.35);
        for (const zz of [top - lv.ring + 5, top - 5]) for (const f of [0.25, 0.75]) D.dot(a + (b - a) * f, zz, 0.5, '#b00');
      }
      if (W.op && W.kind === 'ext') Detail.openingCut(D, M, W, v0, out, bot);
    }
    // 5) чердачное перекрытие и потолок: нижний пояс ферм / затяжка, утеплитель, пароизоляция, натяжной потолок
    if (fr) {
      const hb = fr.h / 10, zb = lv.wallTop + 5, a0 = ext.length ? ext[0].v : -Dh, a1 = ext.length ? ext[ext.length - 1].v : Dh;
      D.rect(a0 - 7.5, lv.wallTop, a0 + 7.5, lv.wallTop + 5, P.wood, '#111', 0.25);                          // лежень / мауэрлат
      D.rect(a1 - 7.5, lv.wallTop, a1 + 7.5, lv.wallTop + 5, P.wood, '#111', 0.25);
      D.rect(a0 - 12, zb, a1 + 12, zb + hb, P.wood, '#111', 0.3);                                           // нижний пояс — на лежень над стеной
      D.rect(inner[0], zb + hb, inner[1], zb + hb + 20, P.ins, '#333', 0.2);                                // утеплитель 200
      D.line(inner[0], zb - 0.5, inner[1], zb - 0.5, '#2a6', 0.4, [1, 0.6]);                               // пароизоляция
      D.line(inner[0], lv.ceil, inner[1], lv.ceil, '#555', 0.35);                                           // натяжной потолок
      for (let v = inner[0] + 100; v < inner[1] - 100; v += 200) D.rect(v, zb + hb + 20, v + 30, zb + hb + 22.5, P.wood, '#111', 0.15);   // ходовые доски
      // 6) кровля: верхние пояса (стропила), решётка фермы, свесы, пирог кровли, конёк
      const hr = fr.h / 10 / Math.cos(U.rad(r.pitch));
      const top0 = (v) => zr(v);
      D.poly([[-Dh, top0(-Dh)], [0, top0(0)], [0, top0(0) - hr], [-Dh, top0(-Dh) - hr]], P.wood, '#111', 0.3);
      D.poly([[Dh, top0(Dh)], [0, top0(0)], [0, top0(0) - hr], [Dh, top0(Dh) - hr]], P.wood, '#111', 0.3);
      if (fr.scheme === 'truss') {                                                                          // W-образная решётка
        const A0 = a0, A1 = a1, zc = zb + hb, span = A1 - A0, mid = (A0 + A1) / 2, B1 = A0 + span / 3, B2 = A0 + 2 * span / 3, T1 = A0 + span / 4, T2 = A0 + 3 * span / 4;
        for (const [sa, za, sb, zb2] of [[T1, top0(T1) - hr, B1, zc], [B1, zc, mid, top0(mid) - hr], [mid, top0(mid) - hr, B2, zc], [B2, zc, T2, top0(T2) - hr]]) D.line(sa, za, sb, zb2, '#6b4a2a', 1.2);
        for (const [s, z] of [[T1, top0(T1) - hr / 2], [B1, zc - hb / 2], [mid, top0(mid) - hr / 2], [B2, zc - hb / 2], [T2, top0(T2) - hr / 2], [A0, zc - hb / 2], [A1, zc - hb / 2]]) D.rect(s - 6, z - 5, s + 6, z + 5, '#9aa3ad', '#333', 0.15);   // пластины МЗП
      }
      // пирог кровли: мембрана, контррейка 50, настил / обрешётка, покрытие
      const off = (v, dz) => top0(v) + dz / Math.cos(U.rad(r.pitch));
      for (const sg of [-1, 1]) {
        const e = sg * Dh;
        D.poly([[e, off(e, 0.1)], [0, off(0, 0.1)], [0, off(0, 5)], [e, off(e, 5)]], '#f7f7f5', '#555', 0.15);   // контррейка (вентзазор)
        D.poly([[e, off(e, 5)], [0, off(0, 5)], [0, off(0, 6.2)], [e, off(e, 6.2)]], P.wood, '#333', 0.2);       // OSB / обрешётка
        D.poly([[e, off(e, 6.2)], [0, off(0, 6.2)], [0, off(0, 7.2)], [e, off(e, 7.2)]], (ROOF_MATERIALS[r.mat] || {}).color || '#555', '#111', 0.3);
        D.line(e, off(e, 0), 0, off(0, 0), '#1f7a4a', 0.3, [1.2, 0.5]);                                        // гидроветрозащитная мембрана
        // лобовая доска и подшивка свеса с вентиляцией
        D.rect(e, off(e, 0) - 15, e - sg * 2.5, off(e, 0), P.wood, '#111', 0.25);
        const wallFace = sg < 0 ? (ext[0] ? ext[0].v - ext[0].th / 2 : -Dh + 50) : (ext.length ? ext[ext.length - 1].v + ext[ext.length - 1].th / 2 : Dh - 50);
        D.rect(wallFace, off(e, 0) - 17, e - sg * 2.5, off(e, 0) - 15, '#dcdcdc', '#333', 0.2);
        // водосточный желоб
        const gx = D.X(e + sg * 7), gy = D.Y(off(e, 0) - 8);
        D.ctx.beginPath(); D.ctx.arc(gx, gy, D.mm(1.6), 0, Math.PI); D.ctx.strokeStyle = '#333'; D.ctx.lineWidth = D.mm(0.3); D.ctx.stroke();
      }
      D.rect(-12, off(0, 7.2), 12, off(0, 7.2) + 6, '#6f7780', '#111', 0.25);                                 // коньковый аэратор
    }
    return { C, walls, zr, inner, ext, Dh };
  },
  /** Кладка в разрезе: ряды блоков (блок + шов), армированные ряды — красные точки */
  courses(D, a, b, z0, z1, mat, op) {
    const M = WALL_MATERIALS[mat] || {}, bh = M.block ? M.block[1] + 1.2 : mat === 'brick' || mat === 'silicate' ? 7.7 : 20;
    const R = WALL_REINF[mat] || { every: 0 };
    D.rect(a, z0, b, z1, D.pat.block, '#111', 0.35);
    let n = 0;
    for (let z = z0 + bh; z < z1 - 1; z += bh) {
      n++;
      D.line(a, z, b, z, '#666', 0.12);
      if (R.every && (n === 1 || n % R.every === 0)) for (const f of b - a > 25 ? [0.3, 0.7] : [0.5]) D.dot(a + (b - a) * f, z - 1, 0.4, '#b00');
    }
    void op;
  },
  /** Проём в разрезе: пустота, рама окна, подоконник, перемычка */
  openingCut(D, M, W, v0, out, bot) {
    const op = W.op, T = OPENING_TYPES[op.type] || {}, sill = T.cat === 'door' ? 0 : (op.sill ?? T.sill ?? 90), h = op.h || T.h || 150;
    const coreTh = M.lay[0].th, a = v0, b = v0 + out * coreTh, oTh = W.th;
    // прорезать все слои стены
    D.rect(v0, sill, v0 + out * oTh, sill + h, '#ffffff', null);
    D.rect(a + out * coreTh * 0.55, sill, a + out * coreTh * 0.55 + out * 7, sill + h, '#f4f6f8', '#111', 0.3);   // рама с стеклопакетом
    D.line(a + out * coreTh * 0.55 + out * 3.5, sill + 3, a + out * coreTh * 0.55 + out * 3.5, sill + h - 3, '#6aa0c8', 0.3);
    D.rect(a - out * 5, sill - 2, a + out * coreTh * 0.55, sill, '#fafafa', '#111', 0.25);                  // подоконник
    D.rect(v0 + out * oTh, sill - 1, v0 + out * (oTh + 5), sill, '#9aa3ad', '#111', 0.2);                   // отлив
    // перемычка: U-блок с бетоном и 2 Ø12
    const lz = sill + h;
    D.rect(a, lz, b, Math.min(lz + 20, M.lv.wallTop - M.lv.ring), D.pat.concrete, '#111', 0.35);
    for (const f of [0.3, 0.7]) D.dot(a + (b - a) * f, lz + 4, 0.5, '#b00');
    void bot;
  },

  /* ------------------------ раскладка кладки по стене ------------------------ */
  /** Стены для раскладки: фасады дома (коллинеарные наружные стены — одна развёртка) и стены гаража */
  elevWalls() {
    const d = App.doc, f1 = d.floors[0].id, ext = d.walls.filter(w => (w.floor || f1) === f1 && w.kind === 'ext'), out = [], used = new Set();
    const dirName = (n) => { const a = (U.deg(Math.atan2(n.x, -n.y)) - (d.north || 0) + 360) % 360; return ['северная', 'северо-восточная', 'восточная', 'юго-восточная', 'южная', 'юго-западная', 'западная', 'северо-западная'][Math.round(a / 45) % 8]; };
    const fd = (App.floorData || [])[0], inside = (p) => fd && fd.outlines.some(o => G.pointInPoly(p, o.outer));
    for (const w of ext) {
      if (used.has(w) || Model.wallLen(w) < 150) continue;
      const u = G.unit(G.sub(w.b, w.a)), grp = ext.filter(x => !used.has(x) && Math.abs(G.cross(u, G.unit(G.sub(x.b, x.a)))) < 0.02 && Math.abs(G.cross(u, G.sub(x.a, w.a))) < 5);
      grp.forEach(x => used.add(x));
      let n = G.perp(u); if (inside(G.add(G.mid(w.a, w.b), G.mul(n, w.th)))) n = G.mul(n, -1);
      out.push({ key: w.id, name: `${dirName(n)} стена дома`, walls: grp, n, u, bld: null });
    }
    for (const it of d.items.filter(o => (o.floor || f1) === f1 && BLD_HOLLOW.has(catItem(o.key).shape) && catItem(o.key).key !== 'house')) {
      for (const side of ['front', 'back', 'left', 'right']) {
        const t = bldWallT(it), F = bldSide(side, it.w, it.d, t), n = G.sub(bldWorld(it, G.mul(F.n, -1)), bldWorld(it, { x: 0, y: 0 }));
        out.push({ key: it.id + ':' + side, name: `${(it.label || catItem(it.key).name).split(' на ')[0].toLowerCase()} — ${dirName(G.unit(n))} стена`, bld: it, side, n: G.unit(n) });
      }
    }
    return out;
  },
  /** Развёртка стены: длина, высота, проёмы [{s0, s1, z0, z1, name}], материал */
  elevGeom(E) {
    if (E.bld) {
      const it = E.bld, sh = bldShell(it, it.w, it.d), F = bldSide(E.side, it.w, it.d, sh.t), H = bldWallH(it);
      const ops = sh.ops.filter(o => o.side === E.side).map(o => ({ s0: o.s0 + F.L / 2, s1: o.s1 + F.L / 2, z0: o.sill || 0, z1: (o.sill || 0) + o.h, name: (OPENING_TYPES[o.type] || {}).name || 'Проём' }));
      return { L: F.L, H, mat: bldWallMat(it), th: sh.t, ops, ring: (WALL_REINF[bldWallMat(it)] || {}).ring };
    }
    const u = E.u, base = E.walls.reduce((m, w) => Math.min(m, G.dot(w.a, u), G.dot(w.b, u)), Infinity), end = E.walls.reduce((m, w) => Math.max(m, G.dot(w.a, u), G.dot(w.b, u)), -Infinity);
    const w0 = E.walls[0], th = w0.th, ops = [];
    for (const w of E.walls) for (const op of App.doc.openings.filter(o => o.wall === w.id)) {
      const g = Model.opGeom(op), T = OPENING_TYPES[op.type] || {};
      if (!g) continue;
      const s0 = Math.min(G.dot(g.a, u), G.dot(g.b, u)) - base, s1 = Math.max(G.dot(g.a, u), G.dot(g.b, u)) - base, sill = T.cat === 'door' ? 0 : (op.sill ?? T.sill ?? 90);
      ops.push({ s0, s1, z0: sill, z1: sill + (op.h || T.h || 150), name: T.name || 'Проём' });
    }
    // по наружной грани — с половиной толщины на углах
    return { L: end - base + th, H: Math.max(...E.walls.map(w => w.h)), mat: w0.mat, th, ops: ops.map(o => ({ ...o, s0: o.s0 + th / 2, s1: o.s1 + th / 2 })), ring: (WALL_REINF[w0.mat] || {}).ring, clad: w0.clad || 0 };
  },
  /** Нарисовать раскладку: блоки с перевязкой в полблока, проёмы, перемычки с опиранием, армированные ряды, армопояс */
  drawElev(D, E) {
    const g = Detail.elevGeom(E), M = WALL_MATERIALS[g.mat] || {}, [bl, bh0] = M.block || (g.mat === 'brick' || g.mat === 'silicate' ? [25, 6.5] : [39, 18.8]);
    const joint = M.block ? 1 : 1.2, bh = bh0 + joint, R = WALL_REINF[g.mat] || { every: 0 }, ring = g.ring ? 25 : 0, top = g.H - ring;
    const inOp = (s, z) => g.ops.some(o => s > o.s0 - 0.5 && s < o.s1 + 0.5 && z > o.z0 - 0.5 && z < o.z1 + 0.5);
    const lint = g.ops.map(o => ({ s0: o.s0 - 25, s1: o.s1 + 25, z0: o.z1, z1: Math.min(o.z1 + bh, top) }));
    let row = 0, blocks = 0;
    D.rect(0, -3, g.L, 0, '#000', null);                                                                  // гидроизоляция по ленте
    for (let z = 0; z < top - 0.5; z += bh, row++) {
      const zt = Math.min(z + bh, top), off = row % 2 ? bl / 2 : 0;
      for (let s = -off; s < g.L; s += bl + joint) {
        const a = Math.max(0, s), b = Math.min(g.L, s + bl);
        if (b - a < 2) continue;
        // блок вырезается проёмом и перемычкой
        if (inOp((a + b) / 2, (z + zt) / 2) || lint.some(l => (a + b) / 2 > l.s0 && (a + b) / 2 < l.s1 && (z + zt) / 2 > l.z0 && (z + zt) / 2 < l.z1)) continue;
        const cut = b - a < bl - 1;
        D.rect(a, z, b, zt - joint, cut ? '#efe6d6' : '#e3dccd', '#8c8474', 0.12);
        blocks += (b - a) / bl;
      }
      const reinf = R.every && (row === 0 || (row + 1) % R.every === 0);
      if (reinf) {
        D.line(0, zt - joint / 2, g.L, zt - joint / 2, '#c0392b', 0.5, [2, 0.8]);
        D.text(`2Ø8 А500 (ряд ${row + 1})`, g.L + 4, zt - joint / 2, { size: 2, color: '#c0392b' });
      }
      // ряд под окном — армировать с заходом 0,9 м
      for (const o of g.ops) if (o.z0 > 0 && Math.abs(zt - o.z0) < bh / 2) D.line(Math.max(0, o.s0 - 90), zt - joint / 2 - 1, Math.min(g.L, o.s1 + 90), zt - joint / 2 - 1, '#c0392b', 0.35, [1, 0.6]);
    }
    for (const o of g.ops) {
      D.rect(o.s0, o.z0, o.s1, o.z1, '#ffffff', '#111', 0.35);
      D.line(o.s0, o.z0, o.s1, o.z1, '#bbb', 0.12); D.line(o.s0, o.z1, o.s1, o.z0, '#bbb', 0.12);
      const l = { s0: Math.max(0, o.s0 - 25), s1: Math.min(g.L, o.s1 + 25), z0: o.z1, z1: Math.min(o.z1 + bh, top) };
      D.rect(l.s0, l.z0, l.s1, l.z1, D.pat.concrete, '#111', 0.35);
      D.text(`Перемычка U-блок ${Math.round(l.s1 - l.s0)} см, 2Ø12`, (l.s0 + l.s1) / 2, l.z1 + 3, { size: 2, align: 'center' });
      D.dimH(o.s0, o.s1, o.z0 + (o.z1 - o.z0) / 2, `${Math.round((o.s1 - o.s0) * 10)}`);
      if (o.z0 > 0) D.dimV(0, o.z0, o.s0 + 6, `${Math.round(o.z0 * 10)}`);
    }
    if (ring) { D.rect(0, top, g.L, g.H, D.pat.concrete, '#111', 0.4); D.text('Армопояс 250 мм, 4Ø12 А500, хомуты Ø8 шаг 300', g.L / 2, top + ring / 2, { size: 2.3, align: 'center', bold: true }); }
    D.dimH(0, g.L, -18, `${Math.round(g.L * 10)}`);
    D.dimV(0, g.H, -12, `${Math.round(g.H * 10)}`);
    D.level(g.L + 30, g.H, '', false); D.level(g.L + 30, 0, 'верх ленты', false);
    return { g, blocks: Math.ceil(blocks * 1.05), rows: row, bl, bh0 };
  },

  /* --------------------------- план стропильной системы --------------------------- */
  drawRoofPlan(D, M) {
    const r = M.r, fr = M.fr, W = r.w / 2, Dh = r.d / 2, S = fr.S;
    // контур крыши, мауэрлат / лежень по стенам, конёк
    D.rect(-W, -Dh, W, Dh, '#f8f8f8', '#111', 0.4);
    D.rect(S.u0 - 7.5, S.v0 - 7.5, S.u1 + 7.5, S.v0 + 7.5, D.pat.wood, '#111', 0.25);
    D.rect(S.u0 - 7.5, S.v1 - 7.5, S.u1 + 7.5, S.v1 + 7.5, D.pat.wood, '#111', 0.25);
    if (r.type === 'gable' || r.type === 'hip') D.line(-W, 0, W, 0, '#111', 0.5, [4, 1, 1, 1]);
    let k = 0;
    for (let u = S.u0; u <= S.u1 + 1; u += fr.step * 100, k++) {
      D.line(u, -Dh, u, Dh, '#8a5a2b', 0.7);
      if (k % 4 === 0) D.text((fr.scheme === 'truss' ? 'Ф' : 'С') + (k + 1), u, -Dh - 8, { size: 2, align: 'center' });
    }
    D.dimH(S.u0, Math.min(S.u1, S.u0 + fr.step * 100), Dh + 25, String(fr.step * 1000));
    D.dimH(-W, W, Dh + 45, String(Math.round(r.w * 10)));
    D.dimV(-Dh, Dh, -W - 20, String(Math.round(r.d * 10)));
    D.dimV(S.v0, S.v1, -W - 40, String(Math.round((S.v1 - S.v0) * 10)));
    D.text(`${fr.scheme === 'truss' ? 'Фермы' : 'Стропила'} ${fr.b}×${fr.h} шаг ${fr.step * 1000} — ${fr.n}${fr.scheme === 'truss' ? '' : ' пар'} шт.`, 0, -Dh * 0.5, { size: 3, align: 'center', bold: true });
    D.text(`Уклон ${Math.round(fr.pitch)}°, конёк +${(Roof.params(r).top / 100).toFixed(3)}`, 0, Dh * 0.5, { size: 2.6, align: 'center' });
  },

  /* ------------------------------ листы ------------------------------ */
  /** Габарит сцены листа (см; ось y — вниз, как на плане) */
  bbox(spec) {
    const M = Detail.model();
    if (spec.detail === 'wallElev') { const g = Detail.elevGeom(spec.arg); return { x0: -40, y0: -g.H - 20, x1: g.L + 70, y1: 35 }; }
    if (!M.r) return { x0: 0, y0: 0, x1: 100, y1: 100 };
    const Dh = M.r.d / 2, ridge = Roof.params(M.r).top + 30;
    if (spec.detail === 'roofPlan') return { x0: -M.r.w / 2 - 60, y0: -Dh - 20, x1: M.r.w / 2 + 20, y1: Dh + 60 };
    const C = Detail.cut(M), ext = Detail.cutWalls(M, C.u).filter(w => w.kind === 'ext'), W0 = ext[0] || { v: -Dh + 50, th: 40 };
    if (spec.detail === 'foundNode') { const f = W0.v - W0.th / 2; return { x0: f - 140, y0: -(M.lv.stripTop + 110), x1: W0.v + W0.th / 2 + 140, y1: -(M.lv.cushion - 20) }; }
    if (spec.detail === 'roofNode') { const f = W0.v - W0.th / 2; return { x0: -Dh - 40, y0: -(M.lv.wallTop + 130), x1: f + W0.th + 120, y1: -(M.lv.wallTop - 70) }; }
    return { x0: -Dh - 75, y0: -ridge - 15, x1: Dh + 65, y1: -(M.lv.cushion - 50) };
  },
  /** Нарисовать лист-деталь в канвас W×H px в масштабе 1:N */
  render(spec, Wpx, Hpx, N, dpmm) {
    const cv = document.createElement('canvas'); cv.width = Math.round(Wpx); cv.height = Math.round(Hpx);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    const b = Detail.bbox(spec), k = dpmm * 10 / N;                                                       // px на см
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ox = cv.width / 2 - cx * k, oy = cv.height / 2 - cy * k;                                        // y сцены: вверх (z), bbox хранит −z
    const D = Detail.kit(ctx, k, ox, oy, dpmm), M = Detail.model();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.clip();
    try {
      if (spec.detail === 'wallElev') { const res = Detail.drawElev(D, spec.arg); spec._res = res; }
      else if (spec.detail === 'roofPlan' && M.fr) { const D2 = Detail.kit(ctx, k, ox, cv.height / 2 - cy * k, dpmm); D2.Y = (z) => cv.height / 2 + (z - cy) * k; Detail.drawRoofPlan(D2, M); }
      else if (M.r) { const S = Detail.drawSection(D, M, spec.detail); spec._notes = Detail.annotate(D, M, S, spec.detail); }
    } finally { ctx.restore(); }
    return cv;
  },
  /** Отметки, размеры и позиции (номера с расшифровкой в панели) разреза и узлов */
  annotate(D, M, S, mode) {
    const { lv, lay, fr, r, F } = M, ext = S.ext, W0 = ext[0], left = W0 ? W0.v - W0.th / 2 : -S.Dh + 50;
    const node = mode === 'foundNode' || mode === 'roofNode';
    const sL = node ? left - 25 : -S.Dh - 35;
    if (mode !== 'roofNode') { D.level(sL, lv.fin, 'чистый пол', true); D.level(sL, lv.gnd, 'земля', true); D.level(sL, lv.stripBot, 'низ ленты', true); }
    if (mode !== 'foundNode') { D.level(sL, lv.wallTop, 'верх стен', true); if (lv.ring) D.level(sL, lv.wallTop - lv.ring, 'армопояс', true); D.level(S.inner[0] + 30, lv.ceil, 'потолок', false); }
    if (!node) D.level(0, Roof.params(r).top + 8, 'конёк', false);
    const T = {
      floor: 'Пол по грунту: керамогранит 10 мм на клею; стяжка 50 мм с трубами тёплого пола; плита 100 мм B20, сетка Ø8 200×200; XPS 100 мм; песок 300 мм с послойным трамбованием; снять растительный слой',
      found: F ? `Фундамент: ${FOUND_TYPES[F.type].toLowerCase()} — лента ${Math.round(F.width * 1000)}×${Math.round(F.H * 1000)} мм, бетон B20 W6 F150; ${F.bars}; защитный слой 40 мм` : 'Фундамент — по расчёту',
      cushion: 'Подушка: песок средней крупности 200 мм, уплотнение Кпл ≥ 0,95, шире ленты на 200 мм с каждой стороны',
      water: 'Гидроизоляция: по верху ленты — 2 слоя наплавляемой (отсечка под кладку); боковые грани — битумная обмазочная',
      xps: 'Утепление ленты: XPS 100 мм по наружной грани до подошвы; под отмосткой — XPS 50 мм, юбка 1200 мм (МЗЛФ)',
      blind: 'Отмостка 1000 мм: бетон 80–100 мм с уклоном 2 % от дома, песок 100 мм, деформационный шов у цоколя',
      wall: 'Стена: ' + lay.map(l => `${l.name.toLowerCase()} ${l.th * 10} мм`).join(' + ') + (lay.some(l => l.kind === 'brick') ? '; облицовка на гибких связях 4 шт./м²' : ''),
      reinf: 'Армирование кладки: 1-й и каждый ' + ((WALL_REINF[M.w0.mat] || {}).every || 3) + '-й ряд — ' + ((WALL_REINF[M.w0.mat] || {}).how || 'по расчёту'),
      lintel: 'Перемычка над проёмом: U-блок с бетоном B20, 2Ø12 А500, опирание ≥ 250 мм; подоконник и отлив',
      ring: 'Армопояс 250 мм по всем наружным стенам: бетон B20, 4Ø12 А500, хомуты Ø8 шаг 300; анкеры М12 шаг 1000 под лежень',
      plate: fr && fr.scheme === 'truss' ? 'Опорный лежень 150×50 (антисептик) по гидроизоляции; ферма — к лежню скобами / уголками с каждой стороны' : 'Мауэрлат 150×150 (антисептик) по гидроизоляции; стропило — скользящей опорой',
      attic: fr ? `Чердачное перекрытие: ${fr.scheme === 'truss' ? 'нижний пояс ферм' : 'затяжка'} ${fr.b}×${fr.h}; пароизоляция снизу; минвата 200 мм; ходовые доски; холодный чердак с продухами ≥ 1/300 площади` : '',
      ceil: 'Потолок: натяжной (ПВХ матовый) на профиле, отступ 50–100 мм от нижнего пояса',
      roof: fr ? `Кровля: ${(ROOF_MATERIALS[r.mat] || {}).name.toLowerCase()}; ${fr.bat}; контррейка 50×50 (вентзазор); гидроветрозащитная мембрана; ${fr.scheme === 'truss' ? 'ферма' : 'стропило'} ${fr.b}×${fr.h} шаг ${fr.step * 1000}` : '',
      truss: fr ? `${fr.name}; пластины МЗП в узлах; пролёт ${fr.span.toFixed(2)} м; снег: район ${Climate.roman(fr.snow.district)} (${fr.snow.sD.toFixed(2)} кПа расчётная)` : '',
      eave: 'Свес: лобовая доска, подшивка софитом с перфорацией (приток воздуха на чердак), водосточный желоб на кронштейнах',
      ridge: 'Конёк: коньковый аэратор / вентилируемый конёк (вытяжка из подкровельного пространства)',
    };
    const inner0 = S.inner[0], Wv = W0 ? W0.v : -S.Dh + 50, bw = F ? F.width * 100 : 50;
    const zr = S.zr, pitchK = Math.tan(U.rad(r.pitch || 0));
    void pitchK;
    if (mode === 'foundNode') {
      D.callout(inner0 + 70, lv.slab - 5, inner0 + 90, lv.fin + 45, T.floor);
      D.callout(Wv, lv.stripBot + 25, Wv + bw / 2 + 45, lv.stripBot + 5, T.found);
      D.callout(Wv - bw / 2 - 10, lv.cushion + 10, Wv - bw / 2 - 40, lv.cushion - 12, T.cushion);
      D.callout(Wv + 5, lv.stripTop + 0.5, Wv + bw / 2 + 35, lv.stripTop + 25, T.water);
      D.callout(left - 8, lv.stripBot + 30, left - 60, lv.stripBot + 10, T.xps);
      D.callout(left - 50, lv.gnd + 4, left - 90, lv.gnd + 45, T.blind);
      D.callout(left + 10, lv.fin + 60, left - 40, lv.fin + 85, T.wall);
      if (F) D.dimH(Wv - bw / 2, Wv + bw / 2, lv.cushion - 8, String(Math.round(bw * 10)));
      D.dimV(lv.stripBot, lv.stripTop, Wv + bw / 2 + 12);
      D.dimV(lv.cushion, lv.stripBot, Wv + bw / 2 + 12);
      D.dimV(lv.gnd, lv.stripTop, Wv - bw / 2 - 20);
    } else if (mode === 'roofNode') {
      const face = left, top = lv.wallTop;
      D.callout(Wv, top - 12, face - 30, top - 40, T.ring);
      D.callout(Wv + 5, top + 2.5, Wv + 45, top - 30, T.plate);
      D.callout(inner0 + 40, top + 20, inner0 + 60, top + 70, T.attic);
      D.callout(inner0 + 20, lv.ceil, inner0 + 50, lv.ceil - 30, T.ceil);
      D.callout(-S.Dh + 60, zr(-S.Dh + 60) + 6, -S.Dh + 30, zr(-S.Dh + 30) + 60, T.roof);
      D.callout(-S.Dh + 3, zr(-S.Dh) - 8, -S.Dh - 25, zr(-S.Dh) - 40, T.eave);
      D.callout(face + 10, top - 60, face - 30, top - 90, T.wall);
      D.dimH(-S.Dh, face, top - 60, String(Math.round((face + S.Dh) * 10)));
      D.dimV(top, zr(face) , face - 12);
    } else {
      if (ext.length >= 2) { D.dimH(ext[0].v, ext[ext.length - 1].v, lv.cushion - 28, String(Math.round((ext[ext.length - 1].v - ext[0].v) * 10))); D.dimH(-S.Dh, S.Dh, lv.cushion - 42); }
      D.dimV(lv.fin, lv.wallTop, S.Dh + 45); D.dimV(lv.gnd, lv.fin, S.Dh + 45);
      D.callout(20, lv.slab, 70, lv.fin + 60, T.floor);
      D.callout(Wv, lv.stripBot + 20, Wv - 80, lv.stripBot - 10, T.found);
      D.callout(left - 50, lv.gnd + 5, left - 80, lv.gnd + 60, T.blind);
      D.callout(left + 15, lv.fin + 150, left - 70, lv.fin + 170, T.wall);
      D.callout(Wv, lv.wallTop - 12, left - 70, lv.wallTop - 20, T.ring);
      const lw = S.walls.find(w => w.op && w.kind === 'ext');
      if (lw) { const T0 = OPENING_TYPES[lw.op.type] || {}, zt = (lw.op.sill ?? T0.sill ?? 90) + (lw.op.h || T0.h || 150); D.callout(lw.v, zt + 8, lw.v + (lw.outV || 1) * 70, zt + 40, T.lintel); }
      if (T.attic) D.callout(S.Dh * 0.35, lv.wallTop + 25, S.Dh * 0.35 + 40, lv.wallTop + 90, T.attic);
      if (T.roof) D.callout(-S.Dh * 0.55, zr(-S.Dh * 0.55) + 7, -S.Dh * 0.55 - 40, zr(-S.Dh * 0.55) + 70, T.roof);
      if (T.truss) D.callout(-S.Dh * 0.2, zr(-S.Dh * 0.2) - 30, -S.Dh * 0.05, zr(-S.Dh * 0.2) + 40, T.truss);
      D.callout(0, zr(0) + 12, 50, zr(0) + 50, T.ridge);
      D.callout(S.inner[1] - 40, lv.ceil, S.inner[1] - 90, lv.ceil - 40, T.ceil);
    }
    return D.notes;
  },
  /* ------------------------------ панели ------------------------------ */
  /** Расшифровка позиций (номера на чертеже) */
  posList(spec) { const n = (spec && spec._notes) || []; return n.length ? U.el('ol', { class: 'pos' }, n.map(t => U.el('li', {}, t))) : null; },
  nodePanel(spec, title, re) {
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, title), Detail.posList(spec),
      U.el('h4', {}, 'Указания'), Sheets.ul(Sheets.notes(re).slice(0, 5)),
      U.el('div', { class: 'norm' }, '§ СП 22.13330.2016; СП 45.13330.2017; СП 50-101-2004; СП 15.13330.2020; СП 17.13330.2017; СП 64.13330.2017'));
  },
  sectionPanel(spec) {
    const M = Detail.model();
    const rows = [['Чистый пол', '±0.000'], ['Земля', ((M.lv.gnd) / 100).toFixed(3)], ['Низ ленты', (M.lv.stripBot / 100).toFixed(3)], ['Верх стен', '+' + (M.lv.wallTop / 100).toFixed(3)]];
    if (M.r) rows.push(['Конёк', '+' + (Roof.params(M.r).top / 100).toFixed(3)]);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Разрез 1-1'), Detail.posList(spec), U.el('h4', {}, 'Отметки'), Sheets.T(null, rows),
      U.el('h4', {}, 'Указания'), Sheets.ul(Sheets.notes(/Фундамент|Конструкции/).slice(0, 4)),
      U.el('div', { class: 'norm' }, '§ СП 22.13330; СП 15.13330; СП 17.13330; СП 20.13330; СП 64.13330; СП 50.13330'));
  },
  roofPanel(node) {
    const M = Detail.model(), fr = M.fr;
    if (!fr) return U.el('div', { class: 'sysdesc' }, 'Крыши нет');
    const rows = [
      ['Схема', fr.name], ['Пролёт между стенами', `${fr.span.toFixed(2)} м`], ['Уклон', `${Math.round(fr.pitch)}°`],
      [fr.scheme === 'truss' ? 'Пояса фермы' : 'Стропила', `${fr.b}×${fr.h} мм, сосна 2 сорт, антисептик`], ['Шаг', `${fr.step * 1000} мм — ${fr.n} ${fr.scheme === 'truss' ? 'ферм' : 'пар'}`],
      ['Снеговой район', `${Climate.roman(fr.snow.district)} — Sg ${fr.snow.Sg} кПа; μ ${fr.snow.mu.toFixed(2)}; расчётная ${fr.snow.sD.toFixed(2)} кПа`],
      ['Проверка', isFinite(fr.sig) ? `σ = ${fr.sig.toFixed(1)} ≤ ${fr.R} МПа; f = ${fr.f.toFixed(0)} ≤ ${fr.fmax.toFixed(0)} мм` : 'нужен индивидуальный расчёт'],
      ['Обрешётка', fr.bat], ['Контррейка 50×50', `${fr.counter.toFixed(0)} м`], ['Мембрана', `${fr.membrane.toFixed(0)} м²`],
      fr.osb ? ['OSB-3 12 мм', `${fr.osb.toFixed(0)} м²`] : null,
      [fr.scheme === 'truss' ? 'Опорный лежень' : 'Мауэрлат', `${fr.mauerlat.toFixed(1)} м, анкеры М12 — ${fr.anchors} шт.`],
      ['Пиломатериал всего', `≈ ${fr.woodV.toFixed(1)} м³`],
      ['Утепление чердака', `минвата ${fr.attic.ins} мм по пароизоляции`], ['Продухи', `≥ ${fr.attic.vent.toFixed(2)} м² (1/300 площади)`],
    ].filter(Boolean);
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, node ? 'Узел карниза' : 'Стропильная система'), Sheets.T(null, rows),
      U.el('h4', {}, 'Указания'), Sheets.ul(['Древесина — сосна/ель 2 сорта, влажность ≤ 20 %, антисептик и антипирен', fr.scheme === 'truss' ? 'Фермы — заводские на МЗП по расчёту изготовителя; монтаж с временными связями, постоянные раскосы по нижним и верхним поясам' : 'Стропила — к мауэрлату скользящими опорами, в коньке — на болтах через накладки', 'Снегозадержатели над входами и вдоль карниза', 'Дымоход: разделка до сгораемых конструкций ≥ 130 мм (кирпич) / по паспорту', 'Люк на чердак утеплённый, 600×900']),
      U.el('div', { class: 'norm' }, '§ СП 17.13330.2017; СП 20.13330.2016; СП 64.13330.2017; СП 7.13130.2013'));
  },
  elevPanel(E) {
    const g = Detail.elevGeom(E), M = WALL_MATERIALS[g.mat] || {}, R = WALL_REINF[g.mat] || {}, [bl, bh] = M.block || [39, 18.8];
    const area = (g.L * g.H - g.ops.reduce((a, o) => a + (o.s1 - o.s0) * (o.z1 - o.z0), 0)) / 1e4;
    const perM2 = 1e4 / ((bl + 1) * (bh + 1));
    const rows = Math.ceil(g.H / (bh + 1));
    return U.el('div', { class: 'sysdesc' }, U.el('h3', {}, 'Раскладка: ' + E.name),
      Sheets.T(null, [['Материал', `${M.name || g.mat}, ${g.th} см`], ['Блок', `${bl * 10}×${bh * 10} мм, шов ${M.block ? '10–12' : '10'} мм`], ['Длина / высота', `${(g.L / 100).toFixed(2)} × ${(g.H / 100).toFixed(2)} м`], ['Площадь кладки', `${area.toFixed(1)} м²`], ['Блоков', `≈ ${Math.ceil(area * perM2 * 1.05)} шт. (+5 %)`], ['Рядов', String(rows)], ['Проёмов', String(g.ops.length)]]),
      U.el('h4', {}, 'Армирование и перемычки'), Sheets.ul([R.every ? `1-й и каждый ${R.every}-й ряд: ${R.how}` : (R.how || 'по расчёту'), 'Ряд под окнами — с заходом 900 мм в стороны', 'Перемычки — U-блоки с бетоном B20 и 2Ø12 А500, опирание ≥ 250 мм', g.ring ? 'Армопояс 250 мм по всему периметру, 4Ø12, хомуты Ø8 шаг 300' : null, g.clad ? 'Облицовка: кирпич на гибких связях (базальтопластик 4 шт./м², у проёмов — шаг 300)' : null].filter(Boolean)),
      U.el('h4', {}, 'Перевязка'), Sheets.ul(['Смещение швов — ½ блока (≥ 0,4 высоты)', 'Углы и примыкания — перевязка через ряд', 'Первый ряд — на раствор по гидроизоляции, выставить по нивелиру']),
      U.el('div', { class: 'norm' }, '§ ' + (R.src || 'СП 15.13330.2020')));
  },
};
