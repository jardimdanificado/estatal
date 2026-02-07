// Flattened corner offsets (typed arrays for fast indexed access)
const CORNERS_X = new Uint8Array([0, 1, 1, 0, 0, 1, 1, 0]);
const CORNERS_Y = new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1]);
const CORNERS_Z = new Uint8Array([0, 0, 0, 0, 1, 1, 1, 1]);

// Flattened edge connections
const EDGE_A = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]);
const EDGE_B = new Uint8Array([1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]);

// Reusable field buffer - grows as needed, never shrinks, persists across calls
let _fieldBuf = null;
let _fieldBufLen = 0;

function getField(size) {
  if (size > _fieldBufLen) {
    _fieldBuf = new Float32Array(size);
    _fieldBufLen = size;
  } else {
    _fieldBuf.fill(0, 0, size);
  }
  return _fieldBuf;
}

// Growable Float32Array - avoids Array.push() GC pressure
function GrowBuf(cap) {
  this.d = new Float32Array(cap);
  this.n = 0;
}

GrowBuf.prototype.ensure = function (needed) {
  if (this.n + needed > this.d.length) {
    const nc = Math.max(this.d.length << 1, this.n + needed);
    const nd = new Float32Array(nc);
    nd.set(this.d);
    this.d = nd;
  }
};

GrowBuf.prototype.finish = function () {
  return this.d.slice(0, this.n);
};

// Pre-allocated corner arrays (reused across cells within a call)
const _cv = new Float64Array(8);
const _cpx = new Float64Array(8);
const _cpy = new Float64Array(8);
const _cpz = new Float64Array(8);

