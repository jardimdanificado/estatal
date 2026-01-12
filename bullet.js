import CONFIG from './config.js';
import BLOCK_TYPES from './blocks.js';
import { updateInventoryDisplay } from './ui.js';

export function createProjectile(world) {
    const player = world.getPlayerEntity();
    if (!player || !player.inventory) return;
    
    const ammoCount = player.inventory[player.selectedBlockType.id] || 0;
    
    if (ammoCount <= 0) {
        console.log(`Sem munição de ${player.selectedBlockType.name}!`);
        return;
    }
    
    player.inventory[player.selectedBlockType.id] = (player.inventory[player.selectedBlockType.id] || 0) - 1;
    updateInventoryDisplay(world);
    
    const damage = player.selectedBlockType.breakDamage;
    
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.position.copy(world._internal.camera.position);
    
    const direction = new THREE.Vector3();
    world._internal.camera.getWorldDirection(direction);
    
    const projectile = {
        mesh: mesh,
        velocity: direction.multiplyScalar(0.5),
        damage: damage,
        lifeTime: 100
    };
    
    world._internal.scene.add(mesh);
    world.projectiles.push(projectile);
}

export function placeBlock(world) {
    const player = world.getPlayerEntity();
    if (!player || !player.inventory) return;
    if (!world.ui.targetBlockPosition) return;
    
    const ammoCount = player.inventory[player.selectedBlockType.id] || 0;
    
    if (ammoCount <= 0) {
        console.log(`Sem blocos de ${player.selectedBlockType.name}!`);
        return;
    }
    
    const { x, y, z } = world.ui.targetBlockPosition;
    
    const newBlock = world.addBlock(x, y, z, player.selectedBlockType, false);
    if (newBlock) {
        player.inventory[player.selectedBlockType.id] = (player.inventory[player.selectedBlockType.id] || 0) - 1;
        updateInventoryDisplay(world);
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
                    
                    // Se derrotar um hostil, dropar itens
                    const playerEntity = world.getPlayerEntity();
                    if (entity.isHostile && playerEntity && playerEntity.inventory) {
                        playerEntity.inventory[BLOCK_TYPES.STONE.id] = 
                            (playerEntity.inventory[BLOCK_TYPES.STONE.id] || 0) + 10;
                        updateInventoryDisplay(world);
                        console.log('Você ganhou 10 pedras!');
                    }
                    
                    world.removeEntity(entity, updateInventoryDisplay);
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
                    
                    const playerEntity = world.getPlayerEntity();
                    if (playerEntity && playerEntity.inventory) {
                        playerEntity.inventory[block.type.id] = 
                            (playerEntity.inventory[block.type.id] || 0) + 2;
                        updateInventoryDisplay(world);
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
