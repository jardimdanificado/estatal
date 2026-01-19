import CONFIG from '../data/config/config.js';
import BLOCK_TYPES from '../data/config/blocks.js';
import { checkCollision, getGroundLevel } from './collision.js';
import { getFactionRelation } from '../data/config/factions.js';
import { alertEntitiesFromShot } from './bullet.js';
import ITEMS from '../data/config/items.js';
import { useItem } from './item.js';

const aiRaycaster = new THREE.Raycaster();
const VISION_ICONS = {
    friendly: { seen: 'sensed_friendly', unseen: 'sensed_friendly_unseen' },
    hostile: { seen: 'sensed_hostile', unseen: 'sensed_hostile_unseen' }
};
const DIRECTION_ICONS = [
    'arrow_0',
    'arrow_1',
    'arrow_2',
    'arrow_3',
    'arrow_4',
    'arrow_5',
    'arrow_6',
    'arrow_7'
];
const HP_ICONS = [
    { threshold: 0.15, key: 'mdam_almost_dead' },
    { threshold: 0.3, key: 'mdam_severely_damaged' },
    { threshold: 0.5, key: 'mdam_heavily_damaged' },
    { threshold: 0.7, key: 'mdam_moderately_damaged' },
    { threshold: 1.01, key: 'mdam_lightly_damaged' }
];

const CONSUMABLE_HEALTH_RATIO = 0.6;
const CONSUMABLE_ITEMS = Object.values(ITEMS).filter((item) => item.isConsumable);

function getBestConsumableInInventory(entity) {
    if (!entity.itemInventory) return null;
    let best = null;
    for (const itemDef of CONSUMABLE_ITEMS) {
        const count = entity.itemInventory[itemDef.id] || 0;
        if (count <= 0) continue;
        if (!best || (itemDef.healValue || 0) > (best.healValue || 0)) {
            best = itemDef;
        }
    }
    return best;
}

function shouldUseConsumable(entity) {
    const maxHP = entity.maxHP || 0;
    if (maxHP <= 0) return false;
    if (entity.hp >= maxHP * CONSUMABLE_HEALTH_RATIO) return false;
    return entity.hp < maxHP;
}

function tryUseConsumable(world, entity) {
    if (!shouldUseConsumable(entity)) return false;
    const consumable = getBestConsumableInInventory(entity);
    if (!consumable) return false;
    const count = entity.itemInventory ? (entity.itemInventory[consumable.id] || 0) : 0;
    if (count <= 0) return false;
    if (useItem(world, entity, consumable, 1)) {
        entity.itemInventory[consumable.id] = Math.max(0, count - 1);
        return true;
    }
    return false;
}




// ============================================================
// INTERAÇÃO COM BLOCO/ENTIDADE
// ============================================================

export function handleInteraction(world, target) {
    const player = world.getPlayerEntity();
    
    if (target.type && target.hasUseFunction && target.type.onUse) {
        const blockAdapter = {
            userData: {
                x: target.x,
                y: target.y,
                z: target.z,
                type: target.type,
                solid: target.solid,
                isFloor: target.isFloor
            },
            material: target.mesh.material,
            position: {
                set: (x, y, z) => {
                    target.mesh.position.set(x, y, z);
                    target.x = x;
                    target.y = y;
                    target.z = z;
                }
            }
        };
        
        // Passa world, block e entity que ativou
        target.type.onUse(world, blockAdapter, player);
        target.solid = blockAdapter.userData.solid;
    } 
    else if (target.onInteract) {
        target.onInteract(world, target);
    } else {
        console.log(`${target.name || 'Objeto'} não tem função de uso.`);
    }
}

export function checkInteractionTarget(world) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    const blockMeshes = world.blocks.map(b => b.mesh);
    const entityMeshes = world.entities.filter(e => e.mesh && e.mesh.visible).map(e => e.mesh);
    const allObjects = [...blockMeshes, ...entityMeshes];
    
    const intersects = raycaster.intersectObjects(allObjects);
    
    const interactionDiv = document.getElementById('interaction');
    const outlineDiv = document.getElementById('block-outline');
    
    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const distance = intersects[0].distance;
        
        const block = world.blocks.find(b => b.mesh === hitMesh);
        if (block && distance < CONFIG.PLACEMENT_RANGE) {
            const normal = intersects[0].face.normal;
            
            let newX = block.x + Math.round(normal.x);
            let newY = block.y + Math.round(normal.y);
            let newZ = block.z + Math.round(normal.z);
            
            world.ui.targetBlockPosition = { x: newX, y: newY, z: newZ };
            outlineDiv.style.display = 'block';
            
            if (distance < CONFIG.INTERACTION_RANGE && block.hasUseFunction) {
                world.ui.interactionTarget = block;
                interactionDiv.textContent = `Usar ${block.type.name}`;
                interactionDiv.style.display = 'block';
                return;
            }
        } else {
            world.ui.targetBlockPosition = null;
            outlineDiv.style.display = 'none';
        }
        
        const entity = world.entities.find(e => e.mesh === hitMesh);
        if (entity && distance < CONFIG.INTERACTION_RANGE && entity.isInteractable) {
            world.ui.interactionTarget = entity;
            interactionDiv.textContent = `Falar com ${entity.name}`;
            interactionDiv.style.display = 'block';
            return;
        }
    } else {
        world.ui.targetBlockPosition = null;
        outlineDiv.style.display = 'none';
    }
    
    world.ui.interactionTarget = null;
    interactionDiv.style.display = 'none';
}

