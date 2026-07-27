"use client";

import { useEffect, useRef } from "react";
import {
  approach,
  cellPosition,
  createFabric,
  drawFabric,
  idleAt,
  setupCanvas,
  type Fabric,
} from "./cellFabric";

const PITCH = 16;
const GAP = 9;
const IDLE_AMPLITUDE = 0.4;
const INK_MAX = 0.06;
const CLAIM_RADIUS = 95;
const REVEAL_DURATION = 1.6;
const AUTOPLAY_RESUME_MS = 4200;

/**
 * Curtail's signature interaction: a fabric of independent cells, each
 * idling on its own rhythm, that snap into synchronized "claimed" formation
 * within a bounded region around the cursor — and release when it moves on.
 * Many independent things, made to act in concert, temporarily.
 */
export function HeroField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    let width = 0;
    let height = 0;

    function resize() {
      if (!container || !canvas) return;
      width = container.clientWidth;
      height = container.clientHeight;
      ctx = setupCanvas(canvas, width, height);
      fabric = createFabric(width, height, PITCH);
      idleValues = new Float32Array(fabric.count);
      revealDelay = new Float32Array(fabric.count);

      const cx = width / 2;
      const cy = height * 0.3;
      const maxDist = Math.hypot(
        Math.max(cx, width - cx),
        Math.max(cy, height - cy),
      );
      for (let i = 0; i < fabric.count; i++) {
        const { x, y } = cellPosition(fabric, i);
        revealDelay[i] = Math.hypot(x - cx, y - cy) / maxDist;
      }
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let pointerX = width / 2;
    let pointerY = height * 0.4;
    let lastPointerAt = -Infinity;
    let hasEverPointed = false;

    function handlePointerMove(event: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      lastPointerAt = performance.now();
      hasEverPointed = true;
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );
    io.observe(container);

    let raf = 0;
    let lastTime = performance.now();
    const start = performance.now();
    let influenceX = pointerX;
    let influenceY = pointerY;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || !ctx || !fabric || !idleValues || !revealDelay) {
        return;
      }

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const t = (now - start) / 1000;

      // Until the visitor moves the mouse — and again after a pause — a
      // slow autonomous path keeps the fabric legible without a pointer.
      const useAutoplay =
        reducedMotion || !hasEverPointed || now - lastPointerAt > AUTOPLAY_RESUME_MS;
      let targetX = pointerX;
      let targetY = pointerY;
      if (useAutoplay) {
        const ang = t * 0.28;
        targetX = width / 2 + Math.cos(ang) * width * 0.2;
        targetY = height * 0.3 + Math.sin(ang * 1.7) * height * 0.09;
      }
      const blendRate = useAutoplay ? 1.4 : 9;
      influenceX = approach(influenceX, targetX, blendRate, dt);
      influenceY = approach(influenceY, targetY, blendRate, dt);

      const reveal = Math.min(1, t / REVEAL_DURATION);

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < fabric.count; i++) {
        const cellReveal = Math.max(
          0,
          Math.min(1, (reveal - revealDelay[i] * 0.6) / 0.4),
        );
        idleValues[i] = idleAt(fabric, i, t, IDLE_AMPLITUDE) * cellReveal;

        if (reducedMotion) continue;

        const { x, y } = cellPosition(fabric, i);
        const dist = Math.hypot(x - influenceX, y - influenceY);
        const falloff = dist > CLAIM_RADIUS ? 0 : 1 - dist / CLAIM_RADIUS;
        const target = falloff * falloff * cellReveal;
        const rate = target > fabric.claim[i] ? 10 : 2.2;
        fabric.claim[i] = approach(fabric.claim[i], target, rate, dt);
      }

      drawFabric(ctx, fabric, idleValues, fabric.claim, {
        ink: "#17140f",
        signal: "#c8763a",
        inkMax: INK_MAX,
        gap: GAP,
      });
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{
        maskImage:
          "radial-gradient(ellipse 48% 36% at 50% 30%, black 0%, black 18%, transparent 66%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 48% 36% at 50% 30%, black 0%, black 18%, transparent 66%)",
      }}
      aria-hidden="true"
    />
  );
}
