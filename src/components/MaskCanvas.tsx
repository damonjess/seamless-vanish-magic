import { useCallback, useEffect, useRef } from "react";

type Props = {
  src: string;
  brush: number;
  mode: "brush" | "tap" | "lasso";
  onSelectionChange: (state: { hasPaint: boolean; points: number }) => void;
  registerApi: (api: MaskApi | null) => void;
};

export type MaskApi = {
  clear: () => void;
  undoPoint: () => void;
  /** Original image plus a copy annotated with paint strokes / target markers */
  exportPair: () => { image: string; marked: string } | null;
};

const PAINT = "rgba(255, 0, 200, 0.62)";
const MARK = "rgb(255, 0, 200)";

export function MaskCanvas({ src, brush, mode, onSelectionChange, registerApi }: Props) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<HTMLCanvasElement | null>(null);
  const points = useRef<{ x: number; y: number }[]>([]);
  const hasPaint = useRef(false);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const lasso = useRef<{ x: number; y: number }[]>([]);

  const notify = useCallback(() => {
    onSelectionChange({ hasPaint: hasPaint.current, points: points.current.length });
  }, [onSelectionChange]);

  /** Re-render markers on top of the paint layer */
  const repaint = useCallback(() => {
    const mask = maskRef.current;
    const paint = strokes.current;
    const ctx = mask?.getContext("2d");
    if (!mask || !paint || !ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.drawImage(paint, 0, 0);

    const unit = Math.max(mask.width, mask.height) / 100;
    points.current.forEach((p, i) => {
      const r = unit * 2.4;
      ctx.save();
      ctx.lineWidth = unit * 0.55;
      ctx.strokeStyle = MARK;
      ctx.fillStyle = MARK;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, unit * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${unit * 2.6}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x + r + unit * 0.6, p.y);
      ctx.restore();
    });
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      if (!strokes.current) strokes.current = document.createElement("canvas");
      for (const c of [baseRef.current, maskRef.current, strokes.current]) {
        if (!c) continue;
        c.width = w;
        c.height = h;
      }
      baseRef.current?.getContext("2d")?.drawImage(img, 0, 0, w, h);
      strokes.current.getContext("2d")?.clearRect(0, 0, w, h);
      points.current = [];
      hasPaint.current = false;
      repaint();
      notify();
    };
    img.src = src;
  }, [src, repaint, notify]);

  useEffect(() => {
    const api: MaskApi = {
      clear: () => {
        const paint = strokes.current;
        if (paint) paint.getContext("2d")?.clearRect(0, 0, paint.width, paint.height);
        points.current = [];
        hasPaint.current = false;
        repaint();
        notify();
      },
      undoPoint: () => {
        points.current = points.current.slice(0, -1);
        repaint();
        notify();
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
  }, [registerApi, repaint, notify]);

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
    const paint = strokes.current;
    const ctx = paint?.getContext("2d");
    if (!c || !paint || !ctx) return;
    const r = c.getBoundingClientRect();
    const size = (brush / r.width) * c.width;
    ctx.strokeStyle = PAINT;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (!hasPaint.current) {
      hasPaint.current = true;
      notify();
    }
    repaint();
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
            points.current = [...points.current, p];
            repaint();
            notify();
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
