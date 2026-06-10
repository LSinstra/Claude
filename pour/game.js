(() => {
  "use strict";

  const SAVE_KEY = "pour.save.v1";
  const CAP = 4; // segments per tube

  const PALETTE = [
    "#ff453a", // red
    "#ff9f0a", // orange
    "#ffd60a", // yellow
    "#bcec30", // lime
    "#32d74b", // green
    "#00c7be", // teal
    "#64d2ff", // sky
    "#0a84ff", // blue
    "#5e5ce6", // indigo
    "#bf5af2", // purple
    "#ff6ac1", // pink
    "#f2f2f7", // white
  ];

  const TILT_MS = 240;
  const POUR_MS = 340;
  const RETURN_MS = 240;

  const $level = document.getElementById("level");
  const $tubes = document.getElementById("tubes");
  const $undo = document.getElementById("undo");
  const $restart = document.getElementById("restart");
  const $extra = document.getElementById("extra");
  const $overlay = document.getElementById("overlay");
  const $ovTitle = document.getElementById("ov-title");
  const $ovSub = document.getElementById("ov-sub");
  const $ovHint = document.getElementById("ov-hint");

  let level = 1;
  let tubes = []; // array of arrays of palette indices, bottom -> top
  let initial = []; // deal at level start, for restart
  let undoStack = [];
  let extraUsed = false;
  let sel = -1;
  let overlayMode = null; // "win" | "stuck" | null
  let animating = false;

  const deep = (t) => t.map((a) => a.slice());

  function shade(hex, k) {
    // k > 0 mixes toward white, k < 0 toward black
    const n = parseInt(hex.slice(1), 16);
    const t = k < 0 ? 0 : 255;
    const p = Math.abs(k);
    const ch = (v) => Math.round(v + (t - v) * p);
    return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function genLevel(lv) {
    const nColors = Math.min(PALETTE.length, 2 + Math.ceil((lv - 1) / 2));
    let deal = [];
    for (let tries = 0; tries < 60; tries++) {
      const pool = [];
      for (let c = 0; c < nColors; c++) for (let k = 0; k < CAP; k++) pool.push(c);
      shuffle(pool);
      deal = [];
      for (let c = 0; c < nColors; c++) deal.push(pool.slice(c * CAP, (c + 1) * CAP));
      // re-deal if any tube comes out pre-sorted
      if (nColors === 1 || !deal.some((t) => t.every((x) => x === t[0]))) break;
    }
    deal.push([], []);
    return deal;
  }

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ level, tubes, initial, extraUsed }));
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && Array.isArray(s.tubes) && s.tubes.length) {
        level = s.level || 1;
        tubes = s.tubes;
        initial = Array.isArray(s.initial) && s.initial.length ? s.initial : deep(tubes);
        extraUsed = !!s.extraUsed;
        return true;
      }
    } catch {}
    return false;
  }

  function newLevel() {
    tubes = genLevel(level);
    initial = deep(tubes);
    undoStack = [];
    extraUsed = false;
    sel = -1;
    save();
    render();
  }

  const isPure = (t) => t.every((x) => x === t[0]);
  const won = () => tubes.every((t) => !t.length || (t.length === CAP && isPure(t)));

  function topRun(t) {
    if (!t.length) return 0;
    const c = t[t.length - 1];
    let k = 1;
    while (k < t.length && t[t.length - 1 - k] === c) k++;
    return k;
  }

  function canPour(a, b) {
    if (a === b) return false;
    const A = tubes[a];
    const B = tubes[b];
    if (!A.length || B.length >= CAP) return false;
    return !B.length || B[B.length - 1] === A[A.length - 1];
  }

  function hasUsefulMove() {
    for (let a = 0; a < tubes.length; a++) {
      for (let b = 0; b < tubes.length; b++) {
        // pouring an already-sorted tube into an empty one goes nowhere
        if (canPour(a, b) && !(isPure(tubes[a]) && !tubes[b].length)) return true;
      }
    }
    return false;
  }

  function showOverlay(mode) {
    overlayMode = mode;
    if (mode === "win") {
      $ovTitle.textContent = `Level ${level} cleared! 🎉`;
      $ovSub.textContent = "Every color sorted. Nicely done.";
      $ovHint.textContent = `Tap for level ${level + 1}`;
    } else {
      $ovTitle.textContent = "No moves left 😬";
      $ovSub.textContent = "Undo a few pours, restart the level, or grab the extra tube.";
      $ovHint.textContent = "Tap to go back";
    }
    $overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlayMode = null;
    $overlay.classList.add("hidden");
  }

  function pour(a, b) {
    animating = true;
    undoStack.push(deep(tubes));
    if (undoStack.length > 200) undoStack.shift();

    const A = tubes[a];
    const B = tubes[b];
    const color = A[A.length - 1];
    const hex = PALETTE[color];
    const amount = Math.min(topRun(A), CAP - B.length);
    const srcRunLen = topRun(A);
    const tgtRunLen = B.length ? topRun(B) : 0;
    const tgtFill = B.length;

    const srcEl = $tubes.children[a];
    const tgtEl = $tubes.children[b];
    srcEl.classList.remove("selected");
    sel = -1;

    const s = srcEl.getBoundingClientRect();
    const t = tgtEl.getBoundingClientRect();

    // fly the tube so its mouth (top center, the transform origin) hovers
    // above the target, tilted with the body swinging back the way it came
    const side = s.left + s.width / 2 <= t.left + t.width / 2 ? 1 : -1;
    const mouthX = t.left + t.width / 2;
    const mouthY = t.top - 26;
    const dx = mouthX - (s.left + s.width / 2);
    const dy = mouthY - s.top;
    srcEl.classList.add("pouring");
    srcEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${side * 70}deg)`;

    setTimeout(() => {
      // liquid stream from the mouth down to the target's surface
      const surfaceY = t.top + 3 + (t.height - 6) * (1 - tgtFill / CAP);
      const stream = document.createElement("div");
      stream.className = "stream";
      stream.style.left = mouthX - 3 + "px";
      stream.style.top = mouthY + 6 + "px";
      stream.style.height = Math.max(10, surfaceY - mouthY - 6) + "px";
      stream.style.background = `linear-gradient(180deg, ${shade(hex, 0.3)}, ${hex})`;
      document.body.append(stream);

      // drain the source's top run
      const srcRunEl = srcEl.querySelector(".liquid").lastElementChild;
      const newSrcH = (srcRunLen - amount) * 25;
      srcRunEl.style.height = newSrcH + "%";
      if (newSrcH === 0) srcRunEl.style.opacity = "0";

      // raise the target's level
      const tgtLiquid = tgtEl.querySelector(".liquid");
      if (tgtFill > 0) {
        tgtLiquid.lastElementChild.style.height = (tgtRunLen + amount) * 25 + "%";
      } else {
        const run = makeRun(color, 0, true);
        tgtLiquid.append(run);
        run.offsetHeight; // flush layout so the height change transitions
        run.style.height = amount * 25 + "%";
      }

      setTimeout(() => {
        stream.style.transition = "transform 0.14s ease";
        stream.style.transformOrigin = "bottom";
        stream.style.transform = "scaleY(0)";
        setTimeout(() => stream.remove(), 150);

        srcEl.style.transform = "";

        // commit the move
        for (let i = 0; i < amount; i++) B.push(A.pop());
        save();

        setTimeout(() => {
          render();
          animating = false;
          if (won()) showOverlay("win");
          else if (!hasUsefulMove()) showOverlay("stuck");
        }, RETURN_MS);
      }, POUR_MS);
    }, TILT_MS);
  }

  function tapTube(i) {
    if (overlayMode || animating) return;
    if (sel < 0) {
      if (tubes[i].length) {
        sel = i;
        render();
      }
    } else if (sel === i) {
      sel = -1;
      render();
    } else if (canPour(sel, i)) {
      pour(sel, i);
    } else {
      sel = tubes[i].length ? i : -1;
      render();
    }
  }

  function makeRun(c, n, isTop) {
    const el = document.createElement("div");
    el.className = "run";
    const hex = PALETTE[c];
    el.style.height = n * 25 + "%";
    el.style.background = `linear-gradient(180deg, ${shade(hex, 0.22)} 0%, ${hex} 45%, ${shade(hex, -0.14)} 100%)`;
    if (isTop) {
      const surface = document.createElement("div");
      surface.className = "surface";
      surface.style.background = shade(hex, 0.42);
      el.append(surface);
    }
    return el;
  }

  function runsOf(t) {
    const runs = [];
    for (const c of t) {
      const last = runs[runs.length - 1];
      if (last && last.c === c) last.n++;
      else runs.push({ c, n: 1 });
    }
    return runs;
  }

  function render() {
    $level.textContent = `Level ${level}`;
    $undo.disabled = !undoStack.length;
    $extra.disabled = extraUsed;

    $tubes.replaceChildren(
      ...tubes.map((t, i) => {
        const tube = document.createElement("div");
        tube.className = "tube" + (i === sel ? " selected" : "");
        const liquid = document.createElement("div");
        liquid.className = "liquid";
        const runs = runsOf(t);
        runs.forEach((r, j) => liquid.append(makeRun(r.c, r.n, j === runs.length - 1)));
        tube.append(liquid);
        tube.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          tapTube(i);
        });
        return tube;
      })
    );
  }

  $undo.addEventListener("click", () => {
    if (!undoStack.length || animating) return;
    tubes = undoStack.pop();
    sel = -1;
    hideOverlay();
    save();
    render();
  });

  $restart.addEventListener("click", () => {
    if (animating) return;
    tubes = deep(initial);
    undoStack = [];
    extraUsed = false;
    sel = -1;
    hideOverlay();
    save();
    render();
  });

  $extra.addEventListener("click", () => {
    if (extraUsed || animating) return;
    undoStack.push(deep(tubes));
    tubes = tubes.concat([[]]);
    extraUsed = true;
    sel = -1;
    hideOverlay();
    save();
    render();
  });

  $overlay.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (overlayMode === "win") {
      level++;
      hideOverlay();
      newLevel();
    } else {
      hideOverlay();
    }
  });

  document.addEventListener("gesturestart", (e) => e.preventDefault());

  if (!load() || won()) {
    newLevel();
  } else {
    render();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
