import { buildSurfaceNetGeometryData } from './surfaceNets.js';

self.onmessage = (event) => {
  const payload = event.data;
  if (!payload) return;

  if (payload.type === 'build') {
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
  } else if (payload.type === 'buildChunks') {
    const { id, chunks, options } = payload;
    const results = [];
    const transfers = [];

    for (const chunk of chunks) {
      const chunkOpts = Object.assign({}, options, {
        clipMin: chunk.clipMin,
        clipMax: chunk.clipMax
      });
      const chunkResults = [];
      for (const group of chunk.groups) {
        const data = buildSurfaceNetGeometryData(group.blocks, chunkOpts);
        if (!data) continue;
        chunkResults.push({
          typeId: group.typeId,
          positions: data.positions,
          normals: data.normals,
          uvs: data.uvs
        });
        transfers.push(data.positions.buffer, data.normals.buffer, data.uvs.buffer);
      }
      if (chunkResults.length > 0) {
        results.push({ chunkKey: chunk.chunkKey, meshes: chunkResults });
      }
    }

    self.postMessage({ type: 'chunkResult', id, results }, transfers);
  }
};
