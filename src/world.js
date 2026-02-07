import CONFIG from './rom-config/config.js';
import BLOCK_TYPES from './rom-config/blocks.js';
import { buildSurfaceNetGeometryData } from './surfaceNets.js';

const CHUNK_SIZE = 8;

function isNumericSequence(value) {
    return Array.isArray(value) || ArrayBuffer.isView(value);
}

function chunkCoord(v) {
    return Math.floor(Math.round(v) / CHUNK_SIZE);
}

function chunkKey(x, y, z) {
    return chunkCoord(x) + ',' + chunkCoord(y) + ',' + chunkCoord(z);
}

function blockPosKey(x, y, z) {
    return Math.round(x) + ',' + Math.round(y) + ',' + Math.round(z);
}

export default {
    entities: [],
    blocks: [],
    projectiles: [],
    items: [],
    messages: [],
    playerEntityIndex: 0,
    mode: 'game',
    
    ui: {
        interactionTarget: null,
        targetBlockPosition: null
    },
    
    _internal: {
        scene: null,
        camera: null,
        renderer: null,
        raycaster: new THREE.Raycaster(),
        blockTextures: {},
        texturesLoaded: false,
        keys: {},
        mapCenter: { x: 0, z: 0 },
        usedNames: new Set(),
        integrated: false,
        editorMoveCommand: null,
        editorMoveLine: null,
        mapBounds: null,
        fx: [],
        terrainGroup: null,
        terrainWorkers: [],
        terrainWorkerFailed: false,
        terrainBuildId: 0,
        terrainBuilding: false,
        terrainPendingResults: 0,
        terrainDirty: false,
        terrainBuildTimer: null,
        terrainBuildDelay: 50,
        terrainBatchDepth: 0,
        useTerrainMesh: true,
        chunkMap: new Map(),
        dirtyChunks: new Set(),
        chunkGroups: new Map(),
        blockSpatialHash: new Map(),
        terrainRootGroup: null,
        lastRebuiltChunks: null,
        onTerrainReady: null
    },

    recalculateMapBounds() {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const block of this.blocks) {
            if (block.x < minX) minX = block.x;
            if (block.x > maxX) maxX = block.x;
            if (block.z < minZ) minZ = block.z;
            if (block.z > maxZ) maxZ = block.z;
        }
        if (minX !== Infinity) {
            this._internal.mapBounds = { minX, maxX, minZ, maxZ };
        } else {
            this._internal.mapBounds = null;
        }
    },
    
    getPlayerEntity() {
        return this.entities[this.playerEntityIndex];
    },
    
    switchPlayerControl(entityIndex) {
        if (entityIndex >= 0 && entityIndex < this.entities.length) {
            this.playerEntityIndex = entityIndex;
            console.log(`Agora controlando: ${this.entities[entityIndex].name}`);
        }
    },

    addBlock(x, y, z, blockType, isFloorBlock = false) {
        if (this.isPositionOccupied(x, y, z)) {
            return null;
        }
        
        let mesh = null;
        if (blockType.render === 'cross') {
            mesh = this.createCrossMesh(blockType);
        } else {
            const geometry = new THREE.BoxGeometry(CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE, CONFIG.BLOCK_SIZE);
            const materials = this.createBlockMaterials(blockType);
            mesh = new THREE.Mesh(geometry, materials);
        }
        
        mesh.position.set(x, y, z);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        if (blockType.editorOnly && this.mode !== 'editor') {
            mesh.visible = false;
        }
        
        const block = {
            mesh: mesh,
            x: x,
            y: y,
            z: z,
            type: blockType,
            solid: blockType.solid,
            velocityY: 0,
            hp: blockType.maxHP,
            maxHP: blockType.maxHP,
            isFloor: isFloorBlock,
            hasUseFunction: typeof blockType.onUse === 'function'
        };
        
        mesh.userData = block;
        
        if (this._internal.useTerrainMesh && blockType.render !== 'cross') {
            mesh.updateMatrixWorld(true);
        } else {
            this._internal.scene.add(mesh);
        }
        this.blocks.push(block);
        this.addBlockToChunk(block);
        this.recalculateMapBounds();
        if (this._internal.useTerrainMesh && blockType.render !== 'cross' && block.solid) {
            this.markChunkDirty(block.x, block.y, block.z);
        }

        return block;
    },
    
    removeBlock(block) {
        const index = this.blocks.indexOf(block);
        if (index > -1) {
            if (block.mesh) {
                this._internal.scene.remove(block.mesh);
            }
            const bx = block.x, by = block.y, bz = block.z;
            this.removeBlockFromChunk(block);
            this.blocks.splice(index, 1);
            this.recalculateMapBounds();
            if (this._internal.useTerrainMesh && block.type && block.type.render !== 'cross' && block.solid) {
                this.markChunkDirty(bx, by, bz);
            }
        }
    },

    clearBlocks() {
        for (const block of this.blocks) {
            this._internal.scene.remove(block.mesh);
        }
        this.blocks = [];
        this._internal.mapBounds = null;
        this._internal.chunkMap.clear();
        this._internal.dirtyChunks.clear();
        this._internal.blockSpatialHash.clear();
        this.disposeTerrainGroup();
        if (this._internal.useTerrainMesh) {
            this.markTerrainDirty();
        }
    },
    
    isPositionOccupied(x, y, z) {
        return this._internal.blockSpatialHash.has(blockPosKey(x, y, z));
    },
    getBlockAt(x, y, z) {
        return this._internal.blockSpatialHash.get(blockPosKey(x, y, z)) || null;
    },
    
    createBlockMaterials(blockType) {
        const textures = this._internal.blockTextures;
        const opacity = typeof blockType.opacity === 'number' ? blockType.opacity : 1;
        const transparent = opacity < 1;
        const makeMat = (texture) => new THREE.MeshLambertMaterial({
            ...(texture ? { map: texture } : { color: 0x9bb0a3 }),
            transparent,
            opacity
        });
        
        if (blockType.textures && blockType.textures.all) {
            const mat = makeMat(textures[blockType.textures.all] || null);
            return [mat, mat, mat, mat, mat, mat];
        } else if (blockType.textures && blockType.textures.top) {
            const topMat = makeMat(textures[blockType.textures.top] || null);
            const sideMat = makeMat(textures[blockType.textures.side] || null);
            const bottomMat = makeMat(textures[blockType.textures.bottom] || null);
            return [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
        }
        const fallback = makeMat(null);
        return [fallback, fallback, fallback, fallback, fallback, fallback];
    },
    createCrossMesh(blockType) {
        const textures = this._internal.blockTextures;
        const textureKey = blockType.textures && (blockType.textures.all || blockType.textures.top);
        const texture = textureKey ? textures[textureKey] : null;
        const size = CONFIG.BLOCK_SIZE;
        const opacity = typeof blockType.opacity === 'number' ? blockType.opacity : 1;
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshLambertMaterial({
            map: texture || null,
            transparent: true,
            opacity: opacity,
            side: THREE.DoubleSide,
            alphaTest: 0.1
        });
        const planeA = new THREE.Mesh(geometry, material);
        const planeB = new THREE.Mesh(geometry, material.clone());
        planeA.rotation.y = Math.PI / 4;
        planeB.rotation.y = -Math.PI / 4;
        const group = new THREE.Group();
        group.add(planeA);
        group.add(planeB);
        return group;
    },
    createTerrainMaterial(blockType) {
        const textures = this._internal.blockTextures;
        const opacity = typeof blockType.opacity === 'number' ? blockType.opacity : 1;
        const transparent = opacity < 1;
        const key = blockType.textures
            ? (blockType.textures.all || blockType.textures.top || blockType.textures.side || blockType.textures.bottom || null)
            : null;
        const map = key ? (textures[key] || null) : null;
        return new THREE.MeshLambertMaterial({
            map: map || null,
            color: map ? 0xffffff : 0x9bb0a3,
            transparent,
            opacity,
            side: THREE.DoubleSide
        });
    },
    setTerrainRenderEnabled(enabled) {
        const useTerrain = !!enabled;
        if (this._internal.useTerrainMesh === useTerrain) return;
        this._internal.useTerrainMesh = useTerrain;

        if (useTerrain) {
            for (const block of this.blocks) {
                if (!block || !block.mesh) continue;
                if (block.type && block.type.render === 'cross') continue;
                if (block.mesh.parent) block.mesh.parent.remove(block.mesh);
            }
            const root = this._internal.terrainRootGroup || this._internal.terrainGroup;
            if (root) root.visible = true;
            this.markTerrainDirtyAll();
        } else {
            const root = this._internal.terrainRootGroup || this._internal.terrainGroup;
            if (root) root.visible = false;
            for (const block of this.blocks) {
                if (!block || !block.mesh) continue;
                if (block.type && block.type.render === 'cross') continue;
                if (block.type && block.type.editorOnly && this.mode !== 'editor') continue;
                if (!block.mesh.parent) this._internal.scene.add(block.mesh);
            }
        }
    },
    ensureTerrainWorkers() {
        if (this._internal.terrainWorkerFailed) return [];
        if (this._internal.terrainWorkers.length > 0) return this._internal.terrainWorkers;
        if (typeof Worker === 'undefined') return [];

        const poolSize = Math.max(1, Math.min(4,
            Math.floor((typeof navigator !== 'undefined' && navigator.hardwareConcurrency || 2) / 2)));
        const workers = [];
        const self = this;

        for (let i = 0; i < poolSize; i++) {
            let worker;
            try {
                worker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
            } catch (error) {
                if (workers.length === 0) {
                    this._internal.terrainWorkerFailed = true;
                    return [];
                }
                break;
            }

            worker.onmessage = (event) => {
                const payload = event.data;
                if (!payload || payload.id !== self._internal.terrainBuildId) return;

                if (payload.type === 'result') {
                    self.applyTerrainResult(payload.results || []);
                } else if (payload.type === 'chunkResult') {
                    self._applyPartialChunkResults(payload.results || []);
                }

                self._internal.terrainPendingResults--;
                if (self._internal.terrainPendingResults <= 0) {
                    self._internal.terrainPendingResults = 0;
                    self._internal.terrainBuilding = false;
                    const rebuilt = self._internal.lastRebuiltChunks;
                    if (rebuilt) {
                        for (const ck of rebuilt) {
                            if (self._internal.dirtyChunks.has(ck)) continue;
                            const set = self._internal.chunkMap.get(ck);
                            if (!set || set.size === 0) {
                                self.disposeChunkGroup(ck);
                            }
                        }
                        self._internal.lastRebuiltChunks = null;
                    }
                    if (self._internal.onTerrainReady) {
                        const cb = self._internal.onTerrainReady;
                        self._internal.onTerrainReady = null;
                        cb();
                    }
                    if (self._internal.terrainDirty || self._internal.dirtyChunks.size > 0) {
                        self.scheduleTerrainRebuild();
                    }
                }
            };

            worker.onerror = () => {
                self._internal.terrainPendingResults--;
                if (self._internal.terrainPendingResults <= 0) {
                    self._internal.terrainBuilding = false;
                }
                for (const w of self._internal.terrainWorkers) {
                    try { w.terminate(); } catch (e) {}
                }
                self._internal.terrainWorkerFailed = true;
                self._internal.terrainWorkers = [];
                self._internal.terrainDirty = true;
                self.scheduleTerrainRebuild();
            };

            workers.push(worker);
        }

        this._internal.terrainWorkers = workers;
        return workers;
    },
    _applyPartialChunkResults(results) {
        if (!this._internal.scene) return;
        if (!this._internal.terrainRootGroup) {
            const root = new THREE.Group();
            root.name = 'terrain-root';
            this._internal.scene.add(root);
            this._internal.terrainRootGroup = root;
            this._internal.terrainGroup = root;
        }
        for (const chunkResult of results) {
            const ck = chunkResult.chunkKey;
            // Dispose old chunk only when its replacement is ready (prevents blink)
            this.disposeChunkGroup(ck);
            const chunkGroup = new THREE.Group();
            chunkGroup.name = 'chunk-' + ck;
            for (const meshData of chunkResult.meshes) {
                if (!meshData || !isNumericSequence(meshData.positions) || !meshData.positions.length) continue;
                if (meshData.positions.length % 3 !== 0) continue;
                if (meshData.positions[0] !== meshData.positions[0]) continue;
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
                    isNumericSequence(meshData.normals) && meshData.normals.length === meshData.positions.length
                        ? meshData.normals
                        : new Array(meshData.positions.length).fill(0),
                    3
                ));
                const uvArray = isNumericSequence(meshData.uvs) && meshData.uvs.length === (meshData.positions.length / 3) * 2
                    ? meshData.uvs
                    : new Array((meshData.positions.length / 3) * 2).fill(0);
                geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
                const blockType = Object.values(BLOCK_TYPES).find((b) => b.id === meshData.typeId);
                const material = this.createTerrainMaterial(blockType || {});
                const mesh = new THREE.Mesh(geometry, material);
                mesh.receiveShadow = true;
                mesh.castShadow = false;
                mesh.frustumCulled = true;
                mesh.userData.blockTypeId = meshData.typeId;
                chunkGroup.add(mesh);
            }
            this._internal.terrainRootGroup.add(chunkGroup);
            this._internal.chunkGroups.set(ck, chunkGroup);
        }
    },
    addBlockToChunk(block) {
        const ck = chunkKey(block.x, block.y, block.z);
        if (!this._internal.chunkMap.has(ck)) {
            this._internal.chunkMap.set(ck, new Set());
        }
        this._internal.chunkMap.get(ck).add(block);
        this._internal.blockSpatialHash.set(blockPosKey(block.x, block.y, block.z), block);
    },
    removeBlockFromChunk(block) {
        const ck = chunkKey(block.x, block.y, block.z);
        const set = this._internal.chunkMap.get(ck);
        if (set) {
            set.delete(block);
            if (set.size === 0) this._internal.chunkMap.delete(ck);
        }
        this._internal.blockSpatialHash.delete(blockPosKey(block.x, block.y, block.z));
    },
    markChunkDirty(x, y, z) {
        if (!this._internal.useTerrainMesh) return;
        const cx = chunkCoord(x);
        const cy = chunkCoord(y);
        const cz = chunkCoord(z);
        const rx = Math.round(x);
        const ry = Math.round(y);
        const rz = Math.round(z);

        this._internal.dirtyChunks.add(cx + ',' + cy + ',' + cz);

        if (rx - cx * CHUNK_SIZE <= 0) this._internal.dirtyChunks.add((cx - 1) + ',' + cy + ',' + cz);
        if (rx - cx * CHUNK_SIZE >= CHUNK_SIZE - 1) this._internal.dirtyChunks.add((cx + 1) + ',' + cy + ',' + cz);
        if (ry - cy * CHUNK_SIZE <= 0) this._internal.dirtyChunks.add(cx + ',' + (cy - 1) + ',' + cz);
        if (ry - cy * CHUNK_SIZE >= CHUNK_SIZE - 1) this._internal.dirtyChunks.add(cx + ',' + (cy + 1) + ',' + cz);
        if (rz - cz * CHUNK_SIZE <= 0) this._internal.dirtyChunks.add(cx + ',' + cy + ',' + (cz - 1));
        if (rz - cz * CHUNK_SIZE >= CHUNK_SIZE - 1) this._internal.dirtyChunks.add(cx + ',' + cy + ',' + (cz + 1));

        if (this._internal.terrainBatchDepth > 0) return;
        this.scheduleTerrainRebuild();
    },
    disposeChunkGroup(ck) {
        const group = this._internal.chunkGroups.get(ck);
        if (!group) return;
        if (group.parent) group.parent.remove(group);
        group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this._internal.chunkGroups.delete(ck);
    },
    disposeAllChunkGroups() {
        for (const ck of this._internal.chunkGroups.keys()) {
            this.disposeChunkGroup(ck);
        }
        this._internal.chunkGroups.clear();
        const root = this._internal.terrainRootGroup;
        if (root) {
            if (root.parent) root.parent.remove(root);
            this._internal.terrainRootGroup = null;
            this._internal.terrainGroup = null;
        }
    },
    disposeTerrainGroup() {
        this.disposeAllChunkGroups();
        const group = this._internal.terrainGroup;
        if (group && !this._internal.terrainRootGroup) {
            if (group.parent) group.parent.remove(group);
            for (const child of group.children) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            }
            this._internal.terrainGroup = null;
        }
    },
    beginTerrainBatch() {
        this._internal.terrainBatchDepth += 1;
    },
    endTerrainBatch() {
        if (this._internal.terrainBatchDepth > 0) {
            this._internal.terrainBatchDepth -= 1;
        }
        if (this._internal.terrainBatchDepth === 0 && (this._internal.terrainDirty || this._internal.dirtyChunks.size > 0)) {
            this.scheduleTerrainRebuild();
        }
    },
    markTerrainDirty() {
        if (!this._internal.useTerrainMesh) return;
        for (const ck of this._internal.chunkMap.keys()) {
            this._internal.dirtyChunks.add(ck);
        }
        this._internal.terrainDirty = true;
        if (this._internal.terrainBatchDepth > 0) return;
        this.scheduleTerrainRebuild();
    },
    markTerrainDirtyAll() {
        this.markTerrainDirty();
    },
    scheduleTerrainRebuild() {
        if (this._internal.terrainBuilding) return;
        if (this._internal.terrainBuildTimer) return;
        if (this.mode === 'editor') {
            this.rebuildTerrainMesh();
            return;
        }
        const delay = this._internal.terrainBuildDelay;
        this._internal.terrainBuildTimer = setTimeout(() => {
            this._internal.terrainBuildTimer = null;
            this.rebuildTerrainMesh();
        }, delay);
    },
    rebuildTerrainMesh() {
        if (!this._internal.useTerrainMesh) return;
        if (!this._internal.scene) return;
        if (this._internal.terrainBuilding) return;

        const dirtySet = this._internal.dirtyChunks;

        if (dirtySet.size === 0 && !this._internal.terrainDirty) return;

        if (this._internal.terrainDirty && dirtySet.size === 0) {
            for (const ck of this._internal.chunkMap.keys()) {
                dirtySet.add(ck);
            }
        }

        if (dirtySet.size === 0 && this._internal.chunkMap.size === 0) {
            this.disposeTerrainGroup();
            this._internal.terrainDirty = false;
            return;
        }

        const subdivisions = this.mode === 'game' ? 6 : 8;
        const padding = this.mode === 'game' ? 3 : 6;
        const dilation = this.mode === 'game' ? 1 : 1;
        const isoLevel = this.mode === 'game' ? 0.5 : 0.5;
        const scale = CONFIG.BLOCK_SIZE / subdivisions;
        const uvScaleTop = this.mode === 'game' ? 1.0 : 0.8;
        const uvScaleSide = this.mode === 'game' ? 0.55 : 0.35;
        const uvScaleSideU = uvScaleSide * 2.0;
        const uvScaleSideV = uvScaleSide * 2.0;
        const fillInset = 0;

        const options = {
            isoLevel,
            padding,
            scale,
            uvScaleTop,
            uvScaleSide,
            uvScaleSideU,
            uvScaleSideV,
            dilation,
            subdivisions,
            fillInset
        };

        const chunksToRebuild = new Set(dirtySet);
        dirtySet.clear();
        this._internal.terrainDirty = false;
        this._internal.terrainBuilding = true;
        this._internal.terrainBuildId += 1;
        const buildId = this._internal.terrainBuildId;

        if (!this._internal.terrainRootGroup) {
            const root = new THREE.Group();
            root.name = 'terrain-root';
            this._internal.scene.add(root);
            this._internal.terrainRootGroup = root;
            this._internal.terrainGroup = root;
        }

        const chunkPayloads = [];
        for (const ck of chunksToRebuild) {
            const parts = ck.split(',');
            const cx = parseInt(parts[0], 10);
            const cy = parseInt(parts[1], 10);
            const cz = parseInt(parts[2], 10);

            const contextBlocks = [];
            const chunkMinX = cx * CHUNK_SIZE;
            const chunkMaxX = (cx + 1) * CHUNK_SIZE;
            const chunkMinY = cy * CHUNK_SIZE;
            const chunkMaxY = (cy + 1) * CHUNK_SIZE;
            const chunkMinZ = cz * CHUNK_SIZE;
            const chunkMaxZ = (cz + 1) * CHUNK_SIZE;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const nk = (cx + dx) + ',' + (cy + dy) + ',' + (cz + dz);
                        const set = this._internal.chunkMap.get(nk);
                        if (!set) continue;
                        const isNeighbor = dx !== 0 || dy !== 0 || dz !== 0;
                        for (const block of set) {
                            if (!block || !block.solid) continue;
                            if (block.type && block.type.render === 'cross') continue;
                            if (block.type && block.type.editorOnly && this.mode !== 'editor') continue;
                            if (isNeighbor) {
                                const rx = Math.round(block.x);
                                const ry = Math.round(block.y);
                                const rz = Math.round(block.z);
                                if (rx < chunkMinX - padding || rx >= chunkMaxX + padding ||
                                    ry < chunkMinY - padding || ry >= chunkMaxY + padding ||
                                    rz < chunkMinZ - padding || rz >= chunkMaxZ + padding) continue;
                            }
                            contextBlocks.push(block);
                        }
                    }
                }
            }

            if (contextBlocks.length === 0) {
                this.disposeChunkGroup(ck);
                continue;
            }

            // Pack blocks as flat arrays per type (4 floats per block: x,y,z,dmg)
            const grouped = new Map();
            for (const block of contextBlocks) {
                const typeId = block.type ? block.type.id : 'unknown';
                if (!grouped.has(typeId)) grouped.set(typeId, []);
                const dmg = (block.maxHP > 0) ? 1 - block.hp / block.maxHP : 0;
                grouped.get(typeId).push(block.x, block.y, block.z, dmg);
            }

            const groups = [];
            for (const [typeId, flatList] of grouped.entries()) {
                const packed = new Float32Array(flatList);
                groups.push({ typeId, blocks: packed });
            }

            const clipMin = [
                (cx * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE,
                (cy * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE,
                (cz * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE
            ];
            const clipMax = [
                ((cx + 1) * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE,
                ((cy + 1) * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE,
                ((cz + 1) * CHUNK_SIZE - 0.5) * CONFIG.BLOCK_SIZE
            ];

            chunkPayloads.push({ chunkKey: ck, groups, clipMin, clipMax });
        }

        if (chunkPayloads.length === 0) {
            this._internal.terrainBuilding = false;
            return;
        }

        this._internal.lastRebuiltChunks = chunksToRebuild;

        const workers = this.ensureTerrainWorkers();
        if (workers.length > 0) {
            // Distribute chunks across worker pool
            const workerCount = Math.min(workers.length, chunkPayloads.length);
            this._internal.terrainPendingResults = workerCount;

            for (let wi = 0; wi < workerCount; wi++) {
                const batch = [];
                const transfers = [];
                // Round-robin distribution for balanced load
                for (let ci = wi; ci < chunkPayloads.length; ci += workerCount) {
                    const chunk = chunkPayloads[ci];
                    batch.push(chunk);
                    for (const group of chunk.groups) {
                        if (group.blocks.buffer) {
                            transfers.push(group.blocks.buffer);
                        }
                    }
                }
                workers[wi].postMessage(
                    { type: 'buildChunks', id: buildId, chunks: batch, options },
                    transfers
                );
            }
            return;
        }

        // Main-thread fallback (no workers available)
        const results = [];
        for (const chunk of chunkPayloads) {
            const chunkOpts = Object.assign({}, options, {
                clipMin: chunk.clipMin,
                clipMax: chunk.clipMax
            });
            const meshes = [];
            for (const group of chunk.groups) {
                const data = buildSurfaceNetGeometryData(group.blocks, chunkOpts);
                if (!data) continue;
                meshes.push({ typeId: group.typeId, ...data });
            }
            if (meshes.length > 0) {
                results.push({ chunkKey: chunk.chunkKey, meshes });
            }
        }
        this.applyChunkResults(results, chunksToRebuild);
        this._internal.lastRebuiltChunks = null;
        this._internal.terrainBuilding = false;
        if (this._internal.onTerrainReady) {
            const cb = this._internal.onTerrainReady;
            this._internal.onTerrainReady = null;
            cb();
        }
    },
    applyTerrainResult(results) {
        this.disposeTerrainGroup();
        if (!results.length || !this._internal.scene) return;

        const group = new THREE.Group();
        group.name = 'terrain-group';

        for (const result of results) {
            if (!result || !isNumericSequence(result.positions) || !result.positions.length) continue;
            if (result.positions.length % 3 !== 0) continue;
            if (result.positions[0] !== result.positions[0]) continue;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
                isNumericSequence(result.normals) && result.normals.length === result.positions.length
                    ? result.normals
                    : new Array(result.positions.length).fill(0),
                3
            ));
            const uvArray = isNumericSequence(result.uvs) && result.uvs.length === (result.positions.length / 3) * 2
                ? result.uvs
                : new Array((result.positions.length / 3) * 2).fill(0);
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));

            const blockType = Object.values(BLOCK_TYPES).find((b) => b.id === result.typeId);
            const material = this.createTerrainMaterial(blockType || {});
            const mesh = new THREE.Mesh(geometry, material);
            mesh.receiveShadow = true;
            mesh.castShadow = false;
            mesh.frustumCulled = false;
            mesh.userData.blockTypeId = result.typeId;
            group.add(mesh);
        }

        this._internal.scene.add(group);
        this._internal.terrainGroup = group;
    },
    applyChunkResults(results, rebuiltChunks) {
        if (!this._internal.scene) return;

        if (!this._internal.terrainRootGroup) {
            const root = new THREE.Group();
            root.name = 'terrain-root';
            this._internal.scene.add(root);
            this._internal.terrainRootGroup = root;
            this._internal.terrainGroup = root;
        }

        if (rebuiltChunks) {
            for (const ck of rebuiltChunks) {
                this.disposeChunkGroup(ck);
            }
        }

        for (const chunkResult of results) {
            const ck = chunkResult.chunkKey;
            this.disposeChunkGroup(ck);

            const chunkGroup = new THREE.Group();
            chunkGroup.name = 'chunk-' + ck;

            for (const meshData of chunkResult.meshes) {
                if (!meshData || !isNumericSequence(meshData.positions) || !meshData.positions.length) continue;
                if (meshData.positions.length % 3 !== 0) continue;
                if (meshData.positions[0] !== meshData.positions[0]) continue;
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
                    isNumericSequence(meshData.normals) && meshData.normals.length === meshData.positions.length
                        ? meshData.normals
                        : new Array(meshData.positions.length).fill(0),
                    3
                ));
                const uvArray = isNumericSequence(meshData.uvs) && meshData.uvs.length === (meshData.positions.length / 3) * 2
                    ? meshData.uvs
                    : new Array((meshData.positions.length / 3) * 2).fill(0);
                geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();

                const blockType = Object.values(BLOCK_TYPES).find((b) => b.id === meshData.typeId);
                const material = this.createTerrainMaterial(blockType || {});
                const mesh = new THREE.Mesh(geometry, material);
                mesh.receiveShadow = true;
                mesh.castShadow = false;
                mesh.frustumCulled = true;
                mesh.userData.blockTypeId = meshData.typeId;
                chunkGroup.add(mesh);
            }

            this._internal.terrainRootGroup.add(chunkGroup);
            this._internal.chunkGroups.set(ck, chunkGroup);
        }

        if (rebuiltChunks) {
            for (const ck of rebuiltChunks) {
                if (this._internal.dirtyChunks.has(ck)) continue;
                const set = this._internal.chunkMap.get(ck);
                if (!set || set.size === 0) {
                    this.disposeChunkGroup(ck);
                }
            }
        }
    },
    addEntity(entityData) {
        const entity = {
            id: this.entities.length,
            name: entityData.name || 'Entity',
            type: entityData.type || 'generic',
            
            x: entityData.x || 0,
            y: entityData.y || 2,
            z: entityData.z || 0,
            velocityY: 0,
            onGround: false,
            
            yaw: entityData.yaw || 0,
            pitch: entityData.pitch || 0,
            
            hp: entityData.hp || 100,
            maxHP: entityData.maxHP || 100,
            
            isCrouching: false,
            
            isControllable: entityData.isControllable !== false,
            isInteractable: entityData.isInteractable !== false,
            
            inventory: entityData.inventory || null,
            itemInventory: entityData.itemInventory || {},
            selectedBlockType: entityData.selectedBlockType || BLOCK_TYPES.GRASS,
            
            mesh: entityData.mesh || null,
            
            onInteract: entityData.onInteract || null,
            onUpdate: entityData.onUpdate || null,
            
            npcData: entityData.npcData || null,
            audioInstance: entityData.audioInstance || null,
            npcTypeId: entityData.npcTypeId || null,
            faction: entityData.faction || 'neutral',
            canSeePlayer: false,
            isSpeaking: false,
            fallStartY: null,
            
            // Sistema de pathfinding
            target: entityData.target || null,
            path: [],
            pathIndex: 0,
            pathUpdateCounter: 0,
            
            // Sistema de combate
            isHostile: entityData.isHostile || false,
            shootCooldown: 0,
            targetEntity: null,
            blockInteractCooldown: 0,
            alertTimer: 0,
            alertTarget: null,
            editorMoveActive: false
        };
        
        this.entities.push(entity);
        return entity;
    },
    
    removeEntity(entity) {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            if (entity.mesh) {
                this._internal.scene.remove(entity.mesh);
            }
            if (entity.indicatorGroup) {
                this._internal.scene.remove(entity.indicatorGroup);
                if (entity.nameTagTexture) {
                    entity.nameTagTexture.dispose();
                }
                if (entity.nameTagMesh && entity.nameTagMesh.material) {
                    entity.nameTagMesh.material.dispose();
                }
                if (entity.nameTagMesh && entity.nameTagMesh.geometry) {
                    entity.nameTagMesh.geometry.dispose();
                }
                if (entity.statusSpriteMesh && entity.statusSpriteMesh.material) {
                    entity.statusSpriteMesh.material.dispose();
                }
                if (entity.statusSpriteMesh && entity.statusSpriteMesh.geometry) {
                    entity.statusSpriteMesh.geometry.dispose();
                }
                if (entity.statusBackgroundMesh && entity.statusBackgroundMesh.material) {
                    entity.statusBackgroundMesh.material.dispose();
                }
                if (entity.statusBackgroundMesh && entity.statusBackgroundMesh.geometry) {
                    entity.statusBackgroundMesh.geometry.dispose();
                }
                if (entity.directionBackgroundMesh && entity.directionBackgroundMesh.material) {
                    entity.directionBackgroundMesh.material.dispose();
                }
                if (entity.directionBackgroundMesh && entity.directionBackgroundMesh.geometry) {
                    entity.directionBackgroundMesh.geometry.dispose();
                }
                if (entity.hpSpriteMesh && entity.hpSpriteMesh.material) {
                    entity.hpSpriteMesh.material.dispose();
                }
                if (entity.hpSpriteMesh && entity.hpSpriteMesh.geometry) {
                    entity.hpSpriteMesh.geometry.dispose();
                }
                if (entity.directionSpriteMesh && entity.directionSpriteMesh.material) {
                    entity.directionSpriteMesh.material.dispose();
                }
                if (entity.directionSpriteMesh && entity.directionSpriteMesh.geometry) {
                    entity.directionSpriteMesh.geometry.dispose();
                }
            }
            if (entity.debugArrow) {
                this._internal.scene.remove(entity.debugArrow);
                if (entity.debugArrow.line && entity.debugArrow.line.material) {
                    entity.debugArrow.line.material.dispose();
                }
                if (entity.debugArrow.line && entity.debugArrow.line.geometry) {
                    entity.debugArrow.line.geometry.dispose();
                }
                if (entity.debugArrow.cone && entity.debugArrow.cone.material) {
                    entity.debugArrow.cone.material.dispose();
                }
                if (entity.debugArrow.cone && entity.debugArrow.cone.geometry) {
                    entity.debugArrow.cone.geometry.dispose();
                }
            }
            if (entity.debugPathLine) {
                this._internal.scene.remove(entity.debugPathLine);
                if (entity.debugPathLine.material) {
                    entity.debugPathLine.material.dispose();
                }
                if (entity.debugPathLine.geometry) {
                    entity.debugPathLine.geometry.dispose();
                }
            }
            if (entity._bloodStains && Array.isArray(entity._bloodStains)) {
                entity._bloodStains.forEach((stain) => {
                    if (stain && stain.parent) stain.parent.remove(stain);
                    if (stain && stain.material) stain.material.dispose();
                    if (stain && stain.geometry) stain.geometry.dispose();
                });
                entity._bloodStains = [];
            }
            if (this._internal.editorMoveCommand && this._internal.editorMoveCommand.entityId === entity.id) {
                this._internal.editorMoveCommand = null;
                if (this._internal.editorMoveLine) {
                    this._internal.editorMoveLine.visible = false;
                }
            }
            this.entities.splice(index, 1);
            
            if (this.playerEntityIndex > index) {
                this.playerEntityIndex--;
            }
        }
    }
};
