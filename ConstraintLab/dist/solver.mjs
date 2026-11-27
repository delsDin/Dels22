export const limits = Object.freeze({ variables: 8, domain: 12, constraints: 32, steps: 3500 });

export const operators = [
  { id: "eq", symbol: "=", label: "Égal à", test: (a, b) => a === b },
  { id: "ne", symbol: "≠", label: "Différent de", test: (a, b) => a !== b },
  { id: "lt", symbol: "<", label: "Strictement inférieur à", test: (a, b) => a < b },
  { id: "le", symbol: "≤", label: "Inférieur ou égal à", test: (a, b) => a <= b },
  { id: "gt", symbol: ">", label: "Strictement supérieur à", test: (a, b) => a > b },
  { id: "ge", symbol: "≥", label: "Supérieur ou égal à", test: (a, b) => a >= b },
  { id: "distance", symbol: "|Δ| ≠ k", label: "Distance différente de k", binaryOnly: true, test: (a, b, k) => Math.abs(a - b) !== k }
];

const operatorById = new Map(operators.map(operator => [operator.id, operator]));
const integerPattern = /^[-+]?\d+$/;
const sepPattern = /^(?:[+-]?\d+)(?:(?:\s*[,;]\s*|\s+)[+-]?\d+)*$/;

function integer(input) {
  const text = String(input ?? "").trim();
  const value = Number(text);
  return integerPattern.test(text) && Number.isSafeInteger(value) && Math.abs(value) <= 9999 ? value : null;
}

class ModelError extends Error {
  constructor(message, id, field) {
    super(message);
    this.id = id;
    this.field = field;
  }
}

export function parseModel(draft) {
  const fail = (message, row, field) => { throw new ModelError(message, row?.id, field); };
  if (!draft.vars.length || draft.vars.length > limits.variables || draft.constraints.length > limits.constraints) {
    fail("Le modèle doit respecter les limites indiquées dans les options.");
  }
  const names = new Set();
  const vars = draft.vars.map((row, i) => {
    const name = row.name.trim();
    if (!/^[\p{L}][\p{L}\p{N}_]{0,11}$/u.test(name)) {
      fail(`Variable ${i + 1} : utilise un nom de 1 à 12 caractères commençant par une lettre.`, row, "name");
    }
    if (names.has(name)) fail(`Le nom « ${name} » est déjà utilisé.`, row, "name");
    names.add(name);
    const source = row.domain.trim();
    if (!sepPattern.test(source)) fail(`Indique au moins un entier pour ${name}, par exemple 1, 2, 3.`, row, "domain");
    const values = source.split(/[,;\s]+/).map(integer);
    if (values.includes(null)) fail(`Les valeurs de ${name} doivent être entre −9 999 et 9 999.`, row, "domain");
    const domain = Array.from(new Set(values)).sort((a, b) => a - b);
    if (domain.length > limits.domain) fail(`Le domaine de ${name} contient plus de ${limits.domain} valeurs distinctes.`, row, "domain");
    return { id: row.id, name, domain };
  });
  const byId = new Map(vars.map(variable => [variable.id, variable]));
  const constraints = draft.constraints.map((row, i) => {
    const operator = operatorById.get(row.op);
    const left = byId.get(row.left);
    const unary = row.kind === "unary";
    const right = unary ? integer(row.right) : byId.get(row.right);
    const param = row.op === "distance" ? integer(row.param) : null;
    if (!operator || !left || (unary && operator.binaryOnly)) fail(`Vérifie la contrainte ${i + 1}.`, row, "op");
    if (unary && right === null) fail(`Saisis un entier entre −9 999 et 9 999 pour la contrainte ${i + 1}.`, row, "right");
    if (!unary && (!right || left === right)) fail(`Choisis deux variables distinctes pour la contrainte ${i + 1}.`, row, "right");
    if (row.op === "distance" && (param === null || param < 0)) fail(`Indique une distance k entière et positive ou nulle pour la contrainte ${i + 1}.`, row, "param");
    const formula = row.op === "distance"
      ? `|${left.name} − ${right.name}| ≠ ${param}`
      : `${left.name} ${operator.symbol} ${unary ? right : right.name}`;
    return {
      id: row.id,
      left: left.id,
      right: unary ? null : right.id,
      formula,
      test: unary ? a => operator.test(a, right) : (a, b) => operator.test(a, b, param)
    };
  });
  return { vars, constraints };
}

