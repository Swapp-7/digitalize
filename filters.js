/* ============================================================
   DIGITALIZE — filters.js
   ============================================================ */

'use strict';

// ── Bayer ordered-dither matrices ─────────────────────────

const BAYER = {
  2: [
    [ 0,  2],
    [ 3,  1],
  ],
  4: [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5],
  ],
  8: [
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ],
};

const BAYER_NORM = {};
for (const [n, mat] of Object.entries(BAYER)) {
  const size = n * n;
  BAYER_NORM[n] = mat.map(row => row.map(v => (v / size) * 255));
}

// ── Color helper ──────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function lcgRand(seed) {
  let s = seed | 0;
  return function() {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

// ── Error diffusion kernels ───────────────────────────────

const KERNELS = {
  'atkinson': {
    divisor: 8,
    spread: [
      [ 1, 0, 1], [ 2, 0, 1],
      [-1, 1, 1], [ 0, 1, 1], [ 1, 1, 1],
                  [ 0, 2, 1],
    ],
  },
  'floyd-steinberg': {
    divisor: 16,
    spread: [
      [ 1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
  'jjn': {
    divisor: 48,
    spread: [
                               [ 1, 0, 7], [ 2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [ 0, 1, 7], [ 1, 1, 5], [ 2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [ 0, 2, 5], [ 1, 2, 3], [ 2, 2, 1],
    ],
  },
  'stucki': {
    divisor: 42,
    spread: [
                               [ 1, 0, 8], [ 2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [ 0, 1, 8], [ 1, 1, 4], [ 2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [ 0, 2, 4], [ 1, 2, 2], [ 2, 2, 1],
    ],
  },
  'sierra': {
    divisor: 32,
    spread: [
                               [ 1, 0, 5], [ 2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [ 0, 1, 5], [ 1, 1, 4], [ 2, 1, 2],
                  [-1, 2, 2], [ 0, 2, 3], [ 1, 2, 2],
    ],
  },
  'burkes': {
    divisor: 32,
    spread: [
                               [ 1, 0, 8], [ 2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [ 0, 1, 8], [ 1, 1, 4], [ 2, 1, 2],
    ],
  },
};

// ── Pixel-level: Ostromoukhov (adaptive error diffusion) ──

function runOstromoukhov(canvas, ctx, threshold, dark, light) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  const buf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    buf[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = buf[idx];
      const nw  = old >= threshold ? 255 : 0;
      const err = old - nw;
      buf[idx]  = nw;
      let c0, c1, c2, div;
      if      (old < 85)  { c0 = 5; c1 = 3; c2 = 2; div = 10; }
      else if (old < 171) { c0 = 3; c1 = 3; c2 = 2; div = 8;  }
      else                { c0 = 2; c1 = 3; c2 = 5; div = 10; }
      if (x + 1 < W)               buf[idx + 1]     += err * c0 / div;
      if (y + 1 < H) {
        if (x - 1 >= 0)             buf[idx + W - 1] += err * c1 / div;
                                    buf[idx + W]     += err * c2 / div;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const col = buf[i] > 127 ? light : dark;
    d[i * 4]     = col.r;
    d[i * 4 + 1] = col.g;
    d[i * 4 + 2] = col.b;
  }
  ctx.putImageData(id, 0, 0);
}

// ── Pixel-level: error diffusion ──────────────────────────

function runErrorDiffusion(canvas, ctx, threshold, kernelName, dark, light) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;
  const { divisor, spread } = KERNELS[kernelName];

  const buf = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    buf[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = buf[idx];
      const nw  = old >= threshold ? 255 : 0;
      const err = old - nw;
      buf[idx]  = nw;
      for (const [dx, dy, w] of spread) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
          buf[ny * W + nx] += (err * w) / divisor;
        }
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const col = buf[i] > 127 ? light : dark;
    d[i * 4]     = col.r;
    d[i * 4 + 1] = col.g;
    d[i * 4 + 2] = col.b;
  }
  ctx.putImageData(id, 0, 0);
}

// ── Pixel-level: Bayer + Random ───────────────────────────

function runPixelDither(canvas, ctx, threshold, algo, dark, light) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  if (algo.startsWith('bayer')) {
    const n    = parseInt(algo.replace('bayer', ''), 10);
    const mat  = BAYER_NORM[n];
    const bias = threshold - 128;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i   = (y * W + x) * 4;
        const lum = luma(d[i], d[i + 1], d[i + 2]);
        const col = lum + bias > mat[y % n][x % n] ? light : dark;
        d[i]     = col.r;
        d[i + 1] = col.g;
        d[i + 2] = col.b;
      }
    }
  } else if (algo === 'random') {
    for (let i = 0; i < d.length; i += 4) {
      const lum = luma(d[i], d[i + 1], d[i + 2]);
      const col = lum + (Math.random() - 0.5) * 128 > threshold ? light : dark;
      d[i]     = col.r;
      d[i + 1] = col.g;
      d[i + 2] = col.b;
    }
  }
  ctx.putImageData(id, 0, 0);
}

// ── Dot shape filler ──────────────────────────────────────
// Fills one block cell (ox, oy, size×size) with a given shape in black.

function fillDot(d, W, H, ox, oy, size, shape, dark) {
  const half = size / 2;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = ox + dx, py = oy + dy;
      if (px >= W || py >= H) continue;

      // Offset from the block center (sub-pixel precision)
      const fx = dx - half + 0.5;
      const fy = dy - half + 0.5;

      let fill = false;
      switch (shape) {
        case 'square':
          fill = true;
          break;
        case 'circle':
          fill = fx * fx + fy * fy <= half * half;
          break;
        case 'diamond':
          fill = Math.abs(fx) + Math.abs(fy) <= half;
          break;
        case 'cross': {
          const arm = Math.max(0.5, half * 0.35);
          fill = Math.abs(fx) <= arm || Math.abs(fy) <= arm;
          break;
        }
      }

      if (fill) {
        const i = (py * W + px) * 4;
        d[i]     = dark.r;
        d[i + 1] = dark.g;
        d[i + 2] = dark.b;
      }
    }
  }
}

// ── Block-level dithering ─────────────────────────────────
// Downsamples to (W/dotSize × H/dotSize) blocks, applies any dithering
// algorithm at that resolution, then renders each "pixel" as a dot shape.

function runBlockDither(canvas, ctx, threshold, algo, dotSize, dotShape, dark, light) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  const bW = Math.ceil(W / dotSize);
  const bH = Math.ceil(H / dotSize);

  // 1. Average luminance per block
  const buf = new Float32Array(bW * bH);
  for (let by = 0; by < bH; by++) {
    for (let bx = 0; bx < bW; bx++) {
      let sum = 0, count = 0;
      for (let dy = 0; dy < dotSize; dy++) {
        for (let dx = 0; dx < dotSize; dx++) {
          const px = bx * dotSize + dx, py = by * dotSize + dy;
          if (px < W && py < H) {
            const i = (py * W + px) * 4;
            sum += luma(d[i], d[i + 1], d[i + 2]);
            count++;
          }
        }
      }
      buf[by * bW + bx] = count ? sum / count : 0;
    }
  }

  // 2. Dither at block resolution
  if (algo in KERNELS) {
    const { divisor, spread } = KERNELS[algo];
    for (let by = 0; by < bH; by++) {
      for (let bx = 0; bx < bW; bx++) {
        const idx = by * bW + bx;
        const old = buf[idx];
        const nw  = old >= threshold ? 255 : 0;
        const err = old - nw;
        buf[idx]  = nw;
        for (const [dx, dy, w] of spread) {
          const nx = bx + dx, ny = by + dy;
          if (nx >= 0 && nx < bW && ny >= 0 && ny < bH) {
            buf[ny * bW + nx] += (err * w) / divisor;
          }
        }
      }
    }
  } else if (algo.startsWith('bayer')) {
    const n    = parseInt(algo.replace('bayer', ''), 10);
    const mat  = BAYER_NORM[n];
    const bias = threshold - 128;
    for (let by = 0; by < bH; by++) {
      for (let bx = 0; bx < bW; bx++) {
        const lum = buf[by * bW + bx];
        buf[by * bW + bx] = lum + bias > mat[by % n][bx % n] ? 255 : 0;
      }
    }
  } else if (algo === 'random') {
    for (let i = 0; i < bW * bH; i++) {
      buf[i] = buf[i] + (Math.random() - 0.5) * 128 > threshold ? 255 : 0;
    }
  } else if (algo === 'ostromoukhov') {
    for (let by = 0; by < bH; by++) {
      for (let bx = 0; bx < bW; bx++) {
        const idx = by * bW + bx;
        const old = buf[idx];
        const nw  = old >= threshold ? 255 : 0;
        const err = old - nw;
        buf[idx]  = nw;
        let c0, c1, c2, div;
        if      (old < 85)  { c0 = 5; c1 = 3; c2 = 2; div = 10; }
        else if (old < 171) { c0 = 3; c1 = 3; c2 = 2; div = 8;  }
        else                { c0 = 2; c1 = 3; c2 = 5; div = 10; }
        if (bx + 1 < bW)              buf[idx + 1]      += err * c0 / div;
        if (by + 1 < bH) {
          if (bx - 1 >= 0)            buf[idx + bW - 1] += err * c1 / div;
                                      buf[idx + bW]     += err * c2 / div;
        }
      }
    }
  }

  // 3. Clear to light color
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = light.r;
    d[i + 1] = light.g;
    d[i + 2] = light.b;
  }

  // 4. Draw a dot for each dark block
  for (let by = 0; by < bH; by++) {
    for (let bx = 0; bx < bW; bx++) {
      if (buf[by * bW + bx] <= 127) {
        fillDot(d, W, H, bx * dotSize, by * dotSize, dotSize, dotShape, dark);
      }
    }
  }

  ctx.putImageData(id, 0, 0);
}

// ── Filter definitions ────────────────────────────────────

window.FilterDefs = {

  dither: {
    label: 'Dither',
    controls: [
      {
        type: 'select', id: 'algo', label: 'ALGORITHM',
        default: 'atkinson',
        options: [
          { value: 'atkinson',        label: 'Atkinson' },
          { value: 'floyd-steinberg', label: 'Floyd-Steinberg' },
          { value: 'jjn',             label: 'Jarvis-Judice-Ninke' },
          { value: 'stucki',          label: 'Stucki' },
          { value: 'sierra',          label: 'Sierra' },
          { value: 'burkes',          label: 'Burkes' },
          { value: 'ostromoukhov',    label: 'Ostromoukhov' },
          { value: 'bayer2',          label: 'Bayer 2×2' },
          { value: 'bayer4',          label: 'Bayer 4×4' },
          { value: 'bayer8',          label: 'Bayer 8×8' },
          { value: 'random',          label: 'Random' },
        ],
      },
      {
        type: 'range', id: 'threshold',
        label: 'THRESHOLD', min: 0, max: 255, step: 1, default: 128,
      },
      {
        type: 'range', id: 'dotSize',
        label: 'DOT SIZE', min: 1, max: 24, step: 1, default: 1,
      },
      {
        type: 'select', id: 'dotShape', label: 'DOT SHAPE',
        default: 'square',
        options: [
          { value: 'square',  label: 'Square' },
          { value: 'circle',  label: 'Circle' },
          { value: 'diamond', label: 'Diamond' },
          { value: 'cross',   label: 'Cross' },
        ],
      },
      {
        type: 'color', id: 'darkColor',
        label: 'DARK COLOR', default: '#0d0d1a',
      },
      {
        type: 'color', id: 'lightColor',
        label: 'LIGHT COLOR', default: '#ff00ff',
      },
    ],

    apply(canvas, ctx, { algo, threshold, dotSize = 1, dotShape = 'square',
                         darkColor = '#0d0d1a', lightColor = '#ff00ff' }) {
      const dark  = hexToRgb(darkColor);
      const light = hexToRgb(lightColor);
      if (dotSize <= 1) {
        if (algo in KERNELS) {
          runErrorDiffusion(canvas, ctx, threshold, algo, dark, light);
        } else if (algo === 'ostromoukhov') {
          runOstromoukhov(canvas, ctx, threshold, dark, light);
        } else {
          runPixelDither(canvas, ctx, threshold, algo, dark, light);
        }
      } else {
        runBlockDither(canvas, ctx, threshold, algo, dotSize, dotShape, dark, light);
      }
    },
  },

};

// ── Glitch effect ─────────────────────────────────────────

function applyGlitch(canvas, ctx, { intensity, vhsSlices, seed }) {
  const W = canvas.width, H = canvas.height;
  const src = ctx.getImageData(0, 0, W, H);
  const sd  = src.data;

  const out = ctx.createImageData(W, H);
  const od  = out.data;

  // Pre-fill alpha channel
  for (let i = 3; i < od.length; i += 4) od[i] = 255;

  // ── RGB Split (Chromatic Aberration) ──────────────────────
  // R shifted RIGHT by `intensity` px, B shifted LEFT — clamped, no wrap
  const shift = Math.round(intensity);
  const rand = lcgRand(seed != null ? seed : 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dst  = (y * W + x) * 4;
      const srcR = (y * W + Math.min(W - 1, x + shift)) * 4;
      const srcG = (y * W + x) * 4;
      const srcB = (y * W + Math.max(0,     x - shift)) * 4;
      od[dst]     = sd[srcR];
      od[dst + 1] = sd[srcG + 1];
      od[dst + 2] = sd[srcB + 2];
    }
  }

  // ── VHS Block Shifting ────────────────────────────────────
  if (vhsSlices) {
    const sliceCount = 3 + Math.floor(rand() * 3); // 3–5 slices
    for (let s = 0; s < sliceCount; s++) {
      const sliceH  = 5  + Math.floor(rand() * 16); // 5–20px tall
      const startY  = Math.floor(rand() * (H - sliceH));
      const offsetX = Math.round((rand() * 60) - 30); // -30 to +30

      for (let y = startY; y < startY + sliceH && y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dst  = (y * W + x) * 4;
          const srcX = Math.max(0, Math.min(W - 1, x - offsetX));
          const si   = (y * W + srcX) * 4;
          od[dst]     = od[si];
          od[dst + 1] = od[si + 1];
          od[dst + 2] = od[si + 2];
        }
      }
    }
  }

  ctx.putImageData(out, 0, 0);
}

