// Сборка в один автономный HTML-файл: dist/floorplaner.html (открывается двойным кликом, без сервера).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const out = join(root, 'dist', 'floorplaner.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('built', out, (html.length / 1024).toFixed(0) + ' KB');
