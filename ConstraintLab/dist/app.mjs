import { examples, limits, operators, parseModel, solve } from "./solver.mjs";

const $ = id => document.getElementById(id);
const create = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};
const copy = value => JSON.parse(JSON.stringify(value));
const storageKey = "constraintlab:model:1";
const freshDraft = () => ({
  vars: [{ id: "v1", name: "A", domain: "1, 2, 3" }, { id: "v2", name: "B", domain: "1, 2, 3" }],
  constraints: []
});

const stepTypes = {
  initial: ["Domaines initiaux", "·", "good"],
  propagate: ["Propagation", "↘", "good"],
  fixed: ["Point fixe", "=", "good"],
  decision: ["Décision", "›", "warn"],
  contradiction: ["Contradiction", "!", "bad"],
  backtrack: ["Retour arrière", "↶", "warn"],
  solution: ["Solution trouvée", "✓", "good"],
  done: ["Résolution terminée", "✓", "good"],
  limit: ["Recherche incomplète", "!", "warn"]
};

let selection = "triangle";
let draft = copy(examples.triangle.draft);
let model;
let result;
let position = 0;
let timer = null;
let activeTab = "domains";
let activeJournal;
let graphCanvas;
let graphObserver;
let needsRun = false;

function readDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Array.isArray(saved.draft?.vars) || !Array.isArray(saved.draft?.constraints)) return;
    draft = saved.draft;
    selection = Object.hasOwn(examples, saved.selection) ? saved.selection : null;
    $("heuristic").value = saved.heuristic === "order" ? "order" : "mrv";
    $("search-mode").value = saved.mode === "first" ? "first" : "all";
    needsRun = !selection;
  } catch {
    // Browser storage is optional.
  }
}

function saveDraft() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      draft, selection, heuristic: $("heuristic").value, mode: $("search-mode").value
    }));
  } catch {
    // The current session still works when storage is unavailable.
  }
}

function updateHeading() {
  const example = examples[selection];
  $("problem-heading").textContent = example?.title ?? "Problème personnalisé";
  $("problem-description").textContent = example?.description ?? "Saisis les valeurs entières possibles, séparées par des virgules, puis ajoute tes contraintes.";
  for (const button of $("example-links").children) {
    button.setAttribute("aria-pressed", String(button.dataset.example === selection));
  }
}

function setView(name, { navigate = false, focus = false } = {}) {
  const view = ["atelier", "exemples", "notions"].includes(name) ? name : "atelier";
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll("[data-view]")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (navigate && location.hash !== "#" + view) history.pushState(null, "", "#" + view);
  if (focus) {
    window.scrollTo(0, 0);
    $(view).querySelector("h2").focus({ preventScroll: true });
  }
  if (view !== "atelier") stopPlayback();
  if (view === "atelier" && graphCanvas) paintGraph();
}

function loadExample(id) {
  selection = id;
  draft = copy(examples[id].draft);
  $("heuristic").value = "mrv";
  $("search-mode").value = "all";
  renderEditor();
  updateHeading();
  saveDraft();
  startRun();
  setView("atelier", { navigate: true, focus: true });
}

function setupExamples() {
  for (const [id, example] of Object.entries(examples)) {
    const quick = create("button", "example-link");
    quick.type = "button";
    quick.dataset.example = id;
    const icon = create("span", "", example.icon);
    icon.setAttribute("aria-hidden", "true");
    quick.append(icon, document.createTextNode(example.short));
    quick.addEventListener("click", () => loadExample(id));
    $("example-links").append(quick);

    const card = create("article", "card example-card");
    const label = create("p", "section-label");
    label.append(document.createTextNode(example.icon + "  " + example.topic.toUpperCase()));
    const title = create("h3", "", example.title);
    const desc = create("p", "", example.description);
    const info = create("div", "count", `${example.draft.vars.length} variables · ${example.draft.constraints.length} contraintes`);
    const button = create("button", "button secondary", "Charger dans l’atelier ↗");
    button.type = "button";
    button.setAttribute("aria-label", `Charger l’exemple « ${example.title} »`);
    button.addEventListener("click", () => loadExample(id));
    card.append(label, title, desc, info, button);
    $("example-grid").append(card);
  }
}

function markDirty({ editedModel = true } = {}) {
  if (editedModel && selection) {
    selection = null;
    updateHeading();
  }
  needsRun = true;
  if (!$("form-error").hidden) clearError();
  if (result) clearRun();
  saveDraft();
}