window.FilterDefs.glitch = {
  label: 'Glitch',
  reroll: true,
  controls: [
    {
      type: 'range', id: 'intensity',
      label: 'INTENSITY', min: 1, max: 50, step: 1, default: 10,
    },
    {
      type: 'toggle', id: 'vhsSlices',
      label: 'VHS SLICES', default: true,
    },
    {
      type: 'range', id: 'seed',
      label: 'SEED', min: 0, max: 65535, step: 1, default: 42,
    },
  ],
  apply(canvas, ctx, values) {
    applyGlitch(canvas, ctx, values);
  },
};

// ── Halftone ──────────────────────────────────────────────

let _halftoneTmp = null;
let _halftoneTmpW = 0, _halftoneTmpH = 0;

function getHalftoneCanvas(W, H) {
  if (!_halftoneTmp) _halftoneTmp = document.createElement('canvas');
  if (_halftoneTmpW !== W || _halftoneTmpH !== H) {
    _halftoneTmp.width = W; _halftoneTmp.height = H;
    _halftoneTmpW = W; _halftoneTmpH = H;
  }
  return _halftoneTmp;
}

function applyHalftone(canvas, ctx, { algo, cellSize, angle, invert, darkColor, lightColor }) {
  const W = canvas.width, H = canvas.height;
  const src = ctx.getImageData(0, 0, W, H);
  const sd  = src.data;

  const tmp = getHalftoneCanvas(W, H);
  const tc  = tmp.getContext('2d');

  tc.fillStyle = invert ? darkColor : lightColor;
  tc.fillRect(0, 0, W, H);
  tc.fillStyle = invert ? lightColor : darkColor;

  const rad  = (angle * Math.PI) / 180;
  const cos  = Math.cos(rad), sin = Math.sin(rad);
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const cx   = W / 2, cy = H / 2;
  const half = Math.floor(cellSize / 2);

  for (let gy = -diag; gy <= diag; gy += cellSize) {
    for (let gx = -diag; gx <= diag; gx += cellSize) {
      const px = cx + gx * cos - gy * sin;
      const py = cy + gx * sin + gy * cos;
      if (px < -cellSize || px > W + cellSize || py < -cellSize || py > H + cellSize) continue;

      // Average luminance of source pixels around cell center
      let sum = 0, count = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const sx = Math.round(px + dx), sy = Math.round(py + dy);
          if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
            const i = (sy * W + sx) * 4;
            sum += luma(sd[i], sd[i + 1], sd[i + 2]);
            count++;
          }
        }
      }
      const lum  = count ? sum / count : 0;
      const t    = invert ? lum / 255 : 1 - lum / 255;
      const r    = t * cellSize * 0.5 * 0.92;
      if (r < 0.5) continue;

      tc.save();
      tc.translate(px, py);
      if (algo === 'circles') {
        tc.beginPath();
        tc.arc(0, 0, r, 0, Math.PI * 2);
        tc.fill();
      } else if (algo === 'lines') {
        tc.fillRect(-cellSize * 0.5, -r, cellSize, r * 2);
      } else if (algo === 'crosses') {
        const arm = r, thick = Math.max(1, r * 0.3);
        tc.fillRect(-arm, -thick, arm * 2, thick * 2);
        tc.fillRect(-thick, -arm, thick * 2, arm * 2);
      }
      tc.restore();
    }
  }

  ctx.drawImage(tmp, 0, 0);
}

