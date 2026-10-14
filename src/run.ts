/**
 * Runs RT4KSR fp32 on this page. The study's harness stays in research and is
 * served from /harness/; this only asks it for the GPU frame and publishes that
 * frame for the viewer.
 */

export interface Rt4ksrRun {
  readonly job: string;
  readonly message: string;
}

interface FullPathResult {
  readonly withinOneFraction: number;
  readonly maxDifference: number;
  readonly injection?: {
    readonly thrown?: unknown;
    readonly deviceLost?: unknown;
    readonly scopeErrors?: number;
    readonly scopeDetails?: readonly { readonly message?: string }[];
  };
}

interface OutputImage {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

interface Harness {
  parityJob(params: Record<string, unknown>): Promise<FullPathResult & Partial<OutputImage> & { readonly load?: { readonly createMs?: number } }>;
}

function tightly(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height * 4;
  if (rgba.byteLength < count) throw new Error(`frame is ${rgba.byteLength} bytes, not ${width} × ${height} RGBA`);
  return rgba.byteOffset === 0 && rgba.byteLength === count ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, count);
}

function failureOf(result: FullPathResult): string {
  const injection = result.injection;
  if (!injection) return "";
  if (injection.thrown) return injection.thrown instanceof Error ? injection.thrown.message : String(injection.thrown);
  if (injection.deviceLost) return "WebGPU device lost.";
  if (injection.scopeErrors) {
    const details = (injection.scopeDetails ?? []).map(entry => entry.message).filter((message): message is string => Boolean(message));
    return details.join("\n") || "WebGPU reported an error.";
  }
  return "";
}

export async function runRt4ksr(
  profile: string,
  caseName: string,
  onStatus: (message: string) => void,
  signal: AbortSignal,
): Promise<Rt4ksrRun> {
  if (!crossOriginIsolated || !navigator.gpu) {
    throw new Error("This page needs an isolated WebGPU browser. Open it from npm run dev in Chrome.");
  }
  const harnessUrl = "/harness/parity.mjs";
  const harness = await import(/* @vite-ignore */ harnessUrl) as Harness;
  if (signal.aborted) throw new DOMException("Cancelled.", "AbortError");
  onStatus("Loading the fp32 graph and reference…");
  const prepared = await harness.parityJob({ action: "prepare", candidate: "rt4ksr-x2", profile, precision: "fp32", case: caseName, logSeverityLevel: 2 });
  if (signal.aborted) throw new DOMException("Cancelled.", "AbortError");
  const createMs = prepared.load?.createMs;
  onStatus(`Session created${typeof createMs === "number" ? ` in ${createMs.toFixed(0)} ms` : ""}. Running the GPU path…`);
  const result = await harness.parityJob({ action: "fullPath", case: caseName });
  const failure = failureOf(result);
  if (failure) throw new Error(failure);
  const image = await harness.parityJob({ action: "outputImage" });
  if (!image.rgba || !image.width || !image.height) throw new Error("The GPU path did not return an image.");
  if (signal.aborted) throw new DOMException("Cancelled.", "AbortError");
  const job = crypto.randomUUID();
  const bytes = new Uint8Array(tightly(image.rgba, image.width, image.height));
  onStatus("Publishing the WebGPU output…");
  const response = await fetch(`/demo/${encodeURIComponent("WebGPU output")}?run=${encodeURIComponent(job)}&width=${image.width}&height=${image.height}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  const within = (100 * result.withinOneFraction).toFixed(2);
  const message = `${within}% of output RGB codes are within one code of the stored reference. Largest code error: ${result.maxDifference}.`;
  onStatus(message);
  return { job, message };
}
