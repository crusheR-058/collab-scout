// Models sometimes send a list as a JSON string, or leave a field out. Repair
// what can be repaired and say what is wrong with the rest, so the model can
// call deliver_brief again instead of the UI rendering a broken brief.
const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  // Try it as written, then as a list that lost its brackets: "a", "b".
  for (const candidate of [value, `[${value}]`]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON in this form.
    }
  }
  return value.trim() ? [value.trim()] : [];
};

export const strings = (value) => (asList(value) ?? []).filter((item) => typeof item === "string");

const TEXT_FIELDS = ["brand", "goal", "audience_summary", "pitch"];
// Garbled tool JSON can swallow the fields after a string into it, such as a
// pitch that ends with `", "limitations": [...]`.
const LEAKED_FIELD = /"(brand|goal|audience_summary|partners|locations|pitch|limitations)"\s*:/;
// Double-escaped JSON leaves a literal backslash-n where a line break was meant.
const unescape = (text) => text.replace(/\\n/g, "\n");

export const checkBrief = (input) => {
  const partners = asList(input.partners);
  const problems = [];

  for (const field of TEXT_FIELDS) {
    if (typeof input[field] !== "string" || !input[field].trim()) problems.push(`${field} must be text`);
    else if (LEAKED_FIELD.test(input[field])) problems.push(`${field} contains other fields; send each field as its own JSON value`);
  }
  if (!partners?.length || partners.some((partner) => typeof partner?.name !== "string")) {
    problems.push("partners must be a list of objects, each with name, type, rationale and evidence");
  }
  if (!strings(input.limitations).length) problems.push("limitations must list what these results do not establish");
  if (problems.length) return { problem: `Brief not accepted: ${problems.join("; ")}. Call deliver_brief again.` };

  return {
    brief: {
      ...input,
      ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, unescape(input[field])])),
      partners: partners.map((partner) => ({ ...partner, evidence: strings(partner.evidence) })),
      locations: (asList(input.locations) ?? []).filter((place) => typeof place?.name === "string"),
      limitations: strings(input.limitations),
    },
  };
};

// Names differ in case, accents and punctuation between Qloo and the model.
const key = (name) =>
  String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : undefined);

const httpsUrl = (url) => (typeof url === "string" && url.startsWith("https://") ? url : undefined);

// The seed entities Qloo says drove a result, from its explainability block.
const drivers = (item, entities) => {
  const ids = (item.explainability?.["signal.interests.entities"] ?? []).map((driver) => String(driver.entity_id).toUpperCase());
  return [...entities.values()].filter((entity) => ids.includes(String(entity.id).toUpperCase())).map((entity) => entity.name);
};

