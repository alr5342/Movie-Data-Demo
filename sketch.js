const CSV_PATH = "Data/top_250_imdb_dataset.csv";
const PRESENT_YEAR = new Date().getFullYear();
const WATCHED_KEY = "imdbTop250_watched_v1";

const state = {
  raw: [],
  filtered: [],
  pending: { yearMin: null, yearMax: null, runtime: new Set(), ratings: new Set(), sort: "rank-asc" },
  applied: { yearMin: null, yearMax: null, runtime: new Set(), ratings: new Set(), sort: "rank-asc" },
  runtimeDefs: [
    { id: "lt90", label: "< 90", min: 0, max: 89 },
    { id: "90_120", label: "90–120", min: 90, max: 120 },
    { id: "121_150", label: "121–150", min: 121, max: 150 },
    { id: "151_180", label: "151–180", min: 151, max: 180 },
    { id: "gt180", label: "> 180", min: 181, max: Infinity }
  ],
  ratingOptions: [],
  watched: new Set()
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  grabEls();
  bindUI();
  state.watched = loadWatched();

  try {
    const res = await fetch(CSV_PATH);
    if (!res.ok) throw new Error(`Could not load CSV (${res.status})`);
    const text = await res.text();
    state.raw = parseCSV(text);
    if (!state.raw.length) throw new Error("CSV parsed empty");

    buildYears(1900, PRESENT_YEAR);
    state.ratingOptions = getRatingOptions(state.raw);
    buildChecks();

    state.filtered = [...state.raw].sort(sorter("rank-asc"));
    render();
  } catch (e) {
    console.error(e);
    els.resultsMeta.textContent = "Dataset failed to load.";
  }
}

function grabEls() {
  els.sortSelect = document.getElementById("sortSelect");
  els.yearMinSelect = document.getElementById("yearMinSelect");
  els.yearMaxSelect = document.getElementById("yearMaxSelect");
  els.yearRangeLabel = document.getElementById("yearRangeLabel");
  els.runtimeChecks = document.getElementById("runtimeChecks");
  els.ratingChecks = document.getElementById("ratingChecks");
  els.applyBtn = document.getElementById("applyBtn");
  els.resetBtn = document.getElementById("resetBtn");
  els.emptyResetBtn = document.getElementById("emptyResetBtn");
  els.grid = document.getElementById("movieGrid");
  els.resultsMeta = document.getElementById("resultsMeta");
  els.empty = document.getElementById("emptyState");
  els.activeChips = document.getElementById("activeChips");
}

function bindUI() {
  els.sortSelect.addEventListener("change", () => { state.pending.sort = els.sortSelect.value; setDirty(true); });

  els.yearMinSelect.addEventListener("change", () => {
    state.pending.yearMin = toIntOrNull(els.yearMinSelect.value);
    clampYears();
    updateYearLabel();
    setDirty(true);
  });

  els.yearMaxSelect.addEventListener("change", () => {
    state.pending.yearMax = toIntOrNull(els.yearMaxSelect.value);
    clampYears();
    updateYearLabel();
    setDirty(true);
  });

  els.applyBtn.addEventListener("click", applyFilters);
  els.resetBtn.addEventListener("click", resetAll);
  els.emptyResetBtn.addEventListener("click", resetAll);
}

function setDirty(on) {
  els.applyBtn.disabled = !on;
}

function applyFilters() {
  state.applied.yearMin = state.pending.yearMin;
  state.applied.yearMax = state.pending.yearMax;
  state.applied.runtime = new Set(state.pending.runtime);
  state.applied.ratings = new Set(state.pending.ratings);
  state.applied.sort = state.pending.sort;

  let out = [...state.raw];

  if (state.applied.yearMin != null) out = out.filter(m => m.year >= state.applied.yearMin);
  if (state.applied.yearMax != null) out = out.filter(m => m.year <= state.applied.yearMax);

  if (state.applied.runtime.size) {
    const buckets = [...state.applied.runtime].map(id => state.runtimeDefs.find(b => b.id === id)).filter(Boolean);
    out = out.filter(m => buckets.some(b => m.durationMinutes >= b.min && m.durationMinutes <= b.max));
  }

  if (state.applied.ratings.size) {
    out = out.filter(m => state.applied.ratings.has(m.ratingLabel));
  }

  out.sort(sorter(state.applied.sort));
  state.filtered = out;
  render();
  setDirty(false);
}