export function buildSurfaceNetGeometryData(blocks, options) {
  if (!options) options = {};

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

  // Support both packed Float32Array (4 floats per block: x,y,z,dmg) and object array
  const isPacked = blocks instanceof Float32Array;
  const blockCount = isPacked ? (blocks.length >> 2) : (blocks ? blocks.length : 0);
  if (blockCount === 0) return null;

  // --- Convert blocks to voxel coords, find AABB ---
  // No string-based dedup needed: blocks are unique by position from spatial hash
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const vxArr = new Int32Array(blockCount);
  const vyArr = new Int32Array(blockCount);
  const vzArr = new Int32Array(blockCount);
  const dmgArr = new Float32Array(blockCount);

  if (isPacked) {
    for (let j = 0, off = 0; j < blockCount; j++, off += 4) {
      const vx = Math.round((blocks[off] - 0.5) * subdivisions);
      const vy = Math.round((blocks[off + 1] - 0.5) * subdivisions);
      const vz = Math.round((blocks[off + 2] - 0.5) * subdivisions);
      vxArr[j] = vx; vyArr[j] = vy; vzArr[j] = vz;
      dmgArr[j] = blocks[off + 3];
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
    }
  } else {
    for (let j = 0; j < blockCount; j++) {
      const b = blocks[j];
      const vx = Math.round((b.x - 0.5) * subdivisions);
      const vy = Math.round((b.y - 0.5) * subdivisions);
      const vz = Math.round((b.z - 0.5) * subdivisions);
      vxArr[j] = vx; vyArr[j] = vy; vzArr[j] = vz;
      dmgArr[j] = b.dmg || 0;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
    }
  }

  // --- Grid setup ---
  const pad = Math.max(1, padding) * subdivisions;
  const gridMinX = minX - pad;
  const gridMinY = minY - pad;
  const gridMinZ = minZ - pad;
  const gridMaxX = maxX + pad + subdivisions;
  const gridMaxY = maxY + pad + subdivisions;
  const gridMaxZ = maxZ + pad + subdivisions;

  const nx = gridMaxX - gridMinX + 1;
  const ny = gridMaxY - gridMinY + 1;
  const nz = gridMaxZ - gridMinZ + 1;
  const nxny = nx * ny;

  const field = getField(nx * ny * nz);

  // --- Fill field, tracking tight bounds of filled voxels ---
  let fillMinX = gridMaxX, fillMinY = gridMaxY, fillMinZ = gridMaxZ;
  let fillMaxX = gridMinX, fillMaxY = gridMinY, fillMaxZ = gridMinZ;

  for (let j = 0; j < blockCount; j++) {
    const totalInset = fillInset + dmgArr[j] * subdivisions * 0.45;
    const sx = Math.max(gridMinX, Math.ceil(vxArr[j] + totalInset - dilation));
    const ex = Math.min(gridMaxX, Math.floor(vxArr[j] + subdivisions - totalInset + dilation));
    const sy = Math.max(gridMinY, Math.ceil(vyArr[j] + totalInset - dilation));
    const ey = Math.min(gridMaxY, Math.floor(vyArr[j] + subdivisions - totalInset + dilation));
    const sz = Math.max(gridMinZ, Math.ceil(vzArr[j] + totalInset - dilation));
    const ez = Math.min(gridMaxZ, Math.floor(vzArr[j] + subdivisions - totalInset + dilation));
    if (sx > ex || sy > ey || sz > ez) continue;

    if (sx < fillMinX) fillMinX = sx;
    if (sy < fillMinY) fillMinY = sy;
    if (sz < fillMinZ) fillMinZ = sz;
    if (ex > fillMaxX) fillMaxX = ex;
    if (ey > fillMaxY) fillMaxY = ey;
    if (ez > fillMaxZ) fillMaxZ = ez;

    for (let z = sz; z <= ez; z++) {
      const zOff = (z - gridMinZ) * nxny;
      for (let y = sy; y <= ey; y++) {
        const rowStart = zOff + (y - gridMinY) * nx;
        field.fill(1, rowStart + (sx - gridMinX), rowStart + (ex - gridMinX) + 1);
      }
    }
  }

  if (fillMinX > fillMaxX) return null;

  // --- Tight cell bounds (skip empty padding) ---
  const cellNx = nx - 1;
  const cellNy = ny - 1;
  const cellNz = nz - 1;

  const cellLoX = Math.max(0, fillMinX - gridMinX - 1);
  const cellHiX = Math.min(cellNx - 1, fillMaxX - gridMinX);
  const cellLoY = Math.max(0, fillMinY - gridMinY - 1);
  const cellHiY = Math.min(cellNy - 1, fillMaxY - gridMinY);
  const cellLoZ = Math.max(0, fillMinZ - gridMinZ - 1);
  const cellHiZ = Math.min(cellNz - 1, fillMaxZ - gridMinZ);

  if (cellLoX > cellHiX || cellLoY > cellHiY || cellLoZ > cellHiZ) return null;

  // Use tight-indexed arrays to save memory on sparse chunks
  const tNx = cellHiX - cellLoX + 1;
  const tNy = cellHiY - cellLoY + 1;
  const tNz = cellHiZ - cellLoZ + 1;
  const tCount = tNx * tNy * tNz;

  const cellPos = new Float32Array(tCount * 3);
  const cellValid = new Uint8Array(tCount);

  // --- Vertex placement (tight bounds, unrolled corners, inlined idx) ---
  for (let z = cellLoZ; z <= cellHiZ; z++) {
    for (let y = cellLoY; y <= cellHiY; y++) {
      for (let x = cellLoX; x <= cellHiX; x++) {
        // Inline field index for base corner (x, y, z)
        const baseIdx = x + nx * y + nxny * z;

        // Read 8 corner values via offset from base (no loop, no array-of-arrays)
        const c0 = field[baseIdx];
        const c1 = field[baseIdx + 1];
        const c2 = field[baseIdx + 1 + nx];
        const c3 = field[baseIdx + nx];
        const c4 = field[baseIdx + nxny];
        const c5 = field[baseIdx + 1 + nxny];
        const c6 = field[baseIdx + 1 + nx + nxny];
        const c7 = field[baseIdx + nx + nxny];

        // Compute mask
        let mask = 0;
        if (c0 > isoLevel) mask = 1;
        if (c1 > isoLevel) mask |= 2;
        if (c2 > isoLevel) mask |= 4;
        if (c3 > isoLevel) mask |= 8;
        if (c4 > isoLevel) mask |= 16;
        if (c5 > isoLevel) mask |= 32;
        if (c6 > isoLevel) mask |= 64;
        if (c7 > isoLevel) mask |= 128;
        if (mask === 0 || mask === 255) continue;

        // Corner world positions
        const wx = (x + gridMinX) * scale;
        const wy = (y + gridMinY) * scale;
        const wz = (z + gridMinZ) * scale;
        const wsx = wx + scale;
        const wsy = wy + scale;
        const wsz = wz + scale;

        // Store in pre-allocated arrays for edge loop
        _cv[0] = c0; _cv[1] = c1; _cv[2] = c2; _cv[3] = c3;
        _cv[4] = c4; _cv[5] = c5; _cv[6] = c6; _cv[7] = c7;
        _cpx[0] = wx;  _cpx[1] = wsx; _cpx[2] = wsx; _cpx[3] = wx;
        _cpx[4] = wx;  _cpx[5] = wsx; _cpx[6] = wsx; _cpx[7] = wx;
        _cpy[0] = wy;  _cpy[1] = wy;  _cpy[2] = wsy; _cpy[3] = wsy;
        _cpy[4] = wy;  _cpy[5] = wy;  _cpy[6] = wsy; _cpy[7] = wsy;
        _cpz[0] = wz;  _cpz[1] = wz;  _cpz[2] = wz;  _cpz[3] = wz;
        _cpz[4] = wsz; _cpz[5] = wsz; _cpz[6] = wsz; _cpz[7] = wsz;

        // Find edge crossings, average vertex position
        let count = 0, sx = 0, sy = 0, sz = 0;
        for (let e = 0; e < 12; e++) {
          const ea = EDGE_A[e];
          const eb = EDGE_B[e];
          const v1 = _cv[ea];
          const v2 = _cv[eb];
          if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
          const denom = v2 - v1;
          if (Math.abs(denom) < 1e-6) {
            sx += _cpx[ea]; sy += _cpy[ea]; sz += _cpz[ea];
          } else {
            const t = (isoLevel - v1) / denom;
            sx += _cpx[ea] + (_cpx[eb] - _cpx[ea]) * t;
            sy += _cpy[ea] + (_cpy[eb] - _cpy[ea]) * t;
            sz += _cpz[ea] + (_cpz[eb] - _cpz[ea]) * t;
          }
          count++;
        }
        if (!count) continue;

        // Store in tight-indexed arrays
        const ti = (x - cellLoX) + tNx * ((y - cellLoY) + tNy * (z - cellLoZ));
        cellValid[ti] = 1;
        const base3 = ti * 3;
        cellPos[base3] = sx / count;
        cellPos[base3 + 1] = sy / count;
        cellPos[base3 + 2] = sz / count;
      }
    }
  }

  // --- Output buffers (GrowBuf avoids Array.push overhead) ---
  const estCap = Math.max(1024, tCount);
  const outPos = new GrowBuf(estCap);
  const outNrm = new GrowBuf(estCap);
  const outUvs = new GrowBuf(estCap);

  // --- Inline triangle emitter (single normal computation, no allocations) ---
  function emitTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let nnx = aby * acz - abz * acy;
    let nny = abz * acx - abx * acz;
    let nnz = abx * acy - aby * acx;
    const len = Math.hypot(nnx, nny, nnz) || 1;
    nnx /= len; nny /= len; nnz /= len;

    outPos.ensure(9);
    const pi = outPos.n;
    outPos.d[pi] = ax; outPos.d[pi + 1] = ay; outPos.d[pi + 2] = az;
    outPos.d[pi + 3] = bx; outPos.d[pi + 4] = by; outPos.d[pi + 5] = bz;
    outPos.d[pi + 6] = cx; outPos.d[pi + 7] = cy; outPos.d[pi + 8] = cz;
    outPos.n += 9;

    outNrm.ensure(9);
    const ni = outNrm.n;
    outNrm.d[ni] = nnx; outNrm.d[ni + 1] = nny; outNrm.d[ni + 2] = nnz;
    outNrm.d[ni + 3] = nnx; outNrm.d[ni + 4] = nny; outNrm.d[ni + 5] = nnz;
    outNrm.d[ni + 6] = nnx; outNrm.d[ni + 7] = nny; outNrm.d[ni + 8] = nnz;
    outNrm.n += 9;

    // UV projection based on dominant normal axis (reuses normal, no re-computation)
    const anx = Math.abs(nnx), any = Math.abs(nny), anz = Math.abs(nnz);
    outUvs.ensure(6);
    const ui = outUvs.n;
    if (any >= anx && any >= anz) {
      const s = uvScaleTop;
      outUvs.d[ui] = ax * s; outUvs.d[ui + 1] = az * s;
      outUvs.d[ui + 2] = bx * s; outUvs.d[ui + 3] = bz * s;
      outUvs.d[ui + 4] = cx * s; outUvs.d[ui + 5] = cz * s;
    } else if (anx >= any && anx >= anz) {
      outUvs.d[ui] = az * uvScaleSideU; outUvs.d[ui + 1] = ay * uvScaleSideV;
      outUvs.d[ui + 2] = bz * uvScaleSideU; outUvs.d[ui + 3] = by * uvScaleSideV;
      outUvs.d[ui + 4] = cz * uvScaleSideU; outUvs.d[ui + 5] = cy * uvScaleSideV;
    } else {
      outUvs.d[ui] = ax * uvScaleSideU; outUvs.d[ui + 1] = ay * uvScaleSideV;
      outUvs.d[ui + 2] = bx * uvScaleSideU; outUvs.d[ui + 3] = by * uvScaleSideV;
      outUvs.d[ui + 4] = cx * uvScaleSideU; outUvs.d[ui + 5] = cy * uvScaleSideV;
    }
    outUvs.n += 6;
  }

  // --- Quad emitter (reads cellPos directly, no getPos array allocation) ---
  function emitQuad(a, b, c, d, flip) {
    if (!cellValid[a] || !cellValid[b] || !cellValid[c] || !cellValid[d]) return;
    const a3 = a * 3, b3 = b * 3, c3 = c * 3, d3 = d * 3;
    const ax = cellPos[a3], ay = cellPos[a3 + 1], az = cellPos[a3 + 2];
    const bx = cellPos[b3], by = cellPos[b3 + 1], bz = cellPos[b3 + 2];
    const cx = cellPos[c3], cy = cellPos[c3 + 1], cz = cellPos[c3 + 2];
    const dx = cellPos[d3], dy = cellPos[d3 + 1], dz = cellPos[d3 + 2];
    if (clipMin) {
      const qx = (ax + bx + cx + dx) * 0.25;
      const qy = (ay + by + cy + dy) * 0.25;
      const qz = (az + bz + cz + dz) * 0.25;
      if (qx < clipMin[0] || qy < clipMin[1] || qz < clipMin[2] ||
          qx >= clipMax[0] || qy >= clipMax[1] || qz >= clipMax[2]) return;
    }
    if (flip) {
      emitTri(ax, ay, az, cx, cy, cz, bx, by, bz);
      emitTri(ax, ay, az, dx, dy, dz, cx, cy, cz);
    } else {
      emitTri(ax, ay, az, bx, by, bz, cx, cy, cz);
      emitTri(ax, ay, az, cx, cy, cz, dx, dy, dz);
    }
  }

  // --- Quad emission loops (tight bounds, inlined cell/field indexing) ---

  // Tight iteration bounds for quad emission
  // Each direction uses cells at offset -1 in some dims, so we clamp accordingly
  const eLoX = cellLoX;
  const eHiX = cellHiX;
  const eLoY = cellLoY;
  const eHiY = cellHiY;
  const eLoZ = cellLoZ;
  const eHiZ = cellHiZ;

  // X-direction edges: check field[x,y,z] vs field[x+1,y,z]
  // Quad uses cells at (y), (y-1), (z), (z-1) → need y >= cellLoY+1, z >= cellLoZ+1
  for (let z = Math.max(eLoZ + 1, 1); z <= Math.min(eHiZ, cellNz - 1); z++) {
    for (let y = Math.max(eLoY + 1, 1); y <= Math.min(eHiY, cellNy - 1); y++) {
      const fieldRow = nx * y + nxny * z;
      for (let x = Math.max(eLoX, 0); x <= Math.min(eHiX, cellNx - 1); x++) {
        const v1 = field[fieldRow + x];
        const v2 = field[fieldRow + x + 1];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const tx = x - cellLoX, ty = y - cellLoY, tz = z - cellLoZ;
        const a = tx + tNx * (ty + tNy * tz);
        const b = tx + tNx * ((ty - 1) + tNy * tz);
        const c = tx + tNx * ((ty - 1) + tNy * (tz - 1));
        const d = tx + tNx * (ty + tNy * (tz - 1));
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  // Y-direction edges: check field[x,y,z] vs field[x,y+1,z]
  // Quad uses cells at (x), (x-1), (z), (z-1) → need x >= cellLoX+1, z >= cellLoZ+1
  for (let z = Math.max(eLoZ + 1, 1); z <= Math.min(eHiZ, cellNz - 1); z++) {
    for (let y = Math.max(eLoY, 0); y <= Math.min(eHiY, cellNy - 1); y++) {
      const fieldRow = nx * y + nxny * z;
      for (let x = Math.max(eLoX + 1, 1); x <= Math.min(eHiX, cellNx - 1); x++) {
        const v1 = field[fieldRow + x];
        const v2 = field[fieldRow + x + nx];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const tx = x - cellLoX, ty = y - cellLoY, tz = z - cellLoZ;
        const a = tx + tNx * (ty + tNy * tz);
        const b = (tx - 1) + tNx * (ty + tNy * tz);
        const c = (tx - 1) + tNx * (ty + tNy * (tz - 1));
        const d = tx + tNx * (ty + tNy * (tz - 1));
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  // Z-direction edges: check field[x,y,z] vs field[x,y,z+1]
  // Quad uses cells at (x), (x-1), (y), (y-1) → need x >= cellLoX+1, y >= cellLoY+1
  for (let z = Math.max(eLoZ, 0); z <= Math.min(eHiZ, cellNz - 1); z++) {
    for (let y = Math.max(eLoY + 1, 1); y <= Math.min(eHiY, cellNy - 1); y++) {
      const fieldRow = nx * y + nxny * z;
      for (let x = Math.max(eLoX + 1, 1); x <= Math.min(eHiX, cellNx - 1); x++) {
        const v1 = field[fieldRow + x];
        const v2 = field[fieldRow + x + nxny];
        if ((v1 > isoLevel) === (v2 > isoLevel)) continue;
        const flip = v1 > isoLevel;
        const tx = x - cellLoX, ty = y - cellLoY, tz = z - cellLoZ;
        const a = tx + tNx * (ty + tNy * tz);
        const b = (tx - 1) + tNx * (ty + tNy * tz);
        const c = (tx - 1) + tNx * ((ty - 1) + tNy * tz);
        const d = tx + tNx * ((ty - 1) + tNy * tz);
        emitQuad(a, b, c, d, flip);
      }
    }
  }

  if (outPos.n === 0) return null;

  return {
    positions: outPos.finish(),
    normals: outNrm.finish(),
    uvs: outUvs.finish()
  };
}
