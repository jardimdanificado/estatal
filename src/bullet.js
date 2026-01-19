import CONFIG from '../data/config/config.js';
import BLOCK_TYPES from '../data/config/blocks.js';
import ITEMS from '../data/config/items.js';
import { spawnBlockDrop, spawnItemDrop } from './item.js';

const BLOOD_SPLASH_KEYS = [
    'blood_red',
    'blood_red_0',
    'blood_red_1_old',
    'blood_red_1_new',
    'blood_red_2_old',
    'blood_red_2_new',
    'blood_red_3_old',
    'blood_red_3_new',
    'blood_red_4_old',
    'blood_red_4_new',
    'blood_red_5',
    'blood_red_6',
    'blood_red_7',
    'blood_red_8',
    'blood_red_9',
    'blood_red_10',
    'blood_red_11',
    'blood_red_12',
    'blood_red_13',
    'blood_red_14',
    'blood_red_15',
    'blood_red_16',
    'blood_red_17',
    'blood_red_18',
    'blood_red_19',
    'blood_red_20',
    'blood_red_21',
    'blood_red_22',
    'blood_red_23',
    'blood_red_24',
    'blood_red_25',
    'blood_red_26',
    'blood_red_27',
    'blood_red_28',
    'blood_red_29'
];
const BLOOD_PUDDLE_KEYS = [
    'blood_puddle_red',
    'blood_puddle_red_1',
    'blood_puddle_red_2',
    'blood_puddle_red_3',
    'blood_puddle_red_4'
];
const WALL_BLOOD_KEYS = [
    'wall_blood_0_north',
    'wall_blood_1_north',
    'wall_blood_3_north',
    'wall_blood_4_north',
    'wall_blood_5_north',
    'wall_blood_6_north',
    'wall_blood_7_north',
    'wall_blood_8_north',
    'wall_blood_9_north',
    'wall_blood_10_north',
    'wall_blood_11_north',
    'wall_blood_12_north',
    'wall_blood_13_north',
    'wall_blood_14_north',
    'wall_blood_15_north',
    'wall_blood_16_north',
    'wall_blood_17_north',
    'wall_blood_18_north'
];

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

function ensureFxStore(world) {
    if (!world._internal.fx) {
        world._internal.fx = [];
    }
}

function addFx(world, fx) {
    ensureFxStore(world);
    if (fx.mesh && fx.mesh.material && typeof fx.mesh.material.opacity === 'number') {
        fx.baseOpacity = fx.mesh.material.opacity;
    }
    world._internal.fx.push(fx);
    world._internal.scene.add(fx.mesh);
}

function pickTexture(world, keys) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    return world._internal.blockTextures[key] || null;
}

