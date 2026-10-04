/** Regenerates favicons, the organisation logo and the default social image in public/. */
import fs from 'node:fs';
import sharp from 'sharp';
import { coverSvg } from '../src/lib/images/covers';

const mark = (bg: string | null) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="512" height="512">
${bg ? `<rect width="48" height="48" rx="10" fill="${bg}"/>` : ''}
<circle cx="22" cy="26" r="17" fill="#c4664b"/>
<g fill="none" stroke="#7a3520" stroke-opacity=".45" stroke-width="2"><path d="M7 22c8 0 18 3 27 12"/><path d="M10 14c6 2 13 9 15 23"/><path d="M20 9.5c-2 7-1 18 4 27"/><path d="M6 31c7-3 16-3 26 1"/></g>
<path d="M30 38L44 8" stroke="#e8b86f" stroke-width="4" stroke-linecap="round"/>
<path d="M44 8c1.5-2 3.6-1.2 3 .6" fill="none" stroke="#e8b86f" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/favicon.svg', mark(null).replace(' width="512" height="512"', ''));
await sharp(Buffer.from(mark('#faf6f0'))).resize(512, 512).png().toFile('public/logo-512.png');
await sharp(Buffer.from(mark('#faf6f0'))).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(mark(null))).resize(32, 32).png().toFile('public/favicon-32.png');
await sharp(Buffer.from(mark('#faf6f0'))).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(coverSvg('yarn-hook')), { density: 144 }).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile('public/og-default.jpg');
fs.writeFileSync(
  'public/site.webmanifest',
  JSON.stringify(
    {
      name: 'Hook & Hearth',
      short_name: 'Hook & Hearth',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/logo-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#faf6f0',
      background_color: '#faf6f0',
      display: 'browser',
    },
    null,
    2,
  ),
);
console.log('Assets written to public/.');
