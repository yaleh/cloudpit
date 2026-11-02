// public/generate-icons.js — regenerate the Cloudpit favicon/logo/PWA icon set from the
// committed raster source `public/logo-source.png` (glossy blue airfoil canopy on navy, 1254×1254).
//
// The source is raster-only (no vector), so the SVG favicon/logo are thin wrappers that embed a
// raster PNG; browsers render them identically to the PNG while keeping the existing
// `type="image/svg+xml"` link in index.html valid.
//
// Layout: full airfoil, full width, vertically centered, navy field above and below. No cropping
// and no zoom — the wide shape is the mark; maskable icon consumers accept the tip crop.
//
// Run from the repo root:  node public/generate-icons.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, 'logo-source.png');

// Navy background sampled from the source corners, used to build the square canvas.
const BG = { r: 2, g: 20, b: 44 };

// Airfoil content bbox on the 1254×1254 source (measured vs the navy background).
const CONTENT = { left: 36, top: 312, width: 1218, height: 583 };

/** Render the full airfoil centered in an `size`×`size` navy square, no crop/zoom. */
async function renderSquare(size) {
  const stripHeight = Math.round((size * CONTENT.height) / CONTENT.width);
  const strip = await sharp(SOURCE)
    .extract(CONTENT)
    .resize(size, stripHeight)
    .png()
    .toBuffer();
  const top = Math.round((size - stripHeight) / 2);
  return sharp({ create: { width: size, height: size, channels: 3, background: BG } })
    .composite([{ input: strip, left: 0, top }])
    .png()
    .toBuffer();
}

/** Wrap a raster PNG in a minimal SVG so `type="image/svg+xml"` links keep working. */
async function renderSvgWrapper(size) {
  const png = await renderSquare(size);
  const b64 = png.toString('base64');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<image href="data:image/png;base64,${b64}" width="${size}" height="${size}"/></svg>`,
  );
}

await fs.mkdir(path.join(here, 'icons'), { recursive: true });

// Favicon + wordmark/logo SVGs.
await fs.writeFile(path.join(here, 'favicon.png'), await renderSquare(64));
await fs.writeFile(path.join(here, 'favicon.svg'), await renderSvgWrapper(64));
await fs.writeFile(path.join(here, 'logo.svg'), await renderSvgWrapper(128));

// README/desktop launcher logos.
for (const size of [32, 64, 128, 256, 512]) {
  await fs.writeFile(path.join(here, `logo-${size}.png`), await renderSquare(size));
}

// PWA + apple-touch icons (maskable: the wide airfoil's tips crop under a circular mask).
for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
  await fs.writeFile(path.join(here, 'icons', `icon-${size}x${size}.png`), await renderSquare(size));
}

console.log('public/generate-icons.js: regenerated favicon, logo and PWA icons from logo-source.png');
