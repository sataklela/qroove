// Android launcher icons and splash screens from brand/qroove-logo.png (run after `cap add android`).
// Run: node scripts/android-icons.mjs. Nearest-neighbour keeps the pixel art crisp.
import sharp from 'sharp';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = resolve(root, 'apps/mobile/android/app/src/main/res');
const BACKING = '#fff4dc'; // same light ground as the web icons (scripts/generate-icons.mjs)
const trimmed = await sharp(resolve(root, 'brand/qroove-logo.png')).trim().png().toBuffer();
const logo = (size) =>
  sharp(trimmed)
    .resize(size, size, { fit: 'contain', background: '#0000', kernel: 'nearest' })
    .png()
    .toBuffer();
const canvas = async (w, h, bg, logoSize) =>
  sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: await logo(logoSize), gravity: 'centre' }])
    .png()
    .toBuffer();

const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITY)) {
  const dir = resolve(res, `mipmap-${d}`);
  const fg = Math.round(108 * k);
  // Adaptive foreground: the launcher shows the middle 72 of 108 dp, so the logo stays inside it.
  await writeFile(resolve(dir, 'ic_launcher_foreground.png'), await canvas(fg, fg, '#0000', Math.round(fg * 0.6)));
  const legacy = Math.round(48 * k);
  await writeFile(resolve(dir, 'ic_launcher.png'), await canvas(legacy, legacy, BACKING, Math.round(legacy * 0.84)));
  const circle = Buffer.from(
    `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`,
  );
  await writeFile(
    resolve(dir, 'ic_launcher_round.png'),
    await sharp(await canvas(legacy, legacy, BACKING, Math.round(legacy * 0.7)))
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toBuffer(),
  );
}
for (const dir of (await readdir(res)).filter((d) => d.startsWith('drawable'))) {
  const file = resolve(res, dir, 'splash.png');
  const meta = await sharp(file).metadata().catch(() => null);
  if (!meta?.width || !meta.height) continue;
  const size = Math.round(Math.min(meta.width, meta.height) * 0.35);
  await writeFile(file, await canvas(meta.width, meta.height, BACKING, size));
}
await writeFile(
  resolve(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKING.toUpperCase()}</color>\n</resources>\n`,
);
console.log('Android icons and splash written.');
