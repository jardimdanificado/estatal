export default {
    CUSCUZ: {
        id: 'cuscuz',
        name: 'Cuscuz',
        placeable: false,
        textureKey: 'item-cuscuz',
        uiTextureKey: 'item-cuscuz',
        dropTextureKey: 'item-cuscuz',
        handTextureKey: 'cuscuz-hand',
        isConsumable: true,
        healValue: 15,
        use: (world, entity, amount) => {
            const total = 15 * amount;
            entity.hp = Math.min(entity.maxHP || 100, (entity.hp || 0) + total);
        }
    },
    PEDRA: {
        id: 'pedra',
        name: 'Pedra',
        placeable: false,
        textureKey: 'item-rock',
        uiTextureKey: 'item-rock',
        dropTextureKey: 'item-rock',
        handTextureKey: 'rock-hand',
        projectileTextureKey: 'item-rock',
        projectileDamage: 8,
        projectileSpeed: 0.75,
        projectileSize: 0.28,
        projectileGravityScale: 0.35,
        projectileDrag: 0.985
    },
    REVOLVER: {
        id: 'revolver',
        name: 'Revolver',
        placeable: false,
        textureKey: 'item-revolver',
        uiTextureKey: 'item-revolver',
        dropTextureKey: 'item-38-bullet',
        handTextureKey: '38-hand',
        projectileTextureKey: 'gold',
        damage: 20,
        projectileDamage: 20,
        projectileSpeed: 1.35,
        projectileSize: 0.2,
        projectileGravityScale: 0.1,
        projectileDrag: 0.995
    }
};
