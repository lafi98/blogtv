/**
 * Original illustrated cover art, generated as SVG and rasterised by sharp.
 *
 * These covers are drawn entirely by this code, so the site owns them outright — no
 * stock licence or attribution needed. They're a placeholder-quality house style: swap
 * in your own photos of finished projects whenever you can (real photos build trust).
 */

export interface Palette {
  bg: string;
  soft: string;
  main: string;
  accent: string;
  dark: string;
  light: string;
}

export const PALETTES: Record<string, Palette> = {
  terracotta: { bg: '#f3e4d4', soft: '#e6cdb4', main: '#c4664b', accent: '#e8b86f', dark: '#5a3a2e', light: '#fbf4ec' },
  sage: { bg: '#e3e8da', soft: '#cdd6c1', main: '#7d9474', accent: '#d9a47a', dark: '#3f4a3a', light: '#f7f6ef' },
  rose: { bg: '#f4dfdb', soft: '#e8c6c0', main: '#c27479', accent: '#8fa58a', dark: '#5b3a3e', light: '#fcf3f0' },
  mustard: { bg: '#f5e8c8', soft: '#e9d5a4', main: '#d19c34', accent: '#7e9aa6', dark: '#4f3e1f', light: '#fdf8ec' },
  blue: { bg: '#dfe7ec', soft: '#c6d4dd', main: '#6e8fa6', accent: '#e2a784', dark: '#2f4352', light: '#f5f8fa' },
  plum: { bg: '#ece0ea', soft: '#dbc8d7', main: '#8e5f84', accent: '#e0b66c', dark: '#3e2a3b', light: '#faf5f9' },
  oat: { bg: '#efe6d8', soft: '#e0d2bc', main: '#a88b6a', accent: '#c4664b', dark: '#4a3b2c', light: '#fbf8f2' },
};

type Draw = (p: Palette) => string;

const W = 1200;
const H = 675;

// ── primitives ──────────────────────────────────────────────────────────────

let uid = 0;
const id = (p: string) => `${p}${++uid}`;

function yarnBall(cx: number, cy: number, r: number, color: string, dark: string, light: string): string {
  const clip = id('yb');
  const sw = Math.max(3, r * 0.05);
  const arcs = [-35, 15, 60, 110]
    .map(
      (deg, i) =>
        `<ellipse cx="${cx}" cy="${cy}" rx="${r * (0.98 - i * 0.04)}" ry="${r * (0.34 + i * 0.05)}" transform="rotate(${deg} ${cx} ${cy})"/>`,
    )
    .join('');
  return `<g>
  <clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
  <g clip-path="url(#${clip})" fill="none" stroke="${dark}" stroke-opacity=".28" stroke-width="${sw}">${arcs}
    <path d="M${cx - r} ${cy + r * 0.2} Q${cx} ${cy - r * 0.5} ${cx + r} ${cy + r * 0.1}"/>
  </g>
  <ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.4}" rx="${r * 0.28}" ry="${r * 0.14}" fill="${light}" opacity=".35" transform="rotate(-30 ${cx - r * 0.35} ${cy - r * 0.4})"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${dark}" stroke-opacity=".25" stroke-width="4"/>
</g>`;
}

/** Crochet hook drawn along the x-axis then placed with translate+rotate. */
function hook(x: number, y: number, len: number, angle: number, handle: string, shaft: string, dark: string): string {
  const hw = len * 0.045;
  const sw = len * 0.022;
  return `<g transform="translate(${x} ${y}) rotate(${angle})">
  <rect x="0" y="${-hw}" width="${len * 0.52}" height="${hw * 2}" rx="${hw}" fill="${handle}"/>
  <rect x="${len * 0.44}" y="${-hw * 0.85}" width="${len * 0.12}" height="${hw * 1.7}" rx="${hw * 0.4}" fill="${dark}" opacity=".18"/>
  <rect x="${len * 0.5}" y="${-sw}" width="${len * 0.48}" height="${sw * 2}" rx="${sw}" fill="${shaft}"/>
  <path d="M${len * 0.955} ${-sw} q${sw * 1.6} 0 ${sw * 1.6} ${sw} l0 ${sw * 0.2} q-${sw * 0.5} -${sw * 0.9} -${sw * 1.5} -${sw * 0.25} z" fill="${dark}" opacity=".55"/>
  <rect x="${len * 0.5}" y="${-sw}" width="${len * 0.48}" height="${sw * 0.7}" rx="${sw * 0.3}" fill="#fff" opacity=".25"/>
</g>`;
}