function spawnBloodSplash(world, position, direction) {
    const texture = pickTexture(world, BLOOD_SPLASH_KEYS);
    if (!texture) return;
    const geometry = new THREE.PlaneGeometry(0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    const velocity = direction.clone().multiplyScalar(0.06);
    velocity.x += (Math.random() - 0.5) * 0.04;
    velocity.y += 0.06 + Math.random() * 0.04;
    velocity.z += (Math.random() - 0.5) * 0.04;
    addFx(world, {
        mesh,
        velocity,
        gravity: 0.004,
        life: 26,
        maxLife: 26,
        fade: true,
        faceCamera: true,
        scaleStart: 0.2,
        scaleEnd: 1.1
    });
}

function spawnBloodDecal(world, point, normal, isFloor, keys = null, sizeOverride = null) {
    const decalKeys = keys || (isFloor ? BLOOD_PUDDLE_KEYS : WALL_BLOOD_KEYS);
    const texture = pickTexture(world, decalKeys);
    if (!texture) return;
    const size = typeof sizeOverride === 'number' ? sizeOverride : (isFloor ? 0.8 : 0.7);
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(point).add(normal.clone().multiplyScalar(0.01));
    if (isFloor) {
        mesh.rotation.x = -Math.PI / 2;
    } else {
        mesh.lookAt(point.clone().add(normal));
    }
    addFx(world, {
        mesh,
        velocity: new THREE.Vector3(0, 0, 0),
        gravity: 0,
        life: 420,
        maxLife: 420,
        fade: true,
        fadeDelay: 0.7
    });
}

function getBlockTexture(world, blockType) {
    if (!blockType || !blockType.textures) return null;
    const key = blockType.textures.all || blockType.textures.top || null;
    return key ? world._internal.blockTextures[key] || null : null;
}

function findFloorHitUnderEntity(world, entity) {
    const raycaster = world._internal.raycaster;
    const origin = new THREE.Vector3(entity.x, entity.y + 0.2, entity.z);
    const blockMeshes = world.blocks.map((block) => block.mesh).filter(Boolean);
    if (!blockMeshes.length) return null;
    raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(blockMeshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const block = world.blocks.find((b) => b.mesh === hit.object);
    if (!block) return null;
    return { hit, block };
}

function spawnBlockDebris(world, block, impactBlockType = null, count = 4) {
    if (!block.mesh) return;
    const sourceMat = Array.isArray(block.mesh.material)
        ? block.mesh.material[0]
        : block.mesh.material;
    const baseTexture = sourceMat && sourceMat.map ? sourceMat.map : null;
    const impactTexture = getBlockTexture(world, impactBlockType);
    const textures = [baseTexture, impactTexture].filter(Boolean);
    for (let i = 0; i < count; i++) {
        const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        const texture = textures.length
            ? textures[Math.floor(Math.random() * textures.length)]
            : null;
        const material = new THREE.MeshLambertMaterial({
            map: texture || null,
            color: texture ? 0xffffff : 0xdddddd,
            transparent: true,
            opacity: 0.9
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            block.x + (Math.random() - 0.5) * 0.4,
            block.y + 0.1 + Math.random() * 0.3,
            block.z + (Math.random() - 0.5) * 0.4
        );
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.08,
            0.08 + Math.random() * 0.08,
            (Math.random() - 0.5) * 0.08
        );
        addFx(world, {
            mesh,
            velocity,
            gravity: 0.01,
            life: 32 + Math.floor(Math.random() * 10),
            maxLife: 42,
            fade: true,
            spin: new THREE.Vector3(
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.2
            )
        });
    }
}

function addBloodStain(world, entity) {
    if (!entity.mesh) return;
    const texture = pickTexture(world, BLOOD_SPLASH_KEYS);
    if (!texture) return;
    const npcTexture = entity.mesh.material && entity.mesh.material.map
        ? entity.mesh.material.map
        : null;
    const width = (entity.npcData && entity.npcData.width)
        || (entity.mesh.geometry && entity.mesh.geometry.parameters && entity.mesh.geometry.parameters.width)
        || 0.8;
    const height = (entity.npcData && entity.npcData.height)
        || (entity.mesh.geometry && entity.mesh.geometry.parameters && entity.mesh.geometry.parameters.height)
        || 1.4;
    const size = 0.25 + Math.random() * 0.2;
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        alphaMap: npcTexture,
        transparent: true,
        opacity: 0.85,
        alphaTest: 0.1,
        depthWrite: false
    });
    const stain = new THREE.Mesh(geometry, material);
    stain.position.set(
        (Math.random() - 0.5) * width * 0.4,
        (Math.random() - 0.5) * height * 0.4,
        0.01
    );
    stain.rotation.z = Math.random() * Math.PI * 2;
    entity.mesh.add(stain);
    entity._bloodStains = entity._bloodStains || [];
    entity._bloodStains.push(stain);
    if (entity._bloodStains.length > 4) {
        const old = entity._bloodStains.shift();
        if (old && old.parent) old.parent.remove(old);
        if (old && old.material) old.material.dispose();
        if (old && old.geometry) old.geometry.dispose();
    }
    setTimeout(() => {
        if (!entity._bloodStains) return;
        const idx = entity._bloodStains.indexOf(stain);
        if (idx >= 0) entity._bloodStains.splice(idx, 1);
        if (stain.parent) stain.parent.remove(stain);
        if (stain.material) stain.material.dispose();
        if (stain.geometry) stain.geometry.dispose();
    }, 450);
}

