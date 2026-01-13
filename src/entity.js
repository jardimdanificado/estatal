import CONFIG from '../data/config.js';
import { checkCollision, getGroundLevel } from './collision.js';

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
                interactionDiv.textContent = `Pressione E para usar ${block.type.name}`;
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
            interactionDiv.textContent = `Pressione E para interagir com ${entity.name}`;
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
        y: Math.round(entity.y),
        z: Math.round(entity.z)
    };
    
    const end = {
        x: Math.round(targetPos.x),
        y: Math.round(targetPos.y),
        z: Math.round(targetPos.z)
    };
    
    // Se já está perto do alvo, não precisa calcular
    const dist = Math.abs(start.x - end.x) + Math.abs(start.z - end.z);
    if (dist < 2) return [];
    
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
    
    while (openSet.length > 0 && iterations < CONFIG.MAX_PATH_ITERATIONS) {
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
        
        // Pulo para cima (1 bloco) - apenas direções cardeais
        if (Math.abs(dir.dx) + Math.abs(dir.dz) === 1) {
            if (canJumpTo(world, entity, nx, y + 1, nz)) {
                neighbors.push({x: nx, y: y + 1, z: nz, cost: 2, needsCrouch: false});
            }
        }
        
        // Queda para baixo
        const groundLevel = getGroundLevel(world, nx, nz);
        if (groundLevel < y && groundLevel >= y - 3) {
            if (canWalkTo(world, entity, nx, groundLevel, nz, false)) {
                neighbors.push({x: nx, y: groundLevel, z: nz, cost: 1.2, needsCrouch: false});
            }
        }
    }
    
    return neighbors;
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
    // Verifica se pode pousar
    if (!canWalkTo(world, entity, x, y, z, false)) return false;
    
    // Verifica altura do pulo
    const startGround = getGroundLevel(world, entity.x, entity.z);
    const endGround = getGroundLevel(world, x, z);
    
    if (endGround - startGround > CONFIG.MAX_JUMP_HEIGHT) return false;
    
    // Verifica distância
    const dx = x - entity.x;
    const dz = z - entity.z;
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
    
    // GRAVIDADE para TODAS as entidades (controláveis e hostis)
    if(!entity.isEditor)
        entity.velocityY -= CONFIG.GRAVITY;
    
    if (isPlayerControlled) {
        updatePlayerControlled(world, entity);
    } else if (entity.isHostile) {
        // Hostis precisam de movimento mesmo não sendo controláveis
        updateHostileMovement(world, entity);
    } else if (entity.isControllable) {
        updateAIControlled(world, entity);
    }
    
    // Física Y para TODAS as entidades
    if(!entity.isEditor)
        applyPhysics(world, entity);
    
    // Gerencia visibilidade do mesh
    updateEntityMesh(world, entity, isPlayerControlled);
    
    // Comportamento customizado (IA hostil roda aqui)
    if (entity.onUpdate) {
        entity.onUpdate(world, entity);
    }
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
    if (target.y > entity.y && entity.onGround) {
        entity.velocityY = CONFIG.JUMP_FORCE;
        entity.onGround = false;
    }
}

// ============================================================
// IA HOSTIL
// ============================================================
export function updateHostileAI(world, entity) {
    if (entity.shootCooldown > 0) {
        entity.shootCooldown--;
    }
    
    const player = world.getPlayerEntity();
    if (!player) return;
    
    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    const dz = player.z - entity.z;
    const distanceToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Detectou o player
    if (distanceToPlayer <= CONFIG.HOSTILE_DETECTION_RANGE) {
        entity.targetEntity = player;
        
        // Se está no range de ataque, atira
        if (distanceToPlayer <= CONFIG.HOSTILE_ATTACK_RANGE) {
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
    if (target.y > entity.y && entity.onGround) {
        entity.velocityY = CONFIG.JUMP_FORCE;
        entity.onGround = false;
    }
}

export function shootProjectileFromEntity(world, shooter, target) {
    if (!shooter.inventory || !shooter.selectedBlockType) return;
    
    const ammoCount = shooter.inventory[shooter.selectedBlockType.id] || 0;
    if (ammoCount <= 0) return;
    
    // Só decrementa se não for munição infinita
    if (ammoCount < 999) {
        shooter.inventory[shooter.selectedBlockType.id]--;
    }
    
    const damage = shooter.selectedBlockType.breakDamage;
    
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xff4400 }); // Cor diferente para NPCs
    const mesh = new THREE.Mesh(geometry, material);
    
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
        velocity: direction.multiplyScalar(0.5),
        damage: damage,
        lifeTime: 100,
        shooter: shooter // Guarda referência de quem atirou
    };
    
    world._internal.scene.add(mesh);
    world.projectiles.push(projectile);
    
    console.log(`${shooter.name} atirou!`);
}

export function applyPhysics(world, entity) {
    let newY = entity.y + entity.velocityY;
    const yCollision = checkCollision(world, entity.x, newY, entity.z, entity);
    
    if (yCollision.collides) {
        if (entity.velocityY < 0) {
            entity.y = yCollision.block.y + CONFIG.BLOCK_SIZE / 2;
            entity.velocityY = 0;
            entity.onGround = true;
        } else {
            entity.velocityY = 0;
        }
    } else {
        entity.y = newY;
        entity.onGround = false;
    }
}

export function updateEntityMesh(world, entity, isPlayerControlled) {
    if (isPlayerControlled) {
        if (entity.mesh && entity.mesh.visible) {
            entity.mesh.visible = false;
        }
    } else {
        if (!entity.mesh && entity.npcData) {
            const geometry = new THREE.PlaneGeometry(entity.npcData.width, entity.npcData.height);
            const material = new THREE.MeshBasicMaterial({
                map: world._internal.blockTextures[entity.npcData.texture],
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
            
            // Hostis olham para o alvo, outros olham para a câmera
            if (entity.isHostile && entity.targetEntity) {
                entity.mesh.lookAt(
                    new THREE.Vector3(
                        entity.targetEntity.x,
                        entity.targetEntity.y + CONFIG.ENTITY_HEIGHT * 0.5,
                        entity.targetEntity.z
                    )
                );
            } else {
                entity.mesh.lookAt(world._internal.camera.position);
            }
        }
    }
}