window.FilterDefs.halftone = {
  label: 'Halftone',
  controls: [
    {
      type: 'select', id: 'algo', label: 'SHAPE',
      default: 'circles',
      options: [
        { value: 'circles', label: 'Circles' },
        { value: 'lines',   label: 'Lines' },
        { value: 'crosses', label: 'Crosses' },
      ],
    },
    { type: 'range',  id: 'cellSize', label: 'CELL SIZE', min: 4,  max: 32,  step: 1,   default: 10  },
    { type: 'range',  id: 'angle',    label: 'ANGLE',     min: 0,  max: 90,  step: 1,   default: 45  },
    { type: 'toggle', id: 'invert',   label: 'INVERT',    default: false },
    { type: 'color',  id: 'darkColor',  label: 'DARK COLOR',  default: '#0d0d1a' },
    { type: 'color',  id: 'lightColor', label: 'LIGHT COLOR', default: '#ff00ff' },
  ],
  apply(canvas, ctx, values) {
    applyHalftone(canvas, ctx, values);
  },
};

// ── Post-FX ───────────────────────────────────────────────

function boxBlurPass(src, W, H, radius, horizontal) {
  const dst = new Uint8ClampedArray(src.length);
  const r     = Math.round(radius);
  const count = 2 * r + 1;

  if (horizontal) {
    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      let rr = 0, gg = 0, bb = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.max(0, Math.min(W - 1, k));
        const i  = (rowOff + sx) * 4;
        rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
      }
      for (let x = 0; x < W; x++) {
        const i    = (rowOff + x) * 4;
        dst[i]     = rr / count;
        dst[i + 1] = gg / count;
        dst[i + 2] = bb / count;
        dst[i + 3] = src[i + 3];
        const removeX = Math.max(0, x - r);
        const addX    = Math.min(W - 1, x + r + 1);
        const ri = (rowOff + removeX) * 4;
        const ai = (rowOff + addX)    * 4;
        rr += src[ai] - src[ri];
        gg += src[ai + 1] - src[ri + 1];
        bb += src[ai + 2] - src[ri + 2];
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      let rr = 0, gg = 0, bb = 0;
      for (let k = -r; k <= r; k++) {
        const sy = Math.max(0, Math.min(H - 1, k));
        const i  = (sy * W + x) * 4;
        rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
      }
      for (let y = 0; y < H; y++) {
        const i    = (y * W + x) * 4;
        dst[i]     = rr / count;
        dst[i + 1] = gg / count;
        dst[i + 2] = bb / count;
        dst[i + 3] = src[i + 3];
        const removeY = Math.max(0, y - r);
        const addY    = Math.min(H - 1, y + r + 1);
        const ri = (removeY * W + x) * 4;
        const ai = (addY    * W + x) * 4;
        rr += src[ai] - src[ri];
        gg += src[ai + 1] - src[ri + 1];
        bb += src[ai + 2] - src[ri + 2];
      }
    }
  }
  return dst;
}