function problem(title, short, icon, topic, description, vars, constraints) {
  return {
    title, short, icon, topic, description,
    draft: {
      vars: vars.map(([name, domain], i) => ({ id: `v${i + 1}`, name, domain })),
      constraints: constraints.map(([left, op, right, param], i) => ({
        id: `c${i + 1}`, kind: typeof right === "number" ? "unary" : "binary",
        left: `v${left + 1}`, op, right: typeof right === "number" ? String(right) : right,
        param: param === undefined ? "1" : String(param)
      }))
    }
  };
}

const triangle = [[0, "ne", "v2"], [1, "ne", "v3"], [0, "ne", "v3"]];
const queens = [];
for (let row = 0; row < 4; row += 1) {
  for (let other = row + 1; other < 4; other += 1) {
    queens.push([row, "ne", `v${other + 1}`], [row, "distance", `v${other + 1}`, other - row]);
  }
}

export const examples = {
  triangle: problem("Coloration d’un triangle", "Coloration d’un triangle", "△", "Propagation en cascade",
    "Attribue une couleur à chaque sommet du triangle. Deux sommets voisins doivent avoir des couleurs différentes.",
    [["A", "1"], ["B", "1, 2"], ["C", "1, 2, 3"]], triangle),
  planning: problem("Ordre des tâches", "Ordre des tâches", "≺", "Contraintes d’ordre",
    "Place les tâches sur trois créneaux. Préparer précède le test, qui précède la livraison. Le test commence au plus tôt au créneau 2.",
    [["Préparer", "1, 2, 3"], ["Tester", "1, 2, 3"], ["Livrer", "1, 2, 3"]],
    [[0, "lt", "v2"], [1, "lt", "v3"], [1, "ge", 2]]),
  queens: problem("Les quatre reines", "Les quatre reines", "♛", "Recherche et retour arrière",
    "Place une reine par ligne sur un damier 4 × 4. Q1 à Q4 indiquent leurs colonnes. Deux reines ne peuvent partager une colonne ni une diagonale.",
    Array.from({ length: 4 }, (_, i) => [`Q${i + 1}`, "1, 2, 3, 4"]), queens),
  impossible: problem("Triangle à deux couleurs", "Triangle à deux couleurs", "∅", "Point fixe sans solution",
    "Colorie trois sommets voisins avec seulement deux couleurs. Observe pourquoi le point fixe initial ne suffit pas à conclure.",
    [["A", "1, 2"], ["B", "1, 2"], ["C", "1, 2"]], triangle)
};

