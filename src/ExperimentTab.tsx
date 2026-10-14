import { CASES, PROFILES, type CaseName, type FrameId, type Profile } from "./frames.ts";

export function ExperimentTab({
  profile, caseName, outputReady, status, busy, onProfile, onCase, onRun, onOpen,
}: {
  profile: Profile;
  caseName: CaseName;
  outputReady: boolean;
  status: string;
  busy: boolean;
  onProfile(profile: Profile): void;
  onCase(caseName: CaseName): void;
  onRun(): void;
  onOpen(frame: FrameId): void;
}) {
  return <div className="experiment-tab">
    <p>The picture is the view behind these windows. Open a picture here, or from the add-tab menu on either side. One selected image tab is that picture. One on each side is the comparison.</p>
    <div className="experiment-tab__row">
      <label>Profile <select value={profile} disabled={busy} onChange={event => onProfile(event.target.value as Profile)}>
        {PROFILES.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label>Case <select value={caseName} disabled={busy} onChange={event => onCase(event.target.value as CaseName)}>
        {CASES.map(item => <option key={item}>{item}</option>)}
      </select></label>
    </div>
    <div className="experiment-tab__row">
      <button type="button" onClick={() => onOpen("original")}>Open original</button>
      <button type="button" onClick={() => onOpen("half")}>Open half-resolution</button>
      <button type="button" disabled={!outputReady} onClick={() => onOpen("output")}>Open WebGPU output</button>
      <button type="button" disabled={busy} onClick={onRun}>{busy ? "Running…" : "Run on GPU"}</button>
    </div>
    <p role="status">{status}</p>
  </div>;
}
