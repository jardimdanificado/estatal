const makeFoodItem = (id, name, textureKey, heal) => ({
    id,
    name,
    placeable: false,
    textureKey,
    isConsumable: true,
    healValue: heal,
    use: (world, entity, amount) => {
        const total = heal * amount;
        entity.hp = Math.min(entity.maxHP || 100, (entity.hp || 0) + total);
    }
});

export default {
    MEDKIT: {
        id: 'medkit',
        name: 'Kit Medico',
        placeable: false,
        textureKey: 'wood',
        isConsumable: true,
        healValue: 25,
        use: (world, entity, amount) => {
            const heal = 25 * amount;
            entity.hp = Math.min(entity.maxHP || 100, (entity.hp || 0) + heal);
        }
    },
    FOOD_APPLE: makeFoodItem('food_apple', 'Apple', 'food_apple', 12),
    FOOD_APRICOT: makeFoodItem('food_apricot', 'Apricot', 'food_apricot', 12),
    FOOD_BANANA: makeFoodItem('food_banana', 'Banana', 'food_banana', 12),
    FOOD_BEEF_JERKY: makeFoodItem('food_beef_jerky', 'Beef Jerky', 'food_beef_jerky', 20),
    FOOD_BONE: makeFoodItem('food_bone', 'Bone', 'food_bone', 10),
    FOOD_BREAD_RATION: makeFoodItem('food_bread_ration', 'Bread Ration', 'food_bread_ration', 20),
    FOOD_CHEESE: makeFoodItem('food_cheese', 'Cheese', 'food_cheese', 20),
    FOOD_CHOKO: makeFoodItem('food_choko', 'Choko', 'food_choko', 12),
    FOOD_CHUNK: makeFoodItem('food_chunk', 'Chunk', 'food_chunk', 8),
    FOOD_CHUNK_ROTTEN: makeFoodItem('food_chunk_rotten', 'Chunk Rotten', 'food_chunk_rotten', 2),
    FOOD_FRUIT: makeFoodItem('food_fruit', 'Fruit', 'food_fruit', 12),
    FOOD_GRAPE: makeFoodItem('food_grape', 'Grape', 'food_grape', 12),
    FOOD_HONEYCOMB: makeFoodItem('food_honeycomb', 'Honeycomb', 'food_honeycomb', 20),
    FOOD_LEMON: makeFoodItem('food_lemon', 'Lemon', 'food_lemon', 12),
    FOOD_LUMP_OF_ROYAL_JELLY: makeFoodItem('food_lump_of_royal_jelly', 'Lump Of Royal Jelly', 'food_lump_of_royal_jelly', 35),
    FOOD_LYCHEE: makeFoodItem('food_lychee', 'Lychee', 'food_lychee', 12),
    FOOD_MEAT_RATION: makeFoodItem('food_meat_ration', 'Meat Ration', 'food_meat_ration', 20),
    FOOD_ORANGE: makeFoodItem('food_orange', 'Orange', 'food_orange', 12),
    FOOD_PEAR: makeFoodItem('food_pear', 'Pear', 'food_pear', 12),
    FOOD_PIECE_OF_AMBROSIA: makeFoodItem('food_piece_of_ambrosia', 'Piece Of Ambrosia', 'food_piece_of_ambrosia', 35),
    FOOD_PIZZA: makeFoodItem('food_pizza', 'Pizza', 'food_pizza', 20),
    FOOD_RAMBUTAN: makeFoodItem('food_rambutan', 'Rambutan', 'food_rambutan', 12),
    FOOD_SAUSAGE: makeFoodItem('food_sausage', 'Sausage', 'food_sausage', 20),
    FOOD_SNOZZCUMBER: makeFoodItem('food_snozzcumber', 'Snozzcumber', 'food_snozzcumber', 12),
    FOOD_STRAWBERRY: makeFoodItem('food_strawberry', 'Strawberry', 'food_strawberry', 12),
    FOOD_SULTANA: makeFoodItem('food_sultana', 'Sultana', 'food_sultana', 12),
};
