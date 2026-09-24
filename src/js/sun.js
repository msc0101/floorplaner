'use strict';
/* ==========================================================================
   Солнце: положение (алгоритм NOAA), тени от построек/деревьев/стен,
   карта инсоляции участка (часы прямого солнца), инсоляция помещений через окна.
   ========================================================================== */

const CITIES = [
  ['Москва', 55.75, 37.62, 3], ['Санкт-Петербург', 59.94, 30.31, 3], ['Нижний Новгород', 56.33, 44.0, 3],
  ['Казань', 55.79, 49.12, 3], ['Самара', 53.2, 50.15, 4], ['Воронеж', 51.67, 39.18, 3], ['Ростов-на-Дону', 47.23, 39.72, 3],
  ['Краснодар', 45.04, 38.98, 3], ['Сочи', 43.6, 39.73, 3], ['Волгоград', 48.71, 44.51, 3], ['Уфа', 54.73, 55.96, 5],
  ['Пермь', 58.01, 56.25, 5], ['Екатеринбург', 56.84, 60.6, 5], ['Челябинск', 55.16, 61.4, 5], ['Тюмень', 57.15, 65.53, 5],
  ['Омск', 54.99, 73.37, 6], ['Новосибирск', 55.03, 82.92, 7], ['Томск', 56.5, 84.97, 7], ['Красноярск', 56.01, 92.87, 7],
  ['Иркутск', 52.29, 104.3, 8], ['Хабаровск', 48.48, 135.07, 10], ['Владивосток', 43.12, 131.89, 10],
  ['Калининград', 54.71, 20.51, 2], ['Мурманск', 68.97, 33.08, 3], ['Архангельск', 64.54, 40.54, 3],
  ['Минск', 53.9, 27.56, 3], ['Киев', 50.45, 30.52, 2], ['Алматы', 43.24, 76.89, 5], ['Астана', 51.17, 71.43, 5],
  ['Ташкент', 41.3, 69.24, 5], ['Тбилиси', 41.72, 44.79, 4], ['Ереван', 40.18, 44.51, 4],
];

