// Models sometimes send a list as a JSON string, or leave a field out. Repair
// what can be repaired and say what is wrong with the rest, so the model can
// call deliver_brief again instead of the UI rendering a broken brief.
const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON: fall through and treat it as one item.
  }
  return value.trim() ? [value.trim()] : [];
};

const strings = (value) => (asList(value) ?? []).filter((item) => typeof item === "string");

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
