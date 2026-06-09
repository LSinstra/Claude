(() => {
  "use strict";

  const STORAGE_KEY = "memo.notes.v1";

  const $notes = document.getElementById("notes");
  const $empty = document.getElementById("empty");
  const $emptyTitle = document.getElementById("empty-title");
  const $emptySub = document.getElementById("empty-sub");
  const $count = document.getElementById("count");
  const $search = document.getElementById("search");
  const $form = document.getElementById("composer-form");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");

  let notes = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

    if (dayDiff === 0) return `Today at ${time}`;
    if (dayDiff === 1) return `Yesterday at ${time}`;

    const opts = { day: "numeric", month: "short" };
    if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
    return `${d.toLocaleDateString([], opts)} at ${time}`;
  }

  function render() {
    const query = $search.value.trim().toLowerCase();
    const visible = query
      ? notes.filter((n) => n.text.toLowerCase().includes(query))
      : notes;

    $count.textContent =
      notes.length === 0 ? "" : notes.length === 1 ? "1 memo" : `${notes.length} memos`;

    $notes.replaceChildren(
      ...visible.map((note) => {
        const card = document.createElement("article");
        card.className = "note";

        const body = document.createElement("div");
        body.className = "note-body";

        const text = document.createElement("p");
        text.className = "note-text";
        text.textContent = note.text;

        const time = document.createElement("p");
        time.className = "note-time";
        time.textContent = formatTime(note.ts);

        body.append(text, time);

        const del = document.createElement("button");
        del.className = "note-delete";
        del.type = "button";
        del.setAttribute("aria-label", "Delete memo");
        del.textContent = "✕";
        del.addEventListener("click", () => {
          notes = notes.filter((n) => n.id !== note.id);
          save();
          render();
        });

        card.append(body, del);
        return card;
      })
    );

    const showEmpty = visible.length === 0;
    $empty.hidden = !showEmpty;
    if (showEmpty) {
      if (query) {
        $emptyTitle.textContent = "No matches";
        $emptySub.textContent = `Nothing found for “${$search.value.trim()}”.`;
      } else {
        $emptyTitle.textContent = "No memos yet";
        $emptySub.textContent = "Write your first note below — it stays on this device.";
      }
    }
  }

  function addNote() {
    const text = $input.value.trim();
    if (!text) return;
    notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text,
      ts: Date.now(),
    });
    save();
    $input.value = "";
    autosize();
    updateSend();
    render();
  }

  function autosize() {
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 120) + "px";
  }

  function updateSend() {
    $send.disabled = $input.value.trim() === "";
  }

  $form.addEventListener("submit", (e) => {
    e.preventDefault();
    addNote();
  });

  $input.addEventListener("input", () => {
    autosize();
    updateSend();
  });

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addNote();
    }
  });

  $search.addEventListener("input", render);

  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
