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
    buf[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
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
    buf[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
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
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const col = lum + bias > mat[y % n][x % n] ? light : dark;
        d[i]     = col.r;
        d[i + 1] = col.g;
        d[i + 2] = col.b;
      }
    }
  } else if (algo === 'random') {
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
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
            sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
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

function applyGlitch(canvas, ctx, { intensity, vhsSlices }) {
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
    const sliceCount = 3 + Math.floor(Math.random() * 3); // 3–5 slices
    for (let s = 0; s < sliceCount; s++) {
      const sliceH  = 5  + Math.floor(Math.random() * 16); // 5–20px tall
      const startY  = Math.floor(Math.random() * (H - sliceH));
      const offsetX = Math.round((Math.random() * 60) - 30); // -30 to +30

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
  ],
  apply(canvas, ctx, values) {
    applyGlitch(canvas, ctx, values);
  },
};

// ── Halftone ──────────────────────────────────────────────

function applyHalftone(canvas, ctx, { algo, cellSize, angle, invert, darkColor, lightColor }) {
  const W = canvas.width, H = canvas.height;
  const src = ctx.getImageData(0, 0, W, H);
  const sd  = src.data;

  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
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
            sum += 0.2126 * sd[i] + 0.7152 * sd[i + 1] + 0.0722 * sd[i + 2];
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
  const r   = Math.round(radius);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rr = 0, gg = 0, bb = 0;
      for (let k = -r; k <= r; k++) {
        const sx = horizontal ? Math.max(0, Math.min(W - 1, x + k)) : x;
        const sy = horizontal ? y : Math.max(0, Math.min(H - 1, y + k));
        const i  = (sy * W + sx) * 4;
        rr += src[i]; gg += src[i + 1]; bb += src[i + 2];
      }
      const count = 2 * r + 1;
      const i = (y * W + x) * 4;
      dst[i]     = rr / count;
      dst[i + 1] = gg / count;
      dst[i + 2] = bb / count;
      dst[i + 3] = src[i + 3];
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
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum > threshold) {
      bright[i] = data[i]; bright[i + 1] = data[i + 1]; bright[i + 2] = data[i + 2];
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
    data[i]     = Math.min(255, data[i]     + blurred[i]     * scale);
    data[i + 1] = Math.min(255, data[i + 1] + blurred[i + 1] * scale);
    data[i + 2] = Math.min(255, data[i + 2] + blurred[i + 2] * scale);
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

  for (let i = 0; i < d.length; i += 4) {
    const [nr, ng, nb] = nearestColor(d[i], d[i + 1], d[i + 2], palette);
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
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
