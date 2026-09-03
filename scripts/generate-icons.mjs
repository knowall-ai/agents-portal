// Generate PNG icons and the Open Graph image from the SVG sources in public/.
// Usage: bun run generate-icons
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

const iconSvg = fs.readFileSync(path.join(publicDir, 'favicon.svg'));
const socialSvg = fs.readFileSync(path.join(publicDir, 'assets/social-preview.svg'));

const outputs = [
  { file: 'favicon-16x16.png', size: 16 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192x192.png', size: 192 },
  { file: 'icon-512x512.png', size: 512 },
];

for (const { file, size } of outputs) {
  await sharp(iconSvg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(publicDir, file));
  console.log(`Generated ${file}`);
}

await sharp(socialSvg).resize(1200, 630).png().toFile(path.join(publicDir, 'og-image.png'));
console.log('Generated og-image.png');