// Qloo ranks entities by population; a smaller rank number means more popular.
// The direction is our calculation from the first and last points Qloo returned.
const recordTrends = (entities, envelope, at) => {
  for (const series of Array.isArray(envelope.series) ? envelope.series : []) {
    const name = series?.entity?.name;
    const points = (Array.isArray(series?.points) ? series.points : [])
      .filter((point) => typeof point?.date === "string" && number(point.population_rank) !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (typeof name !== "string" || points.length < 2) continue;
    const [from, to] = [points[0], points.at(-1)].map((point) => ({ date: point.date, rank: number(point.population_rank) }));
    const known = entities.get(key(name));
    entities.set(key(name), {
      observations: [],
      ...known,
      id: known?.id ?? series.entity.entityId,
      name: known?.name ?? name,
      trend: { direction: to.rank < from.rank ? "rising" : to.rank > from.rank ? "falling" : "flat", from, to, at },
    });
  }
};

// Remember every entity a Qloo result contains, with one observation per call
// that returned it. An affinity is relative to its own query, so observations
// are kept apart and never merged into one score. `call` is the tool call:
// its ID, input, and names for the entity IDs in that input.
export const recordEntities = (entities, tool, envelope, call = {}) => {
  const at = new Date().toISOString();
  if (tool === "qloo_trends") return recordTrends(entities, envelope, at);
  if (!Array.isArray(envelope.results)) return;
  const items = envelope.results.filter((item) => typeof item?.name === "string" && item.entity_id);
  for (const [index, item] of items.entries()) {
    const known = entities.get(key(item.name));
    const observation = {
      call: call.id,
      tool,
      input: call.input,
      labels: call.labels,
      position: index + 1,
      of: items.length,
      affinity: number(item.affinity ?? item.query?.affinity),
      drivers: drivers(item, entities),
      at,
    };
    entities.set(key(item.name), {
      ...known,
      id: item.entity_id,
      name: item.name,
      // A describe result carries its type only in the interpretation.
      category: item.subtype ?? (tool === "qloo_describe" ? envelope.interpretation?.entity?.type : undefined) ?? known?.category,
      popularity: number(item.popularity) ?? known?.popularity,
      image: httpsUrl(item.properties?.image?.url) ?? known?.image,
      description: item.properties?.short_description ?? item.properties?.description ?? known?.description,
      observations: [...(known?.observations ?? []), observation],
    });
  }
};

// Heatmap cells named by places.mjs, so the brief's locations can be checked.
export const recordPlaces = (places, envelope) => {
  const entity = envelope.interpretation?.entity?.name;
  for (const cell of Array.isArray(envelope.results) ? envelope.results : []) {
    const city = cell?.nearest_city;
    if (typeof city?.name !== "string") continue;
    const affinity = number(cell.query?.affinity);
    const known = places.get(key(city.name));
    if (known && (known.affinity ?? 0) >= (affinity ?? 0)) continue;
    places.set(key(city.name), { name: city.name, country: city.country, distance_km: city.distance_km, affinity, entity });
  }
};

// Names for the Qloo entity IDs in a tool input, so the log can show names.
const ENTITY_ID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;

export const entityLabels = (entities, input) => {
  const ids = new Set((JSON.stringify(input).match(ENTITY_ID) ?? []).map((id) => id.toUpperCase()));
  const labels = {};
  for (const entity of entities.values()) {
    if (ids.has(String(entity.id).toUpperCase())) labels[entity.id] = entity.name;
  }
  return labels;
};

// The one Qloo call whose results include the most partners, preferring a
// qloo_rank call, then the latest. Affinities from that call compare with each
// other; affinities from different calls do not.
const sharedCall = (found) => {
  const calls = new Map();
  for (const entity of found) {
    for (const observation of entity?.observations ?? []) {
      if (observation.affinity === undefined) continue;
      const entry = calls.get(observation.call) ?? { ...observation, covers: 0 };
      entry.covers += 1;
      calls.set(observation.call, entry);
    }
  }
  const score = (call) => [call.covers, call.tool === "qloo_rank" ? 1 : 0, call.at];
  return [...calls.values()].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2].localeCompare(x[2]);
  })[0];
};

// Check each partner against what Qloo returned in this scout: Qloo's own name,
// scores, image and records replace the model's, and a partner Qloo never
// returned is flagged. Numbers only ever come from Qloo; the model's are dropped.
// A location counts as checked when it names a city from a Qloo heatmap cell.
export const groundBrief = (brief, entities, places = new Map()) => {
  const found = brief.partners.map((partner) => entities.get(key(partner.name)));
  const shared = sharedCall(found);
  return {
    ...brief,
    affinity_basis: shared && { tool: shared.tool, input: shared.input, labels: shared.labels, covers: shared.covers },
    partners: brief.partners.map((partner, index) => {
      const entity = found[index];
      // Only the model's words are kept; every other field is ours.
      const words = { name: partner.name, type: partner.type, rationale: partner.rationale, evidence: partner.evidence };
      if (!entity) return { ...words, verified: false, observations: [] };
      return {
        ...words,
        verified: true,
        name: entity.name,
        id: entity.id,
        category: entity.category,
        description: entity.description,
        affinity: entity.observations.find((observation) => observation.call === shared?.call)?.affinity,
        popularity: entity.popularity,
        image: entity.image,
        trend: entity.trend,
        observations: entity.observations,
      };
    }),
    locations: brief.locations.map((place) => ({
      name: place.name,
      rationale: place.rationale,
      qloo: [...places.values()].find((city) => key(place.name).includes(key(city.name))),
    })),
  };
};
