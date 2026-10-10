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

export const checkBrief = (input) => {
  const partners = asList(input.partners);
  const problems = [];

  for (const field of ["brand", "goal", "audience_summary", "pitch"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) problems.push(`${field} must be text`);
  }
  if (!partners?.length || partners.some((partner) => typeof partner?.name !== "string")) {
    problems.push("partners must be a list of objects, each with name, type, rationale and evidence");
  }
  if (problems.length) return { problem: `Brief not accepted: ${problems.join("; ")}. Call deliver_brief again.` };

  return {
    brief: {
      ...input,
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

// Remember every entity a Qloo result contains. An affinity from qloo_rank is
// kept over one from another tool, because rank scores a whole shortlist together.
export const recordEntities = (entities, tool, envelope) => {
  if (!Array.isArray(envelope.results)) return;
  const ranked = tool === "qloo_rank";
  for (const item of envelope.results) {
    if (typeof item?.name !== "string" || !item.entity_id) continue;
    const known = entities.get(key(item.name));
    const affinity = number(item.affinity ?? item.query?.affinity);
    const keepKnown = known?.ranked && !ranked;
    const image = item.properties?.image?.url;
    entities.set(key(item.name), {
      id: item.entity_id,
      name: item.name,
      popularity: number(item.popularity) ?? known?.popularity,
      affinity: keepKnown ? known.affinity : (affinity ?? known?.affinity),
      ranked: ranked || Boolean(known?.ranked),
      image: typeof image === "string" && image.startsWith("https://") ? image : known?.image,
    });
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

// Check each partner against what Qloo returned in this scout: Qloo's own name,
// scores and image replace the model's, and a partner Qloo never returned is flagged.
export const groundBrief = (brief, entities) => ({
  ...brief,
  partners: brief.partners.map((partner) => {
    const found = entities.get(key(partner.name));
    if (!found) {
      return { ...partner, verified: false, affinity: number(partner.affinity), popularity: number(partner.popularity) };
    }
    return {
      ...partner,
      verified: true,
      name: found.name,
      affinity: found.affinity ?? number(partner.affinity),
      popularity: found.popularity ?? number(partner.popularity),
      image: found.image,
    };
  }),
});
