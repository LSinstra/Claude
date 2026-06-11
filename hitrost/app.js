(() => {
  "use strict";

  const SAVE_KEY = "hitrost.v1";
  const DOWN = "https://speed.cloudflare.com/__down?bytes=";
  const UP = "https://speed.cloudflare.com/__up";
  const CIRC = 540.35; // gauge circle circumference

  const $mbps = document.getElementById("mbps");
  const $phase = document.getElementById("phase");
  const $bar = document.getElementById("gauge-bar");
  const $start = document.getElementById("start");
  const $down = document.getElementById("stat-down");
  const $up = document.getElementById("stat-up");
  const $ping = document.getElementById("stat-ping");
  const $planDown = document.getElementById("plan-down");
  const $planUp = document.getElementById("plan-up");
  const $verdict = document.getElementById("verdict");
  const $chart = document.getElementById("chart");
  const $history = document.getElementById("history");
  const $historyEmpty = document.getElementById("history-empty");
  const $clear = document.getElementById("clear");

  let state = { plan: { down: null, up: null }, history: [] };
  let running = false;

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === "object") {
        state.plan = s.plan || { down: null, up: null };
        state.history = Array.isArray(s.history) ? s.history : [];
      }
    } catch {}
  }

  const mbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;
  const fmt = (m) => (m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : m.toFixed(2));

  function gauge(m) {
    $mbps.textContent = m == null ? "—" : fmt(m);
    // log scale: 1000 Mbit/s fills the ring
    const pct = m == null ? 0 : Math.min(1, Math.log10(1 + m) / 3);
    $bar.style.strokeDashoffset = CIRC * (1 - pct);
  }

  function setPhase(label, busy) {
    $phase.textContent = label;
    $phase.classList.toggle("busy", !!busy);
  }

  // ─── measurement ───

  async function measurePing() {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await fetch(DOWN + "0&_=" + Math.random(), { cache: "no-store" });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return Math.round(times[Math.floor(times.length / 2)]);
  }

  async function timedDownload(bytes, onProgress, signal) {
    const t0 = performance.now();
    const res = await fetch(DOWN + bytes + "&_=" + Math.random(), { cache: "no-store", signal });
    const reader = res.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      onProgress(received, performance.now() - t0);
    }
    return { bytes: received, ms: performance.now() - t0 };
  }

  async function measureDownload() {
    await timedDownload(1e6, () => {}); // warmup, not counted
    let result = 0;
    for (const size of [1e7, 5e7, 2e8]) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let last = { bytes: 0, ms: 1 };
      try {
        last = await timedDownload(
          size,
          (bytes, ms) => {
            last = { bytes, ms };
            if (ms > 250) gauge(mbps(bytes, ms));
          },
          ctrl.signal
        );
      } catch (e) {
        if (e.name !== "AbortError") throw e;
      }
      clearTimeout(timer);
      if (last.ms > 400) result = mbps(last.bytes, last.ms);
      gauge(result);
      // a transfer that ran 2.5s+ is a solid sample; otherwise escalate size
      if (last.ms > 2500) break;
    }
    return result;
  }

  function randomBlob(size) {
    const buf = new Uint8Array(size);
    for (let o = 0; o < size; o += 65536) {
      crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, size)));
    }
    return new Blob([buf]);
  }

  async function timedUpload(size) {
    const blob = randomBlob(size);
    const t0 = performance.now();
    const res = await fetch(UP, { method: "POST", body: blob });
    await res.text();
    return { bytes: size, ms: performance.now() - t0 };
  }

  async function measureUpload() {
    let r = await timedUpload(2e6);
    let m = mbps(r.bytes, r.ms);
    gauge(m);
    if (r.ms < 2000) {
      r = await timedUpload(2e7);
      m = mbps(r.bytes, r.ms);
      gauge(m);
    }
    return m;
  }

  async function runTest() {
    if (running) return;
    running = true;
    $start.disabled = true;
    $down.textContent = $up.textContent = $ping.textContent = "—";
    gauge(null);

    try {
      setPhase("zakasnitev …", true);
      const ping = await measurePing();
      $ping.textContent = ping + " ms";

      setPhase("prenos ↓", true);
      const down = await measureDownload();
      $down.textContent = fmt(down);

      setPhase("nalaganje ↑", true);
      const up = await measureUpload();
      $up.textContent = fmt(up);

      gauge(down);
      setPhase("končano");
      state.history.push({ ts: Date.now(), down, up, ping });
      if (state.history.length > 50) state.history.shift();
      save();
      renderHistory();
      renderVerdict();
    } catch {
      setPhase("meritev ni uspela");
      $mbps.textContent = "—";
    }

    $start.disabled = false;
    $start.textContent = "Ponovi meritev";
    running = false;
  }

  // ─── plan & verdict ───

  function renderVerdict() {
    const last = state.history[state.history.length - 1];
    const plan = state.plan.down;
    if (!last || !plan) {
      $verdict.innerHTML = "";
      return;
    }
    const pct = Math.round((last.down / plan) * 100);
    let cls, msg;
    if (pct >= 90) {
      cls = "good";
      msg = `✅ Zadnja meritev dosega <span class="pct">${pct} %</span> obljubljene hitrosti (${fmt(last.down)} od ${plan} Mbit/s). Vse, kot mora biti.`;
    } else if (pct >= 60) {
      cls = "meh";
      msg = `🟡 Zadnja meritev dosega <span class="pct">${pct} %</span> obljubljene hitrosti. Poskusi še s kablom ali tik ob usmerjevalniku — Wi-Fi pogosto vzame velik kos.`;
    } else {
      cls = "bad";
      msg = `🔴 Samo <span class="pct">${pct} %</span> obljubljene hitrosti (${fmt(last.down)} od ${plan} Mbit/s). Če se ponavlja tudi prek kabla, pokliči T-2 na 064 064 064.`;
    }
    $verdict.innerHTML = `<div class="verdict ${cls}">${msg}</div>`;
  }

  function planChanged() {
    const d = parseFloat($planDown.value);
    const u = parseFloat($planUp.value);
    state.plan = { down: isFinite(d) && d > 0 ? d : null, up: isFinite(u) && u > 0 ? u : null };
    save();
    renderVerdict();
  }

  $planDown.addEventListener("input", planChanged);
  $planUp.addEventListener("input", planChanged);

  // ─── history ───

  function renderHistory() {
    const items = state.history;
    $historyEmpty.hidden = items.length > 0;
    $clear.hidden = items.length === 0;

    const recent = items.slice(-8);
    const max = Math.max(...recent.map((h) => h.down), 1);
    $chart.replaceChildren(
      ...recent.map((h) => {
        const bar = document.createElement("div");
        bar.className = "chart-bar";
        bar.style.height = Math.max(6, (h.down / max) * 100) + "%";
        return bar;
      })
    );

    $history.replaceChildren(
      ...items
        .slice(-10)
        .reverse()
        .map((h) => {
          const li = document.createElement("li");
          const when = new Date(h.ts).toLocaleString("sl-SI", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          li.innerHTML = `<span class="when">${when}</span><span class="d">↓ ${fmt(h.down)}</span><span>↑ ${fmt(h.up)}</span><span>${h.ping} ms</span>`;
          return li;
        })
    );
  }

  $clear.addEventListener("click", () => {
    state.history = [];
    save();
    renderHistory();
    renderVerdict();
  });

  $start.addEventListener("click", runTest);

  // ─── init ───

  load();
  if (state.plan.down) $planDown.value = state.plan.down;
  if (state.plan.up) $planUp.value = state.plan.up;
  renderHistory();
  renderVerdict();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