// ============================================================
// PATHFINDING (A* SIMPLIFICADO COM PULOS E CROUCH)
// ============================================================
export function findPath(world, entity, targetPos) {
    // Só calcula path se a entidade NÃO está sendo controlada pelo player
    const isPlayerControlled = (world.getPlayerEntity() === entity);
    if (isPlayerControlled) return [];
    
    const start = {
        x: Math.round(entity.x),
        y: Math.round(getGroundLevel(world, entity.x, entity.z)),
        z: Math.round(entity.z)
    };
    
    const endX = Math.round(targetPos.x);
    const endZ = Math.round(targetPos.z);
    let endY = Math.round(targetPos.y);
    if (!canWalkTo(world, entity, endX, endY, endZ, false) &&
        !canWalkTo(world, entity, endX, endY, endZ, true)) {
        endY = Math.round(getGroundLevel(world, targetPos.x, targetPos.z));
    }
    const end = {
        x: endX,
        y: endY,
        z: endZ
    };
    
    // Se já está perto do alvo, não precisa calcular
    const dist = Math.abs(start.x - end.x) + Math.abs(start.z - end.z) + Math.abs(start.y - end.y);
    if (dist < 2 && Math.abs(start.y - end.y) < 0.5) return [];
    
    const openSet = [];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    
    const startKey = `${start.x},${start.y},${start.z}`;
    openSet.push(startKey);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(start, end));
    
    let iterations = 0;
    
    const maxIterations = CONFIG.MAX_PATH_ITERATIONS + dist * 20;
    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        
        openSet.sort((a, b) => fScore.get(a) - fScore.get(b));
        const current = openSet.shift();
        
        const [cx, cy, cz] = current.split(',').map(Number);
        
        if (cx === end.x && cy === end.y && cz === end.z) {
            return reconstructPath(cameFrom, current);
        }
        
        closedSet.add(current);
        
        const neighbors = getNeighbors(world, entity, cx, cy, cz);
        
        for (let neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.z}`;
            
            if (closedSet.has(neighborKey)) continue;
            
            const tentativeG = gScore.get(current) + neighbor.cost;
            
            if (!openSet.includes(neighborKey)) {
                openSet.push(neighborKey);
            } else if (tentativeG >= gScore.get(neighborKey)) {
                continue;
            }
            
            cameFrom.set(neighborKey, current);
            gScore.set(neighborKey, tentativeG);
            fScore.set(neighborKey, tentativeG + heuristic(neighbor, end));
        }
    }
    
    return []; // Sem caminho
}

export function getNeighbors(world, entity, x, y, z) {
    const neighbors = [];
    const directions = [
        {dx: 1, dz: 0},
        {dx: -1, dz: 0},
        {dx: 0, dz: 1},
        {dx: 0, dz: -1}
    ];
    
    for (let dir of directions) {
        const nx = x + dir.dx;
        const nz = z + dir.dz;
        
        // Movimento normal (mesmo nível)
        if (canWalkTo(world, entity, nx, y, nz, false)) {
            neighbors.push({x: nx, y: y, z: nz, cost: 1, needsCrouch: false});
        }
        // Movimento com crouch (passar por espaço de 1 bloco)
        else if (canWalkTo(world, entity, nx, y, nz, true)) {
            neighbors.push({x: nx, y: y, z: nz, cost: 1.5, needsCrouch: true});
        }
        
        // Pulo (até 1 de altura, até 1 na horizontal) - apenas direções cardeais
        if (Math.abs(dir.dx) + Math.abs(dir.dz) === 1) {
            if (canJumpToFrom(world, entity, x, y, z, nx, y + 1, nz)) {
                neighbors.push({x: nx, y: y + 1, z: nz, cost: 2, needsCrouch: false});
            }
            // Salto sobre buraco de 1 bloco (distância 2), mantendo limite de altura
            const gapBlocked = !canWalkTo(world, entity, nx, y, nz, false) &&
                !canWalkTo(world, entity, nx, y, nz, true);
            if (gapBlocked) {
                const jx = x + dir.dx * 2;
                const jz = z + dir.dz * 2;
                if (canWalkTo(world, entity, jx, y, jz, false)) {
                    neighbors.push({x: jx, y: y, z: jz, cost: 2.6, needsCrouch: false});
                }
                if (canWalkTo(world, entity, jx, y + 1, jz, false)) {
                    neighbors.push({x: jx, y: y + 1, z: jz, cost: 3.0, needsCrouch: false});
                }
            }
        }
        
        // Queda para baixo
        const groundLevel = getGroundLevel(world, nx, nz);
        if (groundLevel < y && groundLevel >= y - 3) {
            if (canWalkTo(world, entity, nx, groundLevel, nz, false)) {
                const drop = y - groundLevel;
                const penalty = drop * 2;
                neighbors.push({x: nx, y: groundLevel, z: nz, cost: 1.2 + penalty, needsCrouch: false});
            }
        }
    }
    
    return neighbors;
}

function getWeaponRange(entity) {
    const blockType = entity.selectedBlockType;
    if (!blockType) return CONFIG.HOSTILE_ATTACK_RANGE;
    const speed = blockType.bulletSpeed || 0.5;
    const life = blockType.bulletLifetime || 100;
    return speed * life;
}

function chooseBestBlockTypeForEntity(entity) {
    if (!entity || !entity.inventory) return null;
    let best = null;
    let bestDamage = -Infinity;
    for (const blockType of Object.values(BLOCK_TYPES)) {
        if (!blockType || blockType.droppable === false) continue;
        const count = entity.inventory[blockType.id] || 0;
        if (count <= 0) continue;
        const damage = typeof blockType.breakDamage === 'number' ? blockType.breakDamage : 0;
        if (damage > bestDamage) {
            bestDamage = damage;
            best = blockType;
        }
    }
    return best;
}

function ensureEntityHasWeapon(entity) {
    if (!entity || !entity.inventory) return;
    const current = entity.selectedBlockType;
    if (current) {
        const count = entity.inventory[current.id] || 0;
        if (count > 0) return;
    }
    const best = chooseBestBlockTypeForEntity(entity);
    if (best) {
        entity.selectedBlockType = best;
    }
}

export function canWalkTo(world, entity, x, y, z, crouching) {
    const height = crouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT;
    
    // Verifica se há chão
    const hasGround = getGroundLevel(world, x, z) >= y - 0.1;
    if (!hasGround) return false;
    
    // Verifica colisão
    const collision = checkCollision(world, x, y, z, {...entity, isCrouching: crouching});
    return !collision.collides;
}

export function canJumpTo(world, entity, x, y, z) {
    return canJumpToFrom(world, entity, entity.x, entity.y, entity.z, x, y, z);
}

export function canJumpToFrom(world, entity, startX, startY, startZ, x, y, z) {
    // Verifica se pode pousar
    if (!canWalkTo(world, entity, x, y, z, false)) return false;
    
    // Verifica altura do pulo
    const startGround = getGroundLevel(world, startX, startZ);
    const endGround = getGroundLevel(world, x, z);
    
    if (endGround - startGround > CONFIG.MAX_JUMP_HEIGHT) return false;
    
    // Verifica distância
    const dx = x - startX;
    const dz = z - startZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance > CONFIG.MAX_JUMP_DISTANCE) return false;
    
    return true;
}

export function heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

export function reconstructPath(cameFrom, current) {
    const path = [];
    while (cameFrom.has(current)) {
        const [x, y, z] = current.split(',').map(Number);
        path.unshift({x, y, z});
        current = cameFrom.get(current);
    }
    return path;
}

// ============================================================
// UPDATE DE ENTIDADES
// ============================================================
export function updateEntity(world, entity) {
    const isPlayerControlled = (world.getPlayerEntity() === entity);
    const noClip = !!entity.noClip;
    const bounds = world._internal.mapBounds;
    if (world.mode === 'game' && bounds) {
        const margin = CONFIG.WORLD_MAX_RADIUS;
        if (entity.x < bounds.minX - margin ||
            entity.x > bounds.maxX + margin ||
            entity.z < bounds.minZ - margin ||
            entity.z > bounds.maxZ + margin ||
            entity.y < CONFIG.WORLD_MIN_Y) {
            world.removeEntity(entity);
            return;
        }
    } else if (world.mode === 'game') {
        const center = world._internal.mapCenter || { x: 0, z: 0 };
        const dx = entity.x - center.x;
        const dz = entity.z - center.z;
        const radius = Math.sqrt(dx * dx + dz * dz);
        if (radius > CONFIG.WORLD_MAX_RADIUS || entity.y < CONFIG.WORLD_MIN_Y) {
            world.removeEntity(entity);
            return;
        }
    }
    
    // GRAVIDADE para TODAS as entidades (controláveis e hostis)
    if (!noClip)
        entity.velocityY -= CONFIG.GRAVITY;
    
    if (isPlayerControlled) {
        if (noClip) {
            updateEditorControlled(world, entity);
        } else {
            updatePlayerControlled(world, entity);
        }
    } else {
        if (entity.alertTimer > 0) {
            entity.alertTimer--;
            if (entity.alertTimer <= 0) {
                entity.alertTarget = null;
            }
        }
        const player = world.getPlayerEntity();
        if (world.mode === 'editor') {
            if (player && player.noClip && !entity.editorMoveActive) {
                entity.targetEntity = null;
                entity.target = null;
                entity.path = [];
                entity.canSeePlayer = false;
            }
        } else {
            updateFactionAI(world, entity);
            if (entity.isControllable || entity.isHostile) {
                updateAIControlled(world, entity);
            }
            if (entity.editorMoveActive && !entity.target && entity.path.length === 0) {
                entity.editorMoveActive = false;
            }
        }
    }
    
    // Física Y para TODAS as entidades
    if (!noClip)
        applyPhysics(world, entity);
    
    // Gerencia visibilidade do mesh
    updateEntityMesh(world, entity, isPlayerControlled);
    
    // Comportamento customizado (IA hostil roda aqui)
    if (entity.onUpdate) {
        entity.onUpdate(world, entity);
    }

    if (!isPlayerControlled && entity.type === 'npc') {
        updateNpcBlockInteraction(world, entity);
    }
}

function updateNpcBlockInteraction(world, entity) {
    if (entity.blockInteractCooldown > 0) {
        entity.blockInteractCooldown--;
        return;
    }
    const range = 1.2;
    let closestBlock = null;
    let closestDist = Infinity;
    
    for (const block of world.blocks) {
        if (!block.hasUseFunction) continue;
        const dx = block.x - entity.x;
        const dy = block.y - entity.y;
        const dz = block.z - entity.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < range && dist < closestDist) {
            closestDist = dist;
            closestBlock = block;
        }
    }
    
    if (!closestBlock) return;
    useBlock(world, closestBlock, entity);
    entity.blockInteractCooldown = 120;
}

function useBlock(world, target, entity) {
    if (!target.type || !target.hasUseFunction || !target.type.onUse) return;
    const blockAdapter = {
        userData: {
            x: target.x,
            y: target.y,
            z: target.z,
            type: target.type,
            solid: target.solid,
            isFloor: target.isFloor
        },
        material: target.mesh.material,
        position: {
            set: (x, y, z) => {
                target.mesh.position.set(x, y, z);
                target.x = x;
                target.y = y;
                target.z = z;
            }
        }
    };
    
    target.type.onUse(world, blockAdapter, entity);
    target.solid = blockAdapter.userData.solid;
}

export function updateEditorControlled(world, entity) {
    const keys = world._internal.keys;
    const speedBoost = keys['ShiftLeft'] || keys['ShiftRight'] ? 2.5 : 1;
    const speed = CONFIG.EDITOR_FLY_SPEED * speedBoost;
    entity.isCrouching = false;
    entity.onGround = false;
    
    const forwardVec = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(entity.pitch, entity.yaw, 0, 'YXZ')
    );
    const rightVec = new THREE.Vector3().crossVectors(forwardVec, new THREE.Vector3(0, 1, 0)).normalize();
    
    let moveX = 0;
    let moveY = 0;
    let moveZ = 0;
    
    if (keys['KeyW']) {
        moveX += forwardVec.x * speed;
        moveY += forwardVec.y * speed;
        moveZ += forwardVec.z * speed;
    }
    if (keys['KeyS']) {
        moveX -= forwardVec.x * speed;
        moveY -= forwardVec.y * speed;
        moveZ -= forwardVec.z * speed;
    }
    if (keys['KeyA']) {
        moveX -= rightVec.x * speed;
        moveY -= rightVec.y * speed;
        moveZ -= rightVec.z * speed;
    }
    if (keys['KeyD']) {
        moveX += rightVec.x * speed;
        moveY += rightVec.y * speed;
        moveZ += rightVec.z * speed;
    }
    if (keys['Space']) {
        moveY += speed;
    }
    if (keys['ControlLeft'] || keys['ControlRight']) {
        moveY -= speed;
    }

    entity.x += moveX;
    entity.y += moveY;
    entity.z += moveZ;
    
    const camera = world._internal.camera;
    const eyeHeight = CONFIG.ENTITY_HEIGHT * 0.8;
    camera.position.set(entity.x, entity.y + eyeHeight, entity.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = entity.yaw;
    camera.rotation.x = entity.pitch;
}

export function canStandUp(world, entity, x, y, z) {
    // Verifica se há espaço para ficar em pé
    const standingHeight = CONFIG.ENTITY_HEIGHT;
    const checkY = y + standingHeight;
    
    for (let block of world.blocks) {
        if (!block.solid) continue;
        
        const dx = Math.abs(block.x - x);
        const dz = Math.abs(block.z - z);
        
        if (dx < CONFIG.ENTITY_RADIUS + 0.5 && dz < CONFIG.ENTITY_RADIUS + 0.5) {
            const blockBottom = block.y - CONFIG.BLOCK_SIZE / 2;
            const blockTop = block.y + CONFIG.BLOCK_SIZE / 2;
            
            // Se tem um bloco na altura da cabeça quando em pé
            if (blockBottom < checkY && blockTop > y) {
                return false;
            }
        }
    }
    
    return true;
}

export function updatePlayerControlled(world, entity) {
    const keys = world._internal.keys;
    
    // Crouch - só pode levantar se tiver espaço
    const wantsCrouch = keys['KeyC'];
    
    if (wantsCrouch) {
        entity.isCrouching = true;
    } else if (entity.isCrouching) {
        // Tenta levantar
        if (canStandUp(world, entity, entity.x, entity.y, entity.z)) {
            entity.isCrouching = false;
        }
        // Se não pode levantar, continua agachado
    }
    
    const forward = {
        x: -Math.sin(entity.yaw),
        z: -Math.cos(entity.yaw)
    };
    
    const right = {
        x: Math.cos(entity.yaw),
        z: -Math.sin(entity.yaw)
    };
    
    let moveX = 0;
    let moveZ = 0;
    
    const speed = entity.isCrouching 
        ? CONFIG.MOVE_SPEED * CONFIG.CROUCH_SPEED_MULTIPLIER 
        : CONFIG.MOVE_SPEED;
    
    if (keys['KeyW']) {
        moveX += forward.x * speed;
        moveZ += forward.z * speed;
    }
    if (keys['KeyS']) {
        moveX -= forward.x * speed;
        moveZ -= forward.z * speed;
    }
    if (keys['KeyA']) {
        moveX -= right.x * speed;
        moveZ -= right.z * speed;
    }
    if (keys['KeyD']) {
        moveX += right.x * speed;
        moveZ += right.z * speed;
    }
    
    let newX = entity.x + moveX;
    if (!checkCollision(world, newX, entity.y, entity.z, entity).collides) {
        entity.x = newX;
    }
    
    let newZ = entity.z + moveZ;
    if (!checkCollision(world, entity.x, entity.y, newZ, entity).collides) {
        entity.z = newZ;
    }
    
    // Atualiza câmera
    const camera = world._internal.camera;
    const eyeHeight = entity.isCrouching 
        ? CONFIG.ENTITY_HEIGHT_CROUCHED * 0.8 
        : CONFIG.ENTITY_HEIGHT * 0.8;
    camera.position.set(entity.x, entity.y + eyeHeight, entity.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = entity.yaw;
    camera.rotation.x = entity.pitch;
}

export function updateAIControlled(world, entity) {
    if (!entity.target) return;
    
    entity.pathUpdateCounter++;
    
    // Recalcula path periodicamente
    if (entity.pathUpdateCounter >= CONFIG.PATH_UPDATE_INTERVAL || entity.path.length === 0) {
        entity.path = findPath(world, entity, entity.target);
        entity.pathIndex = 0;
        entity.pathUpdateCounter = 0;
        
        // Se não encontrou caminho, desiste do alvo
        if (entity.path.length === 0) {
            entity.target = null;
            entity.isCrouching = false;
            return;
        }
    }
    
    if (entity.path.length === 0) return;
    
    // Chegou no destino
    const target = entity.path[entity.pathIndex];
    if (!target) return;
    
    const dx = target.x - entity.x;
    const dz = target.z - entity.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance < 0.3) {
        entity.pathIndex++;
        if (entity.pathIndex >= entity.path.length) {
            entity.target = null;
            entity.path = [];
            entity.isCrouching = false;
        }
        return;
    }
    
    // Verifica se precisa crouch
    const nextPos = entity.path[entity.pathIndex];
    const needsCrouch = !canWalkTo(world, entity, nextPos.x, nextPos.y, nextPos.z, false) &&
                        canWalkTo(world, entity, nextPos.x, nextPos.y, nextPos.z, true);
    
    if (needsCrouch) {
        entity.isCrouching = true;
    } else if (entity.isCrouching) {
        // Tenta levantar
        if (canStandUp(world, entity, entity.x, entity.y, entity.z)) {
            entity.isCrouching = false;
        }
    }
    
    // Move em direção ao alvo
    const speed = entity.isCrouching 
        ? CONFIG.MOVE_SPEED * CONFIG.CROUCH_SPEED_MULTIPLIER 
        : CONFIG.MOVE_SPEED;
    
    const moveX = (dx / distance) * speed;
    const moveZ = (dz / distance) * speed;
    
    let newX = entity.x + moveX;
    if (!checkCollision(world, newX, entity.y, entity.z, entity).collides) {
        entity.x = newX;
    }
    
    let newZ = entity.z + moveZ;
    if (!checkCollision(world, entity.x, entity.y, newZ, entity).collides) {
        entity.z = newZ;
    }
    
    // Pulo se necessário
    if (entity.onGround) {
        if (target.y > entity.y) {
            entity.velocityY = CONFIG.JUMP_FORCE;
            entity.onGround = false;
        } else if (distance > 1.1 && target.y >= entity.y - 0.2) {
            entity.velocityY = CONFIG.JUMP_FORCE;
            entity.onGround = false;
        }
    }
}


// ============================================================
// IA DE FACÇÕES + STEALTH
// ============================================================
function getEyeHeight(entity) {
    return (entity.isCrouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT) * 0.8;
}

function hasLineOfSight(world, entity, target) {
    const origin = new THREE.Vector3(entity.x, entity.y + getEyeHeight(entity), entity.z);
    const targetHeight = (target.isCrouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT) * 0.6;
    const targetPos = new THREE.Vector3(target.x, target.y + targetHeight, target.z);
    const rayDir = targetPos.clone().sub(origin);
    const rayDist = rayDir.length();
    if (rayDist <= 0.01) return true;
    rayDir.normalize();

    aiRaycaster.set(origin, rayDir);
    aiRaycaster.far = rayDist - 0.05;
    const occluders = world.blocks
        .filter((block) => block.solid && block.mesh)
        .map((block) => block.mesh);
    const hits = aiRaycaster.intersectObjects(occluders, false);
    return hits.length === 0;
}

function canSeeTarget(world, entity, target) {
    if (!target) return false;
    const dx = target.x - entity.x;
    const dz = target.z - entity.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > CONFIG.VISION_RANGE) return false;

    if (!target.isCrouching && distance <= CONFIG.PROXIMITY_DETECT_RANGE) {
        if (hasLineOfSight(world, entity, target)) return true;
    }

    const forward = new THREE.Vector3(-Math.sin(entity.yaw), 0, -Math.cos(entity.yaw)).normalize();
    const dir = new THREE.Vector3(dx, 0, dz);
    if (dir.lengthSq() > 0) dir.normalize();
    const fovCos = Math.cos((CONFIG.VISION_FOV_DEG * Math.PI / 180) / 2);
    if (forward.dot(dir) < fovCos) return false;

    return hasLineOfSight(world, entity, target);
}

function findClosestProximityTarget(world, entity) {
    let closest = null;
    let closestDist = Infinity;
    for (const other of world.entities) {
        if (other === entity) continue;
        if (other.type !== 'player' && other.type !== 'npc') continue;
        if (other.isCrouching) continue;
        const dx = other.x - entity.x;
        const dz = other.z - entity.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > CONFIG.PROXIMITY_DETECT_RANGE) continue;
        if (!hasLineOfSight(world, entity, other)) continue;
        if (dist < closestDist) {
            closestDist = dist;
            closest = other;
        }
    }
    return closest;
}

function findClosestVisibleEnemy(world, entity) {
    let closest = null;
    let closestDist = Infinity;
    for (const other of world.entities) {
        if (other === entity) continue;
        if (other.type === 'player' || other.type === 'npc') {
            const relation = getFactionRelation(entity.faction, other.faction);
            if (relation !== 'hostile') continue;
            const dx = other.x - entity.x;
            const dz = other.z - entity.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const closeDetect = !other.isCrouching &&
                dist <= CONFIG.HOSTILE_DETECTION_RANGE &&
                hasLineOfSight(world, entity, other);
            if (!closeDetect && !canSeeTarget(world, entity, other)) continue;
            if (dist < closestDist) {
                closestDist = dist;
                closest = other;
            }
        }
    }
    return closest;
}

export function updateFactionAI(world, entity) {
    if (!entity.isControllable && !entity.isHostile) return;

    if (entity.editorMoveActive) {
        return;
    }

    tryUseConsumable(world, entity);

    if (entity.shootCooldown > 0) {
        entity.shootCooldown--;
    }

    const player = world.getPlayerEntity();
    entity.canSeePlayer = player ? canSeeTarget(world, entity, player) : false;
    ensureEntityHasWeapon(entity);

    const target = findClosestVisibleEnemy(world, entity);
    if (!target) {
        entity.targetEntity = null;
        entity.target = null;
        entity.path = [];
        const proximityTarget = findClosestProximityTarget(world, entity);
        if (proximityTarget) {
            entity.alertTimer = 20;
            entity.alertTarget = {
                x: proximityTarget.x,
                y: proximityTarget.y + CONFIG.ENTITY_HEIGHT * 0.5,
                z: proximityTarget.z
            };
            const dx = proximityTarget.x - entity.x;
            const dz = proximityTarget.z - entity.z;
            entity.yaw = Math.atan2(-dx, -dz);
        }
        return;
    }

    entity.targetEntity = target;

    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dz = target.z - entity.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const weaponRange = getWeaponRange(entity);
    const desiredRange = weaponRange > 0 ? weaponRange * 0.85 : CONFIG.HOSTILE_ATTACK_RANGE;

    if (distance <= desiredRange && entity.shootCooldown === 0) {
        shootProjectileFromEntity(world, entity, target);
        entity.shootCooldown = CONFIG.HOSTILE_SHOOT_COOLDOWN;
        entity.target = null;
        entity.path = [];
    } else if (distance > desiredRange) {
        entity.target = { x: target.x, y: target.y, z: target.z };
    }

    entity.yaw = Math.atan2(-dx, -dz);
}

// ============================================================
// IA HOSTIL
// ============================================================
export function updateHostileAI(world, entity) {
    if (entity.shootCooldown > 0) {
        entity.shootCooldown--;
    }
    
    tryUseConsumable(world, entity);

    const player = world.getPlayerEntity();
    if (!player) return;
    ensureEntityHasWeapon(entity);
    
    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    const dz = player.z - entity.z;
    const distanceToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Detectou o player
    if (distanceToPlayer <= CONFIG.HOSTILE_DETECTION_RANGE) {
        entity.targetEntity = player;
        
        const weaponRange = getWeaponRange(entity);
        const desiredRange = weaponRange > 0 ? weaponRange * 0.85 : CONFIG.HOSTILE_ATTACK_RANGE;
        // Se está no range de ataque, atira
        if (distanceToPlayer <= desiredRange) {
            if (entity.shootCooldown === 0) {
                shootProjectileFromEntity(world, entity, player);
                entity.shootCooldown = CONFIG.HOSTILE_SHOOT_COOLDOWN;
            }
            
            // Para de se mover quando está atirando (limpa o target de movimento)
            entity.target = null;
            entity.path = [];
        } else {
            // Move em direção ao player
            entity.target = { x: player.x, y: player.y, z: player.z };
        }
        
        // Olha na direção do player
        entity.yaw = Math.atan2(-dx, -dz);
    } else {
        // Perdeu o player de vista
        entity.targetEntity = null;
        entity.target = null;
        entity.path = [];
    }
}

export function updateHostileMovement(world, entity) {
    if (!entity.target) return;
    
    entity.pathUpdateCounter = (entity.pathUpdateCounter || 0) + 1;
    
    // Recalcula path periodicamente
    if (entity.pathUpdateCounter >= CONFIG.PATH_UPDATE_INTERVAL || entity.path.length === 0) {
        entity.path = findPath(world, entity, entity.target);
        entity.pathIndex = 0;
        entity.pathUpdateCounter = 0;
        
        if (entity.path.length === 0) {
            return; // Não limpa o target, tenta de novo depois
        }
    }
    
    if (entity.path.length === 0) return;
    
    const target = entity.path[entity.pathIndex];
    if (!target) return;
    
    const dx = target.x - entity.x;
    const dz = target.z - entity.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance < 0.3) {
        entity.pathIndex++;
        if (entity.pathIndex >= entity.path.length) {
            entity.path = [];
        }
        return;
    }
    
    // Verifica se precisa crouch
    const nextPos = entity.path[entity.pathIndex];
    const needsCrouch = !canWalkTo(world, entity, nextPos.x, nextPos.y, nextPos.z, false) &&
                        canWalkTo(world, entity, nextPos.x, nextPos.y, nextPos.z, true);
    
    if (needsCrouch) {
        entity.isCrouching = true;
    } else if (entity.isCrouching) {
        if (canStandUp(world, entity, entity.x, entity.y, entity.z)) {
            entity.isCrouching = false;
        }
    }
    
    // Move em direção ao alvo
    const speed = entity.isCrouching 
        ? CONFIG.MOVE_SPEED * CONFIG.CROUCH_SPEED_MULTIPLIER 
        : CONFIG.MOVE_SPEED;
    
    const moveX = (dx / distance) * speed;
    const moveZ = (dz / distance) * speed;
    
    let newX = entity.x + moveX;
    if (!checkCollision(world, newX, entity.y, entity.z, entity).collides) {
        entity.x = newX;
    }
    
    let newZ = entity.z + moveZ;
    if (!checkCollision(world, entity.x, entity.y, newZ, entity).collides) {
        entity.z = newZ;
    }
    
    // Pulo se necessário
    if (entity.onGround) {
        if (target.y > entity.y) {
            entity.velocityY = CONFIG.JUMP_FORCE;
            entity.onGround = false;
        } else if (distance > 1.1 && target.y >= entity.y - 0.2) {
            entity.velocityY = CONFIG.JUMP_FORCE;
            entity.onGround = false;
        }
    }
}

export function shootProjectileFromEntity(world, shooter, target) {
    if (!shooter.inventory) return;
    if (!shooter.selectedBlockType || shooter.selectedBlockType.droppable === false) {
        ensureEntityHasWeapon(shooter);
    }
    if (!shooter.selectedBlockType) return;
    if (shooter.selectedBlockType.droppable === false) return;
    
    const ammoCount = shooter.inventory[shooter.selectedBlockType.id] || 0;
    if (ammoCount <= 0) return;
    
    // Só decrementa se não for munição infinita
    if (ammoCount < 999) {
        shooter.inventory[shooter.selectedBlockType.id]--;
    }
    
    const damage = shooter.selectedBlockType.breakDamage;
    const speed = shooter.selectedBlockType.bulletSpeed || 0.5;
    
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const materials = createBlockMaterials(world, shooter.selectedBlockType);
    const mesh = new THREE.Mesh(geometry, materials);
    
    // Posição inicial do projétil
    const shooterHeight = shooter.isCrouching 
        ? CONFIG.ENTITY_HEIGHT_CROUCHED * 0.8 
        : CONFIG.ENTITY_HEIGHT * 0.8;
    mesh.position.set(shooter.x, shooter.y + shooterHeight, shooter.z);
    
    // Direção para o alvo
    const direction = new THREE.Vector3(
        target.x - shooter.x,
        target.y + CONFIG.ENTITY_HEIGHT * 0.5 - (shooter.y + shooterHeight),
        target.z - shooter.z
    );
    direction.normalize();
    
    const projectile = {
        mesh: mesh,
        velocity: direction.multiplyScalar(speed),
        damage: damage,
        shooter: shooter, // Guarda referência de quem atirou
        blockType: shooter.selectedBlockType,
        gravityScale: 0,
        drag: 1
    };
    
    world._internal.scene.add(mesh);
    world.projectiles.push(projectile);
    alertEntitiesFromShot(world, shooter);
    
    console.log(`${shooter.name} atirou!`);
}

function createBlockMaterials(world, blockType) {
    const textures = world._internal.blockTextures;
    const opacity = typeof blockType.opacity === 'number' ? blockType.opacity : 1;
    const transparent = opacity < 1;
    
    if (blockType.textures.all) {
        const mat = new THREE.MeshLambertMaterial({ 
            map: textures[blockType.textures.all],
            transparent: transparent,
            opacity: opacity
        });
        return [mat, mat, mat, mat, mat, mat];
    }
    
    if (blockType.textures.top) {
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
    
    const fallback = new THREE.MeshLambertMaterial({ color: 0xffffff });
    return [fallback, fallback, fallback, fallback, fallback, fallback];
}

export function applyPhysics(world, entity) {
    let newY = entity.y + entity.velocityY;
    const yCollision = checkCollision(world, entity.x, newY, entity.z, entity);
    
    if (yCollision.collides) {
        if (entity.velocityY < 0) {
            entity.y = yCollision.block.y + CONFIG.BLOCK_SIZE / 2;
            entity.velocityY = 0;
            entity.onGround = true;
            if (entity.fallStartY !== null) {
                const fallDistance = entity.fallStartY - entity.y;
                if (fallDistance > CONFIG.FALL_DAMAGE_THRESHOLD) {
                    const damage = Math.floor((fallDistance - CONFIG.FALL_DAMAGE_THRESHOLD) * CONFIG.FALL_DAMAGE_MULTIPLIER);
                    entity.hp = Math.max(0, entity.hp - damage);
                }
                entity.fallStartY = null;
            }
        } else {
            entity.velocityY = 0;
        }
    } else {
        entity.y = newY;
        entity.onGround = false;
        if (entity.fallStartY === null) {
            entity.fallStartY = entity.y;
        }
    }
}

export function updateEntityMesh(world, entity, isPlayerControlled) {
    if (isPlayerControlled) {
        if (entity.mesh && entity.mesh.visible) {
            entity.mesh.visible = false;
        }
        if (entity.indicatorGroup && entity.indicatorGroup.visible) {
            entity.indicatorGroup.visible = false;
        }
    } else {
        if (!entity.mesh && entity.npcData) {
            const texture = world._internal.blockTextures[entity.npcData.texture];
            let width = entity.npcData.width;
            let height = entity.npcData.height;
            if (texture && texture.image && texture.image.width && texture.image.height) {
                const aspect = texture.image.width / texture.image.height;
                height = entity.npcData.height;
                width = height * aspect;
            }
            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.5,
                side: THREE.DoubleSide
            });
            
            entity.mesh = new THREE.Mesh(geometry, material);
            world._internal.scene.add(entity.mesh);
        }
        
        if (entity.mesh) {
            entity.mesh.visible = true;
            const meshHeight = entity.isCrouching 
                ? entity.npcData.height * 0.6 
                : entity.npcData.height / 2;
            entity.mesh.position.set(entity.x, entity.y + meshHeight, entity.z);
            
            // Olha para o alvo se tiver, senão olha para a câmera
            if (entity.targetEntity) {
                entity.mesh.lookAt(
                    new THREE.Vector3(
                        entity.targetEntity.x,
                        entity.targetEntity.y + CONFIG.ENTITY_HEIGHT * 0.5,
                        entity.targetEntity.z
                    )
                );
            } else if (entity.alertTarget) {
                entity.mesh.lookAt(
                    new THREE.Vector3(
                        entity.alertTarget.x,
                        entity.alertTarget.y,
                        entity.alertTarget.z
                    )
                );
            } else {
                entity.mesh.lookAt(world._internal.camera.position);
            }

            if (entity.npcData) {
                updateEntityIndicators(world, entity);
            }
            if (world.mode === 'editor' && entity.type === 'npc') {
                updateDebugArrow(world, entity);
            } else {
                if (entity.debugArrow) entity.debugArrow.visible = false;
                if (entity.debugPathLine) entity.debugPathLine.visible = false;
            }
        }
    }
}

function createNameTagMesh(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 22;
    const padding = 10;
    ctx.font = `${fontSize}px "Courier New", monospace`;
    const metrics = ctx.measureText(text);
    const textWidth = Math.ceil(metrics.width);
    canvas.width = Math.max(120, textWidth + padding * 2);
    canvas.height = 40;
    ctx.font = `${fontSize}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillText(text, canvas.width / 2 + 2, canvas.height / 2 + 1);
    ctx.fillStyle = 'white';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true
    });
    const aspect = canvas.width / canvas.height;
    const height = 0.28;
    const width = height * aspect;
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, texture, width };
}

