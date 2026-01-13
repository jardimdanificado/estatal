import CONFIG from '../data/config/config.js';
import BLOCK_TYPES from '../data/config/blocks.js';
import ITEMS from '../data/config/items.js';
import { spawnBlockDrop, spawnItemDrop } from './item.js';

function createBlockMaterials(world, blockType) {
    const textures = world._internal.blockTextures;
    
    if (blockType.textures.all) {
        const mat = new THREE.MeshLambertMaterial({ 
            map: textures[blockType.textures.all],
            transparent: blockType.id === BLOCK_TYPES.DOOR.id,
            opacity: blockType.id === BLOCK_TYPES.DOOR.id ? 0.8 : 1
        });
        return [mat, mat, mat, mat, mat, mat];
    }
    
    if (blockType.textures.top) {
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
    
    const fallback = new THREE.MeshLambertMaterial({ color: 0xffffff });
    return [fallback, fallback, fallback, fallback, fallback, fallback];
}

export function createProjectile(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    const isEditor = player.isEditor || world.mode === 'editor';
    
    if (player.selectedItem && player.selectedItem.kind !== 'block') return;
    if (!player.selectedBlockType) return;

    const ammoCount = player.inventory ? (player.inventory[player.selectedBlockType.id] || 0) : 0;
    
    if (!isEditor && ammoCount <= 0) {
        console.log(`Sem munição de ${player.selectedBlockType.name}!`);
        return;
    }
    
    if (!isEditor) {
        player.inventory[player.selectedBlockType.id] = (player.inventory[player.selectedBlockType.id] || 0) - 1;
    }
    ////updateInventoryDisplay(world);
    
    const damage = player.selectedBlockType.breakDamage;
    
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const materials = createBlockMaterials(world, player.selectedBlockType);
    const mesh = new THREE.Mesh(geometry, materials);
    
    mesh.position.copy(world._internal.camera.position);
    
    const direction = new THREE.Vector3();
    world._internal.camera.getWorldDirection(direction);
    
    const projectile = {
        mesh: mesh,
        velocity: direction.multiplyScalar(0.5),
        damage: damage,
        lifeTime: 100,
        shooter: player
    };
    
    world._internal.scene.add(mesh);
    world.projectiles.push(projectile);
}

export function placeBlock(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    if (!world.ui.targetBlockPosition) return;
    const isEditor = player.isEditor || world.mode === 'editor';
    
    if (player.selectedItem && player.selectedItem.kind !== 'block') return;
    if (!player.selectedBlockType) return;

    const ammoCount = player.inventory ? (player.inventory[player.selectedBlockType.id] || 0) : 0;
    if (world.mode === 'shooter') {
        const blockHalf = CONFIG.BLOCK_SIZE / 2;
        const target = world.ui.targetBlockPosition;
        const blockBox = {
            minX: target.x - blockHalf,
            maxX: target.x + blockHalf,
            minY: target.y - blockHalf,
            maxY: target.y + blockHalf,
            minZ: target.z - blockHalf,
            maxZ: target.z + blockHalf
        };
        const height = player.isCrouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT;
        const playerBox = {
            minX: player.x - CONFIG.ENTITY_RADIUS,
            maxX: player.x + CONFIG.ENTITY_RADIUS,
            minY: player.y,
            maxY: player.y + height,
            minZ: player.z - CONFIG.ENTITY_RADIUS,
            maxZ: player.z + CONFIG.ENTITY_RADIUS
        };
        const overlap = playerBox.maxX > blockBox.minX &&
            playerBox.minX < blockBox.maxX &&
            playerBox.maxY > blockBox.minY &&
            playerBox.minY < blockBox.maxY &&
            playerBox.maxZ > blockBox.minZ &&
            playerBox.minZ < blockBox.maxZ;
        if (overlap) return;
    }
    
    if (!isEditor && ammoCount <= 0) {
        console.log(`Sem blocos de ${player.selectedBlockType.name}!`);
        return;
    }
    
    const { x, y, z } = world.ui.targetBlockPosition;
    
    const newBlock = world.addBlock(x, y, z, player.selectedBlockType, false);
    if (newBlock) {
        if (!isEditor) {
            player.inventory[player.selectedBlockType.id] = (player.inventory[player.selectedBlockType.id] || 0) - 1;
        }
        //updateInventoryDisplay(world);
        console.log(`Bloco de ${player.selectedBlockType.name} colocado!`);
    } else {
        console.log('Posição já ocupada!');
    }
}

export function updateProjectiles(world) {
    for (let i = world.projectiles.length - 1; i >= 0; i--) {
        const proj = world.projectiles[i];
        
        proj.mesh.position.add(proj.velocity);
        proj.lifeTime--;
        
        let hitSomething = false;
        
        // Verifica colisão com TODAS as entidades (exceto quem atirou)
        for (let entity of world.entities) {
            // Não atira em quem atirou
            if (proj.shooter && entity === proj.shooter) continue;
            if (entity.isEditor) continue;
            
            // Verifica distância (funciona mesmo sem mesh visível)
            const dx = proj.mesh.position.x - entity.x;
            const dy = proj.mesh.position.y - (entity.y + CONFIG.ENTITY_HEIGHT * 0.5);
            const dz = proj.mesh.position.z - entity.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (distance < 0.5) {
                entity.hp -= proj.damage;
                console.log(`${entity.name} levou ${proj.damage} de dano! HP: ${entity.hp}/${entity.maxHP}`);
                
                // Feedback visual
                if (entity.mesh && entity.mesh.material) {
                    const originalColor = entity.mesh.material.color.getHex();
                    entity.mesh.material.color.setHex(0xff0000);
                    setTimeout(() => {
                        if (entity.mesh && entity.mesh.material) {
                            entity.mesh.material.color.setHex(originalColor);
                        }
                    }, 100);
                }
                
                if (entity.hp <= 0) {
                    console.log(`${entity.name} foi derrotado!`);
                    
                    if (entity.isHostile && world.mode === 'shooter') {
                        spawnItemDrop(world, ITEMS.COIN.id, 5, {
                            x: entity.x,
                            y: entity.y + 0.3,
                            z: entity.z
                        });
                    }

                    if (entity.type !== 'player') {
                        dropEntityInventory(world, entity);
                    }
                    
                    world.removeEntity(entity);
                }
                
                world._internal.scene.remove(proj.mesh);
                world.projectiles.splice(i, 1);
                hitSomething = true;
                break;
            }
        }
        
        if (hitSomething) continue;
        
        // Verifica colisão com blocos
        for (let block of world.blocks) {
            const distance = Math.sqrt(
                Math.pow(proj.mesh.position.x - block.x, 2) +
                Math.pow(proj.mesh.position.y - block.y, 2) +
                Math.pow(proj.mesh.position.z - block.z, 2)
            );
            
            if (distance < 0.5) {
                block.hp -= proj.damage;
                
                if (Array.isArray(block.mesh.material)) {
                    const originalColors = [];
                    block.mesh.material.forEach((mat, idx) => {
                        originalColors[idx] = mat.color.clone();
                        mat.color.setHex(0xffffff);
                    });
                    setTimeout(() => {
                        if (block.mesh && block.mesh.material) {
                            block.mesh.material.forEach((mat, idx) => {
                                mat.color.copy(originalColors[idx]);
                            });
                        }
                    }, 50);
                }
                
                console.log(`${block.type.name} HP: ${block.hp}/${block.maxHP}`);
                
                if (block.hp <= 0) {
                    console.log(`${block.type.name} destruído!`);
                    
                    if (world.mode === 'shooter') {
                        spawnBlockDrop(world, block.type, 1, {
                            x: block.x,
                            y: block.y + 0.3,
                            z: block.z
                        });
                    }
                    
                    world.removeBlock(block);
                }
                
                world._internal.scene.remove(proj.mesh);
                world.projectiles.splice(i, 1);
                hitSomething = true;
                break;
            }
        }
        
        if (hitSomething) continue;
        
        // Remove projétil se acabou o tempo
        if (proj.lifeTime <= 0) {
            world._internal.scene.remove(proj.mesh);
            world.projectiles.splice(i, 1);
        }
    }
}

function dropEntityInventory(world, entity) {
    const base = { x: entity.x, y: entity.y + 0.3, z: entity.z };
    const drops = [];
    
    if (entity.inventory) {
        for (const [blockId, count] of Object.entries(entity.inventory)) {
            const qty = Math.max(0, Math.floor(Number(count) || 0));
            if (qty === 0) continue;
            const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === Number(blockId));
            if (!blockType) continue;
            for (let i = 0; i < qty; i++) {
                drops.push({ kind: 'block', blockType });
            }
        }
    }
    
    if (entity.itemInventory) {
        for (const [itemId, count] of Object.entries(entity.itemInventory)) {
            const qty = Math.max(0, Math.floor(Number(count) || 0));
            if (qty === 0) continue;
            for (let i = 0; i < qty; i++) {
                drops.push({ kind: 'item', itemId });
            }
        }
    }
    
    if (drops.length === 0) return;
    
    for (let i = 0; i < drops.length; i++) {
        const offset = getSpreadOffset(i, drops.length);
        const pos = {
            x: base.x + offset.x,
            y: base.y,
            z: base.z + offset.z
        };
        const drop = drops[i];
        if (drop.kind === 'block') {
            spawnBlockDrop(world, drop.blockType, 1, pos);
        } else if (drop.kind === 'item') {
            spawnItemDrop(world, drop.itemId, 1, pos);
        }
    }
}

function getSpreadOffset(index, total) {
    if (total <= 1) return { x: 0, z: 0 };
    const angle = (index / total) * Math.PI * 2 + Math.random() * 0.4;
    const radius = 0.3 + Math.random() * 0.6;
    return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius
    };
}
