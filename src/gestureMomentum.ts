/**
 * What a trackpad actually delivers, played through the globe's glide.
 *
 * A two-finger swipe is a stream of wheel events. macOS keeps sending them
 * after the fingers lift. A turn is a pointer drag and a pinch is a modified
 * wheel, and those stop when the fingers do. The samples below are that
 * distinction. `coastOf` feeds them to the same inertia the globe uses.
 */
import {
  createInertialCameraController,
  DEFAULT_INERTIA_DECAY_PER_FRAME,
} from "../../engine/src/input/inertialCameraController.ts";
import { createWheelGestureReader, WHEEL_GESTURE_IDLE_MS } from "../../engine/src/input/wheelGesture.ts";
import { DEFAULT_INPUT_RATES } from "../../engine/src/input/inputRates.ts";

const FRAME_MS = 1000 / 60;
/** A wheel tail at least this long, still shrinking, has the shape of trackpad momentum. */
const MOMENTUM_TAIL_MS = 400;
const CANVAS_HEIGHT = 800;

export interface WheelSample {
  t: number;
  kind: "wheel";
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  /** True while a finger or button is down. False when the sample is known to come after the lift. */
  contact: boolean;
}

export interface PointerSample {
  t: number;
  kind: "pointer";
  dx: number;
  dy: number;
  /** 2 is a turn: two-finger click, or the right button. */
  button: 0 | 2;
  contact: boolean;
}

export type GestureSample = WheelSample | PointerSample;

export interface GestureMomentumReport {
  wheelEvents: number;
  pointerEvents: number;
  /** Samples after the last one marked as contact. Null when no sample said a finger was down. */
  eventsAfterLift: number | null;
  /** From the strongest wheel event to the last wheel event. */
  wheelTailMs: number;
  /** Wheel events keep arriving and get smaller after the strongest one. */
  trackpadMomentum: boolean;
  /**
   * How long the globe's glide is still moving after the fingers' last contact,
   * or after the strongest wheel event when no sample was marked as contact.
   */
  coastMs: number;
  after: { panPx: number; orbitDeg: number; zoomLog: number };
  /** How the globe's wheel reader classified the events. */
  wheelModes: Partial<Record<"pan" | "pinchZoom" | "wheelZoom" | "orbit" | "ignore", number>>;
}

function magnitude(sample: WheelSample): number {
  return Math.hypot(sample.deltaX, sample.deltaY);
}

/** The last sample that was taken while a finger or button was down. */
export function contactEndMs(samples: readonly GestureSample[]): number | null {
  let end: number | null = null;
  for (const sample of samples) if (sample.contact) end = sample.t;
  return end;
}

/**
 * Where "afterwards" starts. A marked lift wins. A wheel stream that never
 * says when the fingers left is split at its strongest event, which is where
 * a flick's momentum tail begins.
 */
export function splitMs(samples: readonly GestureSample[]): number | null {
  const contact = contactEndMs(samples);
  if (contact !== null) return contact;
  const wheels = samples.filter((sample): sample is WheelSample => sample.kind === "wheel");
  if (wheels.length === 0) return null;
  let peak = wheels[0];
  for (const wheel of wheels) if (magnitude(wheel) > magnitude(peak)) peak = wheel;
  return peak.t;
}

function wheelTail(samples: readonly GestureSample[], split: number | null): { tailMs: number; momentum: boolean } {
  const wheels = samples.filter((sample): sample is WheelSample => sample.kind === "wheel");
  if (wheels.length === 0 || split === null) return { tailMs: 0, momentum: false };
  const after = wheels.filter(wheel => wheel.t > split);
  if (after.length === 0) return { tailMs: 0, momentum: false };
  const before = wheels.filter(wheel => wheel.t <= split);
  const peak = Math.max(...(before.length > 0 ? before : wheels).map(magnitude));
  const tailMs = after[after.length - 1].t - split;
  const late = after.filter(wheel => wheel.t >= split + tailMs - 200);
  const lateMean = late.reduce((sum, wheel) => sum + magnitude(wheel), 0) / late.length;
  return { tailMs, momentum: after.length >= 8 && tailMs >= MOMENTUM_TAIL_MS && lateMean < peak / 2 };
}

/**
 * The same mapping the globe's wheel and mouse controllers use, then one shared glide.
 * `sustain` feeds a turn and a pinch after the fingers lift, which is what the globe does now.
 */
