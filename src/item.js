import CONFIG from '../data/config.js';
import BLOCK_TYPES from '../data/blocks.js';
import ITEMS from '../data/items.js';
import { getGroundLevel } from './collision.js';

function getBlockTextureKey(blockType) {
    if (blockType.textures.all) return blockType.textures.all;
    if (blockType.textures.top) return blockType.textures.top;
    if (blockType.textures.side) return blockType.textures.side;
    return null;
}

function createBillboardMesh(texture, baseHeight = 0.5) {
    let aspect = 1;
    if (texture && texture.image && texture.image.width && texture.image.height) {
        aspect = texture.image.width / texture.image.height;
    }
    const geometry = new THREE.PlaneGeometry(baseHeight * aspect, baseHeight);
    const material = new THREE.MeshBasicMaterial({
        map: texture || null,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide
    });
    return new THREE.Mesh(geometry, material);
}

export function spawnBlockDrop(world, blockType, amount, position, options = {}) {
    const textureKey = getBlockTextureKey(blockType);
    const texture = textureKey ? world._internal.blockTextures[textureKey] : null;
    const mesh = createBillboardMesh(texture);
    mesh.position.set(position.x, position.y, position.z);
    mesh.userData.baseY = position.y;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    mesh.userData.spin = 0;
    world._internal.scene.add(mesh);
    
    const item = {
        kind: 'block',
        blockTypeId: blockType.id,
        amount: amount,
        mesh: mesh,
        velocityY: options.velocityY ?? 0,
        velocity: options.velocity ? options.velocity.clone() : null,
        onGround: false,
        ignoreEntityId: options.ignoreEntityId ?? null,
        ignoreUntil: options.ignoreUntil ?? 0
    };
    
    world.items.push(item);
}

export function spawnItemDrop(world, itemId, amount, position, options = {}) {
    const itemDef = Object.values(ITEMS).find(it => it.id === itemId);
    const textureKey = itemDef ? itemDef.textureKey : null;
    const texture = textureKey ? world._internal.blockTextures[textureKey] : null;
    const mesh = createBillboardMesh(texture);
    mesh.position.set(position.x, position.y, position.z);
    mesh.userData.baseY = position.y;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    mesh.userData.spin = 0;
    world._internal.scene.add(mesh);
    
    const item = {
        kind: 'item',
        itemId: itemId,
        amount: amount,
        mesh: mesh,
        velocityY: options.velocityY ?? 0,
        velocity: options.velocity ? options.velocity.clone() : null,
        onGround: false,
        ignoreEntityId: options.ignoreEntityId ?? null,
        ignoreUntil: options.ignoreUntil ?? 0
    };
    
    world.items.push(item);
}