function field(tag, row, key, label, attributes = {}) {
  const control = create(tag);
  control.dataset.row = row.id;
  control.dataset.field = key;
  control.setAttribute("aria-label", label);
  Object.assign(control, attributes);
  return control;
}

function removeButton(label, remove, disabled = false) {
  const button = create("button", "delete", "×");
  button.type = "button";
  button.title = label;
  button.disabled = disabled;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", remove);
  return button;
}

function focusField(id, key, fallback) {
  const control = id && document.querySelector(`[data-row="${CSS.escape(id)}"][data-field="${key}"]`);
  (control || $(fallback))?.focus();
}

function renderVariables() {
  const frag = document.createDocumentFragment();
  draft.vars.forEach((row, i) => {
    const container = create("div", "field-row variable-row");
    const name = field("input", row, "name", `Nom de la variable ${i + 1}`, {
      value: row.name, maxLength: 12, placeholder: "A", spellcheck: false
    });
    const domain = field("input", row, "domain", `Domaine de la variable ${i + 1}`, {
      value: row.domain, placeholder: "1, 2, 3", maxLength: 110, spellcheck: false
    });
    name.addEventListener("input", () => {
      row.name = name.value;
      for (const option of $("constraints").querySelectorAll("option[data-variable]")) {
        if (option.value === row.id) option.textContent = row.name.trim() || `Variable ${i + 1}`;
      }
      markDirty();
    });
    domain.addEventListener("input", () => { row.domain = domain.value; markDirty(); });
    const remove = removeButton(`Supprimer la variable ${i + 1} et ses contraintes`, () => {
      draft.vars.splice(i, 1);
      draft.constraints = draft.constraints.filter(rule => rule.left !== row.id && rule.right !== row.id);
      renderEditor();
      markDirty();
      focusField(draft.vars[Math.min(i, draft.vars.length - 1)]?.id, "name", "add-variable");
    }, draft.vars.length === 1);
    container.append(name, domain, remove);
    frag.append(container);
  });
  $("variables").replaceChildren(frag);
  $("variable-count").textContent = draft.vars.length;
  $("add-variable").disabled = draft.vars.length === limits.variables;
}

function fillVariableSelect(select, value) {
  draft.vars.forEach((variable, i) => {
    const option = new Option(variable.name.trim() || `Variable ${i + 1}`, variable.id);
    option.dataset.variable = "";
    select.append(option);
  });
  select.value = value;
}

function renderConstraints() {
  const frag = document.createDocumentFragment();
  draft.constraints.forEach((row, i) => {
    const container = create("div", "field-row constraint-row");
    const number = i + 1;
    const unary = row.kind === "unary";
    const left = field("select", row, "left", `Variable de gauche de la contrainte ${number}`);
    fillVariableSelect(left, row.left);
    left.addEventListener("change", () => { row.left = left.value; markDirty(); });

    const operation = field("select", row, "op", `Opérateur de la contrainte ${number}`);
    for (const operator of operators) {
      if (unary && operator.binaryOnly) continue;
      const option = new Option(operator.symbol, operator.id);
      option.title = operator.label;
      operation.add(option);
    }
    operation.value = row.op;

    const right = unary
      ? field("input", row, "right", `Valeur entière de la contrainte ${number}`, { value: row.right, placeholder: "Entier", maxLength: 5 })
      : field("select", row, "right", `Variable de droite de la contrainte ${number}`);
    if (!unary) fillVariableSelect(right, row.right);
    right.addEventListener(unary ? "input" : "change", () => { row.right = right.value; markDirty(); });

    const remove = removeButton(`Supprimer la contrainte ${number}`, () => {
      draft.constraints.splice(i, 1);
      renderConstraints();
      markDirty();
      focusField(draft.constraints[Math.min(i, draft.constraints.length - 1)]?.id, "left", "add-unary");
    });
    const param = create("label", "param", "Distance interdite k");
    const distance = field("input", row, "param", `Distance interdite k de la contrainte ${number}`, {
      value: row.param, maxLength: 4, inputMode: "numeric"
    });
    param.hidden = row.op !== "distance";
    param.append(distance);
    distance.addEventListener("input", () => { row.param = distance.value; markDirty(); });
    operation.addEventListener("change", () => {
      row.op = operation.value;
      param.hidden = row.op !== "distance";
      markDirty();
    });
    container.append(left, operation, right, remove, param);
    frag.append(container);
  });
  if (!draft.constraints.length) frag.append(create("p", "muted-tip", "Ajoute une règle entre deux variables ou compare une variable à un entier."));
  $("constraints").replaceChildren(frag);
  $("constraint-count").textContent = draft.constraints.length;
  $("add-unary").disabled = draft.constraints.length === limits.constraints;
  $("add-binary").disabled = $("add-unary").disabled || draft.vars.length < 2;
}

