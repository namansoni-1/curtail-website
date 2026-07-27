"use client";

import { useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";
import {
  approach,
  cellPosition,
  createFabric,
  drawFabric,
  idleAt,
  setupCanvas,
  type Fabric,
} from "./cellFabric";

// Logical layout space. The container is locked to this aspect ratio, so
// these coordinates convert to real pixels by a single uniform scale.
const SPACE_W = 800;
const SPACE_H = 860;
const PITCH = 10;
const GAP = 3;
const IDLE_AMPLITUDE = 0.55;
const INK_MAX = 0.1;
const CONNECTOR_REACH = 15;
const BACKGROUND_PRESENCE = 0.05;
const CONNECTOR_PRESENCE = 0.4;

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Point = { x: number; y: number };

type ClusterDef = { key: string; rect: Rect; label: string };

const CLUSTERS: ClusterDef[] = [
  { key: "grid", rect: { x0: 300, y0: 40, x1: 500, y1: 120 }, label: "Grid" },
  { key: "operator", rect: { x0: 280, y0: 210, x1: 520, y1: 300 }, label: "Operator" },
  { key: "tenantA", rect: { x0: 60, y0: 390, x1: 260, y1: 470 }, label: "Tenant A" },
  { key: "tenantB", rect: { x0: 300, y0: 390, x1: 500, y1: 470 }, label: "Tenant B" },
  { key: "tenantC", rect: { x0: 540, y0: 390, x1: 740, y1: 470 }, label: "Tenant C" },
  { key: "capacity", rect: { x0: 220, y0: 560, x1: 580, y1: 680 }, label: "Committed capacity" },
];

type ConnectorDef = { key: string; points: Point[]; window: [number, number] };

const CONNECTORS: ConnectorDef[] = [
  { key: "grid-operator", points: [{ x: 400, y: 120 }, { x: 400, y: 210 }], window: [1.55, 2.05] },
  {
    key: "operator-a",
    points: [{ x: 400, y: 300 }, { x: 400, y: 345 }, { x: 160, y: 345 }, { x: 160, y: 390 }],
    window: [2.4, 2.95],
  },
  { key: "operator-b", points: [{ x: 400, y: 300 }, { x: 400, y: 390 }], window: [2.4, 2.95] },
  {
    key: "operator-c",
    points: [{ x: 400, y: 300 }, { x: 400, y: 345 }, { x: 640, y: 345 }, { x: 640, y: 390 }],
    window: [2.4, 2.95],
  },
  {
    key: "a-capacity",
    points: [{ x: 160, y: 470 }, { x: 160, y: 515 }, { x: 400, y: 515 }, { x: 400, y: 560 }],
    window: [4.2, 4.6],
  },
  { key: "b-capacity", points: [{ x: 400, y: 470 }, { x: 400, y: 560 }], window: [4.2, 4.6] },
  {
    key: "c-capacity",
    points: [{ x: 640, y: 470 }, { x: 640, y: 515 }, { x: 400, y: 515 }, { x: 400, y: 560 }],
    window: [4.2, 4.6],
  },
];

const GRID_WINDOW: [number, number] = [1.2, 1.7];
const OPERATOR_WINDOW: [number, number] = [2.05, 2.55];
const TENANT_WINDOW: [number, number] = [2.95, 4.35];
const CAPACITY_WINDOW: [number, number] = [4.55, 5.35];
const CAPACITY_MAX = 0.82;

export const ARCHITECTURE_STAGES = [
  { at: GRID_WINDOW[0], text: "Grid signal received" },
  { at: GRID_WINDOW[1] + 0.05, text: "Curtail checks tenant permissions" },
  { at: OPERATOR_WINDOW[0], text: "Finds available flexible capacity" },
  { at: OPERATOR_WINDOW[1] + 0.05, text: "Verifies available MW" },
  { at: TENANT_WINDOW[0], text: "Dispatches participating tenants" },
  { at: CAPACITY_WINDOW[0], text: "Operator commits verified capacity" },
];

export const ARCHITECTURE_CLUSTERS = CLUSTERS;
export const ARCHITECTURE_SPACE = { w: SPACE_W, h: SPACE_H };

function pulse(age: number, [start, end]: [number, number]) {
  if (age < start || age > end) return 0;
  const p = (age - start) / (end - start);
  const rise = Math.min(1, p / 0.3);
  const fall = Math.min(1, (1 - p) / 0.3);
  return Math.min(rise, fall);
}

function projectToSegment(p: Point, a: Point, b: Point) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby || 1;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return { t, dist: Math.hypot(p.x - projX, p.y - projY) };
}

