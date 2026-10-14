# @foss-earth/experiments

The app you start for a FOSS Earth experiment.

```sh
npm install
npm run dev
```

Vite prints one address. Open it in Chrome. That server serves the page, the pictures, and the upscale study, with the isolation headers the model needs. Firefox cannot run this model.

The rectangle fills the screen. Windows float on top of it, the way the campus tour's 360 does. The Experiment tab is the controls. Original, half-resolution, and WebGPU output are tabs: one selected image tab is the picture on the view, and one selected image tab on each side is the comparison. WebGPU output can be opened after a run. The photograph is the view, not the contents of a tab.

The rectangle camera and renderer stay in `sphere-image`. Pixels stay in `rectangle-image` and `images`. The study stays in `research`. This repository is only the app you start.