function boxBlur(data, W, H, radius) {
  let d = boxBlurPass(data, W, H, radius, true);
  d     = boxBlurPass(d,    W, H, radius, false);
  return d;
}

function applySharpen(data, W, H, amount) {
  const src = new Uint8ClampedArray(data);
  const t   = amount / 100;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i   = (y * W + x) * 4;
      const yn1 = Math.max(0,     y - 1), yp1 = Math.min(H - 1, y + 1);
      const xn1 = Math.max(0,     x - 1), xp1 = Math.min(W - 1, x + 1);
      for (let c = 0; c < 3; c++) {
        const center = src[i + c];
        // kernel: [0,-1,0,-1,5,-1,0,-1,0]
        const conv = 5 * center
          - src[(yn1 * W + x)  * 4 + c]
          - src[(y   * W + xn1)* 4 + c]
          - src[(y   * W + xp1)* 4 + c]
          - src[(yp1 * W + x)  * 4 + c];
        data[i + c] = Math.max(0, Math.min(255, Math.round(center + t * (conv - center))));
      }
    }
  }
}

function applyGlowFx(data, W, H, intensity, threshold) {
  const bright = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    // Only extract bright from opaque pixels — avoids halo from removed background
    if (data[i + 3] > 0) {
      const lum = luma(data[i], data[i + 1], data[i + 2]);
      if (lum > threshold) {
        bright[i] = data[i]; bright[i + 1] = data[i + 1]; bright[i + 2] = data[i + 2];
      }
    }
    bright[i + 3] = 255;
  }
  const blurR = Math.max(1, Math.round(intensity * 0.6));
  let blurred = bright;
  for (let p = 0; p < 3; p++) {
    blurred = boxBlurPass(blurred, W, H, blurR, true);
    blurred = boxBlurPass(blurred, W, H, blurR, false);
  }
  const scale = intensity / 15;
  for (let i = 0; i < data.length; i += 4) {
    const glowR = Math.min(255, blurred[i]     * scale);
    const glowG = Math.min(255, blurred[i + 1] * scale);
    const glowB = Math.min(255, blurred[i + 2] * scale);
    if (data[i + 3] > 0) {
      // Opaque pixel: add glow to existing RGB
      data[i]     = Math.min(255, data[i]     + glowR);
      data[i + 1] = Math.min(255, data[i + 1] + glowG);
      data[i + 2] = Math.min(255, data[i + 2] + glowB);
    } else {
      // Transparent pixel: let glow bleed in, alpha proportional to glow strength
      const glowAlpha = Math.min(255, Math.max(glowR, glowG, glowB));
      if (glowAlpha > 0) {
        data[i]     = glowR;
        data[i + 1] = glowG;
        data[i + 2] = glowB;
        data[i + 3] = glowAlpha;
      }
    }
  }
}

