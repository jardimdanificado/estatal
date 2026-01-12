import BLOCK_TYPES from './blocks.js';

export function createInventoryUI() {
    const inventoryDiv = document.getElementById('inventory');
    
    Object.values(BLOCK_TYPES).forEach((blockType, index) => {
        const slot = document.createElement('div');
        slot.className = 'inventory-slot';
        slot.id = `slot-${blockType.id}`;
        slot.innerHTML = `
            <div>${blockType.name}</div>
            <div class="count" id="count-${blockType.id}">0</div>
        `;
        slot.onclick = () => selectBlockType(world, blockType);
        inventoryDiv.appendChild(slot);
    });
}

export function updateInventoryDisplay(world) {
    const player = world.getPlayerEntity();
    if (!player || !player.inventory) {
        Object.values(BLOCK_TYPES).forEach(blockType => {
            const countEl = document.getElementById(`count-${blockType.id}`);
            if (countEl) countEl.textContent = '0';
            
            const slotEl = document.getElementById(`slot-${blockType.id}`);
            if (slotEl) slotEl.classList.remove('selected');
        });
        return;
    }
    
    Object.values(BLOCK_TYPES).forEach(blockType => {
        const countEl = document.getElementById(`count-${blockType.id}`);
        if (countEl) {
            countEl.textContent = player.inventory[blockType.id] || 0;
        }
        
        const slotEl = document.getElementById(`slot-${blockType.id}`);
        if (slotEl) {
            if (player.selectedBlockType && player.selectedBlockType.id === blockType.id) {
                slotEl.classList.add('selected');
            } else {
                slotEl.classList.remove('selected');
            }
        }
    });
}

export function selectBlockType(world, blockType) {
    const player = world.getPlayerEntity();
    if (player && player.inventory) {
        player.selectedBlockType = blockType;
        updateInventoryDisplay(world);
    }
}