function strand(d: string, color: string, width = 10): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(1)},${(cy + rr * Math.sin(rad)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke-linejoin="round"/>`;
}

function heart(cx: number, cy: number, s: number, fill: string): string {
  return `<path d="M${cx} ${cy + s * 0.9} C${cx - s * 1.4} ${cy} ${cx - s * 0.9} ${cy - s * 1.1} ${cx} ${cy - s * 0.35} C${cx + s * 0.9} ${cy - s * 1.1} ${cx + s * 1.4} ${cy} ${cx} ${cy + s * 0.9} Z" fill="${fill}"/>`;
}

/** Chart symbols used in stitch illustrations. */
const sym = {
  ch: (x: number, y: number, c: string) => `<ellipse cx="${x}" cy="${y}" rx="18" ry="10" fill="none" stroke="${c}" stroke-width="5"/>`,
  sc: (x: number, y: number, c: string) =>
    `<path d="M${x - 14} ${y - 14} L${x + 14} ${y + 14} M${x + 14} ${y - 14} L${x - 14} ${y + 14}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  hdc: (x: number, y: number, c: string) =>
    `<path d="M${x - 16} ${y - 22} L${x + 16} ${y - 22} M${x} ${y - 22} L${x} ${y + 22}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  dc: (x: number, y: number, c: string) =>
    `<path d="M${x - 16} ${y - 30} L${x + 16} ${y - 30} M${x} ${y - 30} L${x} ${y + 30} M${x - 10} ${y + 6} L${x + 10} ${y - 6}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
};

// ── motifs ──────────────────────────────────────────────────────────────────

const MOTIFS: Record<string, { palette: string; alt: string; draw: Draw }> = {
  'yarn-hook': {
    palette: 'terracotta',
    alt: 'Illustration of a terracotta yarn ball with a loose strand and a crochet hook resting across it',
    draw: (p) =>
      yarnBall(560, 350, 175, p.main, p.dark, p.light) +
      strand(`M700 450 C820 560 930 360 1050 470`, p.main, 11) +
      hook(300, 560, 640, -34, p.accent, '#c9ccd1', p.dark),
  },
  toolkit: {
    palette: 'sage',
    alt: 'Illustration of beginner crochet supplies: a yarn ball, a crochet hook, scissors, a tapestry needle and stitch markers',
    draw: (p) =>
      yarnBall(330, 400, 130, p.main, p.dark, p.light) +
      hook(560, 210, 480, 0, p.accent, '#c9ccd1', p.dark) +
      `<g stroke="${p.dark}" stroke-width="11" fill="none"><circle cx="640" cy="410" r="38"/><circle cx="640" cy="525" r="38"/></g>
       <polygon points="672,430 900,470 672,455" fill="#b9bec5"/><polygon points="672,505 900,474 672,482" fill="#a9aeb6"/>
       <circle cx="700" cy="468" r="7" fill="${p.dark}"/>` +
      `<rect x="760" y="560" width="300" height="9" rx="4.5" fill="#b9bec5"/><ellipse cx="1040" cy="564.5" rx="12" ry="3" fill="${p.bg}"/>` +
      [930, 990, 1050]
        .map((x, i) => `<path d="M${x} 330 a22 22 0 1 1 0 44 l0 26" fill="none" stroke="${[p.main, p.accent, p.dark][i]}" stroke-width="9" stroke-linecap="round"/>`)
        .join(''),
  },
  'stitch-rows': {
    palette: 'mustard',
    alt: 'Illustration of crochet chart symbols for chain, single, half double and double crochet in rows on a paper card',
    draw: (p) => {
      let out = `<rect x="250" y="120" width="700" height="440" rx="22" fill="${p.light}" transform="rotate(-2 600 340)"/>`;
      for (let i = 0; i < 8; i++) {
        const x = 330 + i * 77;
        out += sym.ch(x, 500, p.dark) + sym.sc(x, 425, p.main) + sym.hdc(x, 335, p.dark) + sym.dc(x, 225, p.main);
      }
      return out;
    },
  },
  terms: {
    palette: 'blue',
    alt: 'Illustration of two cards with crochet stitch symbols and a double-headed arrow between them, representing US and UK terms',
    draw: (p) =>
      `<rect x="200" y="170" width="300" height="340" rx="26" fill="${p.light}" transform="rotate(-5 350 340)"/>
       <rect x="700" y="170" width="300" height="340" rx="26" fill="${p.light}" transform="rotate(5 850 340)"/>
       <rect x="200" y="170" width="300" height="70" rx="26" fill="${p.main}" transform="rotate(-5 350 340)"/>
       <rect x="700" y="170" width="300" height="70" rx="26" fill="${p.accent}" transform="rotate(5 850 340)"/>` +
      sym.sc(350, 330, p.dark) +
      sym.dc(350, 430, p.dark) +
      sym.sc(850, 330, p.dark) +
      sym.dc(850, 430, p.dark) +
      `<path d="M545 340 L655 340 M560 318 L540 340 L560 362 M640 318 L660 340 L640 362" stroke="${p.dark}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  },
  'magic-ring': {
    palette: 'rose',
    alt: 'Illustration of a magic ring: a loop of yarn with six stitches worked around it and the yarn tail hanging below',
    draw: (p) => {
      let out = `<circle cx="600" cy="320" r="120" fill="none" stroke="${p.main}" stroke-width="24"/>`;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = 600 + Math.cos(a) * 165;
        const y = 320 + Math.sin(a) * 165;
        out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="40" ry="26" fill="${p.light}" stroke="${p.dark}" stroke-width="7" transform="rotate(${(a * 180) / Math.PI + 90} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      }
      return out + strand('M600 440 C600 520 520 540 540 600', p.main, 12) + hook(760, 600, 420, -55, p.accent, '#c9ccd1', p.dark);
    },
  },
  'pattern-page': {
    palette: 'oat',
    alt: 'Illustration of a printed crochet pattern page with written instructions and a small round stitch chart, with a hook lying on it',
    draw: (p) => {
      let out = `<g transform="rotate(-4 600 340)"><rect x="300" y="90" width="600" height="500" rx="18" fill="${p.light}"/>`;
      for (let i = 0; i < 6; i++) out += `<rect x="350" y="${150 + i * 42}" width="${i % 3 === 2 ? 300 : 500}" height="14" rx="7" fill="${p.soft}"/>`;
      out += `<circle cx="720" cy="470" r="70" fill="none" stroke="${p.soft}" stroke-width="4"/>`;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        const x1 = 720 + Math.cos(a) * 25;
        const y1 = 470 + Math.sin(a) * 25;
        const x2 = 720 + Math.cos(a) * 60;
        const y2 = 470 + Math.sin(a) * 60;
        out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>`;
      }
      out += sym.sc(420, 470, p.dark) + sym.dc(500, 480, p.dark) + '</g>';
      return out + hook(250, 600, 520, -24, p.main, '#c9ccd1', p.dark);
    },
  },
  swatch: {
    palette: 'sage',
    alt: 'Illustration of a square crochet gauge swatch with visible rows, two pins and a ruler beneath it',
    draw: (p) => {
      const clip = id('sw');
      let rows = '';
      for (let y = 160; y < 500; y += 34) rows += `<path d="M380 ${y} L820 ${y}" stroke="${p.dark}" stroke-opacity=".22" stroke-width="5"/>`;
      for (let y = 160; y < 500; y += 34)
        for (let x = 392; x < 820; x += 28) rows += `<path d="M${x} ${y + 6} l8 20 l8 -20" fill="none" stroke="${p.light}" stroke-opacity=".5" stroke-width="3"/>`;
      let ticks = '';
      for (let i = 0; i <= 30; i++) ticks += `<path d="M${330 + i * 18} 545 l0 ${i % 5 === 0 ? 28 : 14}" stroke="${p.dark}" stroke-width="3"/>`;
      return `<clipPath id="${clip}"><rect x="380" y="140" width="440" height="360" rx="14"/></clipPath>
        <rect x="380" y="140" width="440" height="360" rx="14" fill="${p.main}"/><g clip-path="url(#${clip})">${rows}</g>
        <rect x="320" y="535" width="560" height="70" rx="10" fill="${p.light}"/>${ticks}
        <circle cx="430" cy="190" r="13" fill="${p.accent}"/><path d="M430 190 l60 60" stroke="#b9bec5" stroke-width="5"/>
        <circle cx="770" cy="190" r="13" fill="${p.accent}"/><path d="M770 190 l-60 60" stroke="#b9bec5" stroke-width="5"/>`;
    },
  },
  'granny-square': {
    palette: 'terracotta',
    alt: 'Illustration of a classic granny square with rounds of three-stitch clusters in alternating warm colors',
    draw: (p) => {
      const colors = [p.accent, p.main, p.light, p.dark];
      let out = `<rect x="340" y="77" width="520" height="520" rx="22" fill="${p.light}" opacity=".55"/>`;
      const cluster = (x: number, y: number, rot: number, c: string) =>
        `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot})">${[-15, 0, 15]
          .map((dx) => `<rect x="${dx - 6}" y="-20" width="12" height="40" rx="6" fill="${c}" stroke="${p.dark}" stroke-opacity=".15" stroke-width="2"/>`)
          .join('')}</g>`;
      for (let ring = 1; ring <= 4; ring++) {
        const half = 8 + ring * 54;
        const c = colors[(ring - 1) % colors.length];
        // corners: two clusters at 45° offsets; sides: (ring - 1) clusters, as in a real granny square
        const corners: [number, number, number][] = [
          [600 - half, 337 - half, -45],
          [600 + half, 337 - half, 45],
          [600 + half, 337 + half, -45],
          [600 - half, 337 + half, 45],
        ];
        for (const [x, y, rot] of corners) out += cluster(x, y, rot, c);
        const per = ring - 1;
        for (let k = 1; k <= per; k++) {
          const t = -half + (2 * half * k) / (per + 1);
          out += cluster(600 + t, 337 - half, 0, c) + cluster(600 + t, 337 + half, 0, c);
          out += cluster(600 - half, 337 + t, 90, c) + cluster(600 + half, 337 + t, 90, c);
        }
      }
      return out + `<circle cx="600" cy="337" r="22" fill="${p.dark}" opacity=".85"/>`;
    },
  },
  pumpkin: {
    palette: 'mustard',
    alt: 'Illustration of a ribbed crocheted pumpkin with a short stem and a green leaf',
    draw: (p) => {
      const orange = '#d9822b';
      let out = '';
      const lobes = [
        [470, 380, 110, 150],
        [730, 380, 110, 150],
        [530, 385, 120, 165],
        [670, 385, 120, 165],
        [600, 390, 125, 170],
      ];
      for (const [cx, cy, rx, ry] of lobes)
        out += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${orange}" stroke="${p.dark}" stroke-opacity=".25" stroke-width="5"/>`;
      for (let x = 445; x <= 755; x += 22) out += `<path d="M${x} 270 Q${x + (x - 600) * 0.08} 390 ${x} 520" stroke="#fff" stroke-opacity=".12" stroke-width="5" fill="none"/>`;
      out += `<rect x="584" y="170" width="34" height="70" rx="10" fill="#6b5a3a" transform="rotate(8 600 205)"/>
        <path d="M618 215 C700 160 770 190 760 240 C700 250 650 240 618 215 Z" fill="${p.accent === '#7e9aa6' ? '#7f9a6a' : p.accent}"/>
        ${strand('M590 225 C540 190 520 230 545 250 C565 265 580 240 560 232', '#7f9a6a', 6)}`;
      return out;
    },
  },
  calendar: {
    palette: 'plum',
    alt: 'Illustration of a calendar page with several days marked by small yarn balls and a heart, for planning crochet gifts',
    draw: (p) => {
      let out = `<rect x="330" y="120" width="540" height="460" rx="24" fill="${p.light}"/><rect x="330" y="120" width="540" height="100" rx="24" fill="${p.main}"/>
        <rect x="330" y="190" width="540" height="30" fill="${p.main}"/>`;
      for (const x of [420, 600, 780]) out += `<rect x="${x - 9}" y="95" width="18" height="60" rx="9" fill="${p.dark}"/>`;
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 7; c++) out += `<rect x="${362 + c * 70}" y="${250 + r * 62}" width="54" height="46" rx="8" fill="${p.soft}" opacity=".7"/>`;
      out += yarnBall(389 + 2 * 70, 273 + 62, 20, p.accent, p.dark, p.light);
      out += yarnBall(389 + 5 * 70, 273 + 2 * 62, 20, p.main, p.dark, p.light);
      out += yarnBall(389 + 1 * 70, 273 + 3 * 62, 20, p.accent, p.dark, p.light);
      out += heart(389 + 4 * 70, 273 + 4 * 62, 17, '#c4664b');
      return out;
    },
  },
  pouch: {
    palette: 'blue',
    alt: 'Illustration of a small crocheted drawstring pouch with a cord threaded through eyelets and beads on the cord ends',
    draw: (p) => {
      const clip = id('po');
      let rows = '';
      for (let y = 250; y < 560; y += 26) rows += `<path d="M400 ${y} Q600 ${y + 14} 800 ${y}" stroke="${p.dark}" stroke-opacity=".18" stroke-width="5" fill="none"/>`;
      return `<clipPath id="${clip}"><path d="M430 210 Q600 245 770 210 L800 440 Q800 585 600 585 Q400 585 400 440 Z"/></clipPath>
        <path d="M430 210 Q600 245 770 210 L800 440 Q800 585 600 585 Q400 585 400 440 Z" fill="${p.main}"/>
        <g clip-path="url(#${clip})">${rows}</g>
        <path d="M420 200 Q470 170 520 200 Q570 170 620 200 Q670 170 720 200 Q760 175 780 200" fill="none" stroke="${p.main}" stroke-width="22" stroke-linecap="round"/>
        ${[455, 535, 615, 695].map((x) => `<circle cx="${x}" cy="240" r="9" fill="${p.dark}" opacity=".5"/>`).join('')}
        ${strand('M450 240 Q600 262 760 238 C820 250 860 330 840 400', p.accent, 9)}
        ${strand('M760 238 C790 290 800 360 770 420', p.accent, 9)}
        <circle cx="840" cy="410" r="18" fill="${p.light}" stroke="${p.dark}" stroke-width="4"/><circle cx="770" cy="432" r="18" fill="${p.light}" stroke="${p.dark}" stroke-width="4"/>`;
    },
  },
  tote: {
    palette: 'oat',
    alt: 'Illustration of a crocheted mesh market tote bag with two handles',
    draw: (p) => {
      const clip = id('to');
      let mesh = '';
      for (let i = -12; i < 24; i++) {
        mesh += `<path d="M${300 + i * 40} 230 l360 360" stroke="${p.light}" stroke-width="7"/>`;
        mesh += `<path d="M${300 + i * 40} 230 l-360 360" stroke="${p.light}" stroke-width="7"/>`;
      }
      return `<path d="M455 260 C455 120 745 120 745 260" fill="none" stroke="${p.dark}" stroke-width="26" stroke-linecap="round"/>
        <clipPath id="${clip}"><path d="M380 250 L820 250 L780 590 L420 590 Z"/></clipPath>
        <path d="M380 250 L820 250 L780 590 L420 590 Z" fill="${p.main}"/>
        <g clip-path="url(#${clip})">${mesh}</g>
        <rect x="372" y="236" width="456" height="36" rx="12" fill="${p.dark}"/>
        <rect x="412" y="570" width="376" height="30" rx="10" fill="${p.dark}"/>`;
    },
  },
  coaster: {
    palette: 'sage',
    alt: 'Illustration of three round crocheted coasters with concentric rounds, one under a mug',
    draw: (p) => {
      const coaster = (cx: number, cy: number, r: number, c: string) => {
        let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
        for (let k = 1; k <= 5; k++) s += `<circle cx="${cx}" cy="${cy}" r="${(r * k) / 6}" fill="none" stroke="${p.dark}" stroke-opacity=".2" stroke-width="4"/>`;
        return s + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.light}" stroke-width="8" stroke-dasharray="6 9"/>`;
      };
      return (
        coaster(420, 420, 140, p.accent) +
        coaster(640, 300, 140, p.main) +
        coaster(830, 450, 130, '#e8b86f') +
        `<path d="M760 330 L900 330 L888 470 Q886 490 866 490 L794 490 Q774 490 772 470 Z" fill="${p.light}"/>
         <path d="M900 360 q50 5 46 50 q-4 40 -52 40" fill="none" stroke="${p.light}" stroke-width="16"/>
         <ellipse cx="830" cy="330" rx="70" ry="12" fill="${p.soft}"/>`
      );
    },
  },
  gift: {
    palette: 'rose',
    alt: 'Illustration of a wrapped gift box with a ribbon bow and a small crocheted heart tag',
    draw: (p) =>
      `<rect x="420" y="280" width="360" height="290" rx="14" fill="${p.main}"/>
       <rect x="400" y="230" width="400" height="80" rx="14" fill="${p.main}" stroke="${p.dark}" stroke-opacity=".15" stroke-width="5"/>
       <rect x="575" y="230" width="50" height="340" fill="${p.accent}"/>
       <path d="M600 230 C520 150 470 200 520 232 Z M600 230 C680 150 730 200 680 232 Z" fill="${p.accent}" stroke="${p.dark}" stroke-opacity=".2" stroke-width="5"/>
       ${strand('M780 320 C850 330 880 380 870 420', p.dark, 4)}
       ${heart(870, 450, 40, p.light)}
       <path d="M845 440 l50 0 M848 455 l44 0" stroke="${p.main}" stroke-opacity=".5" stroke-width="4"/>`,
  },
  kids: {
    palette: 'mustard',
    alt: 'Illustration of a chunky crochet hook and a long, wavy crocheted chain surrounded by stars',
    draw: (p) => {
      let out = '';
      for (let i = 0; i < 9; i++) {
        const x = 300 + i * 62;
        const y = 420 + Math.sin(i / 1.4) * 60;
        out += `<ellipse cx="${x}" cy="${y.toFixed(1)}" rx="40" ry="24" fill="none" stroke="${i % 2 ? p.main : '#c4664b'}" stroke-width="14" transform="rotate(${Math.cos(i / 1.4) * 30} ${x} ${y.toFixed(1)})"/>`;
      }
      return (
        out +
        hook(780, 600, 380, -70, p.accent, '#c9ccd1', p.dark) +
        star(330, 200, 34, '#c4664b') +
        star(520, 150, 24, p.main) +
        star(980, 200, 30, p.accent) +
        star(1000, 520, 22, '#c4664b') +
        yarnBall(940, 360, 60, '#c4664b', p.dark, p.light)
      );
    },
  },
  edges: {
    palette: 'plum',
    alt: 'Illustration of a crochet swatch with one straight edge and one wavy edge, stitch markers at the row ends and a straight guide line',
    draw: (p) => {
      const clip = id('ed');
      let rows = '';
      for (let y = 150; y < 560; y += 32) rows += `<path d="M380 ${y} L860 ${y}" stroke="${p.light}" stroke-opacity=".35" stroke-width="5"/>`;
      const wavy = 'M420 130 L780 130 C820 200 740 250 790 320 C840 390 750 450 800 540 L800 560 L420 560 Z';
      return `<clipPath id="${clip}"><path d="${wavy}"/></clipPath><path d="${wavy}" fill="${p.main}"/>
        <g clip-path="url(#${clip})">${rows}</g>
        <path d="M880 110 L880 580" stroke="${p.dark}" stroke-width="5" stroke-dasharray="14 12"/>
        ${[166, 262, 358, 454].map((y, i) => `<path d="M410 ${y} a14 14 0 1 1 0 28 l-4 18" fill="none" stroke="${i % 2 ? p.accent : p.light}" stroke-width="7" stroke-linecap="round"/>`).join('')}`;
    },
  },
  'yarn-label': {
    palette: 'terracotta',
    alt: 'Illustration of a skein of yarn wrapped in a paper label showing care symbols',
    draw: (p) => {
      let twists = '';
      for (let x = 320; x <= 880; x += 26) twists += `<path d="M${x} 250 q20 90 0 180" fill="none" stroke="${p.dark}" stroke-opacity=".2" stroke-width="6"/>`;
      return `<rect x="290" y="240" width="620" height="200" rx="100" fill="${p.main}"/>${twists}
        <rect x="500" y="215" width="200" height="250" rx="12" fill="${p.light}"/>
        <rect x="525" y="245" width="150" height="14" rx="7" fill="${p.soft}"/><rect x="525" y="272" width="110" height="12" rx="6" fill="${p.soft}"/>
        <path d="M530 330 l40 0 l-6 32 l-28 0 z" fill="none" stroke="${p.dark}" stroke-width="5"/>
        <path d="M600 365 l20 -36 l20 36 z" fill="none" stroke="${p.dark}" stroke-width="5"/>
        <rect x="652" y="330" width="34" height="34" fill="none" stroke="${p.dark}" stroke-width="5"/><circle cx="669" cy="347" r="10" fill="none" stroke="${p.dark}" stroke-width="4"/>
        <rect x="525" y="395" width="150" height="12" rx="6" fill="${p.accent}"/><rect x="525" y="420" width="90" height="12" rx="6" fill="${p.soft}"/>`;
    },
  },
  scarf: {
    palette: 'blue',
    alt: 'Illustration of a ribbed crocheted scarf draped in an S-curve with fringe at both ends',
    draw: (p) => {
      const d = 'M230 170 C520 120 520 330 640 360 C780 395 760 560 990 520';
      let fringe = '';
      for (let i = -3; i <= 3; i++) {
        fringe += `<path d="M${215 + i * 3} ${170 + i * 17} l-70 ${i * 4}" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>`;
        fringe += `<path d="M${1000 + i * 3} ${520 + i * 17} l70 ${i * 6}" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>`;
      }
      return `${fringe}<path d="${d}" fill="none" stroke="${p.main}" stroke-width="130"/>
        <path d="${d}" fill="none" stroke="${p.dark}" stroke-opacity=".18" stroke-width="130" stroke-dasharray="5 17"/>
        <path d="${d}" fill="none" stroke="${p.light}" stroke-opacity=".18" stroke-width="130" stroke-dasharray="3 19" stroke-dashoffset="9"/>`;
    },
  },
  flower: {
    palette: 'rose',
    alt: 'Illustration of three crocheted five-petal flowers in pink, mustard and cream with green leaves',
    draw: (p) => {
      const flower = (cx: number, cy: number, r: number, petal: string, centre: string) => {
        let out = '';
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
          const x = cx + Math.cos(a) * r * 0.62;
          const y = cy + Math.sin(a) * r * 0.62;
          out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.46).toFixed(1)}" ry="${(r * 0.36).toFixed(1)}" fill="${petal}" stroke="${p.dark}" stroke-opacity=".18" stroke-width="4" transform="rotate(${((a * 180) / Math.PI + 90).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
        }
        return out + `<circle cx="${cx}" cy="${cy}" r="${(r * 0.32).toFixed(1)}" fill="${centre}"/><circle cx="${cx}" cy="${cy}" r="${(r * 0.32).toFixed(1)}" fill="none" stroke="${p.light}" stroke-width="3" stroke-dasharray="4 6"/>`;
      };
      const leaf = (x: number, y: number, rot: number) =>
        `<path d="M0 0 C40 -40 110 -30 140 0 C110 30 40 40 0 0 Z" fill="${p.accent}" transform="translate(${x} ${y}) rotate(${rot})"/>`;
      return leaf(520, 430, 150) + leaf(700, 300, -20) + leaf(820, 470, 20) +
        flower(470, 300, 150, p.main, '#e8b86f') + flower(760, 390, 120, '#e8b86f', p.main) + flower(600, 520, 90, p.light, p.accent);
    },
  },
  blanket: {
    palette: 'sage',
    alt: 'Illustration of a folded crocheted blanket with colourful stripes and a ball of yarn beside it',
    draw: (p) => {
      const colors = [p.main, p.light, p.accent, '#c4664b', p.main, p.light];
      let out = '';
      colors.forEach((c, i) => {
        out += `<rect x="330" y="${200 + i * 55}" width="460" height="55" fill="${c}"/>`;
        for (let x = 345; x < 790; x += 24) out += `<path d="M${x} ${210 + i * 55} l8 18 l8 -18" fill="none" stroke="${p.dark}" stroke-opacity=".15" stroke-width="3"/>`;
      });
      out += `<rect x="330" y="200" width="460" height="330" rx="10" fill="none" stroke="${p.dark}" stroke-opacity=".25" stroke-width="5"/>`;
      out += `<path d="M330 530 q-20 20 0 40 h460 q20 -20 0 -40" fill="${p.soft}"/>`;
      return out + yarnBall(910, 470, 80, '#c4664b', p.dark, p.light);
    },
  },
  hat: {
    palette: 'blue',
    alt: 'Illustration of a ribbed crocheted beanie hat with a fluffy pom-pom',
    draw: (p) => {
      const clip = id('hat');
      let ribs = '';
      for (let x = 400; x <= 800; x += 22) ribs += `<path d="M${x} 210 L${x} 470" stroke="${p.dark}" stroke-opacity=".15" stroke-width="7"/>`;
      return `<clipPath id="${clip}"><path d="M400 470 C400 250 800 250 800 470 Z"/></clipPath>
        <path d="M400 470 C400 250 800 250 800 470 Z" fill="${p.main}"/><g clip-path="url(#${clip})">${ribs}</g>
        <rect x="380" y="440" width="440" height="90" rx="20" fill="${p.accent}"/>
        ${[400, 430, 460, 490, 520, 550, 580, 610, 640, 670, 700, 730, 760, 790].map((x) => `<path d="M${x} 450 l0 70" stroke="${p.dark}" stroke-opacity=".18" stroke-width="5"/>`).join('')}
        <circle cx="600" cy="268" r="62" fill="${p.light}"/>
        ${[0, 40, 80, 120, 160, 200, 240, 280, 320].map((d) => `<path d="M600 268 l${(Math.cos((d * Math.PI) / 180) * 58).toFixed(1)} ${(Math.sin((d * Math.PI) / 180) * 58).toFixed(1)}" stroke="${p.soft}" stroke-width="5"/>`).join('')}`;
    },
  },
  amigurumi: {
    palette: 'mustard',
    alt: 'Illustration of a small round crocheted amigurumi bear with embroidered eyes',
    draw: (p) => {
      const body = '#c98a4b';
      return `<ellipse cx="600" cy="470" rx="150" ry="120" fill="${body}"/>
        <circle cx="490" cy="230" r="55" fill="${body}"/><circle cx="710" cy="230" r="55" fill="${body}"/>
        <circle cx="490" cy="230" r="28" fill="${p.light}"/><circle cx="710" cy="230" r="28" fill="${p.light}"/>
        <circle cx="600" cy="320" r="135" fill="${body}"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${490 + i * 44} 220 q0 200 0 210" stroke="${p.dark}" stroke-opacity=".08" stroke-width="5" fill="none"/>`).join('')}
        <ellipse cx="600" cy="360" rx="58" ry="42" fill="${p.light}"/>
        <path d="M585 345 l15 12 l15 -12" fill="none" stroke="${p.dark}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M555 300 l20 0 M625 300 l20 0" stroke="${p.dark}" stroke-width="9" stroke-linecap="round"/>
        <ellipse cx="600" cy="500" rx="70" ry="55" fill="${p.light}" opacity=".7"/>`;
    },
  },
};

export const COVER_MOTIFS = Object.keys(MOTIFS);

export function coverAlt(motif: string): string {
  return MOTIFS[motif]?.alt ?? 'Decorative illustration of yarn and a crochet hook';
}

export function coverSvg(motif: string, paletteName?: string): string {
  const m = MOTIFS[motif] ?? MOTIFS['yarn-hook'];
  const p = PALETTES[paletteName ?? m.palette] ?? PALETTES[m.palette];
  uid = 0;
  const dots = id('dots');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><pattern id="${dots}" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.8" fill="${p.soft}"/></pattern></defs>
<rect width="${W}" height="${H}" fill="${p.bg}"/>
<rect width="${W}" height="${H}" fill="url(#${dots})" opacity=".7"/>
<circle cx="1070" cy="110" r="150" fill="${p.light}" opacity=".5"/>
<circle cx="130" cy="575" r="175" fill="${p.light}" opacity=".45"/>
${m.draw(p)}
<rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="26" fill="none" stroke="${p.dark}" stroke-opacity=".22" stroke-width="3" stroke-dasharray="14 10"/>
</svg>`;
}