function applyPostFx(canvas, ctx, {
  blurEnabled, blurRadius,
  sharpenEnabled, sharpenAmount,
  glowEnabled, glowIntensity, glowThreshold,
}) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  let   d  = id.data;

  // Order: Blur → Sharpen → Glow
  if (blurEnabled) {
    const blurred = boxBlur(d, W, H, blurRadius);
    d.set(blurred);
  }
  if (sharpenEnabled) {
    applySharpen(d, W, H, sharpenAmount);
  }
  if (glowEnabled) {
    applyGlowFx(d, W, H, glowIntensity, glowThreshold);
  }

  ctx.putImageData(id, 0, 0);
}

window.FilterDefs.postfx = {
  label: 'Post-FX',
  controls: [
    { type: 'toggle', id: 'blurEnabled',    label: 'BLUR',           default: false },
    { type: 'range',  id: 'blurRadius',     label: 'BLUR RADIUS',    min: 1, max: 20, step: 1, default: 3 },
    { type: 'toggle', id: 'sharpenEnabled', label: 'SHARPEN',        default: false },
    { type: 'range',  id: 'sharpenAmount',  label: 'SHARPEN AMOUNT', min: 0, max: 200, step: 1, default: 100 },
    { type: 'toggle', id: 'glowEnabled',    label: 'GLOW',           default: false },
    { type: 'range',  id: 'glowIntensity',  label: 'GLOW INTENSITY', min: 1, max: 30, step: 1, default: 10 },
    { type: 'range',  id: 'glowThreshold',  label: 'GLOW THRESHOLD', min: 0, max: 255, step: 1, default: 180 },
  ],
  apply(canvas, ctx, values) {
    applyPostFx(canvas, ctx, values);
  },
};

// ── Palette / Color Quantization ──────────────────────────

const PALETTE_PRESETS = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  cga:     ['#000000', '#5555ff', '#ff55ff', '#ffffff'],
  pico8:   [
    '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8',
    '#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa',
  ],
  c64: [
    '#000000','#ffffff','#880000','#aaffee','#cc44cc','#00cc55','#0000aa','#eeee77',
    '#dd8855','#664400','#ff7777','#333333','#777777','#aaff66','#0088ff','#bbbbbb',
  ],
};

function nearestColor(r, g, b, palette) {
  let minDist = Infinity, best = palette[0];
  for (const [pr, pg, pb] of palette) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < minDist) { minDist = d; best = [pr, pg, pb]; }
  }
  return best;
}

function applyPalette(canvas, ctx, { mode, darkColor, lightColor, preset, customColors }) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  let palette;
  if (mode === 'monochrome') {
    palette = [[0, 0, 0], [255, 255, 255]];
  } else if (mode === '2-colors') {
    const dk = hexToRgb(darkColor),  lt = hexToRgb(lightColor);
    palette = [[dk.r, dk.g, dk.b], [lt.r, lt.g, lt.b]];
  } else if (mode === 'preset') {
    palette = (PALETTE_PRESETS[preset] || PALETTE_PRESETS.gameboy)
      .map(h => { const c = hexToRgb(h); return [c.r, c.g, c.b]; });
  } else { // custom
    const colors = (customColors && customColors.length) ? customColors : ['#000000', '#ffffff'];
    palette = colors.map(h => { const c = hexToRgb(h); return [c.r, c.g, c.b]; });
  }

  const cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    let entry = cache.get(key);
    if (!entry) { entry = nearestColor(d[i], d[i + 1], d[i + 2], palette); cache.set(key, entry); }
    d[i] = entry[0]; d[i + 1] = entry[1]; d[i + 2] = entry[2];
  }
  ctx.putImageData(id, 0, 0);
}

// Helper: standalone color picker row (used by palette buildBody)
function _colorPickerRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'filter-row filter-row--color';
  row.innerHTML = `
    <div class="filter-label-row">
      <label class="filter-label">${label}</label>
      <span class="filter-value-swatch" style="background:${value}"></span>
    </div>
    <input type="color" value="${value}" />
  `;
  row.querySelector('input').addEventListener('input', (e) => {
    row.querySelector('.filter-value-swatch').style.background = e.target.value;
    onChange(e.target.value);
  });
  return row;
}

