(() => {
  "use strict";

  const SAVE_KEY = "t2.companion.v1";

  // informational prices from t-2.net, June 2026
  const PACKAGES = [
    {
      id: "start",
      name: "Oranžni Start",
      promo: 29.99,
      regular: 45.99,
      blurb: "Osnovni paket za manjše gospodinjstvo — internet in osnovna TV shema.",
    },
    {
      id: "optimum",
      name: "Oranžni Optimum",
      promo: 29.99,
      regular: 63.99,
      blurb: "Najbolj uravnotežen paket: hitrejši internet in bogatejša TV shema.",
    },
    {
      id: "diamant",
      name: "Oranžni Diamant HBO",
      promo: 29.99,
      regular: 87.99,
      blurb: "Premium TV z vključenim HBO — za serije in filme brez dodatkov.",
    },
    {
      id: "king",
      name: "Oranžni King",
      promo: 59.99,
      regular: 99.99,
      blurb: "Najzmogljivejši paket za velika gospodinjstva — vse najvišje, kar T-2 ponuja.",
    },
  ];

  const $viewTitle = document.getElementById("view-title");
  const $reco = document.getElementById("reco");
  const $packages = document.getElementById("packages");
  const $promoStatus = document.getElementById("promo-status");
  const $billChart = document.getElementById("bill-chart");
  const $billList = document.getElementById("bill-list");
  const $billSummary = document.getElementById("bill-summary");

  const VIEW_TITLES = { paketi: "Paketi", stroski: "Stroški", pomoc: "Pomoč" };

  let state = {
    quiz: { tv: 1, speed: 1, budget: 0 },
    promo: null, // {price, regular, start: "YYYY-MM", months}
    bills: [], // {when: "YYYY-MM", amount}
  };

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === "object") {
        state = {
          quiz: { tv: 1, speed: 1, budget: 0, ...(s.quiz || {}) },
          promo: s.promo || null,
          bills: Array.isArray(s.bills) ? s.bills : [],
        };
      }
    } catch {}
  }

  const eur = (n) =>
    n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  function mesecev(n) {
    if (n === 1) return "mesec";
    if (n === 2) return "meseca";
    if (n === 3 || n === 4) return "mesece";
    return "mesecev";
  }

  // ─── tabs ───

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === tab));
      const view = tab.dataset.view;
      document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
      $viewTitle.textContent = VIEW_TITLES[view];
      window.scrollTo(0, 0);
    });
  });

  // ─── paketi ───

  function recommend() {
    const { tv, speed, budget } = state.quiz;
    if (tv === 2) {
      if (speed === 2 && budget === 1) {
        return ["king", "Premium TV in najvišja hitrost — King združi vse, kar T-2 ponuja."];
      }
      return ["diamant", "HBO je vključen samo v Diamant HBO in King — Diamant je cenejša pot do premium vsebin."];
    }
    if (tv === 0) {
      return ["start", "Brez TV potreb je Start najcenejši vstop. Preveri tudi T2 NET pakete brez televizije na t-2.net."];
    }
    if (speed === 2) {
      return budget === 1
        ? ["king", "Za najvišje hitrosti in polno shemo je King prava izbira."]
        : ["optimum", "Optimum ponuja odlično razmerje med hitrostjo in ceno."];
    }
    if (speed === 0 && budget === 0) {
      return ["start", "Za osnovne potrebe in najnižji strošek zadošča Start."];
    }
    return ["optimum", "Najbolj uravnotežena izbira za večino gospodinjstev."];
  }

  function renderPaketi() {
    document.querySelectorAll(".seg").forEach((seg) => {
      const q = seg.dataset.q;
      seg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", Number(b.dataset.v) === state.quiz[q]);
      });
    });

    const [id, why] = recommend();
    const p = PACKAGES.find((x) => x.id === id);
    $reco.innerHTML = `
      <div class="pkg-row">
        <h3>✨ ${p.name}</h3>
        <span class="price"><s>${eur(p.regular)}</s>od ${eur(p.promo)}<small>/mes</small></span>
      </div>
      <p class="why">${why}</p>`;

    $packages.replaceChildren(
      ...PACKAGES.map((pkg) => {
        const el = document.createElement("article");
        el.className = "pkg";
        el.innerHTML = `
          <div class="pkg-row">
            <h3>${pkg.name}</h3>
            <span class="price"><s>${eur(pkg.regular)}</s>od ${eur(pkg.promo)}<small>/mes</small></span>
          </div>
          <p>${pkg.blurb}</p>`;
        return el;
      })
    );
  }

  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      state.quiz[seg.dataset.q] = Number(btn.dataset.v);
      save();
      renderPaketi();
    });
  });

  // ─── stroški: promo countdown ───

  const $pPrice = document.getElementById("promo-price");
  const $pRegular = document.getElementById("promo-regular");
  const $pStart = document.getElementById("promo-start");
  const $pMonths = document.getElementById("promo-months");

  function renderPromo() {
    const p = state.promo;
    if (p) {
      $pPrice.value = p.price;
      $pRegular.value = p.regular;
      $pStart.value = p.start;
      $pMonths.value = p.months;
    }
    if (!p) {
      $promoStatus.innerHTML = "";
      return;
    }

    const [y, m] = p.start.split("-").map(Number);
    const end = new Date(y, m - 1 + p.months, 1);
    const now = new Date();
    const monthsLeft =
      (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
    const jump = p.regular - p.price;
    const endStr = end.toLocaleDateString("sl-SI", { month: "long", year: "numeric" });
    const done = Math.min(1, Math.max(0, (p.months - monthsLeft) / p.months));

    let msg;
    let warn = false;
    if (monthsLeft <= 0) {
      warn = true;
      msg = `⚠️ Akcija se je <strong>iztekla</strong> (${endStr}). Račun je zdaj predvidoma
        <strong class="jump">${eur(p.regular)}/mes</strong> — pokliči T-2 in se pogajaj za novo akcijo.`;
    } else if (monthsLeft <= 2) {
      warn = true;
      msg = `⚠️ Akcija poteče čez <strong>${monthsLeft} ${mesecev(monthsLeft)}</strong> (${endStr}).
        Potem račun zraste za <strong class="jump">+${eur(jump)}/mes</strong> (${eur(jump * 12)}/leto).
        Zdaj je pravi čas za klic na T-2.`;
    } else {
      msg = `Akcijska cena velja še <strong>${monthsLeft} ${mesecev(monthsLeft)}</strong> — do ${endStr}.
        Potem se račun z ${eur(p.price)} dvigne na ${eur(p.regular)} (<strong>+${eur(jump)}/mes</strong>).`;
    }

    $promoStatus.innerHTML = `
      <div class="status-box${warn ? " warn" : ""}">${msg}
        <div class="meter"><div style="width:${Math.round(done * 100)}%"></div></div>
      </div>`;
  }

  document.getElementById("promo-save").addEventListener("click", () => {
    const price = parseFloat($pPrice.value);
    const regular = parseFloat($pRegular.value);
    const start = $pStart.value;
    const months = parseInt($pMonths.value, 10);
    if (!isFinite(price) || !isFinite(regular) || !start || !months) {
      $promoStatus.innerHTML = `<div class="status-box warn">Izpolni vsa štiri polja. 🙂</div>`;
      return;
    }
    state.promo = { price, regular, start, months };
    save();
    renderPromo();
  });

  // ─── stroški: bills ───

  const $billAmount = document.getElementById("bill-amount");

  function monthLabel(when) {
    const [y, m] = when.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("sl-SI", { month: "short", year: "2-digit" });
  }

  function renderBills() {
    const bills = state.bills.slice(-8); // chart shows the last 8
    const max = Math.max(...bills.map((b) => b.amount), 1);
    $billChart.replaceChildren(
      ...bills.map((b) => {
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.height = Math.max(8, (b.amount / max) * 100) + "%";
        bar.innerHTML = `<span>${monthLabel(b.when)}</span>`;
        return bar;
      })
    );

    $billList.replaceChildren(
      ...state.bills
        .slice()
        .reverse()
        .map((b, ri) => {
          const i = state.bills.length - 1 - ri;
          const li = document.createElement("li");
          li.innerHTML = `<span class="when">${monthLabel(b.when)}</span><span>${eur(b.amount)}</span>`;
          const del = document.createElement("button");
          del.textContent = "✕";
          del.setAttribute("aria-label", "Izbriši");
          del.addEventListener("click", () => {
            state.bills.splice(i, 1);
            save();
            renderBills();
          });
          li.append(del);
          return li;
        })
    );

    if (state.bills.length) {
      const n = state.bills.length;
      const racunov = n === 1 ? "račun" : n === 2 ? "računa" : n <= 4 ? "računi" : "računov";
      const sum = state.bills.reduce((a, b) => a + b.amount, 0);
      $billSummary.textContent = `${n} ${racunov} · skupaj ${eur(sum)} · povprečje ${eur(sum / n)}/mes`;
    } else {
      $billSummary.textContent = "Dodaj znesek računa vsak mesec in spremljaj, kam gre denar.";
    }
  }

  document.getElementById("bill-add").addEventListener("click", () => {
    const amount = parseFloat($billAmount.value);
    if (!isFinite(amount) || amount <= 0) return;
    const now = new Date();
    const when = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    state.bills.push({ when, amount });
    $billAmount.value = "";
    save();
    renderBills();
  });

  // ─── init ───

  load();
  if (!state.promo) {
    const now = new Date();
    $pStart.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    $pMonths.value = 12;
  }
  renderPaketi();
  renderPromo();
  renderBills();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