function ensureIndicatorMeshes(world, entity) {
    if (entity.indicatorGroup) return;
    const group = new THREE.Group();

    const nameTag = createNameTagMesh(entity.name || 'Sem Nome');
    const spriteSize = 0.32;
    const bgSize = 0.45;
    const spriteGeometry = new THREE.PlaneGeometry(spriteSize, spriteSize);
    const bgGeometry = new THREE.PlaneGeometry(bgSize, bgSize);
    const bgMaterial = new THREE.MeshBasicMaterial({
        map: world._internal.blockTextures['disabled_base'],
        transparent: true
    });
    const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
    const dirBgMaterial = new THREE.MeshBasicMaterial({
        map: world._internal.blockTextures['halo'],
        transparent: true
    });
    const dirBgMesh = new THREE.Mesh(bgGeometry, dirBgMaterial);
    const spriteMaterial = new THREE.MeshBasicMaterial({
        map: world._internal.blockTextures[VISION_ICONS.friendly.unseen],
        transparent: true
    });
    const spriteMesh = new THREE.Mesh(spriteGeometry, spriteMaterial);
    const hpMaterial = new THREE.MeshBasicMaterial({
        map: world._internal.blockTextures[HP_ICONS[HP_ICONS.length - 1].key],
        transparent: true
    });
    const hpMesh = new THREE.Mesh(spriteGeometry, hpMaterial);
    const dirMaterial = new THREE.MeshBasicMaterial({
        map: world._internal.blockTextures[DIRECTION_ICONS[0]],
        transparent: true
    });
    const dirMesh = new THREE.Mesh(spriteGeometry, dirMaterial);

    const gap = 0.05;
    const totalWidth = spriteSize + gap + nameTag.width + gap + spriteSize;
    const leftX = -totalWidth / 2 + spriteSize / 2;
    const rightX = totalWidth / 2 - spriteSize / 2;
    bgMesh.position.x = leftX;
    bgMesh.position.z = -0.001;
    dirBgMesh.position.x = rightX;
    dirBgMesh.position.z = -0.001;
    spriteMesh.position.x = leftX;
    hpMesh.position.x = leftX;
    dirMesh.position.x = rightX;
    nameTag.mesh.position.x = -totalWidth / 2 + spriteSize + gap + nameTag.width / 2;

    bgMesh.renderOrder = 0;
    dirBgMesh.renderOrder = 0;
    spriteMesh.renderOrder = 1;
    dirMesh.renderOrder = 2;
    hpMesh.renderOrder = 3;
    group.add(bgMesh);
    group.add(dirBgMesh);
    group.add(spriteMesh);
    group.add(dirMesh);
    group.add(hpMesh);
    group.add(nameTag.mesh);

    entity.indicatorGroup = group;
    entity.statusBackgroundMesh = bgMesh;
    entity.directionBackgroundMesh = dirBgMesh;
    entity.statusSpriteMesh = spriteMesh;
    entity.hpSpriteMesh = hpMesh;
    entity.directionSpriteMesh = dirMesh;
    entity.nameTagMesh = nameTag.mesh;
    entity.nameTagTexture = nameTag.texture;
    world._internal.scene.add(group);
}