function renderEditor() {
  renderVariables();
  renderConstraints();
}

function nextId(rows, prefix) {
  let n = rows.length + 1;
  while (rows.some(row => row.id === prefix + n)) n += 1;
  return prefix + n;
}

function addConstraint(kind) {
  const id = nextId(draft.constraints, "c");
  const unary = kind === "unary";
  draft.constraints.push({
    id, kind, left: draft.vars[0].id, op: unary ? "eq" : "ne",
    right: unary ? "1" : draft.vars[1].id, param: "1"
  });
  renderConstraints();
  markDirty();
  focusField(id, "left", "add-unary");
}

function clearError() {
  $("form-error").hidden = true;
  for (const input of $("problem-form").querySelectorAll('[aria-invalid="true"]')) {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
}

function startRun() {
  stopPlayback();
  clearError();
  try {
    model = parseModel(draft);
    result = solve(model, { heuristic: $("heuristic").value, mode: $("search-mode").value });
  } catch (error) {
    if (!error.field) throw error;
    needsRun = true;
    clearRun();
    $("form-error").textContent = error.message;
    $("form-error").hidden = false;
    const invalid = document.querySelector(`[data-row="${CSS.escape(error.id)}"][data-field="${error.field}"]`);
    if (invalid) {
      invalid.setAttribute("aria-invalid", "true");
      invalid.setAttribute("aria-describedby", "form-error");
      invalid.focus();
    }
    return;
  }
  needsRun = false;
  $("step-slider").max = result.frames.length - 1;
  setTab("domains");
  renderJournal();
  goTo(0);
}

function clearRun() {
  stopPlayback();
  result = undefined;
  model = undefined;
  activeJournal = undefined;
  $("journal").replaceChildren();
  $("journal-count").textContent = "";
  $("step-slider").max = 0;
  position = 0;
  renderStep();
}

function renderJournal() {
  const frag = document.createDocumentFragment();
  result.frames.forEach((step, i) => {
    const entry = create("li");
    const button = create("button");
    button.type = "button";
    button.dataset.step = i;
    const [label, symbol] = stepTypes[step.type];
    button.append(create("span", "", String(i + 1).padStart(2, "0")), document.createTextNode(label), create("span", "", symbol));
    button.lastChild.setAttribute("aria-hidden", "true");
    entry.append(button);
    frag.append(entry);
  });
  $("journal").replaceChildren(frag);
  activeJournal = undefined;
  $("journal-count").textContent = `${result.frames.length} étapes`;
}

function renderDomains(frame) {
  const view = $("panel-domains");
  if (!frame) {
    view.replaceChildren(create("p", "muted-tip", "Les domaines apparaîtront ici après le lancement de la résolution."));
    return;
  }
  const domains = create("div", "domains");
  for (const variable of model.vars) {
    const domain = frame.domains[variable.id];
    const removed = frame.changedId === variable.id ? frame.removed : [];
    const restored = frame.restoredById?.[variable.id] ?? [];
    const row = create("div", "domain-row" + (removed.length || restored.length ? " changed" : ""));
    const label = create("span", "variable-badge", variable.name);
    const values = create("div", "domain-values");
    if (!domain.length) {
      const empty = create("span", "empty-domain", "∅");
      empty.setAttribute("aria-label", "Domaine vide");
      values.append(empty);
    }
    for (const value of [...domain, ...removed].sort((a, b) => a - b)) {
      const kind = removed.includes(value) ? "removed" : restored.includes(value) ? "restored" : domain.length === 1 ? "fixed" : "";
      const chip = create("span", "value " + kind, value);
      if (kind === "removed" || kind === "restored") {
        chip.setAttribute("aria-label", `${value}, valeur ${kind === "removed" ? "retirée" : "restaurée"}`);
        chip.title = kind === "removed" ? "Valeur retirée" : "Valeur restaurée";
      }
      values.append(chip);
    }
    row.append(label, values, create("span", "domain-size", `${domain.length} val.`));
    domains.append(row);
  }
  const legend = create("div", "legend");
  for (const [style, label] of [["kept", "Valeur fixée"], ["cut", "Valeur retirée"], ["restored", "Valeur restaurée"]]) {
    const key = create("span", style);
    key.append(create("i"), document.createTextNode(label));
    legend.append(key);
  }
  view.replaceChildren(domains, legend);
}

function renderSolutions(frame) {
  const panel = $("panel-solutions");
  if (!frame?.seen) {
    const label = frame?.status === "unsat" ? "Aucune affectation ne satisfait toutes les contraintes."
      : frame?.status === "limit" ? "Aucune solution observée avant l’arrêt de la recherche."
      : "Les solutions s’ajoutent ici au fil de la trace.";
    panel.replaceChildren(create("p", "muted-tip", label));
    return;
  }
  const container = create("div", "solutions-grid");
  const table = create("table");
  table.createCaption().textContent = `${frame.seen} solution${frame.seen === 1 ? "" : "s"} observée${frame.seen === 1 ? "" : "s"} à cette étape`;
  const header = table.createTHead().insertRow();
  for (const label of ["Étape", ...model.vars.map(variable => variable.name)]) {
    const cell = create("th", "", label);
    cell.scope = "col";
    header.append(cell);
  }
  const body = table.createTBody();
  for (const solution of result.solutions.slice(0, frame.seen)) {
    const row = body.insertRow();
    row.insertCell().textContent = solution.index + 1;
    for (const variable of model.vars) row.insertCell().textContent = solution.values[variable.id];
  }
  container.append(table);
  panel.replaceChildren(container);
}

function renderGraph(frame) {
  const panel = $("panel-graph");
  if (!frame) {
    graphObserver?.disconnect();
    graphCanvas = undefined;
    panel.replaceChildren(create("p", "muted-tip", "Lance la résolution pour visualiser les liens entre les variables."));
    return;
  }
  if (!graphCanvas?.isConnected) {
    graphCanvas = create("canvas");
    graphCanvas.setAttribute("aria-hidden", "true");
    const details = create("details", "graph-details");
    details.append(create("summary", "", "Relations et domaines du graphe"), create("ul"));
    panel.replaceChildren(graphCanvas, details);
    graphObserver?.disconnect();
    graphObserver = new ResizeObserver(paintGraph);
    graphObserver.observe(graphCanvas);
  }
  const associations = panel.querySelector("ul");
  const lines = [
    ...model.vars.map(variable => `${variable.name} ∈ {${frame.domains[variable.id].join(", ")}}`),
    ...model.constraints.map(rule => rule.formula)
  ];
  associations.replaceChildren(...lines.map(line => create("li", "", line)));
  paintGraph();
}

function paintGraph() {
  if (!graphCanvas || activeTab !== "graph" || !result || !model) return;
  const frame = result.frames[position];
  const w = graphCanvas.clientWidth;
  const h = graphCanvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  graphCanvas.width = w * dpr;
  graphCanvas.height = h * dpr;
  const ctx = graphCanvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const count = model.vars.length;
  const loc = new Map(model.vars.map((variable, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / count;
    const x = count === 2 ? w * (.3 + .4 * i) : w / 2 + (count > 1 ? Math.cos(angle) * w * .32 : 0);
    const y = count <= 2 ? h / 2 : h / 2 + Math.sin(angle) * h * .34;
    return [variable.id, { x, y }];
  }));
  const pairLinks = new Map();
  for (const rule of model.constraints) {
    if (rule.right === null) continue;
    const key = [rule.left, rule.right].sort().join("|");
    const active = frame.ruleIds?.includes(rule.id);
    if (active || !pairLinks.has(key)) pairLinks.set(key, { rule, active });
  }
  for (const { rule, active } of pairLinks.values()) {
    const a = loc.get(rule.left);
    const b = loc.get(rule.right);
    ctx.strokeStyle = active ? "#187457" : "#bdd3c3";
    ctx.lineWidth = active ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const variable of model.vars) {
    const { x, y } = loc.get(variable.id);
    const size = frame.domains[variable.id].length;
    const active = variable.id === frame.changedId;
    const unary = model.constraints.some(rule => rule.left === variable.id && rule.right === null);
    if (unary) {
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, 2 * Math.PI);
      ctx.strokeStyle = active ? "#187457" : "#94ad99";
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, 2 * Math.PI);
    ctx.fillStyle = size === 0 ? "#a74f3a" : active ? "#17674f" : size === 1 ? "#d9eddd" : "#ffffff";
    ctx.strokeStyle = active ? "#166c51" : "#86ad94";
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active || size === 0 ? "#fff" : "#234a39";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 12px system-ui";
    ctx.fillText(variable.name.length > 3 ? variable.name.slice(0, 2) + "…" : variable.name, x, y, 28);
    ctx.font = "10px system-ui";
    ctx.fillStyle = "#345f4e";
    ctx.fillText(`${size} val.`, x, y + 26);
  }
}

