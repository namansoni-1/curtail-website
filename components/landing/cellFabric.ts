// The fabric: a dense field of independent cells that idle on their own
// quiet rhythm and can be made to snap into synchronized, single-color
// "claimed" formation. This is Curtail's signature visual language — every
// animated surface on the site (hero, architecture) is built from it.

export type Fabric = {
  cols: number;
  rows: number;
  pitch: number;
  count: number;
  seedA: Float32Array; // per-cell phase offset
  seedB: Float32Array; // per-cell frequency variance
  claim: Float32Array; // 0..1, persistent coordinated state
};

export function createFabric(width: number, height: number, pitch: number): Fabric {
  const cols = Math.max(1, Math.floor(width / pitch));
  const rows = Math.max(1, Math.floor(height / pitch));
  const count = cols * rows;
  const seedA = new Float32Array(count);
  const seedB = new Float32Array(count);
  const claim = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seedA[i] = Math.random() * Math.PI * 2;
    seedB[i] = 0.5 + Math.random() * 0.9;
  }
  return { cols, rows, pitch, count, seedA, seedB, claim };
}

export function cellPosition(fabric: Fabric, index: number) {
  const col = index % fabric.cols;
  const row = (index / fabric.cols) | 0;
  return {
    col,
    row,
    x: col * fabric.pitch + fabric.pitch / 2,
    y: row * fabric.pitch + fabric.pitch / 2,
  };
}

/** Independent idle brightness for a cell at time t, in [0, amplitude]. */
export function idleAt(fabric: Fabric, index: number, t: number, amplitude = 1): number {
  const wave = 0.5 + 0.5 * Math.sin(t * fabric.seedB[index] * 0.6 + fabric.seedA[index]);
  return wave * amplitude;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Exponential ease toward `target`, frame-rate independent. */
export function approach(current: number, target: number, rate: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const BUCKETS = 18;
const rampCache = new Map<string, string[]>();

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function ramp(hex: string, alphaMax: number) {
  const key = `${hex}:${alphaMax}`;
  const cached = rampCache.get(key);
  if (cached) return cached;
  const { r, g, b } = hexToRgb(hex);
  const built: string[] = [];
  for (let i = 0; i < BUCKETS; i++) {
    const a = (alphaMax * (i + 1)) / BUCKETS;
    built.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
  }
  rampCache.set(key, built);
  return built;
}

export type FabricPalette = {
  ink: string;
  signal: string;
  inkMax: number;
  gap: number;
};

/**
 * Draws one frame. Cells are bucketed by opacity into batched Path2D fills
 * (ink vs. claimed/signal) so thousands of cells cost a couple dozen canvas
 * draw calls instead of one per cell.
 */
export function drawFabric(
  ctx: CanvasRenderingContext2D,
  fabric: Fabric,
  idleValues: Float32Array,
  claimValues: Float32Array,
  palette: FabricPalette,
) {
  const inkRamp = ramp(palette.ink, palette.inkMax);
  const signalRamp = ramp(palette.signal, 1);
  const cellSize = fabric.pitch - palette.gap;

  const inkPaths: Path2D[] = new Array(BUCKETS);
  const signalPaths: Path2D[] = new Array(BUCKETS);
  for (let b = 0; b < BUCKETS; b++) {
    inkPaths[b] = new Path2D();
    signalPaths[b] = new Path2D();
  }

  for (let i = 0; i < fabric.count; i++) {
    const claim = claimValues[i];
    const col = i % fabric.cols;
    const row = (i / fabric.cols) | 0;
    const x = col * fabric.pitch;
    const y = row * fabric.pitch;

    if (claim > 0.04) {
      const bucket = Math.min(BUCKETS - 1, Math.floor(claim * BUCKETS));
      signalPaths[bucket].rect(x, y, cellSize, cellSize);
    } else {
      const idle = idleValues[i];
      if (idle <= 0.01) continue;
      const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(idle * BUCKETS)));
      inkPaths[bucket].rect(x, y, cellSize, cellSize);
    }
  }

  for (let b = 0; b < BUCKETS; b++) {
    ctx.fillStyle = inkRamp[b];
    ctx.fill(inkPaths[b]);
  }
  for (let b = 0; b < BUCKETS; b++) {
    ctx.fillStyle = signalRamp[b];
    ctx.fill(signalPaths[b]);
  }
}
