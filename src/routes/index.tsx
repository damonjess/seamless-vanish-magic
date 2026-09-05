import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
import {
  Brush,
  Download,
  Eraser,
  ImagePlus,
  Loader2,
  MousePointerClick,
  RotateCcw,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { MaskCanvas, type MaskApi } from "@/components/MaskCanvas";
import { removeObject } from "@/lib/remove.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vanish — AI Object Remover for Photos" },
      {
        name: "description",
        content:
          "Brush over anything you want gone and Vanish rebuilds the background so it looks like the object was never there.",
      },
      { property: "og:title", content: "Vanish — AI Object Remover for Photos" },
      {
        property: "og:description",
        content: "Paint over unwanted objects and get a clean, seamless photo in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [src, setSrc] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [brush, setBrush] = useState(38);
  const [mode, setMode] = useState<"brush" | "tap" | "lasso">("tap");
  const [selection, setSelection] = useState({ hasPaint: false, points: 0 });
  const [busy, setBusy] = useState(false);
  const apiRef = useRef<MaskApi | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const run = useServerFn(removeObject);

  const registerApi = useCallback((api: MaskApi | null) => {
    apiRef.current = api;
  }, []);

  const pickFile = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSrc(String(reader.result));
      setHistory([]);
      setSelection({ hasPaint: false, points: 0 });
    };
    reader.readAsDataURL(file);
  };

  const erase = async () => {
    const pair = apiRef.current?.exportPair();
    if (!pair || (!selection.hasPaint && selection.points === 0)) {
      toast.error(
        mode === "tap" ? "Tap an object to remove first." : "Brush over what you want removed first.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await run({
        data: { ...pair, points: selection.points, hasPaint: selection.hasPaint },
      });
      setHistory((h) => (src ? [...h, src] : h));
      setSrc(result.image);
      setSelection({ hasPaint: false, points: 0 });
      toast.success("Gone without a trace.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setSrc(h[h.length - 1] ?? null);
      setSelection({ hasPaint: false, points: 0 });
      return h.slice(0, -1);
    });
  };

  const download = () => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = "vanish.png";
    a.click();
  };

  return (
    <main className="min-h-screen bg-background bg-studio">
      <Toaster />
      <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-10">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">
            Generative cleanup
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Vanish
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Paint over anything you don't want. The background is rebuilt pixel by pixel, so it
            looks like it was never there.
          </p>
        </header>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        {!src ? (
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className="mt-10 flex w-full flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-20 text-center transition-colors hover:border-primary/60 hover:bg-card"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary shadow-glow">
              <ImagePlus className="size-6" />
            </span>
            <span className="text-base font-medium text-foreground">Upload a photo</span>
            <span className="text-xs text-muted-foreground">
              Tap to browse, or drop an image here
            </span>
          </button>
        ) : (
          <section className="mt-8 space-y-5">
            <div className="rounded-3xl border border-border bg-card p-3 shadow-panel">
              <div className="relative">
                <MaskCanvas
                  src={src}
                  brush={brush}
                  mode={mode}
                  onSelectionChange={setSelection}
                  registerApi={registerApi}
                />


                {busy && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/70 backdrop-blur-sm">
                    <Loader2 className="size-7 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Rebuilding the background…</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card/70 p-5">
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1">
                <button
                  onClick={() => setMode("tap")}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "tap"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MousePointerClick className="size-4" /> Tap to remove
                </button>
                <button
                  onClick={() => setMode("brush")}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "brush"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Brush className="size-4" /> Brush
                </button>
              </div>

              {mode === "tap" ? (
                <>
                  <div className="mt-5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <Sparkles className="size-4 text-primary" /> Targets placed
                    </span>
                    <span className="text-muted-foreground">{selection.points}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tap the middle of an object — the AI works out its exact outline and shadow, then
                    removes the whole thing. Tap more objects to remove several at once.
                  </p>
                  {selection.points > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => apiRef.current?.undoPoint()}
                    >
                      <Undo2 className="size-4" /> Remove last target
                    </Button>
                  )}
                </>
              ) : (

                <>
                  <div className="mt-5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <Eraser className="size-4 text-primary" /> Brush size
                    </span>
                    <span className="text-muted-foreground">{brush}px</span>
                  </div>
                  <Slider
                    className="mt-4"
                    value={[brush]}
                    min={8}
                    max={110}
                    step={1}
                    onValueChange={(v) => setBrush(v[0] ?? brush)}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Cover the whole object plus a little of its shadow for the cleanest result.
                  </p>
                </>
              )}
            </div>


            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" className="col-span-2 shadow-glow" disabled={busy} onClick={erase}>
                <Wand2 className="size-4" /> Remove selected objects
              </Button>
              <Button variant="secondary" onClick={() => apiRef.current?.clear()} disabled={busy}>
                <RotateCcw className="size-4" /> Clear selection
              </Button>
              <Button variant="secondary" onClick={undo} disabled={busy || !history.length}>
                <Undo2 className="size-4" /> Undo removal
              </Button>
              <Button variant="outline" onClick={download} disabled={busy}>
                <Download className="size-4" /> Download
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSrc(null);
                  setHistory([]);
                }}
                disabled={busy}
              >
                <ImagePlus className="size-4" /> New photo
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
