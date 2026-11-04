// Render assets/icon.svg to the PNG sizes the manifest references.
// Usage: npm run icons
import { firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const outDir = path.join(root, 'extension/icons');
fs.mkdirSync(outDir, { recursive: true });

// Draw the SVG onto a canvas and export PNG, so corners stay transparent
// (Firefox's screenshot can't omit the page background).
const browser = await firefox.launch();
const page = await browser.newPage();
for (const size of [48, 96, 128]) {
  const dataUrl = await page.evaluate(async ({ svg, size }) => {
    const img = new Image(size, size);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  }, { svg, size });
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`icon-${size}.png`);
}
await browser.close();
