import CONFIG from './config.js';


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