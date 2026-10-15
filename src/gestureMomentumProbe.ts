import { coastOf, formatGestureReport, type GestureSample } from "./gestureMomentum.ts";

const IDLE_MS = 400;

const pad = document.querySelector<HTMLElement>("#pad");
const out = document.querySelector<HTMLElement>("#out");
if (!pad || !out) throw new Error("The gesture pad is missing.");

let samples: GestureSample[] = [];
let last: { x: number; y: number } | null = null;
let idle = 0;

function stamp(): number {
  return performance.now();
}

function scheduleReport(): void {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    out.textContent = samples.length === 0 ? "Waiting for a gesture." : formatGestureReport(coastOf(samples));
    samples = [];
    last = null;
  }, IDLE_MS);
}

pad.addEventListener("contextmenu", event => event.preventDefault());
pad.addEventListener("pointerdown", event => {
  if (event.button !== 2) return;
  last = { x: event.clientX, y: event.clientY };
  samples.push({ t: stamp(), kind: "pointer", dx: 0, dy: 0, button: 2, contact: true });
  scheduleReport();
});
pad.addEventListener("pointermove", event => {
  if (event.buttons !== 2 || !last) return;
  samples.push({
    t: stamp(),
    kind: "pointer",
    dx: event.clientX - last.x,
    dy: event.clientY - last.y,
    button: 2,
    contact: true,
  });
  last = { x: event.clientX, y: event.clientY };
  scheduleReport();
});
pad.addEventListener("pointerup", event => {
  if (event.button !== 2) return;
  samples.push({ t: stamp(), kind: "pointer", dx: 0, dy: 0, button: 2, contact: false });
  last = null;
  scheduleReport();
});
pad.addEventListener("wheel", event => {
  event.preventDefault();
  samples.push({
    t: stamp(),
    kind: "wheel",
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    contact: false,
  });
  scheduleReport();
}, { passive: false });
