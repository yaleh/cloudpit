// electron/scripts/generate-macos-icon.js — build the macOS window icon and .icns bundle from the
// committed raster source `public/logo-source.png` (glossy blue airfoil canopy on navy).
//
// Run from the repo root:  node electron/scripts/generate-macos-icon.js

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
await fs.writeFile(path.join(assetsDir, 'logo-macos.png'), await renderSquare(1024));

// ICNS entries — same set the original script emitted (retina variants included).
const icnsEntries = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

const blocks = [];
for (const [type, entrySize] of icnsEntries) {
  const png = await renderSquare(entrySize);
  const block = Buffer.alloc(8 + png.length);
  block.write(type, 0, 4, 'ascii');
  block.writeUInt32BE(block.length, 4);
  png.copy(block, 8);
  blocks.push(block);
}

const totalLength = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(totalLength, 4);

await fs.writeFile(path.join(assetsDir, 'logo-macos.icns'), Buffer.concat([header, ...blocks]));

console.log('electron/scripts/generate-macos-icon.js: regenerated logo-macos.png and logo-macos.icns');
