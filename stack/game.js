(() => {
  "use strict";

  const BEST_KEY = "stack.best.v1";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $score = document.getElementById("score");
  const $best = document.getElementById("best");
  const $overlay = document.getElementById("overlay");
  const $ovTitle = document.getElementById("ov-title");
  const $ovSub = document.getElementById("ov-sub");
  const $ovHint = document.getElementById("ov-hint");

  let W = 0;
  let H = 0;
  let bh = 26; // block height in px

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bh = Math.max(22, Math.round(H * 0.034));
  }
  window.addEventListener("resize", resize);
  resize();

  let phase = "ready"; // ready | playing | over
  let blocks = []; // {x, w}, index i sits at world height i*bh
  let cur = null; // sliding block {x, w, dir, speed}
  let debris = []; // sliced pieces {x, w, yB, vy, rot, vr}
  let rings = []; // perfect-drop flashes {x, w, yB, age}
  let texts = []; // floating labels {str, x, yB, age}
  let camera = 0;
  let score = 0;
  let combo = 0;
  let hue0 = 200;
  let best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
  let overAt = 0;

  const baseW = () => Math.min(W * 0.62, 360);
  const groundY = () => H * 0.93;
  const screenY = (yB) => groundY() - (yB + bh) + camera; // screen y of a block's top edge

  function blockColor(i, l = 60) {
    return `hsl(${(hue0 + i * 7) % 360}, 65%, ${l}%)`;
  }

  function updateHud() {
    $score.textContent = score;
    $best.textContent = best > 0 ? `Best ${best}` : "";
  }

  function spawn() {
    const top = blocks[blocks.length - 1];
    const fromLeft = blocks.length % 2 === 1;
    cur = {
      w: top.w,
      x: fromLeft ? -top.w : W,
      dir: fromLeft ? 1 : -1,
      speed: Math.min(W * (0.45 + score * 0.014), W * 1.15),
    };
  }

  function reset() {
    hue0 = Math.floor(Math.random() * 360);
    blocks = [{ x: (W - baseW()) / 2, w: baseW() }];
    debris = [];
    rings = [];
    texts = [];
    camera = 0;
    score = 0;
    combo = 0;
    updateHud();
    spawn();
  }

  function gameOver() {
    phase = "over";
    overAt = performance.now();
    cur = null;
    const isRecord = score > best;
    if (isRecord) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    $ovTitle.textContent = "Game Over";
    $ovSub.innerHTML = isRecord
      ? `<strong>${score}</strong> blocks — new best! 🎉`
      : `<strong>${score}</strong> blocks · best ${best}`;
    $ovHint.textContent = "Tap to play again";
    $overlay.classList.remove("hidden");
    updateHud();
  }

  function drop() {
    const top = blocks[blocks.length - 1];
    const yB = blocks.length * bh;
    const left = Math.max(cur.x, top.x);
    const right = Math.min(cur.x + cur.w, top.x + top.w);
    const overlap = right - left;

    if (overlap <= 0) {
      debris.push({ x: cur.x, w: cur.w, yB, vy: 0, rot: 0, vr: (Math.random() - 0.5) * 5 });
      gameOver();
      return;
    }

    const tolerance = Math.max(6, W * 0.016);
    if (Math.abs(cur.x - top.x) <= tolerance) {
      // perfect drop: snap, and after 2+ in a row the block grows back a little
      combo++;
      let w = top.w;
      if (combo >= 2) w = Math.min(top.w + Math.max(5, W * 0.014), baseW());
      const x = top.x + (top.w - w) / 2;
      blocks.push({ x, w });
      rings.push({ x, w, yB, age: 0 });
      texts.push({ str: combo >= 2 ? `Perfect ×${combo}` : "Perfect", x: x + w / 2, yB, age: 0 });
    } else {
      combo = 0;
      const cutW = cur.w - overlap;
      const cutX = cur.x < top.x ? cur.x : right;
      debris.push({ x: cutX, w: cutW, yB, vy: 0, rot: 0, vr: (cutX < left ? -1 : 1) * (1 + Math.random() * 3) });
      blocks.push({ x: left, w: overlap });
    }

    score = blocks.length - 1;
    updateHud();
    spawn();
  }

  function tap() {
    if (phase === "playing") {
      drop();
    } else if (phase === "ready") {
      phase = "playing";
      $overlay.classList.add("hidden");
    } else if (phase === "over" && performance.now() - overAt > 450) {
      reset();
      phase = "playing";
      $overlay.classList.add("hidden");
    }
  }

  window.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    tap();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") tap();
  });
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBlock(x, yB, w, i, glow) {
    const y = screenY(yB);
    if (y > H + bh || y < -bh * 2) return;
    if (glow) {
      ctx.shadowColor = "rgba(255, 255, 255, 0.35)";
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = blockColor(i);
    roundRect(x, y, w, bh, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    // darker lip along the bottom edge for depth
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    roundRect(x, y + bh - 5, w, 5, 2.5);
    ctx.fill();
  }

  function update(dt) {
    if (phase === "playing" && cur) {
      cur.x += cur.dir * cur.speed * dt;
      const over = cur.w * 0.12;
      if (cur.x < -over) {
        cur.x = -over;
        cur.dir = 1;
      } else if (cur.x + cur.w > W + over) {
        cur.x = W + over - cur.w;
        cur.dir = -1;
      }
    }

    const target = Math.max(0, blocks.length * bh - H * 0.45);
    camera += (target - camera) * Math.min(1, dt * 6);

    for (const d of debris) {
      d.vy += 2400 * dt;
      d.yB -= d.vy * dt;
      d.rot += d.vr * dt;
    }
    debris = debris.filter((d) => screenY(d.yB) < H + 120);

    for (const r of rings) r.age += dt;
    rings = rings.filter((r) => r.age < 0.45);

    for (const t of texts) t.age += dt;
    texts = texts.filter((t) => t.age < 0.9);
  }

  function draw() {
    const hue = (hue0 + score * 3) % 360;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `hsl(${hue}, 42%, 20%)`);
    bg.addColorStop(1, `hsl(${(hue + 50) % 360}, 50%, 9%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < blocks.length; i++) {
      drawBlock(blocks[i].x, i * bh, blocks[i].w, i);
    }

    if (cur && phase === "playing") {
      drawBlock(cur.x, blocks.length * bh, cur.w, blocks.length, true);
    }

    for (const d of debris) {
      const y = screenY(d.yB);
      ctx.save();
      ctx.translate(d.x + d.w / 2, y + bh / 2);
      ctx.rotate(d.rot);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = blockColor(blocks.length, 45);
      roundRect(-d.w / 2, -bh / 2, d.w, bh, 6);
      ctx.fill();
      ctx.restore();
    }

    for (const r of rings) {
      const k = r.age / 0.45;
      const grow = 14 * k;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      roundRect(r.x - grow, screenY(r.yB) - grow, r.w + grow * 2, bh + grow * 2, 9 + grow);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const t of texts) {
      const k = t.age / 0.9;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = "#ffd60a";
      ctx.font = `700 ${Math.round(bh * 0.75)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(t.str, t.x, screenY(t.yB) - 12 - 30 * k);
      ctx.globalAlpha = 1;
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  reset();
  updateHud();
  requestAnimationFrame(loop);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