function renderStep() {
  const frame = result?.frames[position];
  const [label, symbol, tone] = frame ? stepTypes[frame.type] : ["Modèle à résoudre", "·", "good"];
  const message = $("step-message");
  message.dataset.tone = frame?.status === "unsat" ? "bad" : tone;
  const icon = create("span", "step-icon", symbol);
  icon.setAttribute("aria-hidden", "true");
  const copy = create("div");
  copy.append(create("strong", "", label), create("p", "", frame?.detail ?? "Lance la résolution pour obtenir une trace à explorer."));
  message.replaceChildren(icon, copy);
  const badge = $("run-status");
  const badges = { sat: "Satisfaisable", unsat: "Insatisfaisable", limit: "Incomplète" };
  badge.textContent = badges[frame?.status] ?? (frame ? "Trace disponible" : needsRun ? "À résoudre" : "Prêt");
  badge.dataset.tone = frame?.status === "unsat" ? "bad" : frame?.status === "limit" ? "warn" : "good";
  $("solution-tab-count").textContent = frame?.seen ?? 0;
  $("step-position").textContent = `${frame ? position + 1 : 0} / ${result?.frames.length ?? 0}`;
  $("step-depth").textContent = frame ? `Profondeur ${frame.depth}` : "";
  const slider = $("step-slider");
  slider.value = position;
  slider.setAttribute("aria-valuetext", frame ? `Étape ${position + 1} sur ${result.frames.length}` : "Aucune étape");
  slider.disabled = !frame;
  for (const id of ["step-first", "step-prev"]) $(id).disabled = !frame || position === 0;
  for (const id of ["step-next", "step-last"]) $(id).disabled = !frame || position === result.frames.length - 1;
  $("step-play").disabled = !frame || result.frames.length < 2;
  if (frame) {
    activeJournal?.removeAttribute("aria-current");
    const journal = $("journal");
    activeJournal = journal.children[position]?.firstElementChild;
    activeJournal?.setAttribute("aria-current", "step");
    if (activeJournal) {
      const listBox = journal.getBoundingClientRect();
      const buttonBox = activeJournal.getBoundingClientRect();
      if (buttonBox.top < listBox.top) journal.scrollTop += buttonBox.top - listBox.top;
      else if (buttonBox.bottom > listBox.bottom) journal.scrollTop += buttonBox.bottom - listBox.bottom;
    }
  }
  renderPanel(frame);
}