export function updateItems(world) {
    const player = world.getPlayerEntity();
    
    for (let i = world.items.length - 1; i >= 0; i--) {
        const item = world.items[i];
        const center = world._internal.mapCenter || { x: 0, z: 0 };
        const dxCenter = item.mesh.position.x - center.x;
        const dzCenter = item.mesh.position.z - center.z;
        const itemRadius = Math.sqrt(dxCenter * dxCenter + dzCenter * dzCenter);
        if (itemRadius > CONFIG.WORLD_MAX_RADIUS || item.mesh.position.y < CONFIG.WORLD_MIN_Y) {
            world._internal.scene.remove(item.mesh);
            world.items.splice(i, 1);
            continue;
        }
        if (item.mesh.userData.spin === undefined) {
            item.mesh.userData.spin = 0;
        }
        if (item.mesh.userData.phase === undefined) {
            item.mesh.userData.phase = 0;
        }
        
        item.velocityY -= CONFIG.GRAVITY * 0.7;
        if (item.velocity) {
            const nextPos = item.mesh.position.clone().add(item.velocity);
            if (isItemColliding(world, nextPos)) {
                item.velocity = null;
            } else {
                item.mesh.position.copy(nextPos);
                item.velocity.multiplyScalar(0.95);
                if (item.velocity.length() < 0.01) {
                    item.velocity = null;
                }
            }
        }
        if (item.velocity) {
            item.onGround = false;
        }
        item.mesh.position.y += item.velocityY;
        
        const groundLevel = findGroundLevel(world, item.mesh.position.x, item.mesh.position.z);
        if (groundLevel !== null) {
            const groundY = groundLevel + 0.2;
            if (item.mesh.position.y <= groundY) {
                item.mesh.position.y = groundY;
                item.velocityY = 0;
                item.onGround = true;
                item.mesh.userData.baseY = groundY;
            }
            if (item.mesh.position.y > groundY + 0.5) {
                item.onGround = false;
            }
        } else {
            item.onGround = false;
        }
        
        if (item.onGround) {
            item.mesh.userData.phase += 0.05;
            item.mesh.userData.spin += 0.03;
            item.mesh.position.y = item.mesh.userData.baseY + Math.sin(item.mesh.userData.phase) * 0.15;
        }
        
        item.mesh.lookAt(world._internal.camera.position);
        item.mesh.rotateZ(item.mesh.userData.spin);
        
        if (world.mode !== 'shooter') continue;
        
        const recipients = [
            ...(player ? [player] : []),
            ...world.entities.filter((e) => e.type !== 'player')
        ];
        const now = performance.now();
        for (const entity of recipients) {
            if (item.ignoreEntityId && entity.id === item.ignoreEntityId && now < item.ignoreUntil) {
                continue;
            }
            const dx = item.mesh.position.x - entity.x;
            const dy = item.mesh.position.y - entity.y;
            const dz = item.mesh.position.z - entity.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance > CONFIG.ITEM_PICKUP_RANGE) continue;
            
            if (item.kind === 'block') {
                const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === item.blockTypeId);
                if (blockType && entity.inventory) {
                    entity.inventory[blockType.id] = (entity.inventory[blockType.id] || 0) + item.amount;
                }
            } else if (item.kind === 'item') {
                const itemDef = Object.values(ITEMS).find(it => it.id === item.itemId);
                if (itemDef) {
                    if (itemDef.use) {
                        itemDef.use(world, entity, item.amount);
                        if (!itemDef.isConsumable && !itemDef.handlesInventory) {
                            entity.itemInventory = entity.itemInventory || {};
                            entity.itemInventory[itemDef.id] = (entity.itemInventory[itemDef.id] || 0) + item.amount;
                        }
                    } else {
                        entity.itemInventory = entity.itemInventory || {};
                        entity.itemInventory[itemDef.id] = (entity.itemInventory[itemDef.id] || 0) + item.amount;
                    }
                }
            }
            
            world._internal.scene.remove(item.mesh);
            world.items.splice(i, 1);
            break;
        }
    }
}

export function useItem(world, entity, itemDef, amount = 1) {
    if (!itemDef || !entity) return false;
    if (itemDef.use) {
        itemDef.use(world, entity, amount);
        return true;
    }
    return false;
}

function isItemColliding(world, position) {
    const half = CONFIG.BLOCK_SIZE / 2;
    for (const block of world.blocks) {
        if (!block.solid) continue;
        if (Math.abs(position.x - block.x) < half &&
            Math.abs(position.y - block.y) < half &&
            Math.abs(position.z - block.z) < half) {
            return true;
        }
    }
    return false;
}

function findGroundLevel(world, x, z) {
    let maxY = null;
    for (let block of world.blocks) {
        if (!block.solid) continue;
        const dx = Math.abs(block.x - x);
        const dz = Math.abs(block.z - z);
        if (dx < 0.5 && dz < 0.5) {
            const blockTop = block.y + CONFIG.BLOCK_SIZE / 2;
            if (maxY === null || blockTop > maxY) {
                maxY = blockTop;
            }
        }
    }
    return maxY;
}
