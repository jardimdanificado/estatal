const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1]
];

const EDGE_CONNECTION = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolate(isolevel, p1, p2, v1, v2) {
  const denom = (v2 - v1);
  if (Math.abs(denom) < 1e-6) {
    return [p1[0], p1[1], p1[2]];
  }
  const t = (isolevel - v1) / denom;
  return [
    lerp(p1[0], p2[0], t),
    lerp(p1[1], p2[1], t),
    lerp(p1[2], p2[2], t)
  ];
}

function computeTriNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  return [nx, ny, nz];
}

function pushProjectedUVs(uvs, ax, ay, az, bx, by, bz, cx, cy, cz, uvScaleTop, uvScaleSideU, uvScaleSideV) {
  const [nx, ny, nz] = computeTriNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
  const anx = Math.abs(nx);
  const any = Math.abs(ny);
  const anz = Math.abs(nz);

  let u1, v1, u2, v2, u3, v3;
  if (any >= anx && any >= anz) {
    const s = uvScaleTop;
    u1 = ax * s; v1 = az * s;
    u2 = bx * s; v2 = bz * s;
    u3 = cx * s; v3 = cz * s;
  } else if (anx >= any && anx >= anz) {
    const su = uvScaleSideU;
    const sv = uvScaleSideV;
    u1 = az * su; v1 = ay * sv;
    u2 = bz * su; v2 = by * sv;
    u3 = cz * su; v3 = cy * sv;
  } else {
    const su = uvScaleSideU;
    const sv = uvScaleSideV;
    u1 = ax * su; v1 = ay * sv;
    u2 = bx * su; v2 = by * sv;
    u3 = cx * su; v3 = cy * sv;
  }

  uvs.push(u1, v1, u2, v2, u3, v3);
}

function emitTriangle(out, ax, ay, az, bx, by, bz, cx, cy, cz, uvScaleTop, uvScaleSideU, uvScaleSideV) {
  const [nx, ny, nz] = computeTriNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
  out.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  out.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  pushProjectedUVs(out.uvs, ax, ay, az, bx, by, bz, cx, cy, cz, uvScaleTop, uvScaleSideU, uvScaleSideV);
}

