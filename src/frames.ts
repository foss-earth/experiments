/**
 * Addresses for the three pictures this experiment can open. Original and the
 * half-resolution input are stored frames. WebGPU output exists only after a run.
 */

export const PROFILES = ["720p", "1080p", "small"] as const;
export const CASES = ["natural", "synthetic"] as const;
export type Profile = (typeof PROFILES)[number];
export type CaseName = (typeof CASES)[number];
export type FrameId = "original" | "half" | "output";
export type FrameTabId = `frame:${FrameId}`;

const FRAME_TABS: Record<FrameTabId, FrameId> = {
  "frame:original": "original",
  "frame:half": "half",
  "frame:output": "output",
};

export function isFrameTab(tabId: string): tabId is FrameTabId {
  return Object.hasOwn(FRAME_TABS, tabId);
}

export function frameOfTab(tabId: string): FrameId | null {
  return isFrameTab(tabId) ? FRAME_TABS[tabId] : null;
}

/** A same-origin address, or null when that picture does not exist yet. */
export function frameUrl(frame: FrameId, profile: Profile, caseName: CaseName, job: string | null): string | null {
  if (frame === "output") {
    if (!job) return null;
    return `/demo/${encodeURIComponent("WebGPU output")}?run=${encodeURIComponent(job)}`;
  }
  const name = frame === "original" ? "Original" : "Half-resolution";
  const query = new URLSearchParams({ profile, case: caseName });
  return `/demo/source/${encodeURIComponent(name)}?${query}`;
}
