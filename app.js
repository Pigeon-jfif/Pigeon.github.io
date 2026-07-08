(() => {
  "use strict";

  const CSV_CANDIDATES = [
    new URLSearchParams(window.location.search).get("csv"),
    window.DISCOTECA_CSV,
    "Dischi - Elenco Dischi(1).csv",
    "Dischi - Elenco Dischi.csv",
    "Dischi.csv",
    "dischi.csv",
    "catalogo.csv",
    "data.csv"
  ].filter(Boolean);

  const DEFAULT_GROUP = "catalog";
  const COVER_FOLDER = "covers";
  const COVER_EXTENSION = "jpg";

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
    lastRandomId: ""
  };

  const els = {};
  const coverStatus = new Map();
  let letterObserver = null;
  let letterScrollHandler = null;
  let letterResizeHandler = null;
  let letterScrollRaf = 0;
  let smoothScrollRaf = 0;
  let backToTopRaf = 0;
  let alphabetAnimationTimeout = 0;
  let alphabetNavAnimating = false;
  let alphabetTrackedTargets = [];
  let searchModeRenderTimeout = 0;
  let searchModeOpen = false;
  let lastSearchFocus = null;
  let initialScrollSettled = false;
  const numberFormatter = new Intl.NumberFormat("it-IT");

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    prepareInitialScrollPosition();
    document.body.classList.remove("no-js");
    cacheElements();
    createSearchMode();
    syncThemeToggle();
    bindEvents();
    updateRandomButtonState();

    try {
      const loaded = await loadCsvFromSameFolder();
      hydrate(loaded.rows, loaded.sourceName);
    } catch (error) {
      if (window.location.protocol === "file:") {
        console.info(error.message);
      } else {
        console.warn(error);
      }
      showManualCsvFallback(error);
    }
  }

  function cacheElements() {
    els.appShell = document.querySelector(".app-shell");
    els.grid = document.getElementById("grid");
    els.alphabetNav = document.getElementById("alphabetNav");
    els.statusBox = document.getElementById("statusBox");
    els.manualCsvBox = document.getElementById("manualCsvBox");
    els.csvFileInput = document.getElementById("csvFileInput");
    els.sourceName = document.getElementById("sourceName");
    els.searchInput = document.getElementById("searchInput");
    els.filterToggle = document.getElementById("filterToggle");
    els.filterPanel = document.getElementById("filterPanel");
    els.brandHome = document.querySelector(".brand-home");
    els.decadeFilter = document.getElementById("decadeFilter");
    els.groupSelect = document.getElementById("groupSelect");
    els.resetFilters = document.getElementById("resetFilters");
    els.themeToggle = document.getElementById("themeToggle");
    els.randomButton = document.getElementById("randomButton");
    els.randomHint = document.getElementById("randomHint");
    els.resultCount = document.getElementById("resultCount");
    els.emptyState = document.getElementById("emptyState");
    els.detailDialog = document.getElementById("detailDialog");
    els.dialogContent = document.getElementById("dialogContent");
    els.closeDialog = document.getElementById("closeDialog");
    els.backToTop = document.getElementById("backToTop");
    els.statAlbums = document.getElementById("statAlbums");
    els.statArtists = document.getElementById("statArtists");
    els.statDiscs = document.getElementById("statDiscs");
    els.statYears = document.getElementById("statYears");
  }


  function createSearchMode() {
    const overlay = document.createElement("section");
    overlay.id = "searchMode";
    overlay.className = "search-mode";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "searchModeTitle");
    overlay.innerHTML = `
      <div class="search-mode-panel">
        <div class="search-mode-head">
          <div>
            <p class="eyebrow">Search mode</p>
            <h2 id="searchModeTitle">Trova un disco</h2>
          </div>
          <button id="searchModeClose" class="search-mode-close" type="button" aria-label="Chiudi ricerca">&times;</button>
        </div>
        <label class="search-mode-bar">
          <span aria-hidden="true">検索</span>
          <input id="searchModeInput" type="search" placeholder="Scrivi almeno 2 lettere..." autocomplete="off" />
        </label>
        <div class="search-mode-meta">
          <p id="searchModeCount">Inizia a scrivere per cercare nel catalogo.</p>
          <button id="searchModeClear" class="search-mode-clear" type="button">Svuota</button>
        </div>
        <div id="searchModeHelp" class="search-mode-help">Gli spazi contano: “capa” trova Caparezza, “capa ” no.</div>
        <div id="searchModeResults" class="search-mode-results" aria-live="polite"></div>
      </div>
    `;

    document.body.append(overlay);
    els.searchMode = overlay;
    els.searchModeInput = overlay.querySelector("#searchModeInput");
    els.searchModeResults = overlay.querySelector("#searchModeResults");
    els.searchModeCount = overlay.querySelector("#searchModeCount");
    els.searchModeClose = overlay.querySelector("#searchModeClose");
    els.searchModeClear = overlay.querySelector("#searchModeClear");
    els.searchModeHelp = overlay.querySelector("#searchModeHelp");
  }

  function openSearchMode() {
    if (searchModeOpen) return;
    lastSearchFocus = document.activeElement;
    searchModeOpen = true;
    els.searchMode.hidden = false;
    document.body.classList.add("is-search-mode");
    setSearchModeValue(els.searchInput.value, { focus: false });
    window.requestAnimationFrame(() => {
      els.searchModeInput.focus({ preventScroll: true });
      const length = els.searchModeInput.value.length;
      els.searchModeInput.setSelectionRange(length, length);
    });
  }

  function closeSearchMode() {
    if (!searchModeOpen) return;
    searchModeOpen = false;
    els.searchMode.hidden = true;
    document.body.classList.remove("is-search-mode");
    flushSearchModeGridSync();
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  function setSearchModeValue(value, options = {}) {
    els.searchModeInput.value = value;
    handleSearchModeInput(options);
  }

  function clearSearchMode() {
    els.searchModeInput.value = "";
    handleSearchModeInput();
    els.searchModeInput.focus({ preventScroll: true });
  }

  function handleSearchModeInput() {
    const rawQuery = els.searchModeInput.value;
    els.searchInput.value = rawQuery;
    const ready = isSearchQueryReady(rawQuery);
    state.query = ready ? normalizeForSearchQuery(rawQuery) : "";
    renderSearchModeResults();
    scheduleSearchModeGridSync();
  }

  function scheduleSearchModeGridSync() {
    if (searchModeRenderTimeout) {
      window.clearTimeout(searchModeRenderTimeout);
    }

    searchModeRenderTimeout = window.setTimeout(() => {
      searchModeRenderTimeout = 0;
      applyFiltersAndRender();
    }, 180);
  }

  function flushSearchModeGridSync() {
    if (searchModeRenderTimeout) {
      window.clearTimeout(searchModeRenderTimeout);
      searchModeRenderTimeout = 0;
    }

    applyFiltersAndRender();
  }

  function renderSearchModeResults() {
    if (!els.searchModeResults) return;

    const rawQuery = els.searchModeInput.value;
    const ready = isSearchQueryReady(rawQuery);
    const query = normalizeForSearchQuery(rawQuery);
    const fragment = document.createDocumentFragment();

    els.searchModeResults.replaceChildren();

    if (!ready) {
      els.searchModeCount.textContent = rawQuery.length
        ? "Continua a scrivere: i risultati partono da 2 caratteri."
        : "Inizia a scrivere per cercare nel catalogo.";
      els.searchModeResults.innerHTML = `<div class="search-mode-empty">Barra a fuoco. Scrivi almeno due lettere per vedere le tile qui sotto.</div>`;
      return;
    }

    const results = getFilteredRecords(query);
    els.searchModeCount.textContent = `${numberFormatter.format(results.length)} ${results.length === 1 ? "risultato" : "risultati"}`;

    if (!results.length) {
      els.searchModeResults.innerHTML = `<div class="search-mode-empty">Nessun risultato. In questa ricerca anche eventuali spazi finali o doppi vengono considerati.</div>`;
      return;
    }

    results.slice(0, 80).forEach((record) => {
      fragment.append(createAlbumCard(record));
    });

    if (results.length > 80) {
      const more = document.createElement("div");
      more.className = "search-mode-more";
      more.textContent = `Mostro i primi 80 risultati su ${numberFormatter.format(results.length)}. Continua a scrivere per restringere.`;
      fragment.append(more);
    }

    els.searchModeResults.append(fragment);
  }

  function isSearchQueryReady(value) {
    return String(value ?? "").replace(/\s/g, "").length >= 2;
  }

  function toggleFilterPanel() {
    const toolbar = els.filterToggle?.closest(".side-toolbar");
    if (!toolbar) return;

    const isOpen = toolbar.classList.toggle("is-filters-open");
    els.filterToggle.setAttribute("aria-expanded", String(isOpen));
    els.filterToggle.setAttribute("aria-label", isOpen ? "Nascondi filtri" : "Mostra filtri");
  }

  function bindEvents() {
    els.searchInput.addEventListener("focus", openSearchMode);
    els.searchInput.addEventListener("click", openSearchMode);
    els.searchInput.addEventListener("input", () => {
      openSearchMode();
      setSearchModeValue(els.searchInput.value);
    });

    els.searchModeInput.addEventListener("input", handleSearchModeInput);
    els.searchModeClose.addEventListener("click", closeSearchMode);
    els.searchModeClear.addEventListener("click", clearSearchMode);
    els.searchMode.addEventListener("click", (event) => {
      if (event.target === els.searchMode) closeSearchMode();
    });

    if (els.filterToggle) {
      els.filterToggle.addEventListener("click", toggleFilterPanel);
    }


    els.decadeFilter.addEventListener("change", () => {
      state.decade = els.decadeFilter.value;
      applyFiltersAndRender();
      renderSearchModeResults();
    });

    els.groupSelect.addEventListener("change", () => {
      state.groupBy = els.groupSelect.value;
      applyFiltersAndRender();
      renderSearchModeResults();
    });


    els.resetFilters.addEventListener("click", resetFilters);
    els.randomButton.addEventListener("click", openRandomSuggestion);
    if (els.brandHome) els.brandHome.addEventListener("click", handleBackToTopClick);
    if (els.themeToggle) els.themeToggle.addEventListener("click", toggleTheme);
    if (els.backToTop) {
      els.backToTop.addEventListener("click", handleBackToTopClick);
      window.addEventListener("scroll", scheduleBackToTopVisibility, { passive: true });
      window.addEventListener("resize", scheduleBackToTopVisibility);
      updateBackToTopVisibility();
    }

    window.addEventListener("resize", scheduleDialogTitleFitCheck);

    els.csvFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      hydrate(parseCsv(text), file.name);
      els.manualCsvBox.hidden = true;
    });

    els.closeDialog.addEventListener("click", closeDialog);

    // Richiesta mobile: il dettaglio deve chiudersi con qualunque tap/click,
    // sia sul backdrop sia su qualsiasi punto dentro la tile.
    els.detailDialog.addEventListener("click", closeDialog);
    els.dialogContent.addEventListener("click", closeDialog);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.detailDialog.open) {
        closeDialog();
        return;
      }

      if (event.key === "Escape" && searchModeOpen) {
        closeSearchMode();
      }
    });
  }

  function scheduleBackToTopVisibility() {
    if (backToTopRaf) return;
    backToTopRaf = window.requestAnimationFrame(() => {
      backToTopRaf = 0;
      updateBackToTopVisibility();
    });
  }

  function updateBackToTopVisibility() {
    if (!els.backToTop) return;
    const threshold = Math.min(220, Math.max(110, window.innerHeight * 0.14));
    const shouldShow = getScrollTop() > threshold;
    els.backToTop.hidden = !shouldShow;
    els.backToTop.classList.toggle("is-visible", shouldShow);
  }

  function handleBackToTopClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    scrollBackToTop();
  }

  function scrollBackToTop() {
    // La navigazione alfabetica forza sempre l'animazione.
    // Facciamo lo stesso qui: altrimenti, con "riduci movimento" attivo nel sistema,
    // Back to top e logo saltano istantaneamente mentre le lettere scorrono.
    const shouldReduceMotion = false;
    const currentTop = getScrollTop();
    if (currentTop <= 1) {
      setActiveAlphabetLink(null);
      removeCatalogHashFromUrl();
      return;
    }

    const links = [...(els.alphabetNav?.querySelectorAll("a[data-target]") ?? [])];
    const firstAlphabetIndex = links.length ? 0 : -1;
    const fromIndex = getActiveAlphabetIndex();
    const duration = Math.round(Math.min(4200, Math.max(950, currentTop * 0.7, Math.abs(fromIndex - firstAlphabetIndex) * 170)));

    if (firstAlphabetIndex >= 0) {
      animateAlphabetTrail(fromIndex, firstAlphabetIndex, shouldReduceMotion, duration);
    }

    scrollWindowTo(0, duration, shouldReduceMotion, () => {
      setActiveAlphabetLink(null);
      updateBackToTopVisibility();
      removeCatalogHashFromUrl();
    });
  }

  async function loadCsvFromSameFolder() {
    if (window.location.protocol === "file:") {
      throw new Error("Il sito e aperto con file://: il browser blocca la lettura automatica del CSV locale. Avvialo da un piccolo server locale oppure usa il pulsante Scegli CSV.");
    }

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
    settleInitialScrollPosition();
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

        record.isRemastered = isRemasteredRecord(record);
        record.coverPath = getCoverPath(row, record);
        record.coverFile = record.coverPath ? record.coverPath.split("/").pop() : "";

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
    const decades = uniqueValues(state.all.map((record) => record.decade)).sort(sortDecadesDesc);

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
    state.filtered = getFilteredRecords(state.query);
    renderGrid();
    updateRandomButtonState();
  }

  function getFilteredRecords(query = "") {
    let next = [...state.all];

    if (query) {
      next = next.filter((record) => record.searchText.includes(query));
    }


    if (state.decade !== "all") {
      next = next.filter((record) => record.decade === state.decade);
    }

    next.sort(getDefaultCatalogSorter());
    return next;
  }

  function renderGrid() {
    const fragment = document.createDocumentFragment();
    const groups = buildGroups(state.filtered);
    const letterTargets = [];
    const specialTargets = [];
    const letterIdCounts = new Map();
    const navLabels = new Set();

    groups.forEach((group) => {
      const groupAnchorId = getGroupAnchorId(group);

      if (state.groupBy === "catalog") {
        fragment.append(createGroupSeparator(group, groupAnchorId));

        if (isSpecialSectionGroup(group) && !specialTargets.length) {
          specialTargets.push({
            letter: "-",
            id: groupAnchorId,
            type: "special",
            label: "Vai alle sezioni speciali"
          });
        }

        let lastLetter = "";
        const showLetters = shouldShowLetterSeparators(group);

        group.items.forEach((record) => {
          const currentLetter = firstCatalogLetter(record.artista || record.titolo);
          const isNewLetter = showLetters && currentLetter !== lastLetter;

          if (isNewLetter) {
            const letterIdBase = `letter-${group.key}-${slugForId(currentLetter)}`;
            const nextCount = (letterIdCounts.get(letterIdBase) ?? 0) + 1;
            const targetId = nextCount === 1 ? letterIdBase : `${letterIdBase}-${nextCount}`;
            letterIdCounts.set(letterIdBase, nextCount);
            fragment.append(createLetterSeparator(currentLetter, targetId));
            letterTargets.push({ letter: currentLetter, id: targetId, type: "letter" });
          }

          fragment.append(createAlbumCard(record));
          lastLetter = currentLetter;
        });

        return;
      }

      fragment.append(createCompactGroupSeparator(group.label, groupAnchorId));

      const navTarget = getGroupNavTarget(group, groupAnchorId);
      if (navTarget && !navLabels.has(navTarget.letter)) {
        navLabels.add(navTarget.letter);
        letterTargets.push(navTarget);
      }

      group.items.forEach((record) => {
        fragment.append(createAlbumCard(record));
      });
    });

    els.grid.replaceChildren(fragment);
    setupCoverImages(els.grid);
    updateAlphabetNav(letterTargets, specialTargets);
    els.resultCount.textContent = `${numberFormatter.format(state.filtered.length)} ${state.filtered.length === 1 ? "risultato" : "risultati"}`;
    els.emptyState.hidden = state.filtered.length > 0;
  }

  function createCompactGroupSeparator(label, id = "") {
    const divider = document.createElement("div");
    divider.className = "letter-separator group-label-separator";
    if (id) divider.id = id;
    divider.dataset.letter = label;
    divider.setAttribute("role", "heading");
    divider.setAttribute("aria-level", "2");
    divider.setAttribute("aria-label", label);
    divider.title = label;
    divider.innerHTML = dividerLabelHtml(label);
    return divider;
  }

  function dividerLabelHtml(value) {
    const text = clean(value).replace(/^Anni\s+/i, "");
    if (!text) return '<span class="divider-space-dash">-</span>';

    return [...text.toUpperCase()]
      .map((char) => {
        if (/\s/.test(char) || char === "_") return '<span class="divider-space-dash">-</span>';
        return escapeHtml(char);
      })
      .join(" ")
      .trim();
  }

  function getGroupNavTarget(group, groupAnchorId) {
    if (state.groupBy === "format") return null;

    if (state.groupBy === "artist") {
      const letter = firstCatalogLetter(group.label);
      return { letter, id: groupAnchorId, type: "letter", label: `Vai agli artisti con ${letter}` };
    }

    if (state.groupBy === "decade") {
      const letter = group.key === "Senza anno" ? "--" : String(group.key).slice(-2, -1) || String(group.key).slice(0, 1);
      return { letter, id: groupAnchorId, type: "letter", label: `Vai a ${group.label}` };
    }

    if (state.groupBy === "country") {
      const normalized = clean(group.label)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/gi, "")
        .toUpperCase();
      const letter = normalized ? normalized.slice(0, 2).padEnd(2, "-") : "--";
      return { letter, id: groupAnchorId, type: "letter", label: `Vai a ${group.label}` };
    }

    return null;
  }

  function shouldShowLetterSeparators(group) {
    if (state.groupBy === "catalog") return group.key === "main";
    if (state.groupBy === "section") return true;
    return false;
  }

  function createLetterSeparator(letter, id) {
    const divider = document.createElement("div");
    divider.className = "letter-separator";
    divider.id = id;
    divider.dataset.letter = letter;
    divider.setAttribute("aria-hidden", "true");
    divider.textContent = letter;
    return divider;
  }

  function getGroupAnchorId(group) {
    if (SECTION_META[group.key]) return `section-${slugForId(group.key)}`;
    return `group-${slugForId(group.key || group.label)}`;
  }

  function isSpecialSectionGroup(group) {
    return Boolean(SECTION_META[group.key]) && group.key !== "main";
  }

  function updateAlphabetNav(targets, specialTargets = []) {
    if (!els.alphabetNav) return;

    cleanupAlphabetNavTracking();

    const uniqueTargets = targets.filter((target, index, array) =>
      array.findIndex((candidate) => candidate.letter === target.letter) === index
    );

    const specialTarget = specialTargets.find((target) => document.getElementById(target.id));
    const navTargets = [
      ...uniqueTargets,
      ...(specialTarget ? [specialTarget] : [])
    ];
    const hasTargets = navTargets.length > 0;

    els.appShell?.classList.toggle("is-alphabet-hidden", !hasTargets);

    if (!hasTargets) {
      els.alphabetNav.hidden = true;
      els.alphabetNav.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    navTargets.forEach((target, index) => {
      fragment.append(createAlphabetNavLink(target, index));
    });

    els.alphabetNav.hidden = false;
    els.alphabetNav.replaceChildren(fragment);
    setupLetterObserver();
  }

  function createAlphabetNavLink(target, index) {
    const link = document.createElement("a");
    const isSpecial = target.type === "special";

    link.href = `#${target.id}`;
    link.textContent = target.letter;
    link.dataset.target = target.id;
    link.dataset.letter = target.letter;
    link.dataset.index = String(index);
    link.dataset.type = target.type || "letter";
    link.setAttribute("aria-label", target.label || `Vai alla lettera ${target.letter}`);
    link.addEventListener("click", handleAlphabetClick);

    if (isSpecial) {
      link.classList.add("is-special-jump");
      link.title = "Vai alle sezioni speciali";
    }


    return link;
  }

  function cleanupAlphabetNavTracking() {
    if (letterObserver) {
      letterObserver.disconnect();
      letterObserver = null;
    }

    if (letterScrollHandler) {
      window.removeEventListener("scroll", letterScrollHandler);
      letterScrollHandler = null;
    }

    if (letterResizeHandler) {
      window.removeEventListener("resize", letterResizeHandler);
      letterResizeHandler = null;
    }

    if (letterScrollRaf) {
      window.cancelAnimationFrame(letterScrollRaf);
      letterScrollRaf = 0;
    }

    if (smoothScrollRaf) {
      window.cancelAnimationFrame(smoothScrollRaf);
      smoothScrollRaf = 0;
      document.documentElement.classList.remove("is-script-scrolling");
    }

    if (alphabetAnimationTimeout) {
      window.clearTimeout(alphabetAnimationTimeout);
      alphabetAnimationTimeout = 0;
    }

    alphabetNavAnimating = false;
    alphabetTrackedTargets = [];
  }

  function handleAlphabetClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const link = event.currentTarget;
    const target = document.getElementById(link.dataset.target);
    if (!target) return;

    const shouldReduceMotion = false;
    const links = [...els.alphabetNav.querySelectorAll("a[data-target]")];
    const fromIndex = getActiveAlphabetIndex();
    const toIndex = Number.parseInt(link.dataset.index, 10);
    const targetInfo = {
      id: link.dataset.target,
      letter: link.dataset.letter
    };
    const scrollPlan = getAlphabetTravelPlan(links, fromIndex, toIndex, shouldReduceMotion);

    cancelAlphabetTrailAnimation();
    scrollWindowAlong(scrollPlan.keyframes, scrollPlan.duration, shouldReduceMotion, () => {
      alphabetNavAnimating = false;
      setActiveAlphabetLink(targetInfo);
      removeCatalogHashFromUrl();
    });
  }

  function getAlphabetTravelPlan(links, fromIndex = 0, toIndex = 0, shouldReduceMotion = false) {
    const currentTop = getScrollTop();
    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const safeFromIndex = Math.min(Math.max(Number.isFinite(fromIndex) ? fromIndex : 0, 0), Math.max(links.length - 1, 0));
    const safeToIndex = Math.min(Math.max(Number.isFinite(toIndex) ? toIndex : 0, 0), Math.max(links.length - 1, 0));
    const direction = Math.sign(safeToIndex - safeFromIndex) || 1;
    const keyframes = [{ top: currentTop, index: safeFromIndex }];

    if (!links.length) {
      return { keyframes, duration: 0 };
    }

    for (let index = safeFromIndex + direction; direction > 0 ? index <= safeToIndex : index >= safeToIndex; index += direction) {
      const candidate = links[index];
      const candidateTarget = candidate ? document.getElementById(candidate.dataset.target) : null;
      if (!candidateTarget) continue;

      keyframes.push({
        top: getTargetScrollTop(candidateTarget, maxTop),
        index,
        id: candidate.dataset.target,
        letter: candidate.dataset.letter
      });
    }

    const finalLink = links[safeToIndex];
    const finalTarget = finalLink ? document.getElementById(finalLink.dataset.target) : null;
    const finalTop = finalTarget ? getTargetScrollTop(finalTarget, maxTop) : currentTop;
    if (!keyframes.some((frame) => Math.abs(frame.top - finalTop) < 2)) {
      keyframes.push({
        top: finalTop,
        index: safeToIndex,
        id: finalLink?.dataset.target,
        letter: finalLink?.dataset.letter
      });
    }

    const compacted = compactScrollKeyframes(keyframes, finalTop);
    const totalDistance = compacted.slice(1).reduce((sum, frame, index) => sum + Math.abs(frame.top - compacted[index].top), 0);
    const navSteps = Math.abs(safeToIndex - safeFromIndex);
    const duration = shouldReduceMotion
      ? 0
      : Math.round(Math.min(4800, Math.max(950, totalDistance * 0.7, navSteps * 170)));

    return {
      keyframes: compacted,
      duration
    };
  }

  function getAlphabetScrollPlan(target, shouldReduceMotion, fromIndex = 0, toIndex = 0) {
    const currentTop = getScrollTop();
    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetTop = getTargetScrollTop(target, maxTop);
    const distance = Math.abs(targetTop - currentTop);
    const navSteps = Number.isFinite(fromIndex) && Number.isFinite(toIndex) ? Math.abs(toIndex - fromIndex) : 0;
    const duration = shouldReduceMotion
      ? 0
      : Math.round(Math.min(4200, Math.max(850, distance * 0.52, navSteps * 135)));

    return {
      top: targetTop,
      duration
    };
  }

  function getAlphabetScrollKeyframes(fromIndex, toIndex, fallbackTarget) {
    const links = [...els.alphabetNav.querySelectorAll("a[data-target]")];
    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const frames = [{ top: getScrollTop() }];

    if (!links.length || !Number.isFinite(toIndex)) {
      const fallbackTop = fallbackTarget ? getTargetScrollTop(fallbackTarget, maxTop) : getScrollTop();
      frames.push({ top: fallbackTop });
      return compactScrollKeyframes(frames, fallbackTop);
    }

    const safeToIndex = Math.min(Math.max(toIndex, 0), links.length - 1);
    const safeFromIndex = Math.min(
      Math.max(Number.isFinite(fromIndex) ? fromIndex : safeToIndex, 0),
      links.length - 1
    );
    const direction = Math.sign(safeToIndex - safeFromIndex);

    if (direction === 0) {
      const directTarget = document.getElementById(links[safeToIndex].dataset.target) || fallbackTarget;
      const directTop = directTarget ? getTargetScrollTop(directTarget, maxTop) : getScrollTop();
      frames.push({ top: directTop });
      return compactScrollKeyframes(frames, directTop);
    }

    for (
      let index = safeFromIndex + direction;
      direction > 0 ? index <= safeToIndex : index >= safeToIndex;
      index += direction
    ) {
      const stepTarget = document.getElementById(links[index].dataset.target);
      if (!stepTarget) continue;
      frames.push({ top: getTargetScrollTop(stepTarget, maxTop) });
    }

    const finalTop = frames[frames.length - 1]?.top ?? getScrollTop();
    return compactScrollKeyframes(frames, finalTop);
  }

  function compactScrollKeyframes(keyframes, finalTop) {
    const compacted = [];

    keyframes.forEach((frame) => {
      const previous = compacted[compacted.length - 1];
      if (!previous || Math.abs(previous.top - frame.top) > 2) {
        compacted.push(frame);
      }
    });

    if (!compacted.length) compacted.push({ top: getScrollTop() });
    if (Math.abs(compacted[compacted.length - 1].top - finalTop) > 1) {
      compacted.push({ top: finalTop });
    }

    return compacted;
  }

  function getTargetScrollTop(target, maxTop) {
    const currentTop = getScrollTop();
    const targetTop = currentTop + target.getBoundingClientRect().top - getAlphabetScrollOffset();
    return Math.min(maxTop, Math.max(0, Math.round(targetTop)));
  }

  function getAlphabetScrollOffset() {
    const alphabetRect = els.alphabetNav?.getBoundingClientRect();
    const isHorizontalAlphabet = alphabetRect && alphabetRect.width > alphabetRect.height;

    if (isHorizontalAlphabet) {
      return Math.ceil(alphabetRect.height + 14);
    }

    return 18;
  }

  function scrollWindowTo(targetTop, duration, shouldReduceMotion, onComplete) {
    if (smoothScrollRaf) {
      window.cancelAnimationFrame(smoothScrollRaf);
      smoothScrollRaf = 0;
    }

    const startTop = getScrollTop();
    const distance = targetTop - startTop;

    document.documentElement.classList.add("is-script-scrolling");
    alphabetNavAnimating = true;

    if (shouldReduceMotion || duration <= 0 || Math.abs(distance) < 2) {
      setScrollTop(targetTop);
      document.documentElement.classList.remove("is-script-scrolling");
      alphabetNavAnimating = false;
      syncActiveAlphabetFromScroll(true);
      if (typeof onComplete === "function") onComplete();
      return;
    }

    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeInOutCubic(progress);

      setScrollTop(Math.round(startTop + distance * eased));
      syncActiveAlphabetFromScroll(true);

      if (progress < 1) {
        smoothScrollRaf = window.requestAnimationFrame(step);
        return;
      }

      smoothScrollRaf = 0;
      setScrollTop(targetTop);
      document.documentElement.classList.remove("is-script-scrolling");
      alphabetNavAnimating = false;
      syncActiveAlphabetFromScroll(true);
      if (typeof onComplete === "function") onComplete();
    };

    smoothScrollRaf = window.requestAnimationFrame(step);
  }

  function scrollWindowAlong(keyframes, duration, shouldReduceMotion, onComplete) {
    if (smoothScrollRaf) {
      window.cancelAnimationFrame(smoothScrollRaf);
      smoothScrollRaf = 0;
    }

    const frames = keyframes.length ? keyframes : [{ top: getScrollTop() }];
    const startTop = getScrollTop();
    const finalTop = Math.max(0, Math.round(frames[frames.length - 1]?.top ?? startTop));
    const distance = finalTop - startTop;
    const direction = Math.sign(distance) || 1;
    const travelFrames = frames
      .slice(1)
      .filter((frame) => Number.isFinite(frame.top) && (frame.id || frame.letter))
      .map((frame) => ({
        ...frame,
        top: Math.max(0, Math.round(frame.top))
      }));
    const finalFrame = travelFrames[travelFrames.length - 1];

    document.documentElement.classList.add("is-script-scrolling");
    alphabetNavAnimating = true;

    if (shouldReduceMotion || duration <= 0 || Math.abs(distance) < 2) {
      setScrollTop(finalTop);
      if (finalFrame) setActiveAlphabetLink({ id: finalFrame.id, letter: finalFrame.letter });
      document.documentElement.classList.remove("is-script-scrolling");
      alphabetNavAnimating = false;
      if (typeof onComplete === "function") onComplete();
      return;
    }

    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeInOutSine(progress);
      const nextTop = Math.round(startTop + distance * eased);

      setScrollTop(nextTop);

      const activeFrame = getActiveTravelFrame(travelFrames, nextTop, direction);
      if (activeFrame) {
        setActiveAlphabetLink({ id: activeFrame.id, letter: activeFrame.letter });
      }

      if (progress < 1) {
        smoothScrollRaf = window.requestAnimationFrame(step);
        return;
      }

      smoothScrollRaf = 0;
      setScrollTop(finalTop);
      if (finalFrame) setActiveAlphabetLink({ id: finalFrame.id, letter: finalFrame.letter });
      document.documentElement.classList.remove("is-script-scrolling");
      alphabetNavAnimating = false;
      if (typeof onComplete === "function") onComplete();
    };

    smoothScrollRaf = window.requestAnimationFrame(step);
  }

  function getActiveTravelFrame(frames, currentTop, direction) {
    let activeFrame = null;

    for (const frame of frames) {
      const hasReachedFrame = direction >= 0
        ? currentTop + 3 >= frame.top
        : currentTop - 3 <= frame.top;

      if (!hasReachedFrame) break;
      activeFrame = frame;
    }

    return activeFrame;
  }

  function getScrollTop() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function setScrollTop(value) {
    const top = Math.max(0, Math.round(value));
    const scroller = document.scrollingElement || document.documentElement || document.body;

    if (scroller) {
      scroller.scrollTop = top;
    }

    if (Math.abs(getScrollTop() - top) > 1) {
      window.scrollTo(0, top);
    }
  }

  function easeInOutCubic(progress) {
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function easeInOutSine(progress) {
    return -(Math.cos(Math.PI * progress) - 1) / 2;
  }

  function prepareInitialScrollPosition() {
    try {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    } catch (_) {}

    if (isCatalogNavigationHash(window.location.hash)) {
      removeCatalogHashFromUrl();
    }
  }

  function settleInitialScrollPosition() {
    if (initialScrollSettled) return;
    initialScrollSettled = true;

    if (window.location.hash && !isCatalogNavigationHash(window.location.hash)) return;

    const returnToTop = () => {
      setScrollTop(0);
      setActiveAlphabetLink(null);
    };

    returnToTop();
    window.requestAnimationFrame(() => {
      returnToTop();
      window.requestAnimationFrame(returnToTop);
    });
    window.setTimeout(returnToTop, 90);
  }

  function isCatalogNavigationHash(hash) {
    return /^#(?:letter-|section-|group-|catalogo|statistiche)/.test(hash || "");
  }

  function removeCatalogHashFromUrl() {
    try {
      if (history.replaceState) {
        const cleanUrl = window.location.href.split("#")[0];
        history.replaceState(null, "", cleanUrl);
      }
    } catch (_) {}
  }

  function setupLetterObserver() {
    if (!els.alphabetNav) return;

    alphabetTrackedTargets = [...document.querySelectorAll(".letter-separator[id], .group-separator.is-special-section[id]")]
      .sort(compareDocumentOrder);

    if (!alphabetTrackedTargets.length) return;

    letterScrollHandler = () => {
      if (letterScrollRaf) return;
      letterScrollRaf = window.requestAnimationFrame(() => {
        letterScrollRaf = 0;
        syncActiveAlphabetFromScroll();
      });
    };

    letterResizeHandler = letterScrollHandler;
    window.addEventListener("scroll", letterScrollHandler, { passive: true });
    window.addEventListener("resize", letterResizeHandler);

    letterObserver = new IntersectionObserver(() => syncActiveAlphabetFromScroll(), {
      root: null,
      rootMargin: "-16% 0px -72% 0px",
      threshold: 0
    });

    alphabetTrackedTargets.forEach((target) => letterObserver.observe(target));
    syncActiveAlphabetFromScroll();
  }

  function syncActiveAlphabetFromScroll(force = false) {
    if (!alphabetTrackedTargets.length || (alphabetNavAnimating && !force)) return;
    setActiveAlphabetLink(getCurrentAlphabetTarget(alphabetTrackedTargets));
  }

  function compareDocumentOrder(a, b) {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function getCurrentAlphabetTarget(targets) {
    const anchorY = getLetterTrackingOffset();
    let current = null;

    for (const target of targets) {
      if (target.getBoundingClientRect().top <= anchorY) {
        current = target;
      } else {
        break;
      }
    }

    if (!current) return null;

    const link = [...els.alphabetNav.querySelectorAll("a[data-target]")]
      .find((candidate) => candidate.dataset.target === current.id);

    return {
      id: current.id,
      letter: link?.dataset.letter || current.dataset.letter || current.textContent
    };
  }

  function getLetterTrackingOffset() {
    const alphabetRect = els.alphabetNav?.getBoundingClientRect();
    const mobileOffset = alphabetRect && alphabetRect.width > alphabetRect.height
      ? alphabetRect.height + 22
      : 94;
    return Math.min(window.innerHeight * 0.28, mobileOffset);
  }

  function setActiveAlphabetLink(target) {
    if (!els.alphabetNav) return;

    const links = [...els.alphabetNav.querySelectorAll("a")];

    if (!target) {
      links.forEach((link) => {
        link.classList.remove("is-active", "is-traveling");
      });
      delete els.alphabetNav.dataset.activeIndex;
      return;
    }

    let activeIndex = -1;
    links.forEach((link, index) => {
      const isActive = target.id
        ? link.dataset.target === target.id || (link.dataset.type === "special" && target.letter === "-")
        : link.dataset.letter === target.letter;
      link.classList.toggle("is-active", isActive);
      link.classList.remove("is-traveling");
      if (isActive && activeIndex === -1) activeIndex = index;
    });

    if (activeIndex >= 0) {
      els.alphabetNav.dataset.activeIndex = String(activeIndex);
    }
  }

  function getActiveAlphabetIndex() {
    const activeLink = els.alphabetNav?.querySelector("a.is-active");
    if (activeLink) return Number.parseInt(activeLink.dataset.index, 10) || 0;
    return Number.parseInt(els.alphabetNav?.dataset.activeIndex, 10) || 0;
  }

  function cancelAlphabetTrailAnimation() {
    if (alphabetAnimationTimeout) {
      window.clearTimeout(alphabetAnimationTimeout);
      alphabetAnimationTimeout = 0;
    }

    els.alphabetNav?.querySelectorAll("a.is-traveling").forEach((link) => {
      link.classList.remove("is-traveling");
    });
  }

  function animateAlphabetTrail(fromIndex, toIndex, shouldReduceMotion, duration = 760) {
    const links = [...els.alphabetNav.querySelectorAll("a")];
    if (!links.length || !Number.isFinite(toIndex)) return;

    if (alphabetAnimationTimeout) {
      window.clearTimeout(alphabetAnimationTimeout);
      alphabetAnimationTimeout = 0;
    }

    const safeFromIndex = Math.min(Math.max(Number.isFinite(fromIndex) ? fromIndex : 0, 0), links.length - 1);
    const safeToIndex = Math.min(Math.max(toIndex, 0), links.length - 1);
    const distance = Math.abs(safeToIndex - safeFromIndex);
    const direction = Math.sign(safeToIndex - safeFromIndex) || 1;
    const finalTarget = {
      id: links[safeToIndex]?.dataset.target,
      letter: links[safeToIndex]?.dataset.letter
    };

    if (shouldReduceMotion || distance <= 1) {
      setActiveAlphabetLink(finalTarget);
      return;
    }

    let currentIndex = safeFromIndex;
    const stepDelay = Math.min(145, Math.max(58, duration / distance));

    const tick = () => {
      links.forEach((link, index) => {
        const isCurrent = index === currentIndex;
        link.classList.toggle("is-active", isCurrent);
        link.classList.toggle("is-traveling", isCurrent);
      });

      if (currentIndex === safeToIndex) {
        alphabetAnimationTimeout = window.setTimeout(() => {
          setActiveAlphabetLink(finalTarget);
        }, 160);
        return;
      }

      currentIndex += direction;
      alphabetAnimationTimeout = window.setTimeout(tick, stepDelay);
    };

    tick();
  }

  function firstCatalogLetter(value) {
    const normalized = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const first = normalized.match(/[A-Z0-9]/)?.[0] ?? "#";
    return /\d/.test(first) ? "0-9" : first;
  }


  function slugForId(value) {
    return normalizeForSearch(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "misc";
  }

  function buildGroups(records) {
    if (state.groupBy === "none") {
      return [{ key: "all", label: "Tutti", description: "", items: records }];
    }

    if (state.groupBy === "section" || state.groupBy === "catalog") {
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
        label: (key) => key === "Senza anno" ? "Senza anno" : String(key),
        sort: (a, b) => sortDecadesDesc(a.key, b.key)
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

  function createGroupSeparator(group, id = "") {
    const divider = document.createElement("div");
    divider.className = `group-separator${isSpecialSectionGroup(group) ? " is-special-section" : ""}`;
    if (id) divider.id = id;
    if (SECTION_META[group.key]) divider.dataset.section = group.key;
    if (isSpecialSectionGroup(group)) divider.dataset.letter = "-";
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

  function createAlbumCard(record, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `album-card${options.startsArtist ? " starts-artist" : ""}${record.isRemastered ? " is-remastered" : ""}`;
    button.dataset.id = record.id;
    button.setAttribute("aria-label", `Apri dettagli: ${record.titolo || "Senza titolo"} di ${record.artista || "Artista sconosciuto"}`);
    setTileVars(button, record);

    const sectionChip = record.sectionKey !== "main" && state.groupBy !== "section"
      ? `<span class="chip is-section">${escapeHtml(record.sectionShortLabel)}</span>`
      : "";

    const remasterBadge = record.isRemastered
      ? `<span class="remaster-badge" aria-label="Remastered" title="Remastered">R</span>`
      : "";

    button.innerHTML = `
      ${remasterBadge}
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
      <div class="card-art" data-cover-frame aria-hidden="true" title="Cover attesa: ${escapeHtml(record.coverPath || "covers/artista_titolo.jpg")}">
        <span class="card-cover-sleeve">
          <img class="card-cover-img" data-cover-img data-cover-src="${escapeHtml(record.coverPath)}" alt="" loading="lazy" decoding="async" />
          <span class="cover-overlay"></span>
        </span>
        <span class="card-cover-fallback">
          <span class="card-vinyl vinyl-disc"></span>
        </span>
      </div>
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

    const tileA = colorFromText(record.artista || record.titolo, 0);
    const tileB = colorFromText(record.artista || record.titolo, 38);

    els.dialogContent.innerHTML = `
      <div class="dialog-layout">
        <header class="dialog-title-panel">
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2 id="dialogTitle" class="dialog-title-static" title="${escapeHtml(record.titolo || "Senza titolo")}">${escapeHtml(record.titolo || "Senza titolo")}</h2>
          <p class="dialog-artist">${escapeHtml(record.artista || "Artista sconosciuto")}</p>
        </header>
        <div class="dialog-cover">
          <div class="dialog-cover-stage" data-cover-frame style="--tile-a: ${tileA}; --tile-b: ${tileB};" title="Cover attesa: ${escapeHtml(record.coverPath || "covers/artista_titolo.jpg")}">
            <img class="dialog-cover-img" data-cover-img data-cover-src="${escapeHtml(record.coverPath)}" alt="Copertina di ${escapeHtml(record.titolo || "Senza titolo")} - ${escapeHtml(record.artista || "Artista sconosciuto")}" decoding="async" />
            <span class="cover-overlay" aria-hidden="true"></span>
            <div class="dialog-cover-fallback" aria-hidden="true">
              <div class="dialog-record-stage" style="--tile-a: ${tileA}; --tile-b: ${tileB};">
                <div class="dialog-vinyl vinyl-disc" style="--rotation: ${recordRotation(record)};"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-body">
          <div class="detail-tags">${tags}</div>
          <dl class="detail-list">
            ${detailItems.map(renderDetailItem).join("")}
          </dl>
          ${record.note ? `<div class="note-box"><strong>Note aggiuntive</strong>${escapeHtml(record.note)}</div>` : ""}
        </div>
      </div>
    `;

    setupCoverImages(els.dialogContent);

    if (els.detailDialog.open && typeof els.detailDialog.close === "function") {
      els.detailDialog.close();
    }

    if (typeof els.detailDialog.showModal === "function") {
      els.detailDialog.showModal();
    } else {
      els.detailDialog.setAttribute("open", "");
    }

    scheduleDialogTitleFitCheck();
  }

  function scheduleDialogTitleFitCheck() {
    const checkSoon = () => {
      checkDialogTitleFit();
      window.requestAnimationFrame(checkDialogTitleFit);
      window.setTimeout(checkDialogTitleFit, 180);
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(checkSoon);
    });

    if (document.fonts && typeof document.fonts.ready?.then === "function") {
      document.fonts.ready.then(checkSoon).catch(() => {});
    }
  }

  function checkDialogTitleFit() {
    const title = els.dialogContent?.querySelector(".dialog-title-static");
    if (!title) return;

    title.classList.remove("is-long-title");

    const styles = window.getComputedStyle(title);
    const lineHeight = Number.parseFloat(styles.lineHeight) || title.offsetHeight || 1;
    const isWrapped = title.scrollHeight > lineHeight * 1.35;

    if (isWrapped) {
      title.classList.add("is-long-title");
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
    state.lastRandomId = "";
    if (els.randomHint) els.randomHint.textContent = "Pesca un album casuale dai risultati visibili.";
    resetControlsOnly();
    if (els.searchModeInput) els.searchModeInput.value = "";
    applyFiltersAndRender();
    renderSearchModeResults();
  }

  function resetControlsOnly() {
    els.searchInput.value = "";
    els.decadeFilter.value = "all";
    els.groupSelect.value = DEFAULT_GROUP;
  }

  function showManualCsvFallback(error) {
    const isLocalFile = window.location.protocol === "file:";
    els.sourceName.textContent = "CSV non caricato";
    els.statusBox.hidden = false;
    els.statusBox.classList.add("is-error");
    els.statusBox.textContent = isLocalFile
      ? "Stai aprendo il sito con file://: per sicurezza il browser non puo leggere automaticamente il CSV. Usa Scegli CSV oppure avvia il sito da un server locale."
      : "Caricamento automatico non riuscito. Seleziona il CSV manualmente oppure avvia il sito da un server locale.";
    els.manualCsvBox.hidden = false;
    updateRandomButtonState();
    if (!isLocalFile) console.error(error);
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("discoteca-theme", next);
    } catch (_) {}
    syncThemeToggle();
  }

  function syncThemeToggle() {
    if (!els.themeToggle) return;
    const isDark = document.documentElement.dataset.theme === "dark";
    const label = els.themeToggle.querySelector(".theme-toggle-label");
    if (label) label.textContent = "Tema";
    els.themeToggle.removeAttribute("data-icon");
    els.themeToggle.dataset.state = isDark ? "dark" : "light";
    els.themeToggle.title = isDark ? "Tema scuro attivo" : "Tema chiaro attivo";
    els.themeToggle.setAttribute("aria-pressed", String(isDark));
    els.themeToggle.setAttribute("aria-label", isDark ? "Passa al tema chiaro" : "Passa al tema scuro");
  }

  function updateRandomButtonState() {
    if (!els.randomButton) return;
    els.randomButton.disabled = state.filtered.length === 0;
  }

  function getDefaultCatalogSorter() {
    return (a, b) =>
      localeSort(a.artista, b.artista) ||
      compareYearDesc(a, b) ||
      localeSort(a.titolo, b.titolo);
  }

  function compareYearDesc(a, b) {
    const left = a.annoNumber ?? Number.NEGATIVE_INFINITY;
    const right = b.annoNumber ?? Number.NEGATIVE_INFINITY;
    return right - left;
  }

  function sortDecadesDesc(a, b) {
    if (a === "Senza anno") return 1;
    if (b === "Senza anno") return -1;
    return Number(b) - Number(a);
  }

  function localeSort(a = "", b = "") {
    return String(a).localeCompare(String(b), "it", { sensitivity: "base", numeric: true });
  }

  function uniqueValues(values) {
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function getCoverPath(row, record) {
    const explicitCover = clean(
      row.Cover ||
      row.Copertina ||
      row.Immagine ||
      row["File cover"] ||
      row["Nome cover"] ||
      row["Cover file"]
    );

    if (explicitCover) {
      const normalized = explicitCover.replace(/\\/g, "/").replace(/^\/+/, "");
      const withExtension = /\.[a-z0-9]{2,5}$/i.test(normalized)
        ? normalized
        : `${normalized}.${COVER_EXTENSION}`;
      return withExtension.includes("/") ? withExtension : `${COVER_FOLDER}/${withExtension}`;
    }

    const fileName = buildCoverFileName(record);
    return fileName ? `${COVER_FOLDER}/${fileName}` : "";
  }

  function buildCoverFileName(record) {
    const artistSlug = slugForCover(record.artista);
    const titleSlug = slugForCover(record.titolo);
    if (!artistSlug && !titleSlug) return "";
    return `${artistSlug || "artista-sconosciuto"}_${titleSlug || "senza-titolo"}.${COVER_EXTENSION}`;
  }

  function slugForCover(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function setupCoverImages(root) {
    if (!root) return;

    root.querySelectorAll("img[data-cover-img]").forEach((image) => {
      const frame = image.closest("[data-cover-frame]") || root;
      const src = clean(image.dataset.coverSrc);

      if (!src) {
        markCoverMissing(frame, image);
        return;
      }

      const cachedState = coverStatus.get(src);
      if (cachedState === "failed") {
        markCoverMissing(frame, image);
        return;
      }

      image.addEventListener("load", () => {
        coverStatus.set(src, "loaded");
        markCoverLoaded(frame, image);
      }, { once: true });

      image.addEventListener("error", () => {
        coverStatus.set(src, "failed");
        markCoverMissing(frame, image);
      }, { once: true });

      image.src = encodeURI(src);

      if (cachedState === "loaded" && image.complete && image.naturalWidth > 0) {
        markCoverLoaded(frame, image);
      }
    });
  }

  function markCoverLoaded(frame, image) {
    const card = image?.closest(".album-card");

    frame?.classList.add("has-cover");
    frame?.classList.remove("is-cover-missing");
    card?.classList.add("has-cover");
    card?.classList.remove("is-cover-missing");

    if (image) image.hidden = false;
  }

  function markCoverMissing(frame, image) {
    const card = image?.closest(".album-card");

    frame?.classList.remove("has-cover");
    frame?.classList.add("is-cover-missing");
    card?.classList.remove("has-cover");
    card?.classList.add("is-cover-missing");

    if (image) {
      image.hidden = true;
      image.removeAttribute("src");
    }
  }

  function isRemasteredRecord(record) {
    const haystack = normalizeForSearch([record.titolo, record.colori, record.note].join(" "));
    return /\b(remaster|remastered|rimaster|rimasterizzato|rimasterizzata)\b/.test(haystack);
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

  function normalizeForSearchQuery(value) {
    return String(value ?? "")
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
      "#1E6BFF", "#24B3FF", "#00C2FF", "#42E8F6",
      "#7B61FF", "#A45BFF", "#D05CFF", "#FF5FD2",
      "#FF4F8B", "#FF6B6B", "#FF8A5B", "#FFB000",
      "#FFD166", "#B8F15A", "#43E97B", "#38F9D7",
      "#00D4A6", "#00B894", "#4D96FF", "#6BCBFF",
      "#845EC2", "#B39CD0", "#F15BB5", "#FEE440",
      "#00BBF9", "#00F5D4", "#EF476F", "#F78C6B",
      "#5E60CE", "#5390D9", "#64DFDF", "#80FFDB"
    ];
    return palette[(hashNumber(text) + shift) % palette.length];
  }

  function recordRotation(record) {
    return `${hashNumber(record.titolo + record.artista) % 28 - 14}deg`;
  }

  function setTileVars(element, record) {
    element.style.setProperty("--tile-a", colorFromText(record.artista || record.titolo, 0));
    element.style.setProperty("--tile-b", colorFromText(record.artista || record.titolo, 38));
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