function getDirectionIconIndex(entity, player) {
    if (!player) return 0;
    const dx = player.x - entity.x;
    const dz = player.z - entity.z;
    if (dx === 0 && dz === 0) return 0;
    const forward = new THREE.Vector3(-Math.sin(entity.yaw), 0, -Math.cos(entity.yaw)).normalize();
    const right = new THREE.Vector3(Math.cos(entity.yaw), 0, -Math.sin(entity.yaw)).normalize();
    const dir = new THREE.Vector3(dx, 0, dz).normalize();
    let relative = Math.atan2(-dir.dot(right), dir.dot(forward)) + Math.PI;
    if (relative < 0) relative += Math.PI * 2;
    if (relative >= Math.PI * 2) relative -= Math.PI * 2;
    const sector = Math.floor((relative + Math.PI / 8) / (Math.PI / 4)) % 8;
    return sector;
}

function updateEntityIndicators(world, entity) {
    ensureIndicatorMeshes(world, entity);
    if (entity.indicatorGroup && !entity.indicatorGroup.visible) {
        entity.indicatorGroup.visible = true;
    }
    if (entity.isSpeaking) {
        entity.indicatorGroup.visible = false;
        return;
    }
    const camera = world._internal.camera;
    const player = world.getPlayerEntity();
    const relation = player ? getFactionRelation(entity.faction, player.faction) : 'hostile';
    const relationKey = relation === 'friendly' ? 'friendly' : 'hostile';
    const seenKey = entity.canSeePlayer ? 'seen' : 'unseen';
    const iconKey = VISION_ICONS[relationKey][seenKey];
    const texture = world._internal.blockTextures[iconKey];
    if (texture && entity.statusSpriteMesh.material.map !== texture) {
        entity.statusSpriteMesh.material.map = texture;
        entity.statusSpriteMesh.material.needsUpdate = true;
    }
    const hpMax = entity.maxHP || 1;
    const hp = typeof entity.hp === 'number' ? entity.hp : hpMax;
    const ratio = Math.max(0, Math.min(1, hp / Math.max(1, hpMax)));
    let hpKey = HP_ICONS[HP_ICONS.length - 1].key;
    for (const entry of HP_ICONS) {
        if (ratio <= entry.threshold) {
            hpKey = entry.key;
            break;
        }
    }
    const hpTexture = world._internal.blockTextures[hpKey];
    if (hpTexture && entity.hpSpriteMesh.material.map !== hpTexture) {
        entity.hpSpriteMesh.material.map = hpTexture;
        entity.hpSpriteMesh.material.needsUpdate = true;
    }
    const dirIndex = getDirectionIconIndex(entity, player);
    const dirKey = DIRECTION_ICONS[dirIndex];
    const dirTexture = world._internal.blockTextures[dirKey];
    if (dirTexture && entity.directionSpriteMesh.material.map !== dirTexture) {
        entity.directionSpriteMesh.material.map = dirTexture;
        entity.directionSpriteMesh.material.needsUpdate = true;
    }
    const blockType = entity.selectedBlockType || null;
    let bgKey = 'disabled_base';
    if (blockType && blockType.textures) {
        const count = entity.inventory ? (entity.inventory[blockType.id] || 0) : null;
        if (count === null || count > 0) {
            bgKey = blockType.textures.all || blockType.textures.top || bgKey;
        }
    }
    const bgTexture = world._internal.blockTextures[bgKey];
    if (bgTexture && entity.statusBackgroundMesh.material.map !== bgTexture) {
        entity.statusBackgroundMesh.material.map = bgTexture;
        entity.statusBackgroundMesh.material.needsUpdate = true;
    }

    const headHeight = entity.npcData ? entity.npcData.height : CONFIG.ENTITY_HEIGHT;
    entity.indicatorGroup.position.set(entity.x, entity.y + headHeight + 0.35, entity.z);
    entity.indicatorGroup.lookAt(camera.position);
}

