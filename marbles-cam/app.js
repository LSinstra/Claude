// Marbles Cam app: M1 scope. Mode B native flash capture, import, Look Engine
// with the deli preset, review with subject point, share sheet export.

import { LookEngine, FALLBACK_PRESET } from "./engine.js";

const PREVIEW_EDGE = 1536;
const EXPORT_EDGES = { 4096: 4096, 2048: 2048 };

const $ = (id) => document.getElementById(id);
const screens = { home: $("screen-home"), review: $("screen-review") };
const $notice = $("notice");
const $viewCanvas = $("view-canvas");
const viewCtx = $viewCanvas.getContext("2d");
const $stage = $("stage");
const $subjectDot = $("subject-dot");
const $busy = $("busy");
const $meta = $("meta");
const $flashWarn = $("flash-warn");

const engine = new LookEngine();
let preset = { ...FALLBACK_PRESET };
let current = null; // { img, blob, w, h, subject, exif, mode }
let viewMode = "look"; // look | raw
let exportSize = "4096";
let processing = false;

fetch("presets/deli.json")
  .then((r) => r.json())
  .then((p) => {
    preset = { ...FALLBACK_PRESET, ...p };
    if (current) reprocess();
  })
  .catch(() => {});

if (engine.mode === "cpu") {
  showNotice("WebGL2 is not available. Using a reduced look: no sharpening, simpler falloff.");
}

function showNotice(text) {
  $notice.textContent = text;
  $notice.hidden = false;
}

function show(name) {
  screens.home.hidden = name !== "home";
  screens.review.hidden = name !== "review";
}

// ---- capture entry points ----

$("btn-flash").addEventListener("click", () => {
  if (sessionStorage.getItem("mc.checklist")) {
    $("input-flash").click();
  } else {
    $("checklist").hidden = false;
  }
});

$("checklist-go").addEventListener("click", () => {
  sessionStorage.setItem("mc.checklist", "1");
  $("checklist").hidden = true;
  $("input-flash").click();
});

$("btn-import").addEventListener("click", () => $("input-import").click());

$("input-flash").addEventListener("change", (e) => onFile(e.target, "flash"));
$("input-import").addEventListener("change", (e) => onFile(e.target, "import"));

async function onFile(input, mode) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;

  setBusy(true);
  show("review");
  $meta.textContent = "";
  $flashWarn.hidden = true;

  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    current = {
      img,
      blob: file,
      w: img.naturalWidth,
      h: img.naturalHeight,
      subject: { x: 0.5, y: 0.5 },
      exif: null,
      mode,
    };
    readExif(file, mode);
    reprocess();
  } catch (err) {
    setBusy(false);
    show("home");
    showNotice("Could not read that image.");
  }
}

async function readExif(file, mode) {
  try {
    const exif = await exifr.parse(file, {
      pick: ["Flash", "ISO", "ExposureTime", "FNumber", "LensModel", "DateTimeOriginal"],
    });
    if (!current) return;
    current.exif = exif || null;
    renderMeta(mode);
  } catch {
    renderMeta(mode);
  }
}

function renderMeta(mode) {
  const e = current && current.exif;
  const parts = [];
  if (e) {
    const flashFired =
      typeof e.Flash === "string"
        ? /fired/i.test(e.Flash) && !/did not/i.test(e.Flash)
        : typeof e.Flash === "number"
          ? (e.Flash & 1) === 1
          : null;
    if (flashFired === true) parts.push("Flash fired");
    if (e.ISO) parts.push(`ISO ${e.ISO}`);
    if (e.ExposureTime) parts.push(e.ExposureTime >= 1 ? `${e.ExposureTime}s` : `1/${Math.round(1 / e.ExposureTime)}s`);
    if (e.FNumber) parts.push(`f/${e.FNumber}`);
    if (mode === "flash" && flashFired === false) $flashWarn.hidden = false;
  }
  parts.push(`${current.w} x ${current.h}`);
  $meta.textContent = parts.join(" · ");
}

// ---- processing and review ----

function setBusy(on) {
  processing = on;
  $busy.hidden = !on;
}

