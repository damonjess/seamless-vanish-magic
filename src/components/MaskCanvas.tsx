import { useEffect, useRef } from "react";

type Props = {
  src: string;
  brush: number;
  onStrokesChange: (hasStrokes: boolean) => void;
  registerApi: (api: MaskApi | null) => void;
};

export type MaskApi = {
  clear: () => void;
  /** Original image data URL and a copy with magenta paint over the mask */
  exportPair: () => { image: string; marked: string } | null;
};

const PAINT = "rgba(255, 0, 200, 0.62)";

export function MaskCanvas({ src, brush, onStrokesChange, registerApi }: Props) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const painted = useRef(false);

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
      baseRef.current?.getContext("2d")?.drawImage(img, 0, 0, w, h);
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
    if (!painted.current) {
      painted.current = true;
      onStrokesChange(true);
    }
  };

  return (
    <div className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-card">
      <canvas ref={baseRef} className="block h-auto w-full" />
      <canvas
        ref={maskRef}
        className="absolute inset-0 block h-full w-full cursor-crosshair"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = pos(e);
          last.current = p;
          stroke(p, { x: p.x + 0.01, y: p.y });
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
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
