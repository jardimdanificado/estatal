import CONFIG from './rom-config/config.js';


export function checkCollision(world, x, y, z, entity) {
    const height = entity.isCrouching ? CONFIG.ENTITY_HEIGHT_CROUCHED : CONFIG.ENTITY_HEIGHT;
    const half = CONFIG.BLOCK_SIZE / 2;

    const entityBox = {
        minX: x - CONFIG.ENTITY_RADIUS,
        maxX: x + CONFIG.ENTITY_RADIUS,
        minY: y,
        maxY: y + height,
        minZ: z - CONFIG.ENTITY_RADIUS,
        maxZ: z + CONFIG.ENTITY_RADIUS
    };

    const minBX = Math.floor(entityBox.minX + half);
    const maxBX = Math.floor(entityBox.maxX + half);
    const minBY = Math.floor(entityBox.minY + half);
    const maxBY = Math.floor(entityBox.maxY + half);
    const minBZ = Math.floor(entityBox.minZ + half);
    const maxBZ = Math.floor(entityBox.maxZ + half);

    for (let bx = minBX; bx <= maxBX; bx++) {
        for (let by = minBY; by <= maxBY; by++) {
            for (let bz = minBZ; bz <= maxBZ; bz++) {
                const block = world.getBlockAt(bx, by, bz);
                if (!block || !block.solid) continue;

                const blockMinX = block.x - half;
                const blockMaxX = block.x + half;
                const blockMinY = block.y - half;
                const blockMaxY = block.y + half;
                const blockMinZ = block.z - half;
                const blockMaxZ = block.z + half;

                if (entityBox.maxX > blockMinX && entityBox.minX < blockMaxX &&
                    entityBox.maxY > blockMinY && entityBox.minY < blockMaxY &&
                    entityBox.maxZ > blockMinZ && entityBox.minZ < blockMaxZ) {
                    return { collides: true, block: block };
                }
            }
        }
    }

    return { collides: false };
}

export function getGroundLevel(world, x, z) {
    const bx = Math.round(x);
    const bz = Math.round(z);
    const dx = Math.abs(bx - x);
    const dz = Math.abs(bz - z);
    if (dx >= 0.5 || dz >= 0.5) return 0;

    let maxY = -Infinity;
    const half = CONFIG.BLOCK_SIZE / 2;

    for (let by = -15; by <= 40; by++) {
        const block = world.getBlockAt(bx, by, bz);
        if (block && block.solid) {
            const blockTop = block.y + half;
            if (blockTop > maxY) {
                maxY = blockTop;
            }
        }
    }

    return maxY === -Infinity ? 0 : maxY;
}
