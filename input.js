import CONFIG from './config.js';
import BLOCK_TYPES from './blocks.js';
import { handleInteraction } from './interaction.js';
import { selectBlockType, updateInventoryDisplay } from './ui.js';
import { createProjectile, placeBlock } from './bullet.js';

export function onKeyDown(world, e) {
    world._internal.keys[e.code] = true;
    const player = world.getPlayerEntity();
    
    if (e.code === 'Space' && player.onGround) {
        player.velocityY = CONFIG.JUMP_FORCE;
        player.onGround = false;
    }
    
    if (e.code === 'KeyE' && world.ui.interactionTarget) {
        handleInteraction(world, world.ui.interactionTarget);
    }
    
    if (e.code === 'Tab') {
        e.preventDefault();
        const nextIndex = (world.playerEntityIndex + 1) % world.entities.length;
        world.switchPlayerControl(nextIndex);
        updateInventoryDisplay(world);
    }
    
    if (e.code === 'Digit1') selectBlockType(world, BLOCK_TYPES.STONE);
    if (e.code === 'Digit2') selectBlockType(world, BLOCK_TYPES.GRASS);
    if (e.code === 'Digit3') selectBlockType(world, BLOCK_TYPES.WOOD);
    if (e.code === 'Digit4') selectBlockType(world, BLOCK_TYPES.GOLD);
    if (e.code === 'Digit5') selectBlockType(world, BLOCK_TYPES.DOOR);
    if (e.code === 'Digit6') selectBlockType(world, BLOCK_TYPES.SAND);
}

export function onMouseMove(world, event) {
    if (document.pointerLockElement !== document.body) return;
    
    const player = world.getPlayerEntity();
    if (player) {
        player.yaw -= event.movementX * CONFIG.LOOK_SPEED;
        player.pitch -= event.movementY * CONFIG.LOOK_SPEED;
        player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
    }
}

export function onMouseDown(world, event) {
    if (document.pointerLockElement !== document.body) return;
    
    if (event.button === 0) {
        createProjectile(world);
    } else if (event.button === 2) {
        placeBlock(world);
    }
}

export function onWindowResize(world) {
    world._internal.camera.aspect = window.innerWidth / window.innerHeight;
    world._internal.camera.updateProjectionMatrix();
    world._internal.renderer.setSize(window.innerWidth, window.innerHeight);
}
