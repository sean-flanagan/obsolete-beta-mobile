export function getNodeById(level, nodeId) {
  return (level.nodes || []).find((node) => node.id === nodeId) || null;
}

export function edgeEnabled(edge, structureState = {}) {
  if (!edge.requiresState) {
    return true;
  }

  return Object.entries(edge.requiresState).every(([key, value]) => structureState[key] === value);
}

export function getReachableNeighbors(level, nodeId, structureState = {}) {
  return (level.edges || [])
    .filter((edge) => edgeEnabled(edge, structureState) && (edge.from === nodeId || edge.to === nodeId))
    .map((edge) => (edge.from === nodeId ? edge.to : edge.from));
}

export function findNodePath(level, startNodeId, targetNodeId, structureState = {}) {
  if (!startNodeId || !targetNodeId) {
    return [];
  }

  if (startNodeId === targetNodeId) {
    return [startNodeId];
  }

  const queue = [[startNodeId]];
  const visited = new Set([startNodeId]);

  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = getReachableNeighbors(level, current, structureState);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      const nextPath = [...path, neighbor];
      if (neighbor === targetNodeId) {
        return nextPath;
      }

      visited.add(neighbor);
      queue.push(nextPath);
    }
  }

  return [];
}