function resetAll() {
  state.pending.yearMin = null;
  state.pending.yearMax = null;
  state.pending.runtime.clear();
  state.pending.ratings.clear();
  state.pending.sort = "rank-asc";

  state.applied.yearMin = null;
  state.applied.yearMax = null;
  state.applied.runtime.clear();
  state.applied.ratings.clear();
  state.applied.sort = "rank-asc";

  els.sortSelect.value = "rank-asc";
  els.yearMinSelect.value = "";
  els.yearMaxSelect.value = "";
  updateYearLabel();

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));

  state.filtered = [...state.raw].sort(sorter("rank-asc"));
  render();
  setDirty(false);
}

function render() {
  els.resultsMeta.textContent = `${state.filtered.length} of ${state.raw.length} films`;
  renderChips();
  renderGrid();
}

function renderGrid() {
  els.grid.innerHTML = "";

  if (!state.filtered.length) {
    els.empty.hidden = false;
    return;
  }

  els.empty.hidden = true;

  for (const m of state.filtered) {
    const id = movieId(m);
    const watched = state.watched.has(id);

    const card = document.createElement("div");
    card.className = "card" + (watched ? " is-watched" : "");

    const eye = document.createElement("button");
    eye.className = "eyeToggle";
    eye.type = "button";
    eye.setAttribute("aria-label", watched ? "Watched" : "Not watched");
    eye.innerHTML = watched ? eyeOpenSVG() : eyeClosedSVG();

    card.innerHTML = `
      <div class="card__top">
        <div>
          <div class="rank">#${m.rank}</div>
          <h3 class="title">${escapeHtml(m.title)}</h3>
        </div>
      </div>
      <div class="meta">
        <span class="badge badge--strong">${m.year ?? "—"}</span>
        <span class="badge">${m.durationMinutes ?? "—"} min</span>
        <span class="badge">${escapeHtml(m.ratingLabel)}</span>
      </div>
    `;

    card.appendChild(eye);

    const toggle = () => {
      const now = !state.watched.has(id);
      if (now) state.watched.add(id);
      else state.watched.delete(id);
      saveWatched(state.watched);

      card.classList.toggle("is-watched", now);
      eye.innerHTML = now ? eyeOpenSVG() : eyeClosedSVG();
      eye.setAttribute("aria-label", now ? "Watched" : "Not watched");
    };

    card.addEventListener("click", toggle);
    eye.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

    els.grid.appendChild(card);
  }
}

function renderChips() {
  els.activeChips.innerHTML = "";
  const chips = [];

  if (state.applied.yearMin != null) chips.push({ label: `Year ≥ ${state.applied.yearMin}`, clear: () => { state.pending.yearMin = null; state.applied.yearMin = null; els.yearMinSelect.value = ""; updateYearLabel(); } });
  if (state.applied.yearMax != null) chips.push({ label: `Year ≤ ${state.applied.yearMax}`, clear: () => { state.pending.yearMax = null; state.applied.yearMax = null; els.yearMaxSelect.value = ""; updateYearLabel(); } });

  if (state.applied.runtime.size) {
    const labels = [...state.applied.runtime].map(id => state.runtimeDefs.find(b => b.id === id)?.label).filter(Boolean);
    chips.push({ label: `Runtime: ${labels.join(", ")}`, clear: () => { state.pending.runtime.clear(); state.applied.runtime.clear(); document.querySelectorAll('input[data-kind="runtime"]').forEach(cb => cb.checked = false); } });
  }

  if (state.applied.ratings.size) {
    chips.push({ label: `Rating: ${[...state.applied.ratings].join(", ")}`, clear: () => { state.pending.ratings.clear(); state.applied.ratings.clear(); document.querySelectorAll('input[data-kind="rating"]').forEach(cb => cb.checked = false); } });
  }

  if (state.applied.sort !== "rank-asc") {
    chips.push({ label: `Sort: ${sortLabel(state.applied.sort)}`, clear: () => { state.pending.sort = "rank-asc"; state.applied.sort = "rank-asc"; els.sortSelect.value = "rank-asc"; } });
  }

  for (const c of chips) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = c.label;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.addEventListener("click", () => { c.clear(); applyFilters(); });

    chip.appendChild(btn);
    els.activeChips.appendChild(chip);
  }
}

function buildYears(start, end) {
  els.yearMinSelect.innerHTML = `<option value="">Min (Any)</option>`;
  els.yearMaxSelect.innerHTML = `<option value="">Max (Any)</option>`;
  for (let y = start; y <= end; y++) {
    els.yearMinSelect.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
    els.yearMaxSelect.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
  }
  updateYearLabel();
}