export function coastOf(samples: readonly GestureSample[], decayPerFrame = DEFAULT_INERTIA_DECAY_PER_FRAME, sustain = false): GestureMomentumReport {
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const split = splitMs(ordered);
  const wheels = ordered.filter(sample => sample.kind === "wheel");
  const pointers = ordered.filter(sample => sample.kind === "pointer");
  const lift = contactEndMs(ordered);
  const { tailMs, momentum } = wheelTail(ordered, split);
  const after = { panPx: 0, orbitDeg: 0, zoomLog: 0 };
  const wheelModes: GestureMomentumReport["wheelModes"] = {};
  let clock = ordered[0]?.t ?? 0;
  let sawOrbit = false;
  let orbitReleased = false;
  const counts = (kind: "pan" | "orbit" | "zoom", amount: number): void => {
    if (!(split !== null && clock > split) || !(amount > 0)) return;
    if (kind === "pan") after.panPx += amount;
    else if (kind === "orbit") after.orbitDeg += amount;
    else after.zoomLog += amount;
  };
  const inertia = createInertialCameraController({
    panBy: (x, y) => counts("pan", Math.hypot(x, y)),
    orbitBy: (pitch, heading) => counts("orbit", Math.hypot(pitch, heading)),
    zoomBy: factor => counts("zoom", Number.isFinite(factor) && factor > 0 ? Math.abs(Math.log(factor)) : 0),
  }, { nowMs: () => clock, decayPerFrame: () => decayPerFrame });
  const read = createWheelGestureReader({ nowMs: () => clock, isSafariWithGestures: false, mode: () => "auto" });
  const rates = DEFAULT_INPUT_RATES;
  let cursor = 0;
  let movingUntil = split ?? clock;
  const last = ordered[ordered.length - 1]?.t ?? clock;
  for (let frame = ordered[0]?.t ?? 0; frame <= last + 3000; frame += FRAME_MS) {
    while (cursor < ordered.length && ordered[cursor].t <= frame) {
      const sample = ordered[cursor];
      clock = sample.t;
      if (sample.kind === "pointer") {
        if (sample.contact && sample.button === 2 && (sample.dx !== 0 || sample.dy !== 0)) {
          inertia.orbitBy(sample.dy * rates.mouseOrbitDegPerPx, sample.dx * rates.mouseOrbitDegPerPx);
          sawOrbit = true;
          if (sustain) inertia.armReleaseMomentum("orbit");
        }
      } else {
        const reading = read({
          deltaX: sample.deltaX,
          deltaY: sample.deltaY,
          deltaMode: sample.deltaMode ?? 0,
          ctrlKey: sample.ctrlKey ?? false,
          shiftKey: sample.shiftKey ?? false,
        });
        wheelModes[reading.mode] = (wheelModes[reading.mode] ?? 0) + 1;
        if (reading.mode === "pan") inertia.panBy(sample.deltaX * rates.trackpadPanRate, sample.deltaY * rates.trackpadPanRate, CANVAS_HEIGHT);
        else if (reading.mode === "pinchZoom") {
          const factor = 1 + sample.deltaY * rates.trackpadPinchZoomPerPx;
          if (factor > 0) {
            inertia.zoomBy(factor);
            if (sustain) inertia.armReleaseMomentum("zoom");
          }
        } else if (reading.mode === "wheelZoom" && Math.abs(sample.deltaY) > 0.001) {
          const exponent = Math.log1p(Math.max(0, rates.wheelZoomPerNotch)) / Math.log(1.08);
          inertia.zoomBy(Math.pow(sample.deltaY > 0 ? 1.08 : 0.92, exponent));
        } else if (reading.mode === "orbit") {
          inertia.orbitBy(sample.deltaY * rates.wheelOrbitDegPerPx, -sample.deltaX * rates.wheelOrbitDegPerPx);
        }
      }
      cursor += 1;
    }
    if (sustain && sawOrbit && !orbitReleased && lift !== null && frame >= lift) {
      clock = lift;
      inertia.releaseMomentum("orbit");
      orbitReleased = true;
    }
    clock = frame;
    inertia.update(frame);
    if (split !== null && frame > split && inertia.isActive()) movingUntil = frame;
    if (cursor >= ordered.length && split !== null && frame > split + WHEEL_GESTURE_IDLE_MS && !inertia.isActive()) break;
  }
  return {
    wheelEvents: wheels.length,
    pointerEvents: pointers.length,
    eventsAfterLift: lift === null ? null : ordered.filter(sample => sample.t > lift).length,
    wheelTailMs: tailMs,
    trackpadMomentum: momentum,
    coastMs: split === null ? 0 : Math.max(0, movingUntil - split),
    after,
    wheelModes,
  };
}

export function formatGestureReport(report: GestureMomentumReport): string {
  const lines = [`Wheel events: ${report.wheelEvents}. Pointer events: ${report.pointerEvents}.`];
  const readings = Object.entries(report.wheelModes).filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0);
  if (readings.length > 0) lines.push(`Read as ${readings.map(([mode, count]) => `${mode} ${count}`).join(", ")}.`);
  if (report.trackpadMomentum) {
    lines.push(`Wheel events continued for ${Math.round(report.wheelTailMs)} ms and got smaller.`);
  } else if (report.wheelEvents > 0) {
    lines.push("Wheel events stopped with the gesture.");
  } else {
    lines.push("No wheel events.");
  }
  const lifted = report.eventsAfterLift === null ? "after its strongest wheel event" : "after the fingers left";
  lines.push(`On the globe's glide, the camera would keep moving for ${Math.round(report.coastMs)} ms ${lifted}.`);
  const parts: string[] = [];
  if (report.after.panPx >= 1) parts.push(`pan ${report.after.panPx.toFixed(0)} px`);
  if (report.after.orbitDeg >= 0.05) parts.push(`turn ${report.after.orbitDeg.toFixed(1)}°`);
  if (report.after.zoomLog >= 0.001) parts.push(`zoom ${report.after.zoomLog.toFixed(3)} log`);
  if (parts.length > 0) lines.push(`That coast is ${parts.join(", ")}.`);
  return lines.join("\n");
}