function flashEntityRed(entity) {
    if (!entity.mesh || !entity.mesh.material) return;
    const material = entity.mesh.material;
    if (!material.color) return;
    const originalColor = material.color.getHex();
    material.color.setHex(0xff0000);
    setTimeout(() => {
        if (entity.mesh && entity.mesh.material && entity.mesh.material.color) {
            entity.mesh.material.color.setHex(originalColor);
        }
    }, 100);
}

function flashBlockWhite(block) {
    if (!block.mesh || !block.mesh.material) return;
    const mats = Array.isArray(block.mesh.material) ? block.mesh.material : [block.mesh.material];
    const originals = mats.map((mat) => ({
        color: mat.color ? mat.color.clone() : null
    }));
    mats.forEach((mat) => {
        if (mat.color) mat.color.setHex(0xffffff);
    });
    setTimeout(() => {
        if (!block.mesh || !block.mesh.material) return;
        const matsRestore = Array.isArray(block.mesh.material) ? block.mesh.material : [block.mesh.material];
        matsRestore.forEach((mat, idx) => {
            const original = originals[idx];
            if (!original) return;
            if (mat.color && original.color) mat.color.copy(original.color);
        });
    }, 80);
}

function applyEntityHitEffects(world, entity, direction) {
    flashEntityRed(entity);
    addBloodStain(world, entity);
    const base = new THREE.Vector3(entity.x, entity.y + CONFIG.ENTITY_HEIGHT * 0.6, entity.z);
    spawnBloodSplash(world, base, direction);
    if (entity.onGround) {
        const floorHit = findFloorHitUnderEntity(world, entity);
        if (floorHit) {
            spawnBloodDecal(world, floorHit.hit.point, new THREE.Vector3(0, 1, 0), true);
        }
    }
    if (direction.y < -0.35) {
        const floorHit = findFloorHitUnderEntity(world, entity);
        if (floorHit) {
            spawnBloodDecal(world, floorHit.hit.point, new THREE.Vector3(0, 1, 0), true, BLOOD_SPLASH_KEYS, 0.6);
        }
    }
    const raycaster = world._internal.raycaster;
    const blockMeshes = world.blocks.map((block) => block.mesh).filter(Boolean);
    if (!blockMeshes.length) return;
    const rayDir = direction.clone().normalize();
    raycaster.set(base, rayDir);
    const hits = raycaster.intersectObjects(blockMeshes, false);
    if (!hits.length) return;
    const hit = hits[0];
    if (hit.distance > 1.6) return;
    const block = world.blocks.find((b) => b.mesh === hit.object);
    if (!block) return;
    const normal = hit.face && hit.face.normal
        ? hit.face.normal.clone()
        : hit.point.clone().sub(new THREE.Vector3(block.x, block.y, block.z)).normalize();
    const isFloor = block.isFloor || Math.abs(normal.y) > 0.6;
    if (!isFloor || direction.y >= -0.35) {
        spawnBloodDecal(world, hit.point, normal, isFloor);
    }
}

function applyBlockHitEffects(world, block, impactBlockType = null) {
    flashBlockWhite(block);
    spawnBlockDebris(world, block, impactBlockType, 4);
}

function updateFx(world) {
    const fxList = world._internal.fx || [];
    if (!fxList.length) return;
    const camera = world._internal.camera;
    for (let i = fxList.length - 1; i >= 0; i--) {
        const fx = fxList[i];
        fx.life -= 1;
        if (fx.velocity) {
            fx.mesh.position.add(fx.velocity);
            if (fx.gravity) {
                fx.velocity.y -= fx.gravity;
            }
        }
        if (fx.spin) {
            fx.mesh.rotation.x += fx.spin.x;
            fx.mesh.rotation.y += fx.spin.y;
            fx.mesh.rotation.z += fx.spin.z;
        }
        if (fx.faceCamera && camera) {
            fx.mesh.lookAt(camera.position);
        }
        if (fx.scaleStart !== undefined && fx.scaleEnd !== undefined) {
            const t = 1 - fx.life / fx.maxLife;
            const scale = fx.scaleStart + (fx.scaleEnd - fx.scaleStart) * t;
            fx.mesh.scale.set(scale, scale, scale);
        }
        if (fx.fade && fx.mesh.material) {
            const t = 1 - fx.life / fx.maxLife;
            const delay = fx.fadeDelay || 0;
            const tFade = t <= delay ? 0 : (t - delay) / Math.max(0.0001, 1 - delay);
            const baseOpacity = typeof fx.baseOpacity === 'number' ? fx.baseOpacity : fx.mesh.material.opacity;
            fx.mesh.material.opacity = Math.max(0, baseOpacity * (1 - tFade));
        }
        if (fx.life <= 0) {
            world._internal.scene.remove(fx.mesh);
            if (fx.mesh.material) fx.mesh.material.dispose();
            if (fx.mesh.geometry) fx.mesh.geometry.dispose();
            fxList.splice(i, 1);
        }
    }
}

