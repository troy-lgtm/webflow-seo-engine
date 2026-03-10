// Freight Knowledge Graph — in-memory derived graph from lane pages
// Node types: City, Region, Lane, Mode, Segment
// Edges: City→Region, Lane→City (origin/dest), Lane→Mode, Lane→Segment

export function buildGraph(pages) {
  const nodeMap = new Map();
  const edges = [];

  function addNode(type, id, label) {
    const key = `${type}:${id}`;
    if (!nodeMap.has(key)) nodeMap.set(key, { type, id, label, degree: 0 });
    return key;
  }

  function addEdge(fromKey, toKey, rel) {
    edges.push({ from: fromKey, to: toKey, rel });
    const f = nodeMap.get(fromKey);
    const t = nodeMap.get(toKey);
    if (f) f.degree++;
    if (t) t.degree++;
  }

  (pages || []).forEach((p) => {
    if (!p?.lane) return;
    const { origin, destination, mode } = p.lane;
    const segment = p.target_segment || "smb";
    const oRegion = p.network_proof?.origin_region || "Unknown";
    const dRegion = p.network_proof?.destination_region || "Unknown";

    const laneId = p.slug || `${origin}-${destination}-${mode}`;
    const laneKey = addNode("Lane", laneId, `${origin} → ${destination} (${mode})`);
    const originKey = addNode("City", origin, origin);
    const destKey = addNode("City", destination, destination);
    const modeKey = addNode("Mode", mode, mode);
    const segKey = addNode("Segment", segment, segment);
    const oRegKey = addNode("Region", oRegion, oRegion);
    const dRegKey = addNode("Region", dRegion, dRegion);

    addEdge(laneKey, originKey, "from");
    addEdge(laneKey, destKey, "to");
    addEdge(laneKey, modeKey, "uses_mode");
    addEdge(laneKey, segKey, "targets");
    addEdge(originKey, oRegKey, "in_region");
    addEdge(destKey, dRegKey, "in_region");
  });

  const nodes = [...nodeMap.values()];

  // Top hubs = cities with highest degree
  const cityNodes = nodes.filter((n) => n.type === "City").sort((a, b) => b.degree - a.degree);
  const regionNodes = nodes.filter((n) => n.type === "Region").sort((a, b) => b.degree - a.degree);

  return {
    nodes,
    edges,
    metrics: {
      total_nodes: nodes.length,
      total_edges: edges.length,
      total_lanes: nodes.filter((n) => n.type === "Lane").length,
      total_cities: cityNodes.length,
      total_regions: regionNodes.length,
      top_hubs: cityNodes.slice(0, 5).map((n) => ({ city: n.label, connections: n.degree })),
      top_regions: regionNodes.slice(0, 3).map((n) => ({ region: n.label, connections: n.degree }))
    }
  };
}
