import CONFIG from '../data/config/config.js';
import BLOCK_TYPES from '../data/config/blocks.js';
import { buildSurfaceNetGeometryData } from './surfaceNets.js';

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
        terrainWorker: null,
        terrainWorkerFailed: false,
        terrainBuildId: 0,
        terrainBuilding: false,
        terrainDirty: false,
        terrainBuildTimer: null,
        terrainBuildDelay: 120,
        terrainBatchDepth: 0,
        useTerrainMesh: true
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
        this.recalculateMapBounds();
        if (this._internal.useTerrainMesh && blockType.render !== 'cross' && block.solid) {
            this.markTerrainDirty();
        }
        
        return block;
    },
    
    removeBlock(block) {
        const index = this.blocks.indexOf(block);
        if (index > -1) {
            if (block.mesh) {
                this._internal.scene.remove(block.mesh);
            }
            this.blocks.splice(index, 1);
            this.recalculateMapBounds();
            if (this._internal.useTerrainMesh && block.type && block.type.render !== 'cross' && block.solid) {
                this.markTerrainDirty();
            }
        }
    },

    clearBlocks() {
        for (const block of this.blocks) {
            this._internal.scene.remove(block.mesh);
        }
        this.blocks = [];
        this._internal.mapBounds = null;
        this.disposeTerrainGroup();
        if (this._internal.useTerrainMesh) {
            this.markTerrainDirty();
        }
    },
    
    isPositionOccupied(x, y, z) {
        for (let block of this.blocks) {
            const dx = Math.abs(block.x - x);
            const dy = Math.abs(block.y - y);
            const dz = Math.abs(block.z - z);
            
            if (dx < 0.01 && dy < 0.01 && dz < 0.01) {
                return true;
            }
        }
        return false;
    },
    
    createBlockMaterials(blockType) {
        const textures = this._internal.blockTextures;
        const opacity = typeof blockType.opacity === 'number' ? blockType.opacity : 1;
        const transparent = opacity < 1;
        
        if (blockType.textures.all) {
            const mat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.all],
                transparent: transparent,
                opacity: opacity
            });
            return [mat, mat, mat, mat, mat, mat];
        } else if (blockType.textures.top) {
            const topMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.top],
                transparent: transparent,
                opacity: opacity
            });
            const sideMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.side],
                transparent: transparent,
                opacity: opacity
            });
            const bottomMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.bottom],
                transparent: transparent,
                opacity: opacity
            });
            return [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
        }
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
            // hide block meshes, show terrain
            for (const block of this.blocks) {
                if (!block || !block.mesh) continue;
                if (block.type && block.type.render === 'cross') continue;
                if (block.mesh.parent) block.mesh.parent.remove(block.mesh);
            }
            if (this._internal.terrainGroup) this._internal.terrainGroup.visible = true;
            this.markTerrainDirtyAll();
        } else {
            // show block meshes, hide terrain
            if (this._internal.terrainGroup) this._internal.terrainGroup.visible = false;
            for (const block of this.blocks) {
                if (!block || !block.mesh) continue;
                if (block.type && block.type.render === 'cross') continue;
                if (block.type && block.type.editorOnly && this.mode !== 'editor') continue;
                if (!block.mesh.parent) this._internal.scene.add(block.mesh);
            }
        }
    },
    ensureTerrainWorker() {
        if (this._internal.terrainWorkerFailed) return null;
        if (this._internal.terrainWorker) return this._internal.terrainWorker;
        if (typeof Worker === 'undefined') return null;
        let worker = null;
        try {
            worker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        } catch (error) {
            this._internal.terrainWorkerFailed = true;
            return null;
        }
        worker.onmessage = (event) => {
            const payload = event.data;
            if (!payload || payload.type !== 'result') return;
            if (payload.id !== this._internal.terrainBuildId) return;
            this.applyTerrainResult(payload.results || []);
            this._internal.terrainBuilding = false;
            if (this._internal.terrainDirty) {
                this.scheduleTerrainRebuild();
            }
        };
        worker.onerror = () => {
            this._internal.terrainBuilding = false;
            this._internal.terrainWorkerFailed = true;
            this._internal.terrainWorker = null;
            this._internal.terrainDirty = true;
            this.scheduleTerrainRebuild();
        };
        this._internal.terrainWorker = worker;
        return worker;
    },
    disposeTerrainGroup() {
        const group = this._internal.terrainGroup;
        if (!group) return;
        if (group.parent) group.parent.remove(group);
        for (const child of group.children) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        this._internal.terrainGroup = null;
    },
    beginTerrainBatch() {
        this._internal.terrainBatchDepth += 1;
    },
    endTerrainBatch() {
        if (this._internal.terrainBatchDepth > 0) {
            this._internal.terrainBatchDepth -= 1;
        }
        if (this._internal.terrainBatchDepth === 0 && this._internal.terrainDirty) {
            this.scheduleTerrainRebuild();
        }
    },
    markTerrainDirty() {
        if (!this._internal.useTerrainMesh) return;
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

        const grouped = new Map();
        for (const block of this.blocks) {
            if (!block || !block.solid) continue;
            if (block.type && block.type.render === 'cross') continue;
            if (block.type && block.type.editorOnly && this.mode !== 'editor') continue;
            const typeId = block.type ? block.type.id : 'unknown';
            if (!grouped.has(typeId)) grouped.set(typeId, []);
            grouped.get(typeId).push({ x: block.x, y: block.y, z: block.z });
        }

        if (grouped.size === 0) {
            this.disposeTerrainGroup();
            this._internal.terrainDirty = false;
            return;
        }

        const subdivisions = this.mode === 'game' ? 4 : 8;
        const padding = this.mode === 'game' ? 4 : 6;
        const dilation = this.mode === 'game' ? 0 : 1;
        const isoLevel = this.mode === 'game' ? 0.56 : 0.5;
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

        this._internal.terrainDirty = false;
        this._internal.terrainBuilding = true;
        this._internal.terrainBuildId += 1;
        const buildId = this._internal.terrainBuildId;

        const groups = [];
        for (const [typeId, list] of grouped.entries()) {
            groups.push({ typeId, blocks: list });
        }

        const worker = this.ensureTerrainWorker();
        if (worker) {
            worker.postMessage({ type: 'build', id: buildId, groups, options });
            return;
        }

        const results = [];
        for (const group of groups) {
            const data = buildSurfaceNetGeometryData(group.blocks, options);
            if (!data) continue;
            results.push({ typeId: group.typeId, ...data });
        }
        this.applyTerrainResult(results);
        this._internal.terrainBuilding = false;
    },
    applyTerrainResult(results) {
        this.disposeTerrainGroup();
        if (!results.length || !this._internal.scene) return;

        const group = new THREE.Group();
        group.name = 'terrain-group';

        for (const result of results) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(result.normals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(result.uvs, 2));

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