window.FilterDefs.palette = {
  label: 'Palette',
  controls: [], // UI built via buildBody

  buildBody(body, item, triggerRun) {
    // Seed defaults
    if (!item.values.mode)         item.values.mode = 'monochrome';
    if (!item.values.darkColor)    item.values.darkColor  = '#000000';
    if (!item.values.lightColor)   item.values.lightColor = '#ffffff';
    if (!item.values.preset)       item.values.preset = 'gameboy';
    if (!item.values.customColors) item.values.customColors = ['#000000', '#ffffff'];

    body.innerHTML = '';

    // ── Mode select ──────────────────────────────────────
    const modeRow = document.createElement('div');
    modeRow.className = 'filter-row';
    const modeOpts = [
      ['monochrome', 'Monochrome'],
      ['2-colors',   '2 Colors'],
      ['custom',     'Custom Palette'],
      ['preset',     'Preset'],
    ].map(([v, l]) => `<option value="${v}"${item.values.mode === v ? ' selected' : ''}>${l}</option>`).join('');
    modeRow.innerHTML = `
      <div class="filter-label-row"><label class="filter-label">MODE</label></div>
      <select class="retro-select">${modeOpts}</select>
    `;
    modeRow.querySelector('select').addEventListener('change', (e) => {
      item.values.mode = e.target.value;
      this.buildBody(body, item, triggerRun);
      triggerRun();
    });
    body.appendChild(modeRow);

    // ── Mode-specific controls ───────────────────────────
    if (item.values.mode === '2-colors') {
      body.appendChild(_colorPickerRow('DARK COLOR',  item.values.darkColor,  v => { item.values.darkColor  = v; triggerRun(); }));
      body.appendChild(_colorPickerRow('LIGHT COLOR', item.values.lightColor, v => { item.values.lightColor = v; triggerRun(); }));

    } else if (item.values.mode === 'preset') {
      const presetRow = document.createElement('div');
      presetRow.className = 'filter-row';
      const presetOpts = [
        ['gameboy', 'Game Boy'],
        ['cga',     'CGA'],
        ['pico8',   'Pico-8'],
        ['c64',     'Commodore 64'],
      ].map(([v, l]) => `<option value="${v}"${item.values.preset === v ? ' selected' : ''}>${l}</option>`).join('');
      presetRow.innerHTML = `
        <div class="filter-label-row"><label class="filter-label">PRESET</label></div>
        <select class="retro-select">${presetOpts}</select>
      `;
      // Preview swatches
      const preview = document.createElement('div');
      preview.className = 'palette-preview';
      const renderPreview = (key) => {
        preview.innerHTML = '';
        (PALETTE_PRESETS[key] || []).forEach(hex => {
          const s = document.createElement('span');
          s.className = 'palette-preview__dot';
          s.style.background = hex;
          preview.appendChild(s);
        });
      };
      presetRow.querySelector('select').addEventListener('change', (e) => {
        item.values.preset = e.target.value;
        renderPreview(e.target.value);
        triggerRun();
      });
      renderPreview(item.values.preset);
      presetRow.appendChild(preview);
      body.appendChild(presetRow);

    } else if (item.values.mode === 'custom') {
      const editor = document.createElement('div');
      editor.className = 'filter-row palette-editor';
      editor.innerHTML = '<div class="filter-label-row"><label class="filter-label">COLORS</label></div>';

      const swatchGrid = document.createElement('div');
      swatchGrid.className = 'palette-swatches';

      const renderSwatches = () => {
        swatchGrid.innerHTML = '';
        item.values.customColors.forEach((hex, idx) => {
          const sw = document.createElement('div');
          sw.className = 'palette-swatch';
          sw.innerHTML = `<input type="color" value="${hex}" /><button class="palette-swatch__remove" title="Remove">×</button>`;
          sw.querySelector('input').addEventListener('input', (e) => {
            item.values.customColors[idx] = e.target.value;
            triggerRun();
          });
          sw.querySelector('button').addEventListener('click', () => {
            if (item.values.customColors.length > 1) {
              item.values.customColors.splice(idx, 1);
              renderSwatches();
              triggerRun();
            }
          });
          swatchGrid.appendChild(sw);
        });
      };

      renderSwatches();
      editor.appendChild(swatchGrid);

      if (item.values.customColors.length < 8) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-apply';
        addBtn.textContent = '+ ADD COLOR';
        addBtn.style.marginTop = '6px';
        addBtn.addEventListener('click', () => {
          item.values.customColors.push('#888888');
          renderSwatches();
          triggerRun();
        });
        editor.appendChild(addBtn);
      }
      body.appendChild(editor);
    }
  },

  apply(canvas, ctx, values) {
    applyPalette(canvas, ctx, values);
  },
};

// ── HSL helpers (used by Adjustments) ────────────────────

function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r:  h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g:  h = ((b - r) / d + 2) / 6;               break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function _hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q  = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p  = 2 * l - q;
  const ch = (t) => {
    const t1 = ((t % 1) + 1) % 1;
    if (t1 < 1/6) return p + (q - p) * 6 * t1;
    if (t1 < 1/2) return q;
    if (t1 < 2/3) return p + (q - p) * (2/3 - t1) * 6;
    return p;
  };
  return [Math.round(ch(h + 1/3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1/3) * 255)];
}

// ── Adjustments ───────────────────────────────────────────