export function solve(model, { heuristic = "mrv", mode = "all", stepLimit = limits.steps } = {}) {
  const { vars, constraints } = model;
  const names = new Map(vars.map(variable => [variable.id, variable.name]));
  const initial = Object.fromEntries(vars.map(variable => [variable.id, variable.domain]));
  const groups = new Map();
  for (const constraint of constraints) {
    if (constraint.right === null) continue;
    const scope = [constraint.left, constraint.right].sort();
    const key = scope.join(":");
    if (!groups.has(key)) groups.set(key, { scope, rules: [] });
    groups.get(key).rules.push(constraint);
  }
  const arcs = Array.from(groups.values()).flatMap(({ scope: [a, b], rules }) =>
    [[a, b], [b, a]].map(([from, to]) => ({ from, to, rules }))
  );
  const incoming = new Map(vars.map(variable => [variable.id, arcs.filter(arc => arc.to === variable.id)]));
  const frames = [];
  const solutions = [];
  const limitReached = Symbol("trace limit");
  let rootState = initial;
  let completed = true;

  function record(type, state, depth, detail = "", change = {}) {
    if (type !== "done" && type !== "limit" && frames.length >= stepLimit - 1) throw limitReached;
    frames.push({ type, domains: { ...state }, depth, detail, seen: solutions.length, ...change });
  }

  function reduce(state, depth, id, next, detail, ruleIds, relatedId) {
    const removed = state[id].filter(value => !next.includes(value));
    if (!removed.length) return false;
    state[id] = next;
    const clause = removed.length === 1 ? `la valeur ${removed[0]}` : `les valeurs ${removed.join(", ")}`;
    const consequence = next.length ? "" : ` Le domaine de ${names.get(id)} est vide.`;
    record(next.length ? "propagate" : "contradiction", state, depth,
      `${detail} Le solveur retire ${clause} du domaine de ${names.get(id)}.${consequence}`,
      { changedId: id, relatedId, removed, ruleIds });
    return true;
  }

  function propagate(state, depth) {
    if (depth === 0) {
      for (const rule of constraints) {
        if (rule.right !== null) continue;
        const next = state[rule.left].filter(rule.test);
        reduce(state, depth, rule.left, next, `Filtre ${rule.formula}.`, [rule.id]);
        if (!next.length) return false;
      }
    }
    const queue = [...arcs];
    const queued = new Set(queue);
    for (let i = 0; i < queue.length; i += 1) {
      const arc = queue[i];
      queued.delete(arc);
      const { from, to, rules } = arc;
      const next = state[from].filter(value => state[to].some(other => rules.every(rule =>
        rule.left === from ? rule.test(value, other) : rule.test(other, value)
      )));
      const detail = `${rules.map(rule => rule.formula).join(" et ")}. Les valeurs sans support dans ${names.get(to)} sont écartées.`;
      if (!reduce(state, depth, from, next, detail, rules.map(rule => rule.id), to)) continue;
      if (!next.length) return false;
      for (const neighbor of incoming.get(from)) {
        if (neighbor.from === to || queued.has(neighbor)) continue;
        queue.push(neighbor);
        queued.add(neighbor);
      }
    }
    const complete = vars.every(variable => state[variable.id].length === 1);
    record("fixed", state, depth, complete
      ? "La propagation ne peut plus retirer de valeurs. Chaque variable possède une seule valeur."
      : "La propagation ne peut plus retirer de valeurs. Le solveur doit explorer une branche.");
    return true;
  }

  function visit(state, depth) {
    if (!propagate(state, depth)) return false;
    const open = vars.filter(variable => state[variable.id].length > 1);
    if (!open.length) {
      const values = Object.fromEntries(vars.map(variable => [variable.id, state[variable.id][0]]));
      if (frames.length >= stepLimit - 1) throw limitReached;
      solutions.push({ values, index: frames.length });
      record("solution", state, depth,
        `${vars.map(variable => `${variable.name} = ${values[variable.id]}`).join(", ")}. Toutes les contraintes sont satisfaites.`);
      return mode === "first";
    }
    const chosen = heuristic === "mrv"
      ? open.reduce((best, next) => state[next.id].length < state[best.id].length ? next : best)
      : open[0];
    const domain = state[chosen.id];
    const reason = heuristic === "mrv" ? "Plus petit domaine disponible (MRV)." : "Première variable indéterminée du modèle.";
    for (const value of domain) {
      const child = { ...state, [chosen.id]: [value] };
      record("decision", child, depth + 1, `Essai ${chosen.name} = ${value}. ${reason}`,
        { changedId: chosen.id, removed: domain.filter(item => item !== value) });
      if (visit(child, depth + 1)) return true;
      const restoredById = Object.fromEntries(vars.map(variable => [
        variable.id, state[variable.id].filter(item => !child[variable.id].includes(item))
      ]).filter(([, restored]) => restored.length));
      record("backtrack", state, depth, `Fin de l’essai ${chosen.name} = ${value}. Le solveur restaure les domaines du niveau ${depth}.`,
        { restoredById });
    }
    return false;
  }

  record("initial", initial, 0, "Les domaines de départ sont chargés. Passe à l’étape suivante pour suivre la résolution.");
  const working = { ...initial };
  try {
    const stoppedAtFirst = visit(working, 0);
    rootState = stoppedAtFirst ? frames.at(-1).domains : working;
    const status = solutions.length ? "sat" : "unsat";
    const detail = stoppedAtFirst ? "Première solution trouvée. La recherche s’arrête ici."
      : solutions.length ? `Recherche terminée. ${solutions.length} solution${solutions.length === 1 ? "" : "s"} au total.`
      : "Toutes les branches possibles ont été écartées. Ce problème n’a aucune solution.";
    record("done", rootState, stoppedAtFirst ? frames.at(-1).depth : 0, detail, { status });
  } catch (error) {
    if (error !== limitReached) throw error;
    completed = false;
    const last = frames.at(-1);
    record("limit", last.domains, last.depth,
      `La limite de ${stepLimit.toLocaleString("fr-FR")} étapes est atteinte. La recherche est incomplète.`, { status: "limit" });
  }
  return { frames, solutions, completed };
}