function nearestProgress(point: Point, points: Point[], maxDist: number) {
  let best: { progress: number; dist: number } | null = null;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const { t, dist } = projectToSegment(point, a, b);
    if (dist <= maxDist && (!best || dist < best.dist)) {
      best = { progress: (acc + t * segLen) / total, dist };
    }
    acc += segLen;
  }
  return best;
}

type ConnectorMatch = { index: number; progress: number; falloff: number };

const TOTAL_AGE = 5.6;

export function ArchitectureField({
  onStage,
  scrollProgress,
}: {
  onStage?: (index: number) => void;
  scrollProgress: MotionValue<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let ctx: CanvasRenderingContext2D | null = null;
    let fabric: Fabric | null = null;
    let idleValues: Float32Array | null = null;
    let revealDelay: Float32Array | null = null;
    let clusterOf: Int8Array | null = null;
    let tenantEligible: Uint8Array | null = null;
    let fillOrder: Float32Array | null = null;
    let connectorMatches: ConnectorMatch[][] = [];
    let target: Float32Array | null = null;
    let presence: Float32Array | null = null;
    // Cells that can ever change after the initial reveal: cluster members
    // plus connector-adjacent cells. The remaining majority of the fabric is
    // faint background texture that settles once the reveal sweep finishes,
    // so per-frame work is scoped to this list instead of the full grid.
    let dynamicIndices: Int32Array | null = null;
    let width = 0;
    let height = 0;

    function toPx(rect: Rect) {
      return {
        x0: (rect.x0 / SPACE_W) * width,
        y0: (rect.y0 / SPACE_H) * height,
        x1: (rect.x1 / SPACE_W) * width,
        y1: (rect.y1 / SPACE_H) * height,
      };
    }

    function build() {
      if (!container || !canvas) return;
      width = container.clientWidth;
      height = container.clientHeight;
      ctx = setupCanvas(canvas, width, height);
      fabric = createFabric(width, height, PITCH);
      idleValues = new Float32Array(fabric.count);
      revealDelay = new Float32Array(fabric.count);
      clusterOf = new Int8Array(fabric.count).fill(-1);
      tenantEligible = new Uint8Array(fabric.count);
      fillOrder = new Float32Array(fabric.count);
      target = new Float32Array(fabric.count);
      presence = new Float32Array(fabric.count).fill(BACKGROUND_PRESENCE);

      const rectsPx = CLUSTERS.map((c) => toPx(c.rect));

      for (let i = 0; i < fabric.count; i++) {
        const { x, y } = cellPosition(fabric, i);
        revealDelay[i] = y / height;
        fillOrder[i] = Math.random();
        tenantEligible[i] = Math.random() < 0.55 ? 1 : 0;

        for (let c = 0; c < rectsPx.length; c++) {
          const r = rectsPx[c];
          if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
            clusterOf[i] = c;
            presence[i] = 1;
            break;
          }
        }
      }

      const scale = width / SPACE_W;
      const maxDist = CONNECTOR_REACH * scale;

      connectorMatches = CONNECTORS.map((connector) => {
        const pxPoints = connector.points.map((p) => ({
          x: (p.x / SPACE_W) * width,
          y: (p.y / SPACE_H) * height,
        }));
        const matches: ConnectorMatch[] = [];
        if (!fabric || !clusterOf || !presence) return matches;
        for (let i = 0; i < fabric.count; i++) {
          if (clusterOf[i] !== -1) continue;
          const { x, y } = cellPosition(fabric, i);
          const result = nearestProgress({ x, y }, pxPoints, maxDist);
          if (result) {
            const falloff = 1 - result.dist / maxDist;
            matches.push({ index: i, progress: result.progress, falloff });
            presence[i] = Math.max(presence[i], BACKGROUND_PRESENCE + falloff * CONNECTOR_PRESENCE);
          }
        }
        return matches;
      });

      const dynamicSet = new Set<number>();
      for (let i = 0; i < fabric.count; i++) {
        if (clusterOf[i] !== -1) dynamicSet.add(i);
      }
      for (const matches of connectorMatches) {
        for (const match of matches) dynamicSet.add(match.index);
      }
      dynamicIndices = Int32Array.from(dynamicSet);
    }

    const resizeObserver = new ResizeObserver(build);
    resizeObserver.observe(container);
    build();

    let lastStageIndex = -1;

    const io = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0]?.isIntersecting ?? false;
        if (reducedMotion) return;
        if (isVisible) startLoop();
        else stopLoop();
      },
      { threshold: [0, 0.2, 0.5] },
    );
    io.observe(container);

    if (reducedMotion) {
      // Skip the choreography; render the resolved end-state once.
      const settle = () => {
        if (!ctx || !fabric || !idleValues || !clusterOf || !tenantEligible || !fillOrder || !presence) return;
        for (let i = 0; i < fabric.count; i++) {
          idleValues[i] = idleAt(fabric, i, 0, IDLE_AMPLITUDE * 0.5) * presence[i];
          const cluster = clusterOf[i];
          if (cluster === 2 || cluster === 3 || cluster === 4) {
            fabric.claim[i] = tenantEligible[i] ? 0.9 : 0;
          } else if (cluster === 5) {
            fabric.claim[i] = fillOrder[i] <= CAPACITY_MAX ? 0.9 : 0;
          } else {
            fabric.claim[i] = 0;
          }
        }
        drawFabric(ctx, fabric, idleValues, fabric.claim, {
          ink: "#17140f",
          signal: "#c8763a",
          inkMax: INK_MAX,
          gap: GAP,
        });
      };
      settle();
      onStage?.(ARCHITECTURE_STAGES.length - 1);
      if (srRef.current) srRef.current.hidden = false;
      const ro2 = new ResizeObserver(settle);
      if (container) ro2.observe(container);
      return () => {
        resizeObserver.disconnect();
        io.disconnect();
        ro2.disconnect();
      };
    }

    let raf = 0;
    let lastTime = performance.now();

    function frame(now: number) {
      if (document.hidden || !ctx || !fabric || !idleValues || !revealDelay || !clusterOf || !tenantEligible || !fillOrder || !target || !presence || !dynamicIndices) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const age = scrollProgress.get() * TOTAL_AGE;

      let stageIndex = -1;
      for (let s = 0; s < ARCHITECTURE_STAGES.length; s++) {
        if (age >= ARCHITECTURE_STAGES[s].at) stageIndex = s;
      }
      if (stageIndex !== lastStageIndex) {
        lastStageIndex = stageIndex;
        if (stageIndex >= 0) onStage?.(stageIndex);
      }

      const reveal = Math.min(1, Math.max(0, age / 0.9));
      // Every cell's fade-in resolves by age 0.9 (reveal saturates at 1 and
      // the per-row delay term maxes out at the same point). Past that, the
      // faint background texture never changes, so its shimmer is frozen
      // rather than recomputed — only cluster/connector cells stay live.
      const revealSettled = age > 0.95;

      ctx.clearRect(0, 0, width, height);
      target.fill(0);

      const capacityLevel =
        CAPACITY_MAX *
        Math.max(0, Math.min(1, (age - CAPACITY_WINDOW[0]) / (CAPACITY_WINDOW[1] - CAPACITY_WINDOW[0])));

      if (revealSettled) {
        for (let k = 0; k < dynamicIndices.length; k++) {
          const i = dynamicIndices[k];
          idleValues[i] = idleAt(fabric, i, age, IDLE_AMPLITUDE) * presence[i];

          const cluster = clusterOf[i];
          if (cluster === 0) {
            target[i] = pulse(age, GRID_WINDOW);
          } else if (cluster === 1) {
            target[i] = pulse(age, OPERATOR_WINDOW);
          } else if (cluster === 2 || cluster === 3 || cluster === 4) {
            target[i] = tenantEligible[i] ? pulse(age, TENANT_WINDOW) : 0;
          } else if (cluster === 5) {
            target[i] = fillOrder[i] <= capacityLevel ? 1 : 0;
          }
        }
      } else {
        for (let i = 0; i < fabric.count; i++) {
          const cellReveal = Math.max(0, Math.min(1, (reveal - revealDelay[i] * 0.7) / 0.3));
          idleValues[i] = idleAt(fabric, i, age, IDLE_AMPLITUDE) * cellReveal * presence[i];

          const cluster = clusterOf[i];
          if (cluster === -1) continue;

          if (cluster === 0) {
            target[i] = pulse(age, GRID_WINDOW);
          } else if (cluster === 1) {
            target[i] = pulse(age, OPERATOR_WINDOW);
          } else if (cluster === 2 || cluster === 3 || cluster === 4) {
            target[i] = tenantEligible[i] ? pulse(age, TENANT_WINDOW) : 0;
          } else if (cluster === 5) {
            target[i] = fillOrder[i] <= capacityLevel ? 1 : 0;
          }
        }
      }

      for (let c = 0; c < connectorMatches.length; c++) {
        const [start, end] = CONNECTORS[c].window;
        if (age < start - 0.05 || age > end + 0.15) continue;
        const pulsePos = Math.max(0, Math.min(1, (age - start) / (end - start)));
        const matches = connectorMatches[c];
        for (let m = 0; m < matches.length; m++) {
          const { index, progress, falloff } = matches[m];
          const d = Math.abs(progress - pulsePos);
          const along = d > 0.14 ? 0 : 1 - d / 0.14;
          const contribution = along * along * falloff;
          if (contribution > target[index]) target[index] = contribution;
        }
      }

      if (revealSettled) {
        for (let k = 0; k < dynamicIndices.length; k++) {
          const i = dynamicIndices[k];
          const rate = target[i] > fabric.claim[i] ? 8 : 1.6;
          fabric.claim[i] = approach(fabric.claim[i], target[i], rate, dt);
        }
      } else {
        for (let i = 0; i < fabric.count; i++) {
          const rate = target[i] > fabric.claim[i] ? 8 : 1.6;
          fabric.claim[i] = approach(fabric.claim[i], target[i], rate, dt);
        }
      }

      drawFabric(ctx, fabric, idleValues, fabric.claim, {
        ink: "#17140f",
        signal: "#c8763a",
        inkMax: INK_MAX,
        gap: GAP,
      });

      raf = requestAnimationFrame(frame);
    }

    function startLoop() {
      if (raf) return;
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stopLoop() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    return () => {
      stopLoop();
      resizeObserver.disconnect();
      io.disconnect();
    };
  }, [onStage, scrollProgress]);

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: `${SPACE_W}/${SPACE_H}` }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {CLUSTERS.map((cluster) => (
        <span
          key={`${cluster.key}-outline`}
          aria-hidden="true"
          className="pointer-events-none absolute border border-ink/[0.06]"
          style={{
            left: `${(cluster.rect.x0 / SPACE_W) * 100}%`,
            top: `${(cluster.rect.y0 / SPACE_H) * 100}%`,
            width: `${((cluster.rect.x1 - cluster.rect.x0) / SPACE_W) * 100}%`,
            height: `${((cluster.rect.y1 - cluster.rect.y0) / SPACE_H) * 100}%`,
          }}
        />
      ))}
      {CLUSTERS.map((cluster) => (
        <span
          key={cluster.key}
          className="pointer-events-none absolute font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase"
          style={{
            left: `${(cluster.rect.x0 / SPACE_W) * 100}%`,
            width: `${((cluster.rect.x1 - cluster.rect.x0) / SPACE_W) * 100}%`,
            top: `${(cluster.rect.y1 / SPACE_H) * 100 + 1.4}%`,
            textAlign: "center",
          }}
        >
          {cluster.label}
        </span>
      ))}
      <span ref={srRef} hidden className="sr-only">
        Grid signal received. Curtail checks tenant permissions. Finds
        available flexible capacity. Verifies available MW. Dispatches
        participating tenants. Operator commits verified capacity.
      </span>
    </div>
  );
}