function applyAdjustments(canvas, ctx, { brightness, contrast, saturation, hue }) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;
  const br = (brightness || 0) * 2.55;
  const ct = contrast || 0;
  const cr = ct !== 0 ? (259 * (ct + 255)) / (255 * (259 - ct)) : 1;
  const sf = (saturation || 0) / 100;
  const hr = (hue || 0) / 360;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i], g = d[i+1], b = d[i+2];

    if (brightness) {
      r = Math.max(0, Math.min(255, r + br));
      g = Math.max(0, Math.min(255, g + br));
      b = Math.max(0, Math.min(255, b + br));
    }
    if (ct) {
      r = Math.max(0, Math.min(255, cr * (r - 128) + 128));
      g = Math.max(0, Math.min(255, cr * (g - 128) + 128));
      b = Math.max(0, Math.min(255, cr * (b - 128) + 128));
    }
    if (saturation || hue) {
      const [h2, s, l] = _rgbToHsl(r, g, b);
      [r, g, b] = _hslToRgb((h2 + hr + 1) % 1, Math.max(0, Math.min(1, s + sf)), l);
    }
    d[i] = r; d[i+1] = g; d[i+2] = b;
  }
  ctx.putImageData(id, 0, 0);
}

window.FilterDefs.adjustments = {
  label: 'Adjustments',
  controls: [
    { type: 'range', id: 'brightness', label: 'BRIGHTNESS', min: -100, max: 100, step: 1, default: 0 },
    { type: 'range', id: 'contrast',   label: 'CONTRAST',   min: -100, max: 100, step: 1, default: 0 },
    { type: 'range', id: 'saturation', label: 'SATURATION', min: -100, max: 100, step: 1, default: 0 },
    { type: 'range', id: 'hue',        label: 'HUE ROTATE', min: 0,    max: 360, step: 1, default: 0 },
  ],
  apply(canvas, ctx, values) { applyAdjustments(canvas, ctx, values); },
};

// ── Threshold ─────────────────────────────────────────────

window.FilterDefs.threshold = {
  label: 'Threshold',
  controls: [
    { type: 'range', id: 'level',      label: 'LEVEL',       min: 0, max: 255, step: 1, default: 128 },
    { type: 'color', id: 'darkColor',  label: 'DARK COLOR',  default: '#000000' },
    { type: 'color', id: 'lightColor', label: 'LIGHT COLOR', default: '#ffffff' },
  ],
  apply(canvas, ctx, { level, darkColor, lightColor }) {
    const W = canvas.width, H = canvas.height;
    const id = ctx.getImageData(0, 0, W, H);
    const d  = id.data;
    const dk = hexToRgb(darkColor  || '#000000');
    const lt = hexToRgb(lightColor || '#ffffff');
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const col = luma(d[i], d[i+1], d[i+2]) >= level ? lt : dk;
      d[i] = col.r; d[i+1] = col.g; d[i+2] = col.b;
    }
    ctx.putImageData(id, 0, 0);
  },
};

// ── Posterize ─────────────────────────────────────────────

window.FilterDefs.posterize = {
  label: 'Posterize',
  controls: [
    { type: 'range', id: 'levels', label: 'LEVELS', min: 2, max: 16, step: 1, default: 4 },
  ],
  apply(canvas, ctx, { levels }) {
    const W = canvas.width, H = canvas.height;
    const id = ctx.getImageData(0, 0, W, H);
    const d  = id.data;
    const lvl  = Math.max(2, levels || 4);
    const step = 255 / (lvl - 1);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i]   = Math.round(Math.round(d[i]   / step) * step);
      d[i+1] = Math.round(Math.round(d[i+1] / step) * step);
      d[i+2] = Math.round(Math.round(d[i+2] / step) * step);
    }
    ctx.putImageData(id, 0, 0);
  },
};

// ── Duotone ───────────────────────────────────────────────

window.FilterDefs.duotone = {
  label: 'Duotone',
  controls: [
    { type: 'color', id: 'shadowColor',    label: 'SHADOWS',    default: '#1a0533' },
    { type: 'color', id: 'highlightColor', label: 'HIGHLIGHTS', default: '#ff6ec7' },
    { type: 'range', id: 'midpoint',       label: 'MIDPOINT',   min: 0, max: 255, step: 1, default: 128 },
  ],
  apply(canvas, ctx, { shadowColor, highlightColor, midpoint }) {
    const W = canvas.width, H = canvas.height;
    const id = ctx.getImageData(0, 0, W, H);
    const d  = id.data;
    const sh = hexToRgb(shadowColor    || '#1a0533');
    const hi = hexToRgb(highlightColor || '#ff6ec7');
    const mp = (midpoint || 128) / 255;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const raw = luma(d[i], d[i+1], d[i+2]) / 255;
      const t   = raw < mp
        ? (mp > 0 ? (raw / mp) * 0.5 : 0)
        : (mp < 1 ? 0.5 + ((raw - mp) / (1 - mp)) * 0.5 : 1);
      d[i]   = Math.round(sh.r + t * (hi.r - sh.r));
      d[i+1] = Math.round(sh.g + t * (hi.g - sh.g));
      d[i+2] = Math.round(sh.b + t * (hi.b - sh.b));
    }
    ctx.putImageData(id, 0, 0);
  },
};

// ── Remove Background ─────────────────────────────────────
// Flood-fills from the 4 corners and makes matching pixels transparent.

