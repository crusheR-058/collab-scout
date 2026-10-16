// Synthetic Qloo envelopes in the shape `qloo mcp` 0.1.26 returns. The names
// and IDs are made up for tests; they are not Qloo data.
export const entity = (name, id, extra = {}) => ({
  entity_id: id,
  name,
  type: "urn:entity",
  subtype: "urn:entity:artist",
  popularity: 0.5,
  ...extra,
});

export const ok = (results, extra = {}) => ({
  status: "ok",
  summary: `${results.length} results`,
  result_count: results.length,
  results,
  provenance: { requests: [{ method: "GET", path: "/v2/insights", query: {} }] },
  ...extra,
});

export const A = entity("Test Artist A", "00000000-0000-4000-8000-00000000000A", { affinity: 0.9, popularity: 0.4 });
export const B = entity("Test Artist B", "00000000-0000-4000-8000-00000000000B", { affinity: 0.8, popularity: 0.7 });
export const C = entity("Test Artist C", "00000000-0000-4000-8000-00000000000C", { affinity: 0.7, popularity: 0.9 });

// Model turns in Bedrock Converse shape.
export const toolTurn = (...calls) => ({
  stopReason: "tool_use",
  output: {
    message: {
      role: "assistant",
      content: calls.map(([name, input], index) => ({ toolUse: { toolUseId: `t${Math.random()}${index}`, name, input } })),
    },
  },
});

export const textTurn = (text) => ({
  stopReason: "end_turn",
  output: { message: { role: "assistant", content: [{ text }] } },
});

export const brief = (partners) => ({
  brand: "Test Roastery",
  goal: "A test collaboration",
  audience_summary: "Test audience",
  partners: partners.map((name) => ({ name, type: "artist", rationale: "Because", evidence: ["Qloo said so"], affinity: 0.99, popularity: 0.01 })),
  pitch: "Hello",
  limitations: ["Test only"],
});
