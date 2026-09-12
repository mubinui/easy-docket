/**
 * Render every icon the app ships from one source mark.
 *
 * `src/assets/icon/icon-glyph.svg` is the mark; `favicon.svg` is a variant of
 * it drawn for 16 and 32 pixels. Everything else — the PWA icon set, the
 * Android launcher, its adaptive foreground, the round legacy icon, the splash
 * screens — is composed here, so the mark has exactly one definition and a
 * change to it cannot reach some surfaces and miss others.
 *
 * Rasterised with headless Chrome, which the repository already has for the
 * end-to-end suite. That avoids adding an image toolchain for a job that runs
 * about once a year.
 *
 *   npm run icons
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'src/assets/icon');
const ANDROID_RES = join(ROOT, 'android/app/src/main/res');

/** The brand blue, and the one place it is written down for the icons. */
const BRAND = '#0054e9';

/** Android's launcher densities, and the multiplier each one applies. */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** Splash screens, at the sizes Capacitor's own files use. */
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];

const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

/** The mark's markup, without the `<svg>` wrapper, so it can be re-framed. */
async function readGlyph() {
  const svg = await readFile(join(ICON_DIR, 'icon-glyph.svg'), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (!inner.trim()) throw new Error('icon-glyph.svg has no content');
  return inner;
}

/**
 * The full icon: the mark on a full-bleed background.
 *
 * Full-bleed because the manifest declares these `maskable`, and a maskable
 * icon with transparent corners gets those corners drawn in whatever colour the
 * launcher feels like.
 */
function composeIcon(glyph, { rounded = false } = {}) {
  const background = rounded
    ? `<circle cx="256" cy="256" r="256" fill="${BRAND}"/>`
    : `<rect width="512" height="512" fill="${BRAND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${background}${glyph}</svg>`;
}

/**
 * The adaptive foreground: the mark alone, on transparency.
 *
 * Android composes this over the background colour and then crops the pair to
 * whatever shape the launcher uses. The visible area is the middle two thirds,
 * so the mark is drawn at 62% and centred — anything larger loses its edges to
 * the crop on a round launcher.
 */
function composeForeground(glyph) {
  const scale = 0.62;
  const offset = (512 - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g>
  </svg>`;
}

/** The splash: the mark small and centred on the brand colour. */
function composeSplash(glyph, width, height) {
  const mark = Math.round(Math.min(width, height) * 0.28);
  const x = Math.round((width - mark) / 2);
  const y = Math.round((height - mark) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${BRAND}"/>
    <svg x="${x}" y="${y}" width="${mark}" height="${mark}" viewBox="0 0 512 512">${glyph}</svg>
  </svg>`;
}

/**
 * Rasterise an SVG at an exact pixel size.
 *
 * The page is sized to the output and screenshotted, rather than scaling an
 * image afterwards: every size is drawn from the vector, so a 48px icon has
 * crisp edges instead of a resampled 512px one's soft ones.
 */
async function rasterise(page, svg, width, height, out, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<body style="margin:0;background:transparent">
       <div style="width:${width}px;height:${height}px">${svg.replace(
         '<svg ',
         `<svg width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" `,
       )}</div>
     </body>`,
  );
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: transparent });
}

const glyph = await readGlyph();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const written = [];

// A composed master beside the source, so the icon can be looked at without
// running anything. Generated, not edited.
await writeFile(
  join(ICON_DIR, 'icon.svg'),
  `<!-- Generated by tools/render-icons.mjs from icon-glyph.svg. Do not edit. -->\n${composeIcon(
    glyph,
  )}\n`,
);
written.push('src/assets/icon/icon.svg');

const icon = composeIcon(glyph);
const round = composeIcon(glyph, { rounded: true });
const foreground = composeForeground(glyph);
const favicon = await readFile(join(ICON_DIR, 'favicon.svg'), 'utf8');

for (const size of PWA_SIZES) {
  const out = join(ROOT, `public/icons/icon-${size}x${size}.png`);
  await rasterise(page, icon, size, size, out);
  written.push(`public/icons/icon-${size}x${size}.png`);
}

// The browser tab, where the mark is drawn at a size the full icon cannot hold.
for (const size of [16, 32, 48]) {
  const name = size === 48 ? 'favicon.png' : `favicon-${size}x${size}.png`;
  await rasterise(page, favicon, size, size, join(ICON_DIR, name));
  written.push(`src/assets/icon/${name}`);
}

for (const [density, scale] of DENSITIES) {
  const launcher = Math.round(48 * scale);
  const adaptive = Math.round(108 * scale);
  const dir = join(ANDROID_RES, `mipmap-${density}`);

  await rasterise(page, icon, launcher, launcher, join(dir, 'ic_launcher.png'));
  await rasterise(page, round, launcher, launcher, join(dir, 'ic_launcher_round.png'), {
    transparent: true,
  });
  await rasterise(page, foreground, adaptive, adaptive, join(dir, 'ic_launcher_foreground.png'), {
    transparent: true,
  });
  written.push(`android …/mipmap-${density}/ (launcher ${launcher}px, adaptive ${adaptive}px)`);
}

for (const [dir, width, height] of SPLASHES) {
  await rasterise(page, composeSplash(glyph, width, height), width, height, join(ANDROID_RES, dir, 'splash.png'));
  written.push(`android …/${dir}/splash.png (${width}×${height})`);
}

await browser.close();

console.log(`Rendered ${written.length} outputs from src/assets/icon/icon-glyph.svg:`);
for (const entry of written) console.log(`  ${entry}`);