function tryMeleeHit(world, attacker) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    const entityTargets = world.entities
        .filter((entity) => entity.mesh && entity !== attacker)
        .map((entity) => entity.mesh);
    const blockTargets = world.blocks.map((block) => block.mesh).filter(Boolean);
    const targets = [...entityTargets, ...blockTargets];
    if (!targets.length) return false;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return false;
    const hit = hits[0];
    if (hit.distance > CONFIG.MELEE_RANGE) return false;
    const entity = world.entities.find((e) => e.mesh === hit.object);
    if (entity) {
        const damage = CONFIG.MELEE_DAMAGE;
        entity.hp = Math.max(0, entity.hp - damage);
        console.log(`${entity.name} levou ${damage} de dano (melee). HP: ${entity.hp}/${entity.maxHP}`);
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        applyEntityHitEffects(world, entity, direction);
        return true;
    }
    const block = world.blocks.find((b) => b.mesh === hit.object);
    if (!block) return false;
    const damage = CONFIG.MELEE_DAMAGE;
    block.hp -= damage;
    console.log(`${block.type.name} levou ${damage} de dano (melee). HP: ${block.hp}/${block.maxHP}`);
    applyBlockHitEffects(world, block);
    if (block.hp <= 0) {
        if (world.mode === 'game' && block.type.droppable) {
            spawnBlockDrop(world, block.type, 1, {
                x: block.x,
                y: block.y + 0.3,
                z: block.z
            });
        }
        world.removeBlock(block);
    }
    return true;
}

export function createProjectile(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    const isEditor = player.isEditor || world.mode === 'editor';
    
    if (player.selectedItem && player.selectedItem.kind !== 'block' && player.selectedItem.kind !== 'empty') return;
    if (player.selectedItem && player.selectedItem.kind === 'empty') {
        if (!isEditor) {
            tryMeleeHit(world, player);
        }
        return;
    }
    if (player.selectedBlockType && player.selectedBlockType.droppable === false) {
        console.log(`${player.selectedBlockType.name} não pode ser atirado.`);
        return;
    }
    if (!player.selectedBlockType) {
        if (!isEditor) {
            tryMeleeHit(world, player);
        }
        return;
    }

    const ammoCount = player.inventory ? (player.inventory[player.selectedBlockType.id] || 0) : 0;
    
    if (!isEditor && ammoCount <= 0) {
        console.log(`Sem munição de ${player.selectedBlockType.name}!`);
        tryMeleeHit(world, player);
        return;
    }
    
    if (!isEditor) {
        player.inventory[player.selectedBlockType.id] = (player.inventory[player.selectedBlockType.id] || 0) - 1;
    }
    ////updateInventoryDisplay(world);
    
    const damage = player.selectedBlockType.breakDamage;
    const speed = player.selectedBlockType.bulletSpeed || 0.5;
    
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const materials = createBlockMaterials(world, player.selectedBlockType);
    const mesh = new THREE.Mesh(geometry, materials);
    
    mesh.position.copy(world._internal.camera.position);
    
    const direction = new THREE.Vector3();
    world._internal.camera.getWorldDirection(direction);
    
    const projectile = {
        mesh: mesh,
        velocity: direction.multiplyScalar(speed),
        damage: damage,
        shooter: player,
        blockType: player.selectedBlockType
    };
    
    world._internal.scene.add(mesh);
    world.projectiles.push(projectile);
    alertEntitiesFromShot(world, player);
}

