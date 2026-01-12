import CONFIG from './config.js';


export function checkCollision(world, x, y, z, entity) {
    const height = entity.isCrouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT;
    
    const entityBox = {
        minX: x - CONFIG.ENTITY_RADIUS,
        maxX: x + CONFIG.ENTITY_RADIUS,
        minY: y,
        maxY: y + height,
        minZ: z - CONFIG.ENTITY_RADIUS,
        maxZ: z + CONFIG.ENTITY_RADIUS
    };
    
    for (let block of world.blocks) {
        if (!block.solid) continue;
        
        const half = CONFIG.BLOCK_SIZE / 2;
        
        const blockBox = {
            minX: block.x - half,
            maxX: block.x + half,
            minY: block.y - half,
            maxY: block.y + half,
            minZ: block.z - half,
            maxZ: block.z + half
        };
        
        if (entityBox.maxX > blockBox.minX && entityBox.minX < blockBox.maxX &&
            entityBox.maxY > blockBox.minY && entityBox.minY < blockBox.maxY &&
            entityBox.maxZ > blockBox.minZ && entityBox.minZ < blockBox.maxZ) {
            return { collides: true, block: block };
        }
    }
    
    return { collides: false };
}

export function getGroundLevel(world, x, z) {
    let maxY = -Infinity;
    
    for (let block of world.blocks) {
        if (!block.solid) continue;
        
        const dx = Math.abs(block.x - x);
        const dz = Math.abs(block.z - z);
        
        if (dx < 0.5 && dz < 0.5) {
            const blockTop = block.y + CONFIG.BLOCK_SIZE / 2;
            if (blockTop > maxY) {
                maxY = blockTop;
            }
        }
    }
    
    return maxY === -Infinity ? 0 : maxY;
}