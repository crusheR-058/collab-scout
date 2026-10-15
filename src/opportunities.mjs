// Cultural Opportunity Engine: scores the candidates that a cross-category
// scan returned. Every input is a Qloo value or Qloo's own result order; the
// weights are ours. The method is documented in docs/EVIDENCE_AND_SCORING.md,
// and a change to it must bump SCORING_VERSION.
export const SCORING_VERSION = "1";
export const CATEGORIES = ["artist", "book", "brand", "movie", "person", "place", "podcast", "tv_show", "videogame"];
export const PREFERENCES = ["either", "emerging", "established"];
export const MAX_CATEGORIES = 6;

const WEIGHTS = { fit: 0.6, size: 0.2, novelty: 0.2 };
const round = (value) => Math.round(value * 100) / 100;
const number = (value) => (Number.isFinite(value) ? value : undefined);

// `calls`: [{ category, envelope }] from one scan. `seeds`: the resolved seed
// entities, with their category when Qloo gave one.
export const scoreScan = ({ calls, seeds, prefer = "either" }) => {
  const seedIds = new Set(seeds.map((seed) => String(seed.id).toUpperCase()));
  const seedCategories = new Set(seeds.map((seed) => seed.category).filter(Boolean));
  const weights = prefer === "either" ? { fit: WEIGHTS.fit, novelty: WEIGHTS.novelty } : WEIGHTS;
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

  const seen = new Set();
  const candidates = [];
  for (const { category, envelope } of calls) {
    const items = (Array.isArray(envelope.results) ? envelope.results : []).filter(
      (item) => typeof item?.name === "string" && item.entity_id,
    );
    for (const [index, item] of items.entries()) {
      const id = String(item.entity_id).toUpperCase();
      if (seedIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      candidates.push({
        id: item.entity_id,
        name: item.name,
        category: item.subtype ?? `urn:entity:${category}`,
        position: index + 1,
        of: items.length,
        affinity: number(item.affinity),
        popularity: number(item.popularity),
      });
    }
  }

  // Popularity is placed by rank against the other candidates in this scan:
  // Qloo's raw values bunch near 1, and one outlier would squash a min-max scale.
  // 0 is the least popular candidate and 1 the most; ties share a place.
  const known = candidates.map((candidate) => candidate.popularity).filter((value) => value !== undefined);
  const relative = (value) => {
    if (known.length < 2) return 0.5;
    const below = known.filter((other) => other < value).length;
    const equal = known.filter((other) => other === value).length - 1;
    return (below + equal / 2) / (known.length - 1);
  };

  const scored = candidates.map((candidate) => {
    const missing = [];
    // Qloo's order within its own call; affinities from different calls do not compare.
    const fit = 1 - (candidate.position - 1) / candidate.of;
    let size;
    if (prefer !== "either") {
      if (candidate.popularity === undefined) missing.push("popularity");
      else size = prefer === "emerging" ? 1 - relative(candidate.popularity) : relative(candidate.popularity);
    }
    let novelty;
    if (!seedCategories.size) missing.push("seed category");
    else novelty = seedCategories.has(candidate.category) ? 0 : 1;
    // Missing evidence counts as zero, never as a high score.
    const parts = { fit, size, novelty };
    const score = Object.entries(weights).reduce((sum, [part, weight]) => sum + weight * (parts[part] ?? 0), 0) / total;
    return {
      ...candidate,
      fit: round(fit),
      size: size === undefined ? undefined : round(size),
      novelty,
      score: round(score),
      missing,
    };
  });

  scored.sort((a, b) => b.score - a.score || b.fit - a.fit || a.name.localeCompare(b.name));
  return {
    version: SCORING_VERSION,
    prefer,
    weights: Object.fromEntries(Object.entries(weights).map(([part, weight]) => [part, round(weight / total)])),
    seeds: seeds.map(({ id, name, category }) => ({ id, name, category })),
    categories: calls.map(({ category, envelope }) => ({
      category,
      status: envelope.status,
      count: Array.isArray(envelope.results) ? envelope.results.length : 0,
      error: envelope.error?.code,
    })),
    candidates: scored,
  };
};