function renderPanel(frame = result?.frames[position]) {
  if (activeTab === "domains") renderDomains(frame);
  if (activeTab === "graph") renderGraph(frame);
  if (activeTab === "solutions") renderSolutions(frame);
}

function goTo(step) {
  if (!result) return;
  position = Math.max(0, Math.min(step, result.frames.length - 1));
  renderStep();
  if (position === result.frames.length - 1) stopPlayback();
}

function updatePlaybackButton() {
  const button = $("step-play");
  const label = timer === null ? "Lire automatiquement" : "Mettre en pause";
  button.setAttribute("aria-label", label);
  button.title = label;
  const icon = create("span", timer === null ? "play-icon" : "pause-icon");
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon);
}

function stopPlayback() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  updatePlaybackButton();
}

function play() {
  if (!result) return;
  if (timer !== null) {
    stopPlayback();
    return;
  }
  if (position === result.frames.length - 1) goTo(0);
  timer = setInterval(() => goTo(position + 1), Number($("speed").value));
  updatePlaybackButton();
}

function setTab(name, focus = false) {
  activeTab = name;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    $("panel-" + button.dataset.tab).hidden = !active;
    if (active && focus) button.focus();
  }
  renderPanel();
}

function drawHero() {
  const canvas = $("hero-graph");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, "#153c3000");
  fade.addColorStop(1, "#205645");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  for (let x = 12; x < w; x += 19) {
    for (let y = 12; y < h; y += 19) {
      ctx.fillStyle = `rgba(190, 226, 190, ${x / w * .21})`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }
  const pts = [{ x: 244, y: 75, name: "A", domain: "{1}" }, { x: 162, y: 212, name: "B", domain: "{1, 2}" },
    { x: 337, y: 212, name: "C", domain: "{1, 2, 3}" }];
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "#9cd2ab";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const point of pts.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [i, point] of pts.entries()) {
    const { x, y, name, domain } = point;
    ctx.strokeStyle = "#8ed3a26a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 32, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = i === 0 ? "#d0edba" : "#234f3f";
    ctx.strokeStyle = "#a3d7aa";
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === 0 ? "#174932" : "#e6f5dd";
    ctx.font = "700 19px Georgia";
    ctx.fillText(name, x, y + 1);
    ctx.fillStyle = "#c1e1c5";
    ctx.font = "12px monospace";
    ctx.fillText(domain, x, y + 45);
  }
  ctx.fillStyle = "#c1e1c5";
  ctx.font = "700 14px monospace";
  for (const [x, y] of [[191, 144], [303, 143], [249, 196]]) ctx.fillText("≠", x, y);
}

