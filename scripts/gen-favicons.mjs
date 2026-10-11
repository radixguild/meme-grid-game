import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Use sharp from next's node_modules
const sharpPath = resolve(__dirname, '../node_modules/next/node_modules/sharp');
let sharp;
try {
  sharp = (await import(sharpPath)).default;
} catch {
  sharp = (await import('sharp')).default;
}

const svgPath = resolve(__dirname, '../public/favicon.svg');
const svgBuffer = readFileSync(svgPath);
const outDir = resolve(__dirname, '../public');

// Generate PNGs
const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  const outPath = resolve(outDir, name);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated ${name} (${size}x${size})`);
}

// Generate favicon.ico as a simple ICO file containing 16x16 and 32x32 PNGs
// ICO format: header + directory + image data
const png16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer();
const png32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();

function buildIco(images) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // reserved
  header.writeUInt16LE(1, 2);           // type: 1 = ICO
  header.writeUInt16LE(images.length, 4); // number of images

  // Each directory entry: 16 bytes
  const dirEntrySize = 16;
  const headerSize = 6;
  const dirSize = images.length * dirEntrySize;
  let imageOffset = headerSize + dirSize;

  const dirs = [];
  for (const { buf, w, h } of images) {
    const dir = Buffer.alloc(dirEntrySize);
    dir.writeUInt8(w === 256 ? 0 : w, 0);   // width (0 = 256)
    dir.writeUInt8(h === 256 ? 0 : h, 1);   // height
    dir.writeUInt8(0, 2);                    // color count (0 = no palette)
    dir.writeUInt8(0, 3);                    // reserved
    dir.writeUInt16LE(1, 4);                 // color planes
    dir.writeUInt16LE(32, 6);               // bits per pixel
    dir.writeUInt32LE(buf.length, 8);        // size of image data
    dir.writeUInt32LE(imageOffset, 12);      // offset of image data
    dirs.push(dir);
    imageOffset += buf.length;
  }

  return Buffer.concat([header, ...dirs, ...images.map(i => i.buf)]);
}

const icoBuffer = buildIco([
  { buf: png16, w: 16, h: 16 },
  { buf: png32, w: 32, h: 32 },
]);

const icoPath = resolve(outDir, 'favicon.ico');
writeFileSync(icoPath, icoBuffer);
console.log('Generated favicon.ico (16x16, 32x32)');
console.log('Done!');
