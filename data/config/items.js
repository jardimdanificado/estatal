export default {
    COIN: {
        id: 'coin',
        name: 'Moeda',
        placeable: false,
        textureKey: 'gold',
        isConsumable: false,
        handlesInventory: true,
        use: (world, entity, amount) => {
            entity.itemInventory = entity.itemInventory || {};
            entity.itemInventory.coin = (entity.itemInventory.coin || 0) + amount;
        }
    },
    MEDKIT: {
        id: 'medkit',
        name: 'Kit Medico',
        placeable: false,
        textureKey: 'wood',
        isConsumable: true,
        use: (world, entity, amount) => {
            const heal = 25 * amount;
            entity.hp = Math.min(entity.maxHP || 100, (entity.hp || 0) + heal);
        }
    }
};