function reprocess() {
  if (!current) return;
  setBusy(true);
  // let the busy indicator paint before the synchronous GPU work
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const t0 = performance.now();
      try {
        if (viewMode === "look") {
          const res = engine.process(current.img, current.w, current.h, preset, current.subject, PREVIEW_EDGE);
          drawToView(res.canvas, res.width, res.height);
        } else {
          const scale = Math.min(1, PREVIEW_EDGE / Math.max(current.w, current.h));
          drawToView(current.img, Math.round(current.w * scale), Math.round(current.h * scale));
        }
      } finally {
        setBusy(false);
      }
      placeSubjectDot();
      console.debug(`render ${Math.round(performance.now() - t0)} ms`);
    })
  );
}

function drawToView(source, w, h) {
  $viewCanvas.width = w;
  $viewCanvas.height = h;
  viewCtx.drawImage(source, 0, 0, w, h);
}

function canvasRect() {
  return $viewCanvas.getBoundingClientRect();
}

function placeSubjectDot() {
  if (!current || viewMode !== "look") {
    $subjectDot.hidden = true;
    return;
  }
  const r = canvasRect();
  const stageR = $stage.getBoundingClientRect();
  $subjectDot.style.left = r.left - stageR.left + current.subject.x * r.width + "px";
  $subjectDot.style.top = r.top - stageR.top + current.subject.y * r.height + "px";
  $subjectDot.hidden = false;
}

$stage.addEventListener("pointerdown", (e) => {
  if (!current || processing) return;
  const r = canvasRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  current.subject = { x, y };
  if (viewMode === "look") reprocess();
});

$("seg-view").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || processing) return;
  viewMode = btn.dataset.v;
  for (const b of $("seg-view").querySelectorAll("button")) b.classList.toggle("on", b === btn);
  reprocess();
});

$("btn-retake").addEventListener("click", () => {
  current = null;
  show("home");
});

// ---- export ----

$("seg-size").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  exportSize = btn.dataset.size;
  for (const b of $("seg-size").querySelectorAll("button")) b.classList.toggle("on", b === btn);
});

function exportName() {
  const d = (current.exif && current.exif.DateTimeOriginal && new Date(current.exif.DateTimeOriginal)) || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `JM_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${preset.name || "deli"}.jpg`
  );
}

async function renderExport() {
  let source = current.img;
  let w = current.w;
  let h = current.h;
  let subject = current.subject;
  let edge;

  if (exportSize === "square") {
    // 1:1 crop centred on the subject point, clamped to the frame
    const side = Math.min(w, h);
    let cx = Math.round(subject.x * w - side / 2);
    let cy = Math.round(subject.y * h - side / 2);
    cx = Math.max(0, Math.min(w - side, cx));
    cy = Math.max(0, Math.min(h - side, cy));
    const crop = document.createElement("canvas");
    crop.width = side;
    crop.height = side;
    crop.getContext("2d").drawImage(current.img, cx, cy, side, side, 0, 0, side, side);
    subject = { x: (subject.x * w - cx) / side, y: (subject.y * h - cy) / side };
    source = crop;
    w = h = side;
    edge = 1080;
  } else {
    edge = EXPORT_EDGES[exportSize] || 4096;
  }

  const res = engine.process(source, w, h, preset, subject, edge);
  const blob = await new Promise((resolve) => res.canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob;
}

async function withExport(fn) {
  if (!current || processing) return;
  setBusy(true);
  try {
    const blob = await renderExport();
    await fn(blob, exportName());
  } catch (err) {
    $meta.textContent = "Export failed. Try again.";
  } finally {
    setBusy(false);
    // restore the preview after the export render reused the engine canvas
    reprocess();
  }
}

$("btn-share").addEventListener("click", () =>
  withExport(async (blob, name) => {
    const file = new File([blob], name, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err && err.name !== "AbortError") download(blob, name);
      }
    } else {
      download(blob, name);
    }
  })
);

$("btn-download").addEventListener("click", () => withExport(async (blob, name) => download(blob, name)));

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

window.addEventListener("resize", placeSubjectDot);

// expose for the automated smoke test
window.__mc = { engine, getPreset: () => preset };

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
