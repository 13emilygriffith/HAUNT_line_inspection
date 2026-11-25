/* HAUNT line review: plots each line window (data/{el}.json, written by Line_Synthesis/export_web_data.py),
   collects a rating + comment per line, keeps them in the browser (localStorage) and sends them to a Google Sheet
   through a Google Apps Script web app (config.js SHEET_URL; one tab per element). */
(() => {
  "use strict";
  const CFG = window.REVIEW_CONFIG;
  const $ = (sel) => document.querySelector(sel);

  const state = {
    reviewer: "",
    el: "",
    data: null,          // contents of data/{el}.json
    ion: "",             // ionization stage shown ("I", "II"); windows are listed per stage
    wins: [],            // the windows of that stage, in data order (strongest first)
    view: "single",      // "single" | "all"
    idx: 0,              // current window (single view), 0-based
    cards: [],           // rendered cards: {win, root, plot, rendered}
    observer: null,
  };

  // ---------------------------------------------------------------------------------------------------------
  // Local storage (per reviewer and element). Every access is guarded: storage can be unavailable.
  // ---------------------------------------------------------------------------------------------------------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    keys(prefix) {
      try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)); } catch (e) { return []; }
    },
  };
  const reviewerKey = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");
  const ratingsKey = (reviewer, el) => `haunt:ratings:${reviewerKey(reviewer)}:${el}`;
  const winKey = (win) => win.center.toFixed(3);

  let ratings = {};      // winKey -> {window, center, species, rating, comment, t, synced}
  function loadRatings() {
    ratings = state.reviewer && state.el ? store.get(ratingsKey(state.reviewer, state.el), {}) : {};
  }
  function saveRatings() {
    if (state.reviewer && state.el) store.set(ratingsKey(state.reviewer, state.el), ratings);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Google Sheet sync
  // ---------------------------------------------------------------------------------------------------------
  let syncTimer = null;
  let syncing = false;

  function setSyncStatus(text, cls) {
    const s = $("#sync-status");
    s.textContent = text;
    s.className = cls || "";
    $("#sync-now").hidden = cls !== "error";
  }

  function unsentCount() {
    if (!state.reviewer) return 0;
    let n = 0;
    for (const k of store.keys(`haunt:ratings:${reviewerKey(state.reviewer)}:`)) {
      n += Object.values(store.get(k, {})).filter((r) => !r.synced).length;
    }
    return n;
  }

  function refreshSyncStatus() {
    if (!CFG.SHEET_URL) { setSyncStatus("Ratings are saved in this browser only (no sheet configured)"); return; }
    const n = unsentCount();
    if (n === 0) setSyncStatus("All ratings sent to the sheet", "ok");
    else setSyncStatus(`${n} rating${n > 1 ? "s" : ""} waiting to be sent…`);
  }

  function scheduleSync(delay = 1500) {
    if (!CFG.SHEET_URL) { refreshSyncStatus(); return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAll, delay);
    refreshSyncStatus();
  }

  async function syncAll() {
    if (!CFG.SHEET_URL || !state.reviewer || syncing) return;
    syncing = true;
    let failed = false;
    try {
      // every element this reviewer has unsent ratings for (not only the one on screen)
      for (const key of store.keys(`haunt:ratings:${reviewerKey(state.reviewer)}:`)) {
        const el = key.split(":").pop();
        const all = store.get(key, {});
        const todo = Object.entries(all).filter(([, r]) => !r.synced);
        if (!todo.length) continue;
        const body = {
          reviewer: state.reviewer.trim(),
          element: el,
          ratings: todo.map(([, r]) => ({ window: r.window, center: r.center, species: r.species,
                                         rating: r.rating || "", comment: r.comment || "" })),
        };
        // text/plain body: a "simple" request, so the browser sends it to Apps Script without a CORS preflight
        const resp = await fetch(CFG.SHEET_URL, { method: "POST", body: JSON.stringify(body) });
        const out = await resp.json();
        if (!out.ok) throw new Error(out.error || "sheet refused the ratings");
        // mark as sent, unless the rating was changed again while the request was on its way
        const now = store.get(key, {});
        for (const [k, r] of todo) if (now[k] && now[k].t === r.t) now[k].synced = true;
        store.set(key, now);
        if (el === state.el) { for (const [k, r] of todo) if (ratings[k] && ratings[k].t === r.t) ratings[k].synced = true; }
      }
    } catch (err) {
      failed = true;
      console.error("sync failed", err);
      setSyncStatus(`Could not reach the sheet (${unsentCount()} unsent; kept in this browser)`, "error");
    } finally {
      syncing = false;
    }
    if (!failed) refreshSyncStatus();
  }

  async function pullFromSheet() {
    // ratings this reviewer already sent (e.g. from another computer) fill in anything not rated here
    if (!CFG.SHEET_URL || !state.reviewer || !state.el) return;
    const el = state.el, reviewer = state.reviewer;
    try {
      const url = `${CFG.SHEET_URL}?element=${encodeURIComponent(el)}&reviewer=${encodeURIComponent(reviewer.trim())}`;
      const out = await (await fetch(url)).json();
      if (!out.ok || el !== state.el || reviewer !== state.reviewer) return;
      let changed = false;
      for (const r of out.ratings || []) {
        const k = Number(r.center).toFixed(3);
        if (ratings[k] && !ratings[k].synced) continue;          // local edit not sent yet wins
        if (!ratings[k] || ratings[k].rating !== r.rating || (ratings[k].comment || "") !== (r.comment || "")) {
          ratings[k] = { window: r.window, center: Number(r.center), species: r.species, rating: r.rating,
                         comment: r.comment || "", t: Date.now(), synced: true };
          changed = true;
        }
      }
      if (changed) { saveRatings(); state.cards.forEach(fillCardRating); updateProgress(); }
    } catch (err) {
      console.warn("could not read earlier ratings from the sheet", err);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Ratings
  // ---------------------------------------------------------------------------------------------------------
  function setRating(win, patch) {
    if (!state.reviewer) return;
    const k = winKey(win);
    const prev = ratings[k] || { window: win.i, center: win.center, species: win.dom || win.species, rating: "", comment: "" };
    ratings[k] = { ...prev, ...patch, t: Date.now(), synced: false };
    saveRatings();
    updateProgress();
    scheduleSync(patch.comment !== undefined ? 2500 : 800);
  }

  function ratingClass(value) {
    const r = CFG.RATINGS.find((x) => x.value === value);
    return r ? r.cls : "";
  }

  function updateProgress() {
    if (!state.data) { $("#progress").textContent = ""; return; }
    const n = state.wins.length;
    const done = state.wins.filter((w) => (ratings[winKey(w)] || {}).rating).length;
    $("#progress").textContent = `${state.el}${state.ion ? " " + state.ion : ""}: ${done} / ${n} rated`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Plot
  // ---------------------------------------------------------------------------------------------------------
  const axName = (base, n) => (n === 1 ? base : base + n);            // xaxis, xaxis2, ...
  const axRef = (base, n) => (n === 1 ? base : base + n);             // x, x2, ...
  const KIND_COLOR = { 1: "#d62728", 2: "#9a9a9a", 0: "#222222" };
  const SPEC_FRAC = 0.45;         // spectra fill the lower 45% of each upper panel, line labels the rest
  const PLOT_HEIGHT_ALL = 820;    // per line in the all-lines view; one-at-a-time view fills the window

  function singlePlotHeight() {
    // fit the whole card (title, plot, rating column) between the sticky top bar and the bottom of the window
    const top = $(".topbar").getBoundingClientRect().height;
    const head = state.cards[0] ? state.cards[0].root.querySelector(".card-head").getBoundingClientRect().height : 30;
    return Math.round(Math.max(460, Math.min(window.innerHeight - top - head - 40, 1100)));
  }

  function residRange(win, panels) {
    // one residual scale for all four panels, so the element's effect can be compared between them
    let lo = 0, hi = 0;
    for (const P of panels) {
      const d = win.p[P.key];
      d.fn.forEach((v, i) => {
        if (v === null || d.f[i] === null) return;
        lo = Math.min(lo, v - d.f[i]); hi = Math.max(hi, v - d.f[i]);
      });
    }
    const pad = 0.08 * Math.max(hi - lo, 0.005);
    return [lo - pad, hi + pad];
  }

  function figure(win, height) {
    const el = state.data.element;
    const panels = state.data.panels;
    const traces = [], annotations = [], shapes = [];
    const rr = residRange(win, panels);
    const layout = {
      height,
      margin: { l: 58, r: 8, t: 30, b: 38 },
      showlegend: true,
      legend: { orientation: "h", x: 0, y: 1.0, yanchor: "bottom", font: { size: 11 } },
      hovermode: "closest",
      plot_bgcolor: "#ffffff",
      paper_bgcolor: "#ffffff",
      font: { family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 12, color: "#1d2330" },
    };
    const gap = 0.06, colW = (1 - gap) / 2;
    const rows = [{ spec: [0.625, 0.955], res: [0.53, 0.61] }, { spec: [0.1, 0.43], res: [0.0, 0.08] }];

    panels.forEach((P, p) => {
      const d = win.p[P.key];
      const r = Math.floor(p / 2), c = p % 2;
      const a = 2 * p + 1, b = 2 * p + 2;                 // axis numbers: spectrum, residual
      const xa = axRef("x", a), ya = axRef("y", a), xb = axRef("x", b), yb = axRef("y", b);
      const xd = [c * (colW + gap), c * (colW + gap) + colW];
      const col = CFG.COLORS[P.line_source] || { synth: "#333", no_el: "#999" };
      const wl = Array.from({ length: d.n }, (_, i) => +(d.w0 + i * d.dw).toFixed(3));
      const resid = d.fn.map((v, i) => (v === null || d.f[i] === null ? null : v - d.f[i]));
      const ybot = d.yr[0], ytop = ybot + (1.05 - ybot) / SPEC_FRAC;   // spectra below SPEC_FRAC, labels above

      if (d.ow.length) {
        traces.push({ x: d.ow, y: d.of, xaxis: xa, yaxis: ya, type: "scatter", mode: "lines+markers",
          line: { color: CFG.COLORS.obs, width: 1.5 }, marker: { color: CFG.COLORS.obs, size: 4 },
          name: "GHOST spectrum", legendgroup: "obs", showlegend: p === 0,
          hovertemplate: `${P.target}<br>%{x:.3f} Å, %{y:.3f}<extra></extra>` });
      }
      traces.push({ x: wl, y: d.f, xaxis: xa, yaxis: ya, type: "scatter", mode: "lines",
        line: { color: col.synth, width: 2.2 }, name: `synthesis, ${P.linelist}`,
        legendgroup: `s-${P.line_source}`, showlegend: r === 0,
        hovertemplate: `synthesis (${P.linelist})<br>%{x:.3f} Å, %{y:.3f}<extra></extra>` });
      traces.push({ x: wl, y: d.fn, xaxis: xa, yaxis: ya, type: "scatter", mode: "lines",
        line: { color: col.no_el, width: 2.2, dash: "dash" }, name: `without ${el}, ${P.linelist}`,
        legendgroup: `n-${P.line_source}`, showlegend: r === 0,
        hovertemplate: `without ${el} (${P.linelist})<br>%{x:.3f} Å, %{y:.3f}<extra></extra>` });
      traces.push({ x: wl, y: resid, xaxis: xb, yaxis: yb, type: "scatter", mode: "lines",
        line: { color: col.synth, width: 2.2 }, showlegend: false,
        hovertemplate: `without ${el} − full<br>%{x:.3f} Å, %{y:.4f}<extra></extra>` });

      layout[axName("xaxis", a)] = { domain: xd, anchor: ya, range: [win.lo, win.hi], showticklabels: false,
        ...(a === 1 ? {} : { matches: "x" }), showgrid: false, ticks: "outside", linecolor: "#888", mirror: true };
      layout[axName("yaxis", a)] = { domain: rows[r].spec, anchor: xa, range: [ybot, ytop], showgrid: false,
        title: c === 0 ? { text: "Norm. flux", font: { size: 12 } } : undefined, ticks: "outside",
        linecolor: "#888", mirror: true, zeroline: false };
      layout[axName("xaxis", b)] = { domain: xd, anchor: yb, matches: "x", tickformat: ".1f", showgrid: false,
        ticks: "outside", linecolor: "#888", mirror: true,
        title: r === 1 ? { text: "Wavelength (Å)", font: { size: 12 } } : undefined };
      layout[axName("yaxis", b)] = { domain: rows[r].res, anchor: xb, showgrid: false, ticks: "outside",
        linecolor: "#888", mirror: true, zeroline: true, zerolinecolor: "#bbb", nticks: 4, range: rr,
        title: c === 0 ? { text: `no ${el} − synth`, font: { size: 11 } } : undefined };

      annotations.push({ xref: "paper", yref: "paper", x: (xd[0] + xd[1]) / 2, y: rows[r].spec[1] + 0.004,
        xanchor: "center", yanchor: "bottom", showarrow: false,
        text: `<b>${P.star}</b>, ${P.linelist} · max resid ${d.rmax.toFixed(3)}`, font: { size: 13 } });

      // line labels: tick at the line, leader to the (spread-out) text position, vertical text above
      const ydom = `${ya} domain`, y0 = SPEC_FRAC + 0.02;
      for (const [x0, xt, txt, kind, s0, s1] of d.lab) {
        const color = KIND_COLOR[kind];
        if (s0 !== null && s1 !== null && s1 > s0) {
          shapes.push({ type: "line", xref: xa, yref: ydom, x0: s0, x1: s1, y0: y0 + 0.015, y1: y0 + 0.015,
            line: { color, width: 3 }, opacity: 0.5 });
        }
        shapes.push({ type: "line", xref: xa, yref: ydom, x0, x1: x0, y0, y1: y0 + 0.04, line: { color, width: 1 } });
        shapes.push({ type: "line", xref: xa, yref: ydom, x0, x1: xt, y0: y0 + 0.04, y1: y0 + 0.07,
          line: { color, width: 0.6 } });
        annotations.push({ xref: xa, yref: ydom, x: xt, y: y0 + 0.08, text: txt, textangle: -90, showarrow: false,
          xanchor: "center", yanchor: "bottom", font: { size: 8, color } });
      }
    });
    layout.annotations = annotations;
    layout.shapes = shapes;
    return { traces, layout };
  }

  const PLOT_CONFIG = {
    responsive: true, displaylogo: false, doubleClick: "reset",
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
  };

  function renderPlot(card) {
    if (card.rendered) return;
    card.plot.innerHTML = "";
    const { traces, layout } = figure(card.win, state.view === "all" ? PLOT_HEIGHT_ALL : singlePlotHeight());
    Plotly.newPlot(card.plot, traces, layout, PLOT_CONFIG);
    card.rendered = true;
  }

  function releasePlot(card) {
    if (!card.rendered) return;
    Plotly.purge(card.plot);
    card.plot.innerHTML = '<div class="placeholder">Scroll here to load the plot</div>';
    card.rendered = false;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------------------------------------
  function buildCard(win) {
    const root = $("#card-template").content.firstElementChild.cloneNode(true);
    const n = state.wins.length;
    const sp = win.dom || win.species;
    root.querySelector(".card-title").textContent = `${sp}  ${win.center.toFixed(2)} Å`;
    root.querySelector(".card-meta").textContent =
      `line ${win.i} of ${n} · window ${win.lo.toFixed(2)}–${win.hi.toFixed(2)} Å · ` +
      (win.species !== sp ? `window also has ${win.species.split(", ").filter((x) => x !== sp).join(", ")} lines · ` : "") +
      `HAUNT-star peak resid: ` + state.data.panels.filter((P) => P.star === state.data.panels[0].star).map((P) => {
        const v = win.peak ? win.peak[P.line_source] : null;
        return `${P.linelist.replace(" line list", "")} ${v === null || v === undefined ? "not selected" : v.toFixed(3)}`;
      }).join(", ");
    const plot = root.querySelector(".plot");
    plot.style.minHeight = (state.view === "all" ? PLOT_HEIGHT_ALL : 460) + "px";
    plot.innerHTML = '<div class="placeholder">Loading plot…</div>';

    const form = root.querySelector(".rating");
    form.addEventListener("submit", (e) => e.preventDefault());
    const fs = root.querySelector(".choices");
    for (const opt of CFG.RATINGS) {
      const lab = document.createElement("label");
      lab.className = opt.cls;
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = `rating-${win.i}`;
      inp.value = opt.value;
      inp.addEventListener("change", () => { setRating(win, { rating: opt.value }); fillCardRating(card); });
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = opt.key;
      lab.append(inp, document.createTextNode(opt.label), key);
      fs.append(lab);
    }
    const ta = root.querySelector("textarea");
    ta.addEventListener("input", () => setRating(win, { comment: ta.value }));

    if (state.view === "single") {
      const nav = root.querySelector(".side-nav");
      nav.hidden = false;
      const jump = nav.querySelector(".jump");
      jump.max = n;
      jump.value = win.i;
      nav.querySelector(".n-lines").textContent = n;
      jump.addEventListener("change", () => go(parseInt(jump.value, 10) - 1));
      nav.querySelector(".prev").addEventListener("click", () => go(state.idx - 1));
      nav.querySelector(".next").addEventListener("click", () => go(state.idx + 1));
      nav.querySelector(".next-unrated").addEventListener("click", nextUnrated);
    }

    const card = { win, root, plot, rendered: false };
    fillCardRating(card);
    return card;
  }

  function fillCardRating(card) {
    const r = ratings[winKey(card.win)] || {};
    for (const inp of card.root.querySelectorAll("input[type=radio]")) inp.checked = inp.value === r.rating;
    const ta = card.root.querySelector("textarea");
    if (document.activeElement !== ta) ta.value = r.comment || "";
    const cls = ratingClass(r.rating);
    card.root.classList.remove("rated-accept", "rated-maybe", "rated-reject");
    if (cls) card.root.classList.add(`rated-${cls}`);
    card.root.querySelector(".card-badge").textContent = r.rating ? r.rating : "not rated";
    card.root.querySelector(".rating").classList.toggle("locked", !state.reviewer);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------------------
  function clearCards() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    for (const c of state.cards) if (c.rendered) Plotly.purge(c.plot);
    state.cards = [];
    $("#cards").innerHTML = "";
  }

  function render() {
    clearCards();
    $("#view-single").classList.toggle("active", state.view === "single");
    $("#view-all").classList.toggle("active", state.view === "all");
    document.body.classList.toggle("single-view", state.view === "single");
    if (!state.data) return;
    const wins = state.wins;

    if (state.view === "single") {
      state.idx = Math.min(Math.max(state.idx, 0), wins.length - 1);
      const card = buildCard(wins[state.idx]);
      state.cards = [card];
      $("#cards").append(card.root);
      renderPlot(card);
      scrollToCard();
    } else {
      const frag = document.createDocumentFragment();
      state.cards = wins.map(buildCard);
      state.cards.forEach((c) => frag.append(c.root));
      $("#cards").append(frag);
      // only draw plots near the screen; free the ones far away
      state.observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const card = state.cards.find((c) => c.plot === e.target);
          if (!card) continue;
          if (e.isIntersecting) renderPlot(card); else releasePlot(card);
        }
      }, { rootMargin: "1200px 0px" });
      state.cards.forEach((c) => state.observer.observe(c.plot));
    }
    writeHash();
  }

  function go(idx) {
    if (!state.data) return;
    state.idx = Math.min(Math.max(idx, 0), state.wins.length - 1);
    render();
  }

  function scrollToCard() {
    // put the card right under the sticky top bar, so the plot and the rating column fill the window
    const card = state.cards[0];
    if (!card) return;
    const top = $(".topbar").getBoundingClientRect().height;
    window.scrollTo({ top: card.root.getBoundingClientRect().top + window.scrollY - top - 8 });
  }

  function nextUnrated() {
    const wins = state.wins;
    for (let s = 1; s <= wins.length; s++) {
      const j = (state.idx + s) % wins.length;
      if (!(ratings[winKey(wins[j])] || {}).rating) { go(j); return; }
    }
    alert(`Every ${state.el} ${state.ion} line is rated.`);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Element + reviewer
  // ---------------------------------------------------------------------------------------------------------
  async function loadMenu() {
    const sel = $("#element");
    try {
      const menu = await (await fetch("data/elements.json", { cache: "no-cache" })).json();
      sel.innerHTML = '<option value="">Choose…</option>' +
        menu.map((e) => `<option value="${e.el}">${e.el} (${e.n} lines)</option>`).join("");
    } catch (err) {
      sel.innerHTML = '<option value="">Could not load data/elements.json</option>';
      console.error(err);
    }
  }

  const ROMAN = ["I", "II", "III", "IV"];
  function ionCounts(data) {
    // {stage: number of windows}, in order I, II, ... (other labels, e.g. molecules, last)
    const n = {};
    for (const w of data.windows) { const k = w.ion || ""; n[k] = (n[k] || 0) + 1; }
    const rank = (k) => (ROMAN.includes(k) ? ROMAN.indexOf(k) : 99);
    return Object.entries(n).sort((a, b) => rank(a[0]) - rank(b[0]));
  }

  function setIon(ion) {
    const counts = ionCounts(state.data);
    if (!counts.some(([k]) => k === ion)) ion = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];  // most lines
    state.ion = ion;
    state.wins = state.data.windows.filter((w) => (w.ion || "") === ion);
    const sel = $("#ion");
    sel.innerHTML = counts.map(([k, n]) =>
      `<option value="${k}">${state.el} ${k} (${n} line${n > 1 ? "s" : ""})</option>`).join("");
    sel.value = ion;
    $("#ion-label").hidden = counts.length < 2;
  }

  async function selectElement(el, idx = 0, ion = "") {
    state.el = el;
    state.data = null;
    state.wins = [];
    state.ion = "";
    state.idx = idx;
    $("#ion-label").hidden = true;
    $("#element-note").hidden = true;
    loadRatings();
    updateProgress();
    if (!el) { render(); return; }
    $("#cards").innerHTML = '<p class="intro">Loading…</p>';
    try {
      state.data = await (await fetch(`data/${el}.json`)).json();
    } catch (err) {
      $("#cards").innerHTML = `<p class="intro">Could not load data/${el}.json</p>`;
      return;
    }
    if (state.el !== el) return;
    setIon(ion);
    showElementNote();
    updateProgress();
    render();
    pullFromSheet();
  }

  function showElementNote() {
    const box = $("#element-note");
    if (!state.data) { box.hidden = true; return; }
    const d = state.data, sel = d.selection || {}, el = d.element, n = d.windows.length, ns = state.wins.length;
    const multi = ns < n, sp = `${el} ${state.ion}`;
    const cuts = [`removing ${el} changes the flux by more than ${sel.min_resid}`];
    if (sel.max_resid !== null && sel.max_resid !== undefined) cuts.push(`but by no more than ${sel.max_resid} (very strong, saturated lines are left out)`);
    if (sel.wl_min !== null && sel.wl_min !== undefined) cuts.push(`at wavelengths of ${sel.wl_min} Å or more`);
    const parts = [
      (multi ? `<b>${ns} ${sp} lines</b> (of ${n} ${el} lines; choose ${el} I or ${el} II at the top). Each line ` +
        `window is listed under the ionization stage of the line at its centre (the ${el} line that absorbs most ` +
        `there in the HAUNT-star synthesis).` : `<b>${ns} ${sp} lines.</b>`) +
      ` These are already pruned: a line is shown only if, in the HAUNT-star synthesis with ` +
      `Alex Ji's line list or the TSFitPy line list (either is enough), ${cuts.join(", ")}.`,
      sel.include_molecules ? `Molecular lines containing ${el} are included.` : `Only atomic ${el} lines are included (no molecules).`,
      sel.max_stamps ? `At most ${sel.max_stamps} lines are kept, spread evenly in wavelength.` : "",
      `Each window is ±${sel.half_window || 0.75} Å around the line. The same windows are shown for the Sun ` +
      `and for both line lists, so in some panels the line can be weak or missing.`,
      d.order ? `Lines are listed strongest first, by the largest strength of the ${sp} lines in the window (either ` +
        `line list): log(n/U) + log gf − θχ, with n the number density of the species (abundance and ionization), U its ` +
        `partition function, χ the lower-level excitation potential and θ = 5040/T, all at τ = ${d.order.tau} in the ` +
        `model atmosphere of the HAUNT star (${d.order.teff} K, log g ${d.order.logg}). It is a rough ranking that ignores ` +
        `blending and saturation.` : "",
    ];
    box.innerHTML = parts.filter(Boolean).join(" ");
    box.hidden = false;
  }

  function setReviewer(name) {
    state.reviewer = name.trim();
    store.set("haunt:reviewer", state.reviewer);
    loadRatings();
    state.cards.forEach(fillCardRating);
    updateProgress();
    refreshSyncStatus();
    pullFromSheet();
    if (unsentCount()) scheduleSync(500);
  }

  // ---------------------------------------------------------------------------------------------------------
  // URL hash: #el=Zr&line=5&view=single  (so a link can point at one line)
  // ---------------------------------------------------------------------------------------------------------
  function writeHash() {
    const h = new URLSearchParams();
    if (state.el) h.set("el", state.el);
    if (state.ion) h.set("ion", state.ion);
    if (state.view === "single" && state.data) h.set("line", String(state.idx + 1));
    h.set("view", state.view);
    history.replaceState(null, "", "#" + h.toString());
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return { el: h.get("el") || "", ion: h.get("ion") || "", line: parseInt(h.get("line") || "1", 10), view: h.get("view") };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------------------
  function wire() {
    const nameInput = $("#reviewer");
    nameInput.addEventListener("change", () => setReviewer(nameInput.value));
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

    $("#element").addEventListener("change", (e) => selectElement(e.target.value, 0));
    $("#ion").addEventListener("change", (e) => {
      if (!state.data) return;
      setIon(e.target.value);
      state.idx = 0;
      showElementNote();
      updateProgress();
      render();
    });
    $("#view-single").addEventListener("click", () => { state.view = "single"; render(); });
    $("#view-all").addEventListener("click", () => { state.view = "all"; render(); });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const card = state.cards[0];
        if (state.view === "single" && card && card.rendered) Plotly.relayout(card.plot, { height: singlePlotHeight() });
      }, 200);
    });
    $("#sync-now").addEventListener("click", () => syncAll());

    document.addEventListener("keydown", (e) => {
      if (state.view !== "single" || !state.data || e.metaKey || e.ctrlKey || e.altKey) return;
      const act = document.activeElement;
      const tag = (act && act.tagName) || "";
      if (tag === "TEXTAREA") {
        // Enter in the comment box saves it and moves on; Shift+Enter starts a new line
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); act.blur(); go(state.idx + 1); }
        else if (e.key === "Escape") act.blur();
        return;
      }
      const isRadio = tag === "INPUT" && act.type === "radio";   // focused after clicking a rating
      if ((tag === "INPUT" && !isRadio) || tag === "SELECT" || tag === "BUTTON") {
        if (e.key === "Escape") act.blur();
        return;
      }
      // (preventDefault also stops the browser's own arrow-key handling of a focused rating button)
      if (e.key === "ArrowLeft") { go(state.idx - 1); e.preventDefault(); return; }
      if (e.key === "ArrowRight") { go(state.idx + 1); e.preventDefault(); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { if (isRadio) e.preventDefault(); return; }
      if (e.key === "Enter") { go(state.idx + 1); e.preventDefault(); return; }
      const opt = CFG.RATINGS.find((r) => r.key === e.key);
      if (opt && state.reviewer && state.cards[0]) {
        setRating(state.cards[0].win, { rating: opt.value });
        fillCardRating(state.cards[0]);
      }
    });

    window.addEventListener("beforeunload", (e) => {
      if (CFG.SHEET_URL && unsentCount()) { e.preventDefault(); e.returnValue = ""; }
    });
    window.addEventListener("online", () => scheduleSync(200));
  }

  async function init() {
    wire();
    const saved = store.get("haunt:reviewer", "");
    $("#reviewer").value = saved;
    state.reviewer = saved;
    refreshSyncStatus();
    await loadMenu();
    const h = readHash();
    if (h.view === "all" || h.view === "single") state.view = h.view;
    if (h.el && [...$("#element").options].some((o) => o.value === h.el)) {
      $("#element").value = h.el;
      await selectElement(h.el, (h.line || 1) - 1, h.ion);
    } else {
      render();
    }
    if (!state.reviewer) $("#reviewer").focus();
    if (unsentCount()) scheduleSync(500);
  }

  init();
})();
