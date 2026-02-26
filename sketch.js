// IMDb Top 250 Finder (Apply-to-filter version)
const CSV_PATH = "top_250_imdb_dataset.csv";
const PRESENT_YEAR = new Date().getFullYear(); // will be 2026 for you right now

const state = {
  raw: [],
  filtered: [],

  // filters the user is currently selecting (NOT applied yet)
  pending: {
    yearMin: null,
    yearMax: null,
    runtimeBuckets: new Set(),
    ratings: new Set(),
    sort: "rank-asc"
  },

  // filters that are currently applied to the results
  applied: {
    yearMin: null,
    yearMax: null,
    runtimeBuckets: new Set(),
    ratings: new Set(),
    sort: "rank-asc"
  },

  dirty: false,

  runtimeBucketDefs: [
    { id: "lt90", label: "< 90", min: 0, max: 89 },
    { id: "90_120", label: "90–120", min: 90, max: 120 },
    { id: "121_150", label: "121–150", min: 121, max: 150 },
    { id: "151_180", label: "151–180", min: 151, max: 180 },
    { id: "gt180", label: "> 180", min: 181, max: Infinity }
  ],

  ratingOptions: [] // built from CSV "Certificate" column
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheEls();
  wireUI();

  try {
    setStatus("Loading dataset…", "warn");
    const text = await fetch(CSV_PATH).then(r => {
      if (!r.ok) throw new Error(`Could not load ${CSV_PATH} (${r.status})`);
      return r.text();
    });

    state.raw = parseCSV(text);

    if (!state.raw.length) throw new Error("Dataset parsed as empty.");

    buildYearDropdowns(1900, PRESENT_YEAR);
    buildRatingOptions();
    buildChecklists();

    // Show full list immediately
    applyCurrentSortOnly();
    renderAll();

    setStatus(`Loaded ${state.raw.length} films`, "ok");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load dataset. Check CSV path / server.", "error");
    els.resultsMeta.textContent = "Could not load CSV. Use a local server (Live Server / python http.server).";
  }
}

function cacheEls() {
  els.statusPill = document.getElementById("statusPill");
  els.statusText = document.getElementById("statusText");

  els.sortSelect = document.getElementById("sortSelect");

  els.yearMinSelect = document.getElementById("yearMinSelect");
  els.yearMaxSelect = document.getElementById("yearMaxSelect");
  els.yearRangeLabel = document.getElementById("yearRangeLabel");

  els.runtimeChecks = document.getElementById("runtimeChecks");
  els.ratingChecks = document.getElementById("ratingChecks");

  els.applyBtn = document.getElementById("applyBtn");
  els.applyHint = document.getElementById("applyHint");

  els.resetBtn = document.getElementById("resetBtn");
  els.grid = document.getElementById("movieGrid");
  els.resultsMeta = document.getElementById("resultsMeta");
  els.empty = document.getElementById("emptyState");
  els.emptyResetBtn = document.getElementById("emptyResetBtn");
  els.activeChips = document.getElementById("activeChips");
}

function wireUI() {
  // Sort can be pending; only affects list when Apply is clicked (per your request).
  els.sortSelect.addEventListener("change", () => {
    state.pending.sort = els.sortSelect.value;
    markDirty();
  });

  els.yearMinSelect.addEventListener("change", () => {
    state.pending.yearMin = parseNullableInt(els.yearMinSelect.value);
    clampYearDropdowns();
    updateYearLabel(state.pending.yearMin, state.pending.yearMax);
    markDirty();
  });

  els.yearMaxSelect.addEventListener("change", () => {
    state.pending.yearMax = parseNullableInt(els.yearMaxSelect.value);
    clampYearDropdowns();
    updateYearLabel(state.pending.yearMin, state.pending.yearMax);
    markDirty();
  });

  els.applyBtn.addEventListener("click", () => {
    applyPendingFilters();
  });

  els.resetBtn.addEventListener("click", resetAll);
  els.emptyResetBtn.addEventListener("click", resetAll);
}

