/**
 * Генерация растровых иконок и превью из SVG-мастеров бренда MioFlow.
 * Запуск: node brand/render.js  (нужен Playwright с Chromium)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = (p) => path.join(root, p);
const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(require.resolve(f)).toString('base64');

const BLUE = '#2F3BFF', PINK = '#FFC7D6', INK = '#0E0F2B';
// Знак без фона: кольцо, стрелка, точка. scale/offset — чтобы попасть в безопасную зону адаптивной иконки Android.
const glyph = (ring, dot, s = 1) => `
  <g transform="translate(32 32) scale(${s}) translate(-32 -32)">
    <circle cx="32" cy="33" r="15" fill="none" stroke="${ring}" stroke-width="5"/>
    <line x1="32" y1="33" x2="32" y2="24" stroke="${ring}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="46" cy="18" r="6.5" fill="${dot}"/>
  </g>`;
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}${body}</svg>`;

const icons = [
  // iOS/общая иконка: квадрат во весь размер (скругление делает система)
  ['apps/mobile/assets/icon.png', 1024, svg(glyph('#FFFFFF', PINK, 1.15), `<rect width="64" height="64" fill="${BLUE}"/>`)],
  // Android adaptive: передний план в безопасной зоне (~66%), фон отдельно, монохромная версия для тем
  ['apps/mobile/assets/android-icon-foreground.png', 1024, svg(glyph('#FFFFFF', PINK, 0.78))],
  ['apps/mobile/assets/android-icon-background.png', 1024, svg('', `<rect width="64" height="64" fill="${BLUE}"/>`)],
  ['apps/mobile/assets/android-icon-monochrome.png', 1024, svg(glyph('#FFFFFF', '#FFFFFF', 0.78))],
  // Заставка при запуске: знак на белом
  ['apps/mobile/assets/splash-icon.png', 1024, fs.readFileSync(path.join(__dirname, 'mark.svg'), 'utf8')],
  ['apps/mobile/assets/favicon.png', 96, fs.readFileSync(path.join(__dirname, 'app-icon.svg'), 'utf8')],
  ['apps/web/public/apple-touch-icon.png', 180, svg(glyph('#FFFFFF', PINK, 1.15), `<rect width="64" height="64" fill="${BLUE}"/>`)],
  ['apps/web/public/favicon-192.png', 192, fs.readFileSync(path.join(__dirname, 'app-icon.svg'), 'utf8')],
  ['apps/web/public/favicon-512.png', 512, fs.readFileSync(path.join(__dirname, 'app-icon.svg'), 'utf8')],
];

(async () => {
  const b = await chromium.launch();
  for (const [file, size, markup] of icons) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out(file), omitBackground: true });
    await p.close();
  }
  fs.copyFileSync(path.join(__dirname, 'app-icon.svg'), out('apps/web/public/favicon.svg'));

  // Превью ссылки для соцсетей и мессенджеров (Open Graph) 1200×630
  const og = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<html><head><style>
    @font-face{font-family:Yeseva;src:url(${font('@expo-google-fonts/yeseva-one/400Regular/YesevaOne_400Regular.ttf')})}
    @font-face{font-family:Golos;font-weight:500;src:url(${font('@expo-google-fonts/golos-text/500Medium/GolosText_500Medium.ttf')})}
    body{margin:0;width:1200px;height:630px;background:${BLUE};color:#fff;font-family:Golos;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box}
    h1{font-family:Yeseva;font-weight:400;font-size:132px;line-height:.9;margin:0}
    p{font-size:38px;line-height:1.3;margin:24px 0 0;color:#dfe2ff;max-width:640px}
    .bubble{margin-top:40px;display:inline-block;background:#fff;color:${INK};border-radius:28px 28px 28px 10px;padding:22px 28px;font-size:30px}
  </style></head><body>
    <svg width="260" height="260" viewBox="0 0 64 64">${glyph('#FFFFFF', PINK, 1.6)}</svg>
    <div><h1>MioFlow</h1><p>Онлайн-запись и напоминания для салонов красоты</p><div class="bubble">Пора к мастеру: завтра в 14:00</div></div>
  </body></html>`);
  await og.waitForTimeout(300);
  await og.screenshot({ path: out('apps/web/public/og.png') });
  await b.close();
  console.log('ok');
})();