export function buildSurfaceNetGeometryData(blocks, options = {}) {
  const isoLevel = typeof options.isoLevel === 'number' ? options.isoLevel : 0.5;
  const padding = typeof options.padding === 'number' ? options.padding : 2;
  const scale = typeof options.scale === 'number' ? options.scale : 1;
  const uvScaleTop = typeof options.uvScaleTop === 'number' ? options.uvScaleTop : 1;
  const uvScaleSide = typeof options.uvScaleSide === 'number' ? options.uvScaleSide : 1;
  const uvScaleSideU = typeof options.uvScaleSideU === 'number' ? options.uvScaleSideU : uvScaleSide;
  const uvScaleSideV = typeof options.uvScaleSideV === 'number' ? options.uvScaleSideV : uvScaleSide;
  const dilation = typeof options.dilation === 'number' ? options.dilation : 0;
  const subdivisions = Math.max(1, Math.floor(options.subdivisions || 1));
  const fillInset = Math.max(0, Number(options.fillInset || 0));
  const clipMin = options.clipMin || null;
  const clipMax = options.clipMax || null;

  if (!blocks || !blocks.length) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const voxelList = [];
  const voxelSet = new Set();
  for (const block of blocks) {
    const vx = Math.round((block.x - 0.5) * subdivisions);
    const vy = Math.round((block.y - 0.5) * subdivisions);
    const vz = Math.round((block.z - 0.5) * subdivisions);
    const key = `${vx},${vy},${vz}`;
    if (voxelSet.has(key)) continue;
    voxelSet.add(key);
    voxelList.push({ vx, vy, vz, dmg: block.dmg || 0 });
    if (vx < minX) minX = vx;
    if (vy < minY) minY = vy;
    if (vz < minZ) minZ = vz;
    if (vx > maxX) maxX = vx;
    if (vy > maxY) maxY = vy;
    if (vz > maxZ) maxZ = vz;
  }

  if (!voxelList.length) return null;

  const pad = Math.max(1, padding) * subdivisions;
  minX -= pad; minY -= pad; minZ -= pad;
  maxX += pad; maxY += pad; maxZ += pad;

  const gridMinX = minX;
  const gridMinY = minY;
  const gridMinZ = minZ;
  const gridMaxX = maxX + subdivisions;
  const gridMaxY = maxY + subdivisions;
  const gridMaxZ = maxZ + subdivisions;

  const nx = gridMaxX - gridMinX + 1;
  const ny = gridMaxY - gridMinY + 1;
  const nz = gridMaxZ - gridMinZ + 1;

  const field = new Float32Array(nx * ny * nz);

  function idx(x, y, z) {
    return (x - gridMinX) + nx * ((y - gridMinY) + ny * (z - gridMinZ));
  }

  for (const voxel of voxelList) {
    const totalInset = fillInset + voxel.dmg * subdivisions * 0.45;
    const startX = Math.max(gridMinX, Math.ceil(voxel.vx + totalInset - dilation));
    const endX = Math.min(gridMaxX, Math.floor(voxel.vx + subdivisions - totalInset + dilation));
    const startY = Math.max(gridMinY, Math.ceil(voxel.vy + totalInset - dilation));
    const endY = Math.min(gridMaxY, Math.floor(voxel.vy + subdivisions - totalInset + dilation));
    const startZ = Math.max(gridMinZ, Math.ceil(voxel.vz + totalInset - dilation));
    const endZ = Math.min(gridMaxZ, Math.floor(voxel.vz + subdivisions - totalInset + dilation));

    if (startX > endX || startY > endY || startZ > endZ) continue;

    for (let z = startZ; z <= endZ; z++) {
      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          field[idx(x, y, z)] = 1;
        }
      }
    }
  }

  const cellNx = nx - 1;
  const cellNy = ny - 1;
  const cellNz = nz - 1;
  const cellCount = cellNx * cellNy * cellNz;

  const cellPos = new Float32Array(cellCount * 3);
  const cellValid = new Uint8Array(cellCount);

  function cellId(x, y, z) {
    return x + cellNx * (y + cellNy * z);
  }

  const cornerValues = new Float64Array(8);
  const cpx = new Float64Array(8);
  const cpy = new Float64Array(8);
  const cpz = new Float64Array(8);

  for (let z = 0; z < cellNz; z++) {
    for (let y = 0; y < cellNy; y++) {
      for (let x = 0; x < cellNx; x++) {
        for (let i = 0; i < 8; i++) {
          const gx = x + CORNERS[i][0] + gridMinX;
          const gy = y + CORNERS[i][1] + gridMinY;
          const gz = z + CORNERS[i][2] + gridMinZ;
          cornerValues[i] = field[idx(gx, gy, gz)];
          cpx[i] = gx * scale;
          cpy[i] = gy * scale;
          cpz[i] = gz * scale;
        }

        let mask = 0;
        for (let i = 0; i < 8; i++) {
          if (cornerValues[i] > isoLevel) mask |= (1 << i);
        }
        if (mask === 0 || mask === 255) continue;

        let count = 0;
        let sx = 0, sy = 0, sz = 0;
        for (let e = 0; e < 12; e++) {
          const ea = EDGE_CONNECTION[e][0];
          const eb = EDGE_CONNECTION[e][1];
          const v1 = cornerValues[ea];
          const v2 = cornerValues[eb];
          if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
          const denom = v2 - v1;
          if (Math.abs(denom) < 1e-6) {
            sx += cpx[ea]; sy += cpy[ea]; sz += cpz[ea];
          } else {
            const t = (isoLevel - v1) / denom;
            sx += cpx[ea] + (cpx[eb] - cpx[ea]) * t;
            sy += cpy[ea] + (cpy[eb] - cpy[ea]) * t;
            sz += cpz[ea] + (cpz[eb] - cpz[ea]) * t;
          }
          count++;
        }
        if (!count) continue;

        const idxCell = cellId(x, y, z);
        cellValid[idxCell] = 1;
        const base = idxCell * 3;
        cellPos[base] = sx / count;
        cellPos[base + 1] = sy / count;
        cellPos[base + 2] = sz / count;
      }
    }
  }

  const out = { positions: [], normals: [], uvs: [] };

  function getPos(ci) {
    const base = ci * 3;
    return [cellPos[base], cellPos[base + 1], cellPos[base + 2]];
  }

  function emitQuad(a, b, c, d, flip) {
    if (!cellValid[a] || !cellValid[b] || !cellValid[c] || !cellValid[d]) return;
    const [ax, ay, az] = getPos(a);
    const [bx, by, bz] = getPos(b);
    const [cx, cy, cz] = getPos(c);
    const [dx, dy, dz] = getPos(d);
    if (clipMin) {
      const qx = (ax + bx + cx + dx) * 0.25;
      const qy = (ay + by + cy + dy) * 0.25;
      const qz = (az + bz + cz + dz) * 0.25;
      if (qx < clipMin[0] || qy < clipMin[1] || qz < clipMin[2] ||
          qx >= clipMax[0] || qy >= clipMax[1] || qz >= clipMax[2]) return;
    }
    if (flip) {
      emitTriangle(out, ax, ay, az, cx, cy, cz, bx, by, bz, uvScaleTop, uvScaleSideU, uvScaleSideV);
      emitTriangle(out, ax, ay, az, dx, dy, dz, cx, cy, cz, uvScaleTop, uvScaleSideU, uvScaleSideV);
    } else {
      emitTriangle(out, ax, ay, az, bx, by, bz, cx, cy, cz, uvScaleTop, uvScaleSideU, uvScaleSideV);
      emitTriangle(out, ax, ay, az, cx, cy, cz, dx, dy, dz, uvScaleTop, uvScaleSideU, uvScaleSideV);
    }
  }

  for (let z = 1; z < cellNz; z++) {
    for (let y = 1; y < cellNy; y++) {
      for (let x = 0; x < cellNx; x++) {
        const v1 = field[idx(x + gridMinX, y + gridMinY, z + gridMinZ)];
        const v2 = field[idx(x + 1 + gridMinX, y + gridMinY, z + gridMinZ)];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const a = cellId(x, y, z);
        const b = cellId(x, y - 1, z);
        const c = cellId(x, y - 1, z - 1);
        const d = cellId(x, y, z - 1);
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  for (let z = 1; z < cellNz; z++) {
    for (let y = 0; y < cellNy; y++) {
      for (let x = 1; x < cellNx; x++) {
        const v1 = field[idx(x + gridMinX, y + gridMinY, z + gridMinZ)];
        const v2 = field[idx(x + gridMinX, y + 1 + gridMinY, z + gridMinZ)];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const a = cellId(x, y, z);
        const b = cellId(x - 1, y, z);
        const c = cellId(x - 1, y, z - 1);
        const d = cellId(x, y, z - 1);
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  for (let z = 0; z < cellNz; z++) {
    for (let y = 1; y < cellNy; y++) {
      for (let x = 1; x < cellNx; x++) {
        const v1 = field[idx(x + gridMinX, y + gridMinY, z + gridMinZ)];
        const v2 = field[idx(x + gridMinX, y + gridMinY, z + 1 + gridMinZ)];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const a = cellId(x, y, z);
        const b = cellId(x - 1, y, z);
        const c = cellId(x - 1, y - 1, z);
        const d = cellId(x, y - 1, z);
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  if (!out.positions.length) return null;

  return {
    positions: new Float32Array(out.positions),
    normals: new Float32Array(out.normals),
    uvs: new Float32Array(out.uvs)
  };
}