function applyRemoveBg(canvas, ctx, { autoDetect, bgColor, tolerance, softEdge }) {
  const W = canvas.width, H = canvas.height;
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  // Determine target BG color
  let tr, tg, tb;
  if (autoDetect !== false) {
    // Average of the 4 corner pixels
    const c0 = 0, c1 = (W - 1) * 4, c2 = (H - 1) * W * 4, c3 = ((H - 1) * W + W - 1) * 4;
    tr = Math.round((d[c0] + d[c1] + d[c2] + d[c3]) / 4);
    tg = Math.round((d[c0+1] + d[c1+1] + d[c2+1] + d[c3+1]) / 4);
    tb = Math.round((d[c0+2] + d[c1+2] + d[c2+2] + d[c3+2]) / 4);
  } else {
    const c = hexToRgb(bgColor);
    tr = c.r; tg = c.g; tb = c.b;
  }

  const colorDist = (r, g, b) => Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);

  // BFS flood fill from 4 corners
  const visited = new Uint8Array(W * H);
  const queue   = new Int32Array(W * H);
  let head = 0, tail = 0;

  for (const idx of [0, W - 1, (H - 1) * W, (H - 1) * W + W - 1]) {
    const i = idx * 4;
    if (d[i + 3] > 0 && colorDist(d[i], d[i + 1], d[i + 2]) <= tolerance && !visited[idx]) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  }

  while (head < tail) {
    const idx = queue[head++];
    d[idx * 4 + 3] = 0;
    const x = idx % W, y = (idx / W) | 0;
    const check = (n) => {
      if (!visited[n] && colorDist(d[n * 4], d[n * 4 + 1], d[n * 4 + 2]) <= tolerance) {
        visited[n] = 1; queue[tail++] = n;
      }
    };
    if (x > 0)   check(idx - 1);
    if (x < W-1) check(idx + 1);
    if (y > 0)   check(idx - W);
    if (y < H-1) check(idx + W);
  }

  // Soft edge: fade opaque pixels that are close to the BG color but outside tolerance
  if (softEdge) {
    const softTol = tolerance * 1.5;
    for (let i = 0; i < W * H; i++) {
      if (d[i * 4 + 3] > 0) {
        const dist = colorDist(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        if (dist > tolerance && dist < softTol) {
          const t = (dist - tolerance) / (softTol - tolerance);
          d[i * 4 + 3] = Math.round(t * 255);
        }
      }
    }
  }

  ctx.putImageData(id, 0, 0);
}

window.FilterDefs.removebg = {
  label: 'Remove BG',
  controls: [
    { type: 'toggle', id: 'autoDetect', label: 'AUTO-DETECT', default: true  },
    { type: 'color',  id: 'bgColor',    label: 'BG COLOR',    default: '#ffffff' },
    { type: 'range',  id: 'tolerance',  label: 'TOLERANCE',   min: 0, max: 150, step: 1, default: 30 },
    { type: 'toggle', id: 'softEdge',   label: 'SOFT EDGE',   default: false },
  ],
  apply(canvas, ctx, values) {
    applyRemoveBg(canvas, ctx, values);
  },
};

// ── ASCII Art ──────────────────────────────────────────────

const ASCII_CHARSETS = {
  classic: ' .:-=+*#%@',
  dense:   ' `.^,:;Il!i><~+_-?][}{1|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks:  ' ░▒▓█',
  binary:  ' 10',
};

function applyAsciiArt(canvas, ctx, { cellSize, charset, colored, invert, bgColor, fgColor }) {
  const W = canvas.width, H = canvas.height;
  const src = ctx.getImageData(0, 0, W, H);
  const sd  = src.data;

  const chars    = ASCII_CHARSETS[charset] || ASCII_CHARSETS.classic;
  const fontSize = Math.max(4, cellSize | 0);

  // Measure actual character width for this font/size
  ctx.font = `${fontSize}px monospace`;
  const charW = ctx.measureText('M').width;

  const cols = Math.ceil(W / charW);
  const rows = Math.ceil(H / fontSize);

  // Sample one block per character cell
  const blocks = new Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = Math.round(col * charW);
      const y0 = row * fontSize;
      const x1 = Math.min(W, Math.round((col + 1) * charW));
      const y1 = Math.min(H, y0 + fontSize);
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * W + px) * 4;
          rSum += sd[i]; gSum += sd[i + 1]; bSum += sd[i + 2];
          count++;
        }
      }
      const r = count ? rSum / count : 0;
      const g = count ? gSum / count : 0;
      const b = count ? bSum / count : 0;
      blocks[row * cols + col] = { r, g, b, lum: luma(r, g, b) };
    }
  }

  // Fill background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Draw characters
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { r, g, b, lum } = blocks[row * cols + col];
      // chars[0] = lightest (space), chars[last] = darkest
      // invert=false → dark image pixel → dense char (high idx)
      const t   = lum / 255;
      const idx = invert
        ? Math.min(chars.length - 1, Math.floor(t * chars.length))
        : Math.min(chars.length - 1, Math.floor((1 - t) * chars.length));
      const ch = chars[idx];
      if (ch === ' ') continue;
      ctx.fillStyle = colored
        ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
        : fgColor;
      ctx.fillText(ch, Math.round(col * charW), row * fontSize);
    }
  }
}

window.FilterDefs.ascii = {
  label: 'ASCII Art',
  controls: [
    {
      type: 'range', id: 'cellSize',
      label: 'CELL SIZE', min: 4, max: 24, step: 1, default: 10,
    },
    {
      type: 'select', id: 'charset', label: 'CHARSET',
      default: 'classic',
      options: [
        { value: 'classic', label: 'Classic' },
        { value: 'dense',   label: 'Dense' },
        { value: 'blocks',  label: 'Blocks' },
        { value: 'binary',  label: 'Binary' },
      ],
    },
    { type: 'toggle', id: 'colored', label: 'COLORED',    default: false },
    { type: 'toggle', id: 'invert',  label: 'INVERT',     default: false },
    { type: 'color',  id: 'bgColor', label: 'BG COLOR',   default: '#FDF7EE' },
    { type: 'color',  id: 'fgColor', label: 'TEXT COLOR', default: '#2A1500' },
  ],
  apply(canvas, ctx, values) {
    applyAsciiArt(canvas, ctx, values);
  },
};
