// Сборка в один автономный HTML-файл: dist/floorplaner.html (открывается двойным кликом, без сервера).
// Для публикации на сайте: SITE_URL=https://example.ru/ node tools/build.mjs — дополнительно
// dist/index.html с canonical/og:url/og:image, dist/robots.txt, dist/sitemap.xml и dist/og.png.
// Коды подтверждения прав: GOOGLE_VERIFY=… (Search Console), YANDEX_VERIFY=… (Яндекс Вебмастер).
// Счётчик уникальных посетителей в шапке: VISITS_URL=…{op}… (op = hit | get; «off» — выключить),
// по умолчанию — бесплатный abacus.jasoncameron.dev, запасной — LiveInternet (VISITS_LI=off — без него).
// YANDEX_METRIKA=номер — ещё и Яндекс Метрика.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
let html = readFileSync(join(src, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  `<style>\n${readFileSync(join(src, href), 'utf8')}\n</style>`);

html = html.replace(/<!-- build:js -->([\s\S]*?)<!-- endbuild -->/, (_, block) => {
  const files = [...block.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const code = files.map(f => `/* ---- ${f} ---- */\n` + readFileSync(join(src, f), 'utf8').replace(/<\/script/gi, '<\\/script')).join('\n');
  return `<script>\n${code}\n</script>`;
});

const dist = join(root, 'dist');
const out = join(dist, 'floorplaner.html');
mkdirSync(dist, { recursive: true });
writeFileSync(out, html.replace('<!-- build:seo -->\n', ''));
console.log('built', out, (html.length / 1024).toFixed(0) + ' KB');

// версия для сайта: теги, которые требуют абсолютного адреса, + robots.txt и sitemap.xml
const site = (process.env.SITE_URL || '').trim();
if (site) {
  const base = site.endsWith('/') ? site : site + '/';
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // код подтверждения: принимаем и сам код, и целиком тег <meta name="…" content="код">
  const code = (v) => { v = (v || '').trim(); const m = v.match(/content\s*=\s*["']([^"']+)["']/i); return m ? m[1].trim() : v; };
  const gv = code(process.env.GOOGLE_VERIFY), yv = code(process.env.YANDEX_VERIFY);
  // счётчик: пространство имён — из адреса сайта (msc0101.github.io/floorplaner → msc0101-github-io-floorplaner)
  const ns = base.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  let visits = (process.env.VISITS_URL || '').trim() || `https://abacus.jasoncameron.dev/{op}/${ns}/visitors`;
  if (/^(off|no|0|false)$/i.test(visits)) visits = '';
  // запасной счётчик LiveInternet (доступен из России); VISITS_LI=off — выключить
  const liCounter = !/^(off|no|0|false)$/i.test((process.env.VISITS_LI || '').trim());
  const ym = (process.env.YANDEX_METRIKA || '').trim().match(/\d{5,12}/);
  const tags = [
    `<link rel="canonical" href="${esc(base)}">`,
    `<meta property="og:url" content="${esc(base)}">`,
    `<meta property="og:image" content="${esc(base)}og.png">`,
    '<meta property="og:image:width" content="1440">',
    '<meta property="og:image:height" content="860">',
    `<meta name="twitter:image" content="${esc(base)}og.png">`,
    gv && `<meta name="google-site-verification" content="${esc(gv)}">`,
    yv && `<meta name="yandex-verification" content="${esc(yv)}">`,
    visits && `<meta name="fp-visits" content="${esc(visits)}">`,
    liCounter && '<meta name="fp-visits-li" content="1">',
    ym && `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${ym[0]},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true});</script>`,
    ym && `<noscript><div><img src="https://mc.yandex.ru/watch/${ym[0]}" style="position:absolute;left:-9999px" alt=""></div></noscript>`,
  ].filter(Boolean).join('\n');
  const page = html.replace('<!-- build:seo -->', tags)
    .replace('"@type": "WebApplication",', `"@type": "WebApplication",\n  "url": "${base}",\n  "image": "${base}og.png",`);
  writeFileSync(join(dist, 'index.html'), page);
  const shot = join(root, 'docs', 'screenshots', 'overview.png');
  if (existsSync(shot)) copyFileSync(shot, join(dist, 'og.png'));
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(base)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`);
  console.log('site', base, '→ dist/index.html, robots.txt, sitemap.xml, og.png', visits ? '· счётчик ' + visits : '', ym ? '· Метрика ' + ym[0] : '');
}
