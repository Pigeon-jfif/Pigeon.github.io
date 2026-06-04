(() => {
  "use strict";

  const CSV_CANDIDATES = [
    new URLSearchParams(window.location.search).get("csv"),
    window.DISCOTECA_CSV,
    "Dischi - Elenco Dischi(1).csv",
    "Dischi - Elenco Dischi.csv",
    "dischi.csv",
    "catalogo.csv",
    "data.csv"
  ].filter(Boolean);

  const DEFAULT_GROUP = "section";

  const SECTION_META = {
    main: {
      key: "main",
      label: "Catalogo principale",
      shortLabel: "Catalogo",
      description: "Album ordinati normalmente, esclusi gli spazi speciali.",
      order: 0
    },
    ost: {
      key: "ost",
      label: "OST / Colonne sonore",
      shortLabel: "OST",
      description: "Colonne sonore e soundtrack in una sezione dedicata.",
      order: 1
    },
    various: {
      key: "various",
      label: "Various Artists",
      shortLabel: "Various",
      description: "Compilation e raccolte con artisti vari, fuori dall'ordine alfabetico standard.",
      order: 2
    },
    "il-rock": {
      key: "il-rock",
      label: "Il Rock",
      shortLabel: "Il Rock",
      description: "La collezione Il Rock separata dal resto del catalogo.",
      order: 3
    }
  };

  const state = {
    all: [],
    filtered: [],
    sourceName: "",
    query: "",
    format: "all",
    decade: "all",
    section: "all",
    groupBy: DEFAULT_GROUP,
    sort: "artist-az",
    lastRandomId: ""
  };

  const els = {};
  const numberFormatter = new Intl.NumberFormat("it-IT");

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    document.body.classList.remove("no-js");
    cacheElements();
    bindEvents();
    updateRandomButtonState();

    try {
      const loaded = await loadCsvFromSameFolder();
      hydrate(loaded.rows, loaded.sourceName);
    } catch (error) {
      console.warn(error);
      showManualCsvFallback(error);
    }
  }

  function cacheElements() {
    els.grid = document.getElementById("grid");
    els.statusBox = document.getElementById("statusBox");
    els.manualCsvBox = document.getElementById("manualCsvBox");
    els.csvFileInput = document.getElementById("csvFileInput");
    els.sourceName = document.getElementById("sourceName");
    els.searchInput = document.getElementById("searchInput");
    els.formatFilter = document.getElementById("formatFilter");
    els.sectionFilter = document.getElementById("sectionFilter");
    els.decadeFilter = document.getElementById("decadeFilter");
    els.groupSelect = document.getElementById("groupSelect");
    els.sortSelect = document.getElementById("sortSelect");
    els.resetFilters = document.getElementById("resetFilters");
    els.randomButton = document.getElementById("randomButton");
    els.randomHint = document.getElementById("randomHint");
    els.resultCount = document.getElementById("resultCount");
    els.emptyState = document.getElementById("emptyState");
    els.detailDialog = document.getElementById("detailDialog");
    els.dialogContent = document.getElementById("dialogContent");
    els.closeDialog = document.getElementById("closeDialog");
    els.statAlbums = document.getElementById("statAlbums");
    els.statArtists = document.getElementById("statArtists");
    els.statDiscs = document.getElementById("statDiscs");
    els.statYears = document.getElementById("statYears");
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", () => {
      state.query = normalizeForSearch(els.searchInput.value);
      applyFiltersAndRender();
    });

    els.formatFilter.addEventListener("change", () => {
      state.format = els.formatFilter.value;
      applyFiltersAndRender();
    });

    els.sectionFilter.addEventListener("change", () => {
      state.section = els.sectionFilter.value;
      applyFiltersAndRender();
    });

    els.decadeFilter.addEventListener("change", () => {
      state.decade = els.decadeFilter.value;
      applyFiltersAndRender();
    });

    els.groupSelect.addEventListener("change", () => {
      state.groupBy = els.groupSelect.value;
      applyFiltersAndRender();
    });

    els.sortSelect.addEventListener("change", () => {
      state.sort = els.sortSelect.value;
      applyFiltersAndRender();
    });

    els.resetFilters.addEventListener("click", resetFilters);
    els.randomButton.addEventListener("click", openRandomSuggestion);

    els.csvFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      hydrate(parseCsv(text), file.name);
      els.manualCsvBox.hidden = true;
    });

    els.closeDialog.addEventListener("click", closeDialog);

    els.detailDialog.addEventListener("click", (event) => {
      if (event.target === els.detailDialog) closeDialog();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.detailDialog.open) closeDialog();
    });
  }

  async function loadCsvFromSameFolder() {
    const errors = [];

    for (const fileName of CSV_CANDIDATES) {
      try {
        const response = await fetch(encodeURI(fileName), { cache: "no-store" });
        if (!response.ok) throw new Error(`${fileName}: risposta HTTP ${response.status}`);
        const text = await response.text();
        return { rows: parseCsv(text), sourceName: fileName };
      } catch (error) {
        errors.push(error.message);
      }
    }

    throw new Error(`CSV non trovato o non leggibile. Tentativi: ${errors.join(" | ")}`);
  }

  function hydrate(rawRows, sourceName) {
    const normalized = normalizeRows(rawRows);
    if (!normalized.length) throw new Error("Il CSV e vuoto o non contiene righe valide.");

    state.all = normalized;
    state.filtered = [];
    state.sourceName = sourceName;
    state.query = "";
    state.format = "all";
    state.decade = "all";
    state.section = "all";
    state.groupBy = DEFAULT_GROUP;
    state.sort = "artist-az";
    state.lastRandomId = "";

    els.sourceName.textContent = sourceName;
    els.statusBox.hidden = true;
    els.statusBox.classList.remove("is-error");
    els.manualCsvBox.hidden = true;
    if (els.randomHint) els.randomHint.textContent = "Pesca un album casuale dai risultati visibili.";

    populateFilters();
    resetControlsOnly();
    renderStats();
    applyFiltersAndRender();
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const normalized = text.replace(/^\uFEFF/, "");

    for (let i = 0; i < normalized.length; i += 1) {
      const char = normalized[i];
      const next = normalized[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(field);
        field = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        continue;
      }

      field += char;
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    const nonEmptyRows = rows.filter((candidate) => candidate.some((cell) => clean(cell)));
    const headers = nonEmptyRows.shift()?.map((header) => clean(header)) ?? [];

    return nonEmptyRows.map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    });
  }

  function normalizeRows(rows) {
    return rows
      .map((row, index) => {
        const anno = clean(row.Anno);
        const annoNumber = /^\d{4}$/.test(anno) ? Number(anno) : null;
        const dischi = Number.parseInt(clean(row.Dischi), 10);
        const record = {
          id: `disc-${index}`,
          artista: clean(row.Artista),
          titolo: clean(row.Titolo),
          formato: clean(row.Formato),
          dischi: Number.isFinite(dischi) ? dischi : null,
          anno,
          annoNumber,
          decade: annoNumber ? `${Math.floor(annoNumber / 10) * 10}` : "Senza anno",
          etichetta: clean(row.Etichetta),
          paese: clean(row.Paese),
          colori: clean(row["Colori speciali"]),
          note: clean(row["Note aggiuntive"])
        };

        const sectionKey = detectSection(record);
        const sectionMeta = SECTION_META[sectionKey] ?? SECTION_META.main;
        record.sectionKey = sectionKey;
        record.sectionLabel = sectionMeta.label;
        record.sectionShortLabel = sectionMeta.shortLabel;
        record.sectionOrder = sectionMeta.order;
        record.searchText = normalizeForSearch([
          record.artista,
          record.titolo,
          record.formato,
          record.anno,
          record.etichetta,
          record.paese,
          record.colori,
          record.note,
          record.sectionLabel
        ].join(" "));

        return record;
      })
      .filter((record) => record.artista || record.titolo);
  }

  function detectSection(record) {
    const artist = normalizeForSearch(record.artista);
    const format = normalizeForSearch(record.formato);

    if (artist === "il rock") return "il-rock";
    if (/^various artists?$/.test(artist)) return "various";
    if (format === "ost" || artist === "original motion soundtrack" || artist.includes("soundtrack")) return "ost";
    return "main";
  }

  function populateFilters() {
    const formats = uniqueValues(state.all.map((record) => record.formato)).sort(localeSort);
    const decades = uniqueValues(state.all.map((record) => record.decade)).sort(sortDecades);
    const sectionCounts = countBy(state.all, (record) => record.sectionKey);

    els.formatFilter.innerHTML = '<option value="all">Tutti i formati</option>';
    formats.forEach((format) => {
      els.formatFilter.append(new Option(format, format));
    });

    els.sectionFilter.innerHTML = '<option value="all">Tutte le sezioni</option>';
    Object.values(SECTION_META)
      .sort((a, b) => a.order - b.order)
      .forEach((section) => {
        const count = sectionCounts.get(section.key) ?? 0;
        if (count > 0) {
          els.sectionFilter.append(new Option(`${section.label} (${numberFormatter.format(count)})`, section.key));
        }
      });

    els.decadeFilter.innerHTML = '<option value="all">Tutti gli anni</option>';
    decades.forEach((decade) => {
      const label = decade === "Senza anno" ? decade : `Anni ${decade}`;
      els.decadeFilter.append(new Option(label, decade));
    });
  }

  function renderStats() {
    const artists = uniqueValues(state.all.map((record) => record.artista));
    const discs = state.all.reduce((sum, record) => sum + (record.dischi ?? 0), 0);
    const years = state.all.map((record) => record.annoNumber).filter(Number.isFinite);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);

    els.statAlbums.textContent = numberFormatter.format(state.all.length);
    els.statArtists.textContent = numberFormatter.format(artists.length);
    els.statDiscs.textContent = numberFormatter.format(discs);
    els.statYears.textContent = years.length ? `${minYear}-${maxYear}` : "--";
  }

  function applyFiltersAndRender() {
    let next = [...state.all];

    if (state.query) {
      next = next.filter((record) => record.searchText.includes(state.query));
    }

    if (state.format !== "all") {
      next = next.filter((record) => record.formato === state.format);
    }

    if (state.section !== "all") {
      next = next.filter((record) => record.sectionKey === state.section);
    }

    if (state.decade !== "all") {
      next = next.filter((record) => record.decade === state.decade);
    }

    next.sort(getSorter(state.sort));
    state.filtered = next;
    renderGrid();
    updateRandomButtonState();
  }

  function renderGrid() {
    const fragment = document.createDocumentFragment();
    const groups = buildGroups(state.filtered);

    groups.forEach((group) => {
      if (state.groupBy !== "none") {
        fragment.append(createGroupSeparator(group));
      }

      group.items.forEach((record) => {
        fragment.append(createAlbumCard(record));
      });
    });

    els.grid.replaceChildren(fragment);
    els.resultCount.textContent = `${numberFormatter.format(state.filtered.length)} ${state.filtered.length === 1 ? "risultato" : "risultati"}`;
    els.emptyState.hidden = state.filtered.length > 0;
  }

  function buildGroups(records) {
    if (state.groupBy === "none") {
      return [{ key: "all", label: "Tutti", description: "", items: records }];
    }

    if (state.groupBy === "section") {
      return Object.values(SECTION_META)
        .sort((a, b) => a.order - b.order)
        .map((section) => ({
          key: section.key,
          label: section.label,
          description: section.description,
          items: records.filter((record) => record.sectionKey === section.key)
        }))
        .filter((group) => group.items.length);
    }

    if (state.groupBy === "artist") {
      return groupsFromMap(records, (record) => record.artista || "Artista sconosciuto", {
        sort: (a, b) => localeSort(a.label, b.label)
      });
    }

    if (state.groupBy === "decade") {
      return groupsFromMap(records, (record) => record.decade, {
        label: (key) => key === "Senza anno" ? "Senza anno" : `Anni ${key}`,
        sort: (a, b) => sortDecades(a.key, b.key)
      });
    }

    if (state.groupBy === "format") {
      return groupsFromMap(records, (record) => record.formato || "Senza formato", {
        sort: (a, b) => localeSort(a.label, b.label)
      });
    }

    if (state.groupBy === "country") {
      return groupsFromMap(records, (record) => record.paese || "Paese non indicato", {
        description: "Suggerimento extra: utile per separare stampe italiane, UK, USA e import.",
        sort: (a, b) => {
          if (a.key === "Paese non indicato") return 1;
          if (b.key === "Paese non indicato") return -1;
          return localeSort(a.label, b.label);
        }
      });
    }

    return [{ key: "all", label: "Tutti", description: "", items: records }];
  }

  function groupsFromMap(records, getKey, options = {}) {
    const groups = new Map();

    records.forEach((record) => {
      const key = clean(getKey(record)) || "Senza valore";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: options.label ? options.label(key) : key,
          description: options.description || "",
          items: []
        });
      }
      groups.get(key).items.push(record);
    });

    return [...groups.values()].sort(options.sort || ((a, b) => localeSort(a.label, b.label)));
  }

  function createGroupSeparator(group) {
    const divider = document.createElement("div");
    divider.className = "group-separator";
    divider.setAttribute("role", "heading");
    divider.setAttribute("aria-level", "2");

    divider.innerHTML = `
      <div class="group-copy">
        <h2>${escapeHtml(group.label)}</h2>
        ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}
      </div>
      <span class="group-count">${numberFormatter.format(group.items.length)} ${group.items.length === 1 ? "disco" : "dischi"}</span>
    `;

    return divider;
  }

  function createAlbumCard(record) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-card";
    button.dataset.id = record.id;
    button.setAttribute("aria-label", `Apri dettagli: ${record.titolo || "Senza titolo"} di ${record.artista || "Artista sconosciuto"}`);
    setTileVars(button, record);

    const sectionChip = record.sectionKey !== "main" && state.groupBy !== "section"
      ? `<span class="chip is-section">${escapeHtml(record.sectionShortLabel)}</span>`
      : "";

    button.innerHTML = `
      <div class="card-copy">
        <h3 class="card-title">${escapeHtml(record.titolo || "Senza titolo")}</h3>
        <p class="card-artist">${escapeHtml(record.artista || "Artista sconosciuto")}</p>
      </div>
      <div class="card-meta">
        ${record.formato ? `<span class="chip">${escapeHtml(record.formato)}</span>` : ""}
        ${record.anno ? `<span class="chip">${escapeHtml(record.anno)}</span>` : ""}
        ${sectionChip}
        ${record.colori ? `<span class="chip is-special">${escapeHtml(record.colori)}</span>` : ""}
      </div>
      <div class="card-vinyl vinyl-disc" aria-hidden="true"></div>
    `;

    button.addEventListener("click", () => openDetails(record));
    return button;
  }

  function openRandomSuggestion() {
    const visible = state.filtered;
    if (!visible.length) return;

    let pool = visible;
    if (visible.length > 1 && state.lastRandomId) {
      pool = visible.filter((record) => record.id !== state.lastRandomId);
    }

    const record = pool[Math.floor(Math.random() * pool.length)];
    state.lastRandomId = record.id;
    if (els.randomHint) {
      els.randomHint.textContent = `${record.titolo || "Senza titolo"} - ${record.artista || "Artista sconosciuto"}`;
    }
    openDetails(record, "Suggerimento d'ascolto");
  }

  function openDetails(record, eyebrow = "Dettaglio disco") {
    const tags = [
      record.formato ? { value: record.formato, className: "" } : null,
      record.anno ? { value: record.anno, className: "" } : null,
      record.dischi ? { value: `${record.dischi} ${record.dischi === 1 ? "disco" : "dischi"}`, className: "" } : null,
      record.sectionKey !== "main" ? { value: record.sectionLabel, className: " is-section" } : null,
      record.colori ? { value: record.colori, className: " is-special" } : null
    ]
      .filter(Boolean)
      .map((tag) => `<span class="chip${tag.className}">${escapeHtml(tag.value)}</span>`)
      .join("");

    const detailItems = [
      record.sectionKey !== "main" ? ["Sezione", record.sectionLabel] : null,
      ["Formato", record.formato],
      ["Numero dischi", record.dischi ?? ""],
      ["Anno", record.anno],
      ["Etichetta", record.etichetta],
      ["Paese", record.paese],
      ["Colori speciali", record.colori]
    ].filter(Boolean);

    const tileA = colorFromText(record.artista + record.titolo, 0);
    const tileB = colorFromText(record.titolo + record.artista, 38);

    els.dialogContent.innerHTML = `
      <div class="dialog-layout">
        <div class="dialog-cover">
          <div class="dialog-record-stage" style="--tile-a: ${tileA}; --tile-b: ${tileB};" aria-hidden="true">
            <div class="dialog-vinyl vinyl-disc" style="--rotation: ${recordRotation(record)};"></div>
          </div>
        </div>
        <div class="dialog-body">
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2 id="dialogTitle">${escapeHtml(record.titolo || "Senza titolo")}</h2>
          <p class="dialog-artist">${escapeHtml(record.artista || "Artista sconosciuto")}</p>
          <div class="detail-tags">${tags}</div>
          <dl class="detail-list">
            ${detailItems.map(renderDetailItem).join("")}
          </dl>
          ${record.note ? `<div class="note-box"><strong>Note aggiuntive</strong>${escapeHtml(record.note)}</div>` : ""}
        </div>
      </div>
    `;

    if (els.detailDialog.open && typeof els.detailDialog.close === "function") {
      els.detailDialog.close();
    }

    if (typeof els.detailDialog.showModal === "function") {
      els.detailDialog.showModal();
    } else {
      els.detailDialog.setAttribute("open", "");
    }
  }

  function renderDetailItem([label, value]) {
    return `
      <div class="detail-item">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value || "-")}</dd>
      </div>
    `;
  }

  function closeDialog() {
    if (els.detailDialog.open && typeof els.detailDialog.close === "function") {
      els.detailDialog.close();
    } else {
      els.detailDialog.removeAttribute("open");
    }
  }

  function resetFilters() {
    state.query = "";
    state.format = "all";
    state.section = "all";
    state.decade = "all";
    state.groupBy = DEFAULT_GROUP;
    state.sort = "artist-az";
    state.lastRandomId = "";
    if (els.randomHint) els.randomHint.textContent = "Pesca un album casuale dai risultati visibili.";
    resetControlsOnly();
    applyFiltersAndRender();
  }

  function resetControlsOnly() {
    els.searchInput.value = "";
    els.formatFilter.value = "all";
    els.sectionFilter.value = "all";
    els.decadeFilter.value = "all";
    els.groupSelect.value = DEFAULT_GROUP;
    els.sortSelect.value = "artist-az";
  }

  function showManualCsvFallback(error) {
    els.sourceName.textContent = "CSV non caricato";
    els.statusBox.hidden = false;
    els.statusBox.classList.add("is-error");
    els.statusBox.textContent = "Caricamento automatico non riuscito. Seleziona il CSV manualmente oppure avvia il sito da un server locale.";
    els.manualCsvBox.hidden = false;
    updateRandomButtonState();
    console.error(error);
  }

  function updateRandomButtonState() {
    if (!els.randomButton) return;
    els.randomButton.disabled = state.filtered.length === 0;
  }

  function getSorter(sortKey) {
    const byArtist = (a, b) => localeSort(a.artista, b.artista) || localeSort(a.titolo, b.titolo) || compareYear(a, b, "asc");
    const sorters = {
      "artist-az": byArtist,
      "title-az": (a, b) => localeSort(a.titolo, b.titolo) || localeSort(a.artista, b.artista),
      "year-desc": (a, b) => compareYear(a, b, "desc") || byArtist(a, b),
      "year-asc": (a, b) => compareYear(a, b, "asc") || byArtist(a, b)
    };
    return sorters[sortKey] ?? byArtist;
  }

  function compareYear(a, b, direction) {
    const left = a.annoNumber ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const right = b.annoNumber ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return direction === "asc" ? left - right : right - left;
  }

  function sortDecades(a, b) {
    if (a === "Senza anno") return 1;
    if (b === "Senza anno") return -1;
    return Number(a) - Number(b);
  }

  function countBy(records, getter) {
    return records.reduce((map, record) => {
      const key = getter(record);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map());
  }

  function localeSort(a = "", b = "") {
    return String(a).localeCompare(String(b), "it", { sensitivity: "base", numeric: true });
  }

  function uniqueValues(values) {
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeForSearch(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function hashNumber(text = "") {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function colorFromText(text, shift = 0) {
    const palette = [
      "#1A4182",
      "#2D82B7",
      "#38B2B8",
      "#42E2B8",
      "#9BE1BC",
      "#F3DFBF",
      "#F1CAB4",
      "#EFB5A8",
      "#EB8A90"
    ];
    return palette[(hashNumber(text) + shift) % palette.length];
  }

  function recordRotation(record) {
    return `${hashNumber(record.titolo + record.artista) % 28 - 14}deg`;
  }

  function setTileVars(element, record) {
    element.style.setProperty("--tile-a", colorFromText(record.artista + record.titolo, 0));
    element.style.setProperty("--tile-b", colorFromText(record.titolo + record.artista, 38));
    element.style.setProperty("--rotation", recordRotation(record));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
