import { describe, expect, it } from "vitest";
import { coastOf, formatGestureReport, type GestureSample } from "./gestureMomentum.ts";

/** One flick, about a tenth of a second, sampled the way a trackpad reports it. */
function flick(make: (t: number) => GestureSample): GestureSample[] {
  const samples: GestureSample[] = [];
  for (let t = 0; t <= 128; t += 16) samples.push(make(t));
  return samples;
}

/**
 * The hypothesis: after a two-finger swipe the trackpad keeps sending wheel
 * events, smaller each time, for the better part of a second. `contact: false`
 * is the lift. A turn and a pinch in these fixtures stop when the fingers do.
 */
function panSwipe(withMomentum: boolean): GestureSample[] {
  const during = flick(t => ({ t, kind: "wheel", deltaX: 0.4, deltaY: -14.5, contact: true }));
  if (!withMomentum) return during;
  const tail: GestureSample[] = [];
  for (let t = 160; t <= 960; t += 16) {
    const deltaY = -14.5 * Math.exp(-(t - 160) / 280);
    if (Math.abs(deltaY) < 0.4) break;
    tail.push({ t, kind: "wheel", deltaX: 0.2, deltaY, contact: false });
  }
  return [...during, ...tail];
}

function orbitDrag(): GestureSample[] {
  return flick(t => ({ t, kind: "pointer", dx: 0.4, dy: -14.5, button: 2, contact: true }));
}

function pinch(): GestureSample[] {
  return flick(t => ({ t, kind: "wheel", deltaX: 0, deltaY: -14.5, ctrlKey: true, contact: true }));
}

describe("trackpad momentum and the globe's glide", () => {
  it("reads a swipe's trailing wheel events as momentum, and a turn or a pinch as stopping with the fingers", () => {
    const pan = coastOf(panSwipe(true));
    const turn = coastOf(orbitDrag());
    const zoom = coastOf(pinch());

    expect(pan.eventsAfterLift).toBeGreaterThan(20);
    expect(pan.trackpadMomentum).toBe(true);
    expect(pan.wheelTailMs).toBeGreaterThan(400);
    expect(formatGestureReport(pan)).toContain("got smaller");

    expect(turn.eventsAfterLift).toBe(0);
    expect(turn.trackpadMomentum).toBe(false);
    expect(turn.wheelEvents).toBe(0);
    expect(formatGestureReport(turn)).toContain("No wheel events.");

    expect(zoom.eventsAfterLift).toBe(0);
    expect(zoom.trackpadMomentum).toBe(false);
    expect(formatGestureReport(zoom)).toContain("stopped with the gesture");
  });

  it("keeps the camera moving much longer when the swipe's wheel events continue after the lift", () => {
    const pan = coastOf(panSwipe(true));
    const panWithoutTail = coastOf(panSwipe(false));
    const turn = coastOf(orbitDrag());
    const zoom = coastOf(pinch());

    expect(pan.after.panPx).toBeGreaterThan(panWithoutTail.after.panPx * 3);
    expect(pan.after.orbitDeg).toBe(0);
    expect(pan.after.zoomLog).toBe(0);
    expect(turn.after.orbitDeg).toBeGreaterThan(0);
    expect(turn.after.panPx).toBe(0);
    expect(zoom.after.zoomLog).toBeGreaterThan(0);
    expect(zoom.after.panPx).toBe(0);

    // The same glide. The extra time is the extra wheel events, not a different decay.
    expect(pan.coastMs).toBeGreaterThan(turn.coastMs + 400);
    expect(pan.coastMs).toBeGreaterThan(zoom.coastMs + 400);
    expect(Math.abs(panWithoutTail.coastMs - turn.coastMs)).toBeLessThan(250);
    expect(Math.abs(panWithoutTail.coastMs - zoom.coastMs)).toBeLessThan(250);
  });

  it("feeds a turn and a pinch after the lift for about as long as the swipe's own wheel events", () => {
    const pan = coastOf(panSwipe(true));
    const turn = coastOf(orbitDrag(), undefined, true);
    const zoom = coastOf(pinch(), undefined, true);
    expect(turn.coastMs).toBeGreaterThan(900);
    expect(zoom.coastMs).toBeGreaterThan(900);
    expect(Math.abs(turn.coastMs - pan.coastMs)).toBeLessThan(400);
    expect(Math.abs(zoom.coastMs - pan.coastMs)).toBeLessThan(400);
  });
});
