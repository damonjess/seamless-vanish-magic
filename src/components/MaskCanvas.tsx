import { useCallback, useEffect, useRef } from "react";

type Props = {
  src: string;
  brush: number;
  mode: "brush" | "tap";
  /** 0-100 snap sensitivity used in tap mode */
  tolerance: number;
  onStrokesChange: (hasStrokes: boolean) => void;
  registerApi: (api: MaskApi | null) => void;
};

export type MaskApi = {
  clear: () => void;
  /** Original image data URL and a copy with magenta paint over the mask */
  exportPair: () => { image: string; marked: string } | null;
};

const PAINT = "rgba(255, 0, 200, 0.62)";

export function MaskCanvas({
  src,
  brush,
  mode,
  tolerance,
  onStrokesChange,
  registerApi,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const baseData = useRef<ImageData | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const painted = useRef(false);

  const markPainted = useCallback(() => {
    if (!painted.current) {
      painted.current = true;
      onStrokesChange(true);
    }
  }, [onStrokesChange]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      for (const c of [baseRef.current, maskRef.current]) {
        if (!c) continue;
        c.width = w;
        c.height = h;
      }
      const ctx = baseRef.current?.getContext("2d");
      ctx?.drawImage(img, 0, 0, w, h);
      baseData.current = ctx?.getImageData(0, 0, w, h) ?? null;
      painted.current = false;
      onStrokesChange(false);
    };
    img.src = src;
  }, [src, onStrokesChange]);

  useEffect(() => {
    const api: MaskApi = {
      clear: () => {
        const c = maskRef.current;
        if (!c) return;
        c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
        painted.current = false;
        onStrokesChange(false);
      },
      exportPair: () => {
        const base = baseRef.current;
        const mask = maskRef.current;
        if (!base || !mask) return null;
        const merged = document.createElement("canvas");
        merged.width = base.width;
        merged.height = base.height;
        const ctx = merged.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(base, 0, 0);
        ctx.drawImage(mask, 0, 0);
        return {
          image: base.toDataURL("image/png"),
          marked: merged.toDataURL("image/png"),
        };
      },
    };
    registerApi(api);
    return () => registerApi(null);
  }, [registerApi, onStrokesChange]);

  const pos = (e: React.PointerEvent) => {
    const c = maskRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = maskRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const r = c.getBoundingClientRect();
    const size = (brush / r.width) * c.width;
    ctx.strokeStyle = PAINT;
    ctx.fillStyle = PAINT;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    markPainted();
  };

  /** Magic-wand style snap: flood fill the region under the tap, then feather it out. */
  const snapAt = (pt: { x: number; y: number }) => {
    const data = baseData.current;
    const mask = maskRef.current;
    const mctx = mask?.getContext("2d");
    if (!data || !mask || !mctx) return;

    const w = data.width;
    const h = data.height;
    const sx = Math.min(w - 1, Math.max(0, Math.round(pt.x)));
    const sy = Math.min(h - 1, Math.max(0, Math.round(pt.y)));
    const px = data.data;
    const start = (sy * w + sx) * 4;
    const tr = px[start]!;
    const tg = px[start + 1]!;
    const tb = px[start + 2]!;
    // tolerance 0-100 -> squared RGB distance threshold
    const t = 12 + (tolerance / 100) * 90;
    const limit = t * t * 3;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    queue[tail++] = sy * w + sx;
    visited[sy * w + sx] = 1;

    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    let count = 0;
    const maxPixels = w * h * 0.55;

    while (head < tail) {
      const idx = queue[head++]!;
      count++;
      if (count > maxPixels) break;
      const y = (idx / w) | 0;
      const x = idx - y * w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || visited[n]) continue;
        const o = n * 4;
        const dr = px[o]! - tr;
        const dg = px[o + 1]! - tg;
        const db = px[o + 2]! - tb;
        if (dr * dr + dg * dg + db * db <= limit) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    // Render the selection into a temp canvas, then blot it in with a soft blur
    // so the edges of the object (and its halo) are fully covered.
    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");
    if (!tctx) return;
    const out = tctx.createImageData(w, h);
    const od = out.data;
    for (let i = 0; i < visited.length; i++) {
      if (!visited[i]) continue;
      const o = i * 4;
      od[o] = 255;
      od[o + 1] = 0;
      od[o + 2] = 200;
      od[o + 3] = 255;
    }
    tctx.putImageData(out, 0, 0);

    const grow = Math.max(2, Math.round(Math.max(w, h) * 0.006));
    mctx.save();
    mctx.globalAlpha = 0.62;
    mctx.filter = `blur(${grow}px)`;
    // draw a few times so the blurred (semi-transparent) edge becomes solid
    for (let i = 0; i < 3; i++) mctx.drawImage(temp, 0, 0);
    mctx.restore();
    markPainted();
  };

  return (
    <div className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-card">
      <canvas ref={baseRef} className="block h-auto w-full" />
      <canvas
        ref={maskRef}
        className={`absolute inset-0 block h-full w-full ${
          mode === "tap" ? "cursor-pointer" : "cursor-crosshair"
        }`}
        onPointerDown={(e) => {
          const p = pos(e);
          if (mode === "tap") {
            snapAt(p);
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = p;
          stroke(p, { x: p.x + 0.01, y: p.y });
        }}
        onPointerMove={(e) => {
          if (mode === "tap" || !drawing.current || !last.current) return;
          const p = pos(e);
          stroke(last.current, p);
          last.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerLeave={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
    </div>
  );
}