function markDirty() {
  state.dirty = true;
  els.applyBtn.disabled = false;
  els.applyHint.hidden = false;
}

function clearDirty() {
  state.dirty = false;
  els.applyBtn.disabled = true;
  els.applyHint.hidden = true;
}

function applyPendingFilters() {
  // copy pending -> applied
  state.applied.yearMin = state.pending.yearMin;
  state.applied.yearMax = state.pending.yearMax;

  state.applied.runtimeBuckets = new Set(state.pending.runtimeBuckets);
  state.applied.ratings = new Set(state.pending.ratings);

  state.applied.sort = state.pending.sort;

  applyFiltersAndRender();
  clearDirty();
}

function resetAll() {
  // clear pending
  state.pending.yearMin = null;
  state.pending.yearMax = null;
  state.pending.runtimeBuckets.clear();
  state.pending.ratings.clear();
  state.pending.sort = "rank-asc";

  // clear applied
  state.applied.yearMin = null;
  state.applied.yearMax = null;
  state.applied.runtimeBuckets.clear();
  state.applied.ratings.clear();
  state.applied.sort = "rank-asc";

  // UI reset
  els.sortSelect.value = "rank-asc";
  setYearSelectValue(els.yearMinSelect, "");
  setYearSelectValue(els.yearMaxSelect, "");
  updateYearLabel(null, null);

  document.querySelectorAll('input[type="checkbox"][data-kind="runtime"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('input[type="checkbox"][data-kind="rating"]').forEach(cb => cb.checked = false);

  // show full list immediately
  applyFiltersAndRender();
  clearDirty();
}

function applyCurrentSortOnly() {
  // initial: show raw sorted by rank asc
  state.filtered = state.raw.slice().sort(sorter("rank-asc"));
}

function applyFiltersAndRender() {
  let out = state.raw.slice();

  // apply year
  if (state.applied.yearMin != null) out = out.filter(m => m.year != null && m.year >= state.applied.yearMin);
  if (state.applied.yearMax != null) out = out.filter(m => m.year != null && m.year <= state.applied.yearMax);

  // apply runtime buckets
  if (state.applied.runtimeBuckets.size > 0) {
    const selected = Array.from(state.applied.runtimeBuckets)
      .map(id => state.runtimeBucketDefs.find(b => b.id === id))
      .filter(Boolean);

    out = out.filter(m => {
      const d = m.durationMinutes;
      if (!Number.isFinite(d)) return false;
      return selected.some(b => d >= b.min && d <= b.max);
    });
  }

  // apply rating (CSV column is "Certificate")
  if (state.applied.ratings.size > 0) {
    out = out.filter(m => state.applied.ratings.has(m.ratingLabel));
  }

  // sort
  out.sort(sorter(state.applied.sort));

  state.filtered = out;
  renderAll();
}

function renderAll() {
  renderChips();
  renderMeta();
  renderGrid();
}

function renderMeta() {
  const total = state.raw.length;
  const shown = state.filtered.length;
  els.resultsMeta.textContent = `${shown} of ${total} films`;
}

function renderGrid() {
  els.grid.innerHTML = "";

  if (state.filtered.length === 0) {
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;

  for (const m of state.filtered) {
    els.grid.appendChild(movieCard(m));
  }
}

function movieCard(m) {
  const card = document.createElement("article");
  card.className = "card";

  const top = document.createElement("div");
  top.className = "card__top";

  const left = document.createElement("div");

  const rank = document.createElement("div");
  rank.className = "rank";
  rank.textContent = `#${m.rank}`;

  const title = document.createElement("h3");
  title.className = "title";
  title.textContent = m.title;

  left.appendChild(rank);
  left.appendChild(title);
  top.appendChild(left);

  const meta = document.createElement("div");
  meta.className = "meta";

  meta.appendChild(badge(String(m.year ?? "—"), true));
  meta.appendChild(badge(`${m.durationMinutes ?? "—"} min`, false));
  meta.appendChild(badge(m.ratingLabel, false));

  card.appendChild(top);
  card.appendChild(meta);
  return card;
}

function badge(text, strong=false){
  const b = document.createElement("span");
  b.className = strong ? "badge badge--strong" : "badge";
  b.textContent = text;
  return b;
}

function renderChips() {
  els.activeChips.innerHTML = "";

  const chips = [];

  if (state.applied.yearMin != null) chips.push({
    label: `Year ≥ ${state.applied.yearMin}`,
    onClear: () => { state.pending.yearMin = null; state.applied.yearMin = null; setYearSelectValue(els.yearMinSelect, ""); updateYearLabel(state.pending.yearMin, state.pending.yearMax); }
  });

  if (state.applied.yearMax != null) chips.push({
    label: `Year ≤ ${state.applied.yearMax}`,
    onClear: () => { state.pending.yearMax = null; state.applied.yearMax = null; setYearSelectValue(els.yearMaxSelect, ""); updateYearLabel(state.pending.yearMin, state.pending.yearMax); }
  });

  if (state.applied.runtimeBuckets.size > 0) {
    const labels = Array.from(state.applied.runtimeBuckets)
      .map(id => state.runtimeBucketDefs.find(b => b.id===id)?.label)
      .filter(Boolean);

    chips.push({
      label: `Runtime: ${labels.join(", ")}`,
      onClear: () => {
        state.pending.runtimeBuckets.clear();
        state.applied.runtimeBuckets.clear();
        document.querySelectorAll('input[type="checkbox"][data-kind="runtime"]').forEach(cb => cb.checked = false);
      }
    });
  }

  if (state.applied.ratings.size > 0) {
    const labels = Array.from(state.applied.ratings);
    chips.push({
      label: `Rating: ${labels.join(", ")}`,
      onClear: () => {
        state.pending.ratings.clear();
        state.applied.ratings.clear();
        document.querySelectorAll('input[type="checkbox"][data-kind="rating"]').forEach(cb => cb.checked = false);
      }
    });
  }

  if (state.applied.sort && state.applied.sort !== "rank-asc") {
    chips.push({
      label: `Sort: ${labelForSort(state.applied.sort)}`,
      onClear: () => {
        state.pending.sort = "rank-asc";
        state.applied.sort = "rank-asc";
        els.sortSelect.value = "rank-asc";
      }
    });
  }

  for (const c of chips) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = c.label;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Remove filter";
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      c.onClear();
      // after clearing an APPLIED chip, update results immediately
      applyFiltersAndRender();
      clearDirty();
    });

    chip.appendChild(btn);
    els.activeChips.appendChild(chip);
  }
}

