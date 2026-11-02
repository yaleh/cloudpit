// electron/scripts/generate-windows-icon.js — build the Windows .ico (PNG-compressed entries) from
// the committed raster source `public/logo-source.png` (glossy blue airfoil canopy on navy).
//
// Modern Windows (Vista+) accepts PNG-encoded ICO entries, so each size embeds a PNG directly.
//
// Run from the repo root:  node electron/scripts/generate-windows-icon.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, '..', 'assets');
const SOURCE = path.join(here, '..', '..', 'public', 'logo-source.png');

const BG = { r: 2, g: 20, b: 44 };
const CONTENT = { left: 36, top: 312, width: 1218, height: 583 };

/** Full airfoil centered in an `size`×`size` navy square, no crop/zoom. */
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

await fs.mkdir(assetsDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes) {
  images.push({ size, png: await renderSquare(size) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4); // count

const directory = Buffer.alloc(16 * images.length);
let offset = 6 + directory.length;
images.forEach(({ size, png }, i) => {
  const entry = 16 * i;
  directory.writeUInt8(size === 256 ? 0 : size, entry + 0); // width (0 = 256)
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1); // height (0 = 256)
  directory.writeUInt8(0, entry + 2); // palette
  directory.writeUInt8(0, entry + 3); // reserved
  directory.writeUInt16LE(1, entry + 4); // color planes
  directory.writeUInt16LE(32, entry + 6); // bits per pixel
  directory.writeUInt32LE(png.length, entry + 8); // bytes in this entry
  directory.writeUInt32LE(offset, entry + 12); // image offset
  offset += png.length;
});

const body = Buffer.concat(images.map(({ png }) => png));
await fs.writeFile(path.join(assetsDir, 'logo-windows.ico'), Buffer.concat([header, directory, body]));

console.log('electron/scripts/generate-windows-icon.js: regenerated logo-windows.ico');
