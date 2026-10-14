import { useRef, useState } from "react";
import type { CaseName, Profile } from "./frames.ts";

export function useRun(): {
  job: string | null;
  status: string;
  busy: boolean;
  run(profile: Profile, caseName: CaseName): void;
} {
  const [job, setJob] = useState<string | null>(null);
  const [status, setStatus] = useState("Run RT4KSR fp32 in Chrome. Original and the half-resolution input can be opened before a run. WebGPU output appears after one.");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  return {
    job, status, busy,
    run(profile, caseName) {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      void import("./run.ts").then(({ runRt4ksr }) => runRt4ksr(profile, caseName, setStatus, controller.signal)).then(result => {
        if (controller.signal.aborted) return;
        setJob(result.job);
        setStatus(`${result.message} Open WebGPU output to put it on the view.`);
      }, error => {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        if (abort.current === controller) setBusy(false);
      });
    },
  };
}