export function alertEntitiesFromShot(world, shooter) {
    if (!shooter) return;
    if (world.mode === 'editor') {
        const player = world.getPlayerEntity();
        if (player && player.noClip) return;
    }
    const range = CONFIG.SHOT_DETECTION_RANGE || CONFIG.HOSTILE_DETECTION_RANGE * 2;
    const origin = {
        x: shooter.x,
        y: shooter.y + CONFIG.ENTITY_HEIGHT * 0.5,
        z: shooter.z
    };
    for (const entity of world.entities) {
        if (entity === shooter) continue;
        if (entity.type !== 'npc' && entity.type !== 'player') continue;
        const dx = entity.x - origin.x;
        const dz = entity.z - origin.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > range) continue;
        entity.alertTimer = 120;
        entity.alertTarget = { x: origin.x, y: origin.y, z: origin.z };
    }
}

export function placeBlock(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    if (!world.ui.targetBlockPosition) return;
    const isEditor = player.isEditor || world.mode === 'editor';
    
    if (player.selectedItem && player.selectedItem.kind !== 'block') return;
    if (!player.selectedBlockType) return;

    const ammoCount = player.inventory ? (player.inventory[player.selectedBlockType.id] || 0) : 0;
    if (world.mode === 'game') {
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
        const bounds = world._internal.mapBounds;
        if (bounds) {
            const margin = CONFIG.WORLD_MAX_RADIUS;
            if (proj.mesh.position.x < bounds.minX - margin ||
                proj.mesh.position.x > bounds.maxX + margin ||
                proj.mesh.position.z < bounds.minZ - margin ||
                proj.mesh.position.z > bounds.maxZ + margin ||
                proj.mesh.position.y < CONFIG.WORLD_MIN_Y) {
                world._internal.scene.remove(proj.mesh);
                world.projectiles.splice(i, 1);
                continue;
            }
        } else {
            const center = world._internal.mapCenter || { x: 0, z: 0 };
            const dx = proj.mesh.position.x - center.x;
            const dz = proj.mesh.position.z - center.z;
            const radius = Math.sqrt(dx * dx + dz * dz);
            if (radius > CONFIG.WORLD_MAX_RADIUS || proj.mesh.position.y < CONFIG.WORLD_MIN_Y) {
                world._internal.scene.remove(proj.mesh);
                world.projectiles.splice(i, 1);
                continue;
            }
        }

        const gravityScale = typeof proj.gravityScale === 'number' ? proj.gravityScale : 0.6;
        const drag = typeof proj.drag === 'number' ? proj.drag : 0.985;
        proj.velocity.y -= CONFIG.GRAVITY * gravityScale;
        proj.velocity.multiplyScalar(drag);
        proj.mesh.position.add(proj.velocity);
        
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

                if (proj.shooter && proj.shooter !== entity) {
                    entity.alertTimer = 90;
                    entity.alertTarget = {
                        x: proj.shooter.x,
                        y: proj.shooter.y + CONFIG.ENTITY_HEIGHT * 0.5,
                        z: proj.shooter.z
                    };
                }
                
                const direction = proj.velocity.clone().normalize();
                applyEntityHitEffects(world, entity, direction);
                
                if (entity.hp <= 0) {
                    console.log(`${entity.name} foi derrotado!`);
                    if (entity.type === 'player') {
                        entity.hp = 0;
                        world._internal.scene.remove(proj.mesh);
                        world.projectiles.splice(i, 1);
                        hitSomething = true;
                        break;
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
                applyBlockHitEffects(world, block, proj.blockType || null);
                
                console.log(`${block.type.name} HP: ${block.hp}/${block.maxHP}`);
                
                if (block.hp <= 0) {
                    console.log(`${block.type.name} destruído!`);
                    
                    if (world.mode === 'game' && block.type.droppable) {
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
        
    }
    updateFx(world);
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
