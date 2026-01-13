import CONFIG from '../data/config/config.js';
import BLOCK_TYPES from '../data/config/blocks.js';

export default {
    entities: [],
    blocks: [],
    projectiles: [],
    items: [],
    messages: [],
    playerEntityIndex: 0,
    mode: 'shooter',
    
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
        mapCenter: { x: 0, z: 0 }
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
        
        this._internal.scene.add(mesh);
        this.blocks.push(block);
        
        return block;
    },
    
    removeBlock(block) {
        const index = this.blocks.indexOf(block);
        if (index > -1) {
            if (block.mesh) {
                this._internal.scene.remove(block.mesh);
            }
            this.blocks.splice(index, 1);
        }
    },

    clearBlocks() {
        for (const block of this.blocks) {
            this._internal.scene.remove(block.mesh);
        }
        this.blocks = [];
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
        
        if (blockType.textures.all) {
            const mat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.all],
                transparent: blockType.id === BLOCK_TYPES.DOOR.id,
                opacity: blockType.id === BLOCK_TYPES.DOOR.id ? 0.8 : 1
            });
            return [mat, mat, mat, mat, mat, mat];
        } else if (blockType.textures.top) {
            const topMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.top]
            });
            const sideMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.side]
            });
            const bottomMat = new THREE.MeshLambertMaterial({ 
                map: textures[blockType.textures.bottom]
            });
            return [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
        }
    },
    createCrossMesh(blockType) {
        const textures = this._internal.blockTextures;
        const textureKey = blockType.textures && (blockType.textures.all || blockType.textures.top);
        const texture = textureKey ? textures[textureKey] : null;
        const size = CONFIG.BLOCK_SIZE;
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshLambertMaterial({
            map: texture || null,
            transparent: true,
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
            
            // Sistema de pathfinding
            target: entityData.target || null,
            path: [],
            pathIndex: 0,
            pathUpdateCounter: 0,
            
            // Sistema de combate
            isHostile: entityData.isHostile || false,
            shootCooldown: 0,
            targetEntity: null,
            blockInteractCooldown: 0
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
            this.entities.splice(index, 1);
            
            if (this.playerEntityIndex > index) {
                this.playerEntityIndex--;
            } else if (this.playerEntityIndex === index) {
                this.playerEntityIndex = 0;
                console.log(`Voltando controle para: ${this.entities[0].name}`);
            }
        }
    }
};