export function refreshEntityIndicators(world, entity) {
    if (!entity || !entity.indicatorGroup) return;
    world._internal.scene.remove(entity.indicatorGroup);
    if (entity.nameTagTexture) {
        entity.nameTagTexture.dispose();
    }
    if (entity.nameTagMesh && entity.nameTagMesh.material) {
        entity.nameTagMesh.material.dispose();
    }
    if (entity.nameTagMesh && entity.nameTagMesh.geometry) {
        entity.nameTagMesh.geometry.dispose();
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
    if (entity.statusSpriteMesh && entity.statusSpriteMesh.material) {
        entity.statusSpriteMesh.material.dispose();
    }
    if (entity.statusSpriteMesh && entity.statusSpriteMesh.geometry) {
        entity.statusSpriteMesh.geometry.dispose();
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
    entity.indicatorGroup = null;
    entity.statusBackgroundMesh = null;
    entity.directionBackgroundMesh = null;
    entity.statusSpriteMesh = null;
    entity.hpSpriteMesh = null;
    entity.directionSpriteMesh = null;
    entity.nameTagMesh = null;
    entity.nameTagTexture = null;
}

function updateDebugArrow(world, entity) {
    if (!entity.debugArrow) {
        const dir = new THREE.Vector3(0, 0, -1);
        const origin = new THREE.Vector3(entity.x, entity.y, entity.z);
        entity.debugArrow = new THREE.ArrowHelper(dir, origin, 0.7, 0xffd54a, 0.2, 0.12);
        world._internal.scene.add(entity.debugArrow);
    }
    const headHeight = entity.npcData ? entity.npcData.height : CONFIG.ENTITY_HEIGHT;
    const dir = new THREE.Vector3(-Math.sin(entity.yaw), 0, -Math.cos(entity.yaw)).normalize();
    entity.debugArrow.setDirection(dir);
    entity.debugArrow.position.set(entity.x, entity.y + headHeight + 0.6, entity.z);
    entity.debugArrow.visible = true;
}
