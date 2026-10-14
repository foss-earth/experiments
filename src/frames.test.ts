import { describe, expect, it } from "vitest";
import { frameOfTab, frameUrl } from "./frames.ts";

describe("frame addresses", () => {
  it("serves the stored frames from this page", () => {
    expect(frameUrl("original", "720p", "natural", null)).toBe("/demo/source/Original?profile=720p&case=natural");
    expect(frameUrl("half", "1080p", "synthetic", null)).toBe("/demo/source/Half-resolution?profile=1080p&case=synthetic");
  });

  it("withholds WebGPU output until a run has published it", () => {
    expect(frameUrl("output", "720p", "natural", null)).toBeNull();
    expect(frameUrl("output", "720p", "natural", "job-1")).toBe("/demo/WebGPU%20output?run=job-1");
  });

  it("recognizes the add-menu tabs", () => {
    expect(frameOfTab("frame:half")).toBe("half");
    expect(frameOfTab("image:1")).toBeNull();
  });
});