$("problem-heading").tabIndex = -1;
$("problem-form").addEventListener("submit", event => {
  event.preventDefault();
  startRun();
  if (result && matchMedia("(max-width: 620px)").matches) {
    $("trace-heading").tabIndex = -1;
    $("trace-heading").focus();
  }
});
$("new-problem").addEventListener("click", () => {
  draft = freshDraft();
  selection = null;
  needsRun = true;
  $("heuristic").value = "mrv";
  $("search-mode").value = "all";
  clearError();
  updateHeading();
  renderEditor();
  setTab("domains");
  clearRun();
  saveDraft();
  focusField(draft.vars[0].id, "name", "add-variable");
});
$("add-variable").addEventListener("click", () => {
  const id = nextId(draft.vars, "v");
  const names = new Set(draft.vars.map(variable => variable.name.trim()));
  const name = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").find(letter => !names.has(letter));
  draft.vars.push({ id, name, domain: "1, 2, 3" });
  renderEditor();
  markDirty();
  focusField(id, "name", "add-variable");
});
for (const kind of ["binary", "unary"]) $("add-" + kind).addEventListener("click", () => addConstraint(kind));
for (const id of ["heuristic", "search-mode"]) $(id).addEventListener("change", () => markDirty({ editedModel: false }));
for (const [id, step] of Object.entries({
  "step-first": () => 0, "step-prev": () => position - 1,
  "step-next": () => position + 1, "step-last": () => result.frames.length - 1
})) $(id).addEventListener("click", () => { stopPlayback(); goTo(step()); });
$("step-play").addEventListener("click", play);
$("speed").addEventListener("change", () => { if (timer !== null) { stopPlayback(); play(); } });
$("step-slider").addEventListener("input", event => { stopPlayback(); goTo(Number(event.target.value)); });
$("journal").addEventListener("click", event => {
  const step = event.target.closest("[data-step]");
  if (step) { stopPlayback(); goTo(Number(step.dataset.step)); }
});
const tabNames = ["domains", "graph", "solutions"];
for (const name of tabNames) {
  const tab = $("tab-" + name);
  tab.addEventListener("click", () => setTab(name));
  tab.addEventListener("keydown", event => {
    const i = tabNames.indexOf(name);
    const keys = { ArrowLeft: (i + 2) % 3, ArrowRight: (i + 1) % 3, Home: 0, End: 2 };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    setTab(tabNames[keys[event.key]], true);
  });
}
for (const link of document.querySelectorAll('.nav-link, .brand, .sidebar-foot a')) {
  link.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setView(link.hash.slice(1), { navigate: true, focus: true });
  });
}
window.addEventListener("hashchange", () => setView(location.hash.slice(1)));
readDraft();
setupExamples();
renderEditor();
updateHeading();
drawHero();
if (needsRun) clearRun();
else startRun();
setView(location.hash.slice(1));