function labelForSort(v){
  const map = {
    "rank-asc":"Rank (best → worst)",
    "rank-desc":"Rank (worst → best)",
    "year-desc":"Year (new → old)",
    "year-asc":"Year (old → new)",
    "runtime-desc":"Runtime (long → short)",
    "runtime-asc":"Runtime (short → long)",
    "title-asc":"Title (A → Z)",
    "title-desc":"Title (Z → A)"
  };
  return map[v] ?? v;
}

function sorter(mode){
  switch(mode){
    case "rank-desc": return (a,b) => b.rank - a.rank;
    case "year-desc": return (a,b) => (b.year ?? -9999) - (a.year ?? -9999) || a.rank - b.rank;
    case "year-asc": return (a,b) => (a.year ?? 9999) - (b.year ?? 9999) || a.rank - b.rank;
    case "runtime-desc": return (a,b) => (b.durationMinutes ?? -9999) - (a.durationMinutes ?? -9999) || a.rank - b.rank;
    case "runtime-asc": return (a,b) => (a.durationMinutes ?? 9999) - (b.durationMinutes ?? 9999) || a.rank - b.rank;
    case "title-desc": return (a,b) => b.title.localeCompare(a.title);
    case "title-asc": return (a,b) => a.title.localeCompare(b.title);
    case "rank-asc":
    default: return (a,b) => a.rank - b.rank;
  }
}
