import { buildSurfaceNetGeometryData } from './surfaceNets.js';

self.onmessage = (event) => {
  const payload = event.data;
  if (!payload || payload.type !== 'build') return;
  const { id, groups, options } = payload;
  const results = [];
  const transfers = [];

  for (const group of groups) {
    const data = buildSurfaceNetGeometryData(group.blocks, options);
    if (!data) continue;
    results.push({
      typeId: group.typeId,
      positions: data.positions,
      normals: data.normals,
      uvs: data.uvs
    });
    transfers.push(data.positions.buffer, data.normals.buffer, data.uvs.buffer);
  }

  self.postMessage({ type: 'result', id, results }, transfers);
};