function clampYears() {
  const a = state.pending.yearMin;
  const b = state.pending.yearMax;
  if (a != null && b != null && a > b) {
    state.pending.yearMax = a;
    els.yearMaxSelect.value = String(a);
  }
}

function updateYearLabel() {
  const a = state.pending.yearMin;
  const b = state.pending.yearMax;
  if (a == null && b == null) els.yearRangeLabel.textContent = "Any";
  else if (a != null && b == null) els.yearRangeLabel.textContent = `${a} → Any`;
  else if (a == null && b != null) els.yearRangeLabel.textContent = `Any → ${b}`;
  else els.yearRangeLabel.textContent = `${a} → ${b}`;
}

function getRatingOptions(rows) {
  const s = new Set();
  let blank = false;
  for (const m of rows) {
    const c = (m.certificate ?? "").trim();
    if (!c) blank = true;
    else s.add(c);
  }
  const arr = [...s].sort();
  if (blank) arr.unshift("Unrated/Unknown");
  return arr;
}

function buildChecks() {
  els.runtimeChecks.innerHTML = state.runtimeDefs.map(b => `
    <label class="check">
      <input type="checkbox" data-kind="runtime" value="${b.id}">
      <span>${b.label}</span>
    </label>
  `).join("");

  els.ratingChecks.innerHTML = state.ratingOptions.map(r => `
    <label class="check">
      <input type="checkbox" data-kind="rating" value="${escapeHtml(r)}">
      <span>${escapeHtml(r)}</span>
    </label>
  `).join("");

  document.querySelectorAll('input[data-kind="runtime"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.pending.runtime.add(cb.value);
      else state.pending.runtime.delete(cb.value);
      setDirty(true);
    });
  });

  document.querySelectorAll('input[data-kind="rating"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.pending.ratings.add(cb.value);
      else state.pending.ratings.delete(cb.value);
      setDirty(true);
    });
  });
}

function sorter(mode){
  switch(mode){
    case "rank-desc": return (a,b) => b.rank - a.rank;
    case "year-desc": return (a,b) => b.year - a.year;
    case "year-asc": return (a,b) => a.year - b.year;
    case "runtime-desc": return (a,b) => b.durationMinutes - a.durationMinutes;
    case "runtime-asc": return (a,b) => a.durationMinutes - b.durationMinutes;
    case "title-desc": return (a,b) => b.title.localeCompare(a.title);
    case "title-asc": return (a,b) => a.title.localeCompare(b.title);
    default: return (a,b) => a.rank - b.rank;
  }
}

function sortLabel(v){
  const m = {
    "rank-asc":"Rank (best → worst)",
    "rank-desc":"Rank (worst → best)",
    "year-desc":"Year (new → old)",
    "year-asc":"Year (old → new)",
    "runtime-desc":"Runtime (long → short)",
    "runtime-asc":"Runtime (short → long)",
    "title-asc":"Title (A → Z)",
    "title-desc":"Title (Z → A)"
  };
  return m[v] ?? v;
}

function parseCSV(text){
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const header = lines[0].split(",");

  const iRank = header.indexOf("Rank");
  const iTitle = header.indexOf("Title");
  const iYear = header.indexOf("Year");
  const iDur = header.indexOf("Duration_Minutes");
  const iCert = header.indexOf("Certificate");

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);

    const rank = parseInt(cols[iRank], 10);
    const title = cols[iTitle];
    const year = parseInt(cols[iYear], 10);
    const dur = parseInt(cols[iDur], 10);
    const cert = (cols[iCert] ?? "").trim();

    out.push({
      rank,
      title,
      year,
      durationMinutes: dur,
      certificate: cert || null,
      ratingLabel: cert || "Unrated/Unknown"
    });
  }

  return out;
}

function splitCSVLine(line){
  const out = [];
  let cur = "";
  let q = false;

  for (let i = 0; i < line.length; i++){
    const ch = line[i];

    if (ch === '"'){
      if (q && line[i+1] === '"') { cur += '"'; i++; }
      else q = !q;
      continue;
    }

    if (ch === "," && !q){
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function toIntOrNull(v){
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function movieId(m){
  return `${m.rank}|${m.title}|${m.year}`;
}

function loadWatched(){
  try {
    const raw = localStorage.getItem(WATCHED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveWatched(set){
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...set]));
  } catch {}
}

function eyeOpenSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="2" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
  </svg>`;
}

function eyeClosedSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="2" />
    <path d="M4 20L20 4" stroke="currentColor" stroke-width="2" />
  </svg>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