const Sun = {
  /* --------------------------- астрономия -------------------------------- */
  /** Положение солнца: азимут (° от севера по часовой) и высота (°). date = 'YYYY-MM-DD', min — местное время, минуты */
  position(date, min, lat, lon, tz) {
    const [Y, M, D] = date.split('-').map(Number);
    const jd = Date.UTC(Y, M - 1, D) / 86400000 + 2440587.5 + (min - tz * 60) / 1440;
    const T = (jd - 2451545) / 36525;
    const r = Math.PI / 180;
    const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    const Ma = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(Ma * r) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Ma * r) * (0.019993 - 0.000101 * T) + Math.sin(3 * Ma * r) * 0.000289;
    const om = 125.04 - 1934.136 * T;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * r);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(om * r);
    const decl = Math.asin(Math.sin(eps * r) * Math.sin(lam * r));
    const y = Math.tan(eps * r / 2) ** 2;
    const eqt = 4 / r * (y * Math.sin(2 * L0 * r) - 2 * e * Math.sin(Ma * r) + 4 * e * y * Math.sin(Ma * r) * Math.cos(2 * L0 * r)
      - 0.5 * y * y * Math.sin(4 * L0 * r) - 1.25 * e * e * Math.sin(2 * Ma * r));
    const tst = min + eqt + 4 * lon - 60 * tz;
    const ha = (tst / 4 - 180) * r;
    const la = lat * r;
    const cz = U.clamp(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha), -1, 1);
    const alt = 90 - Math.acos(cz) / r;
    const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) / r + 180 + 360) % 360;
    return { az, alt, decl: decl / r, eqt };
  },
  /** Восход, заход, полдень, долгота дня (минуты местного времени) */
  dayInfo(date, geo) {
    const f = (m) => Sun.position(date, m, geo.lat, geo.lon, geo.tz).alt + 0.833;
    let rise = null, set = null, noon = 0, maxAlt = -99;
    let prev = f(0);
    for (let m = 2; m <= 1440; m += 2) {
      const v = f(m);
      if (prev < 0 && v >= 0 && rise === null) rise = m - 2 + 2 * (-prev / (v - prev));
      if (prev >= 0 && v < 0) set = m - 2 + 2 * (prev / (prev - v));
      if (v > maxAlt) { maxAlt = v; noon = m; }
      prev = v;
    }
    const polarDay = rise === null && set === null && maxAlt > 0;
    return { rise, set, noon, maxAlt: maxAlt - 0.833, polarDay, length: rise !== null && set !== null ? set - rise : (polarDay ? 1440 : 0) };
  },
  /** Экранно-плановый вектор (в мировых координатах, y вниз) для азимута bearing */
  planDir(bearing) {
    const t = U.rad(App.doc.north + bearing);
    return { x: Math.sin(t), y: -Math.cos(t) };
  },
  /** Азимут (°) для планового направления */
  bearingOf(v) { return U.norm360(U.deg(Math.atan2(v.x, -v.y)) - App.doc.north); },
  current() {
    const s = Sun.state(), g = App.doc.geo;
    return Sun.position(s.date, s.min, g.lat, g.lon, g.tz);
  },
  state() {
    const st = App.doc.settings;
    if (!st.sun) {
      const d = new Date();
      st.sun = { date: d.toISOString().slice(0, 10), min: 12 * 60, period: 'day', step: 15 };
    }
    return st.sun;
  },
  /** Норматив непрерывной инсоляции по широте (СанПиН 1.2.3685-21, упрощённо) */
  norm(lat) {
    if (lat > 58) return { hours: 2.5, zone: 'северная зона (севернее 58° с.ш.)', period: '22 апреля – 22 августа' };
    if (lat >= 48) return { hours: 2.0, zone: 'центральная зона (58°–48° с.ш.)', period: '22 апреля – 22 августа' };
    return { hours: 1.5, zone: 'южная зона (южнее 48° с.ш.)', period: '22 февраля – 22 октября' };
  },

  /* ------------------------------ тени ----------------------------------- */
  /** Объекты, отбрасывающие тень */
  casters() {
    const res = [];
    // стены всех этажей: призма от отметки пола этажа до верха стены
    for (const w of App.doc.walls) if (w.h > 0 && G.dist(w.a, w.b) > 0.5) { const e = Model.elevOf(w); res.push({ id: w.id, pts: Model.wallRect(w), h: e + w.h, h0: e }); }
    for (const r of App.doc.roofs || []) { const c = Roof.caster(r); if (c) res.push(c); }
    for (const it of App.doc.items) {
      const def = catItem(it.key);
      const casts = it.shadow ?? def.shadow;
      if (!casts || !(it.h > 0)) continue;
      if (Model.elevOf(it) > 0) continue;   // тени считаем от объектов участка
      if (def.shape === 'tree' || def.shape === 'conifer' || def.shape === 'bush') {
        const h0 = def.shape === 'tree' ? it.h * 0.3 : def.shape === 'conifer' ? it.h * 0.05 : 0;
        res.push({ id: it.id, circle: { x: it.x, y: it.y }, r: Math.min(it.w, it.d) / 2 * (def.shape === 'conifer' ? 0.85 : 0.95), h0, h: it.h, trunk: def.shape === 'tree' ? Math.max(8, it.w * 0.04) : 0 });
      } else if (def.sym) {
        const r = Math.max(it.w, it.d) / 2;
        res.push({ id: it.id, circle: { x: it.x, y: it.y }, r, h0: 0, h: it.h });
      } else {
        // навесы/перголы: тень только от кровли (под ней — открыто)
        const roof = it.roof ?? def.roof;
        res.push({ id: it.id, pts: Model.itemPts(it), h: it.h, h0: roof ? Math.max(0, it.h - 30) : 0 });
      }
    }
    return res;
  },
  /** Заливка теней в ctx (мировые координаты, текущий fillStyle). z — высота «приёмника», см. */
  pathShadows(ctx, casters, sun, z = 0, exclude) {
    if (sun.alt <= 0.5) return;
    const k = 1 / Math.tan(U.rad(sun.alt));
    const dir = Sun.planDir(sun.az);
    const v = (h) => ({ x: -dir.x * h * k, y: -dir.y * h * k });
    for (const c of casters) {
      if (exclude && exclude === c.id) continue;
      const hEff = (c.verts ? Math.max(...c.verts.map(p => p.z)) : c.h) - z;
      if (hEff <= 0) continue;
      ctx.beginPath();
      if (c.verts) {
        // выпуклый многогранник (крыша): оболочка проекций вершин
        const hull = G.hull(c.verts.map(p => G.add(p, v(Math.max(0, p.z - z)))));
        if (hull.length >= 3) { ctx.moveTo(hull[0].x, hull[0].y); for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y); ctx.closePath(); ctx.fill(); }
        continue;
      }
      if (c.circle) {
        const a = G.add(c.circle, v(Math.max(0, c.h0 - z))), b = G.add(c.circle, v(hEff));
        // отдельные заливки, чтобы встречное направление обхода не давало «дыр»
        ctx.arc(a.x, a.y, c.r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x, b.y, c.r, 0, Math.PI * 2); ctx.fill();
        const n = G.mul(G.perp(G.unit(G.sub(b, a))), c.r);
        ctx.beginPath();
        if (G.dist(a, b) > 0.5) { ctx.moveTo(a.x + n.x, a.y + n.y); ctx.lineTo(b.x + n.x, b.y + n.y); ctx.lineTo(b.x - n.x, b.y - n.y); ctx.lineTo(a.x - n.x, a.y - n.y); ctx.closePath(); ctx.fill(); }
        ctx.beginPath();
        if (c.trunk && c.h0 > z) {
          const t0 = c.circle, t1 = G.add(c.circle, v(c.h0 - z)), m = G.mul(G.perp(G.unit(G.sub(t1, t0))), c.trunk / 2);
          ctx.moveTo(t0.x + m.x, t0.y + m.y); ctx.lineTo(t1.x + m.x, t1.y + m.y); ctx.lineTo(t1.x - m.x, t1.y - m.y); ctx.lineTo(t0.x - m.x, t0.y - m.y); ctx.closePath();
        }
      } else {
        const off = v(hEff), off0 = v(Math.max(0, (c.h0 || 0) - z));
        const hull = G.hull(c.pts.map(p => G.add(p, off0)).concat(c.pts.map(p => G.add(p, off))));
        ctx.moveTo(hull[0].x, hull[0].y);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
        ctx.closePath();
      }
      ctx.fill();
    }
  },
  /** Проверка: точка p (на высоте z) в тени? */
  inShadow(p, casters, sun, z, exclude) {
    if (sun.alt <= 0.5) return true;
    const k = 1 / Math.tan(U.rad(sun.alt));
    const dir = Sun.planDir(sun.az);
    for (const c of casters) {
      if (exclude && exclude === c.id) continue;
      if (c.verts) {
        if (Math.max(...c.verts.map(q => q.z)) <= z) continue;
        const hull = G.hull(c.verts.map(q => G.add(q, G.mul(dir, -Math.max(0, q.z - z) * k))));
        if (G.pointInPoly(p, hull)) return true;
        continue;
      }
      const hEff = c.h - z;
      if (hEff <= 0) continue;
      if (c.circle) {
        const a = G.add(c.circle, G.mul(dir, -Math.max(0, c.h0 - z) * k)), b = G.add(c.circle, G.mul(dir, -hEff * k));
        if (G.distSeg(p, a, b) <= c.r) return true;
      } else {
        // быстрый отсев: точка должна лежать «за» объектом относительно солнца
        const off = G.mul(dir, -hEff * k), off0 = G.mul(dir, -Math.max(0, (c.h0 || 0) - z) * k);
        const hull = G.hull(c.pts.map(q => G.add(q, off0)).concat(c.pts.map(q => G.add(q, off))));
        if (G.pointInPoly(p, hull)) return true;
      }
    }
    return false;
  },

  /* ------------------------ карта инсоляции ------------------------------ */
  heatRegion() {
    const plots = App.doc.areas.filter(a => a.kind === 'plot');
    let b = null;
    for (const a of plots) b = G.bboxUnion(b, G.bbox(a.pts));
    if (!b) {
      b = Model.contentBBox();
      if (!G.bboxValid(b)) return null;
      b = { x0: b.x0 - 600, y0: b.y0 - 600, x1: b.x1 + 600, y1: b.y1 + 600 };
    }
    return { b, plots };
  },
  daysForPeriod(period, date) {
    const y = Number(date.slice(0, 4));
    const mk = (m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (period === 'season') return [mk(4, 22), mk(5, 22), mk(6, 22), mk(7, 22), mk(8, 22)];
    if (period === 'year') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => mk(m, 21));
    return [date];
  },
  _job: 0,
  /** Расчёт карты. onProgress(0..1). Результат — App.heat */
  async computeHeat(onProgress) {
    const job = ++Sun._job;
    const reg = Sun.heatRegion();
    if (!reg) { UI.toast('Нарисуйте участок или объекты — считать нечего', 'err'); return null; }
    const { b, plots } = reg;
    const W = b.x1 - b.x0, H = b.y1 - b.y0;
    const cell = Math.max(10, Math.ceil(Math.max(W, H) / 320));
    const nx = Math.max(1, Math.ceil(W / cell)), ny = Math.max(1, Math.ceil(H / cell));
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const setT = () => cx.setTransform(1 / cell, 0, 0, 1 / cell, -b.x0 / cell, -b.y0 / cell);
    const st = Sun.state(), g = App.doc.geo;
    const days = Sun.daysForPeriod(st.period || 'day', st.date);
    const step = st.step || 15;
    const casters = Sun.casters();
    const sunH = new Float32Array(nx * ny);
    let daylight = 0, samples = 0, total = 0;
    for (let i = 0; i < days.length; i++) for (let m = 0; m < 1440; m += step) total++;
    for (const d of days) {
      for (let m = step / 2; m < 1440; m += step) {
        samples++;
        const pos = Sun.position(d, m, g.lat, g.lon, g.tz);
        if (pos.alt > 0.5) {
          daylight += step / 60;
          cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, nx, ny);
          setT(); cx.fillStyle = '#000';
          Sun.pathShadows(cx, casters, pos, 0);
          const data = cx.getImageData(0, 0, nx, ny).data;
          for (let i = 0, j = 3; i < sunH.length; i++, j += 4) if (data[j] < 128) sunH[i] += step / 60;
        }
        if (samples % 12 === 0) {
          onProgress && onProgress(samples / total);
          await new Promise(r => setTimeout(r, 0));
          if (job !== Sun._job) return null;
        }
      }
    }
    for (let i = 0; i < sunH.length; i++) sunH[i] /= days.length;
    daylight /= days.length;
    // Маска: вне участка — прозрачно; внутри помещений/построек — нет данных
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, nx, ny); setT();
    cx.fillStyle = '#000';
    if (plots.length) { cx.beginPath(); for (const a of plots) { cx.moveTo(a.pts[0].x, a.pts[0].y); for (const p of a.pts) cx.lineTo(p.x, p.y); cx.closePath(); } cx.fill(); }
    else cx.fillRect(b.x0, b.y0, W, H);
    const inside = cx.getImageData(0, 0, nx, ny).data;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, nx, ny); setT();
    cx.beginPath();
    for (const r of (App.floorData ? App.floorData[0].rooms : App.rooms)) { cx.moveTo(r.axis[0].x, r.axis[0].y); for (const p of r.axis) cx.lineTo(p.x, p.y); cx.closePath(); }
    for (const c of casters) if (c.pts && !c.h0) { cx.moveTo(c.pts[0].x, c.pts[0].y); for (const p of c.pts) cx.lineTo(p.x, p.y); cx.closePath(); }
    cx.fill();
    const blocked = cx.getImageData(0, 0, nx, ny).data;
    // Картинка
    const img = cx.createImageData(nx, ny);
    let minV = Infinity, maxV = 0, sum = 0, cnt = 0;
    const hist = [0, 0, 0, 0];  // <3 ч, 3–6, 6–9, >9
    for (let i = 0; i < sunH.length; i++) {
      const j = i * 4;
      if (inside[j + 3] < 128 || blocked[j + 3] >= 128) { img.data[j + 3] = 0; sunH[i] = NaN; continue; }
      const v = sunH[i];
      const [r, gg, bb] = Sun.heatColor(daylight ? v / daylight : 0);
      img.data[j] = r; img.data[j + 1] = gg; img.data[j + 2] = bb; img.data[j + 3] = 175;
      minV = Math.min(minV, v); maxV = Math.max(maxV, v); sum += v; cnt++;
      hist[v < 3 ? 0 : v < 6 ? 1 : v < 9 ? 2 : 3]++;
    }
    cx.putImageData(img, 0, 0);
    onProgress && onProgress(1);
    App.heat = { canvas: cv, x0: b.x0, y0: b.y0, cell, nx, ny, data: sunH, daylight, min: minV, max: maxV, avg: cnt ? sum / cnt : 0, cells: cnt, hist, days, stale: false, period: st.period || 'day', date: st.date };
    return App.heat;
  },
  heatColor(t) {
    t = U.clamp(t, 0, 1);
    const stops = [[0, [38, 48, 110]], [0.25, [52, 104, 190]], [0.45, [40, 170, 170]], [0.65, [120, 200, 80]], [0.82, [245, 205, 50]], [1, [250, 120, 40]]];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const k = (t - t0) / (t1 - t0);
        return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
      }
    }
    return stops[stops.length - 1][1];
  },
  heatAt(p) {
    const h = App.heat;
    if (!h) return null;
    const i = Math.floor((p.x - h.x0) / h.cell), j = Math.floor((p.y - h.y0) / h.cell);
    if (i < 0 || j < 0 || i >= h.nx || j >= h.ny) return null;
    const v = h.data[j * h.nx + i];
    return Number.isNaN(v) ? null : v;
  },

  /* ---------------------- окна и помещения ------------------------------- */
  windowInfo(op) {
    const g = Model.opGeom(op);
    if (!g) return null;
    const off = g.th / 2 + 12;
    const p1 = G.add(g.c, G.mul(g.n, off)), p2 = G.sub(g.c, G.mul(g.n, off));
    const r1 = Rooms.at(p1), r2 = Rooms.at(p2);
    if (r1 && r2) return { interior: true, room: null };
    let outN, room;
    if (r1 && !r2) { room = r1; outN = G.mul(g.n, -1); }
    else if (r2 && !r1) { room = r2; outN = g.n; }
    else { room = null; outN = G.mul(g.n, -op.side || -1); }
    const bearing = Sun.bearingOf(outN);
    return { room, outN, bearing, dir: U.compass8(bearing), point: G.add(g.c, G.mul(outN, g.th / 2 + 3)), g };
  },
  /** Инсоляция окна за день: суммарно и максимальный непрерывный период (часы) */
  windowSun(op, date, casters, step = 5) {
    const info = Sun.windowInfo(op);
    if (!info || info.interior) return null;
    const g = App.doc.geo;
    const z = Model.elevOf(op) + (op.sill || 0) + (op.h || 140) / 2;
    let total = 0, run = 0, best = 0;
    for (let m = step / 2; m < 1440; m += step) {
      const pos = Sun.position(date, m, g.lat, g.lon, g.tz);
      let lit = false;
      if (pos.alt > 3) {
        const s = Sun.planDir(pos.az);
        // солнце перед окном; учитываем откосы — угол падения в плане < 80°
        if (G.dot(s, info.outN) > Math.cos(U.rad(80))) lit = !Sun.inShadow(info.point, casters, pos, z, op.wall);
      }
      if (lit) { total += step / 60; run += step / 60; best = Math.max(best, run); } else run = 0;
    }
    return { total, cont: best, info };
  },
  roomsInsolation(date) {
    const casters = Sun.casters();
    const res = new Map();
    for (const op of App.V.openings) {
      if (OPENING_TYPES[op.type]?.cat !== 'window') continue;
      const r = Sun.windowSun(op, date, casters);
      if (!r || !r.info.room) continue;
      const cur = res.get(r.info.room.id) || { total: 0, cont: 0, windows: [] };
      cur.total = Math.max(cur.total, r.total); cur.cont = Math.max(cur.cont, r.cont);
      cur.windows.push({ op, dir: r.info.dir, bearing: r.info.bearing, total: r.total, cont: r.cont });
      res.set(r.info.room.id, cur);
    }
    return res;
  },
};
