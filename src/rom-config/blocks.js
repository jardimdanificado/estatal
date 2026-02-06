import { loadDefaultExportFromRom } from './_rom_loader.js';

const fallback = {
  STONE: {
    id: 1,
    name: 'Stone',
    textures: { all: 'stone' },
    solid: true,
    floor: false,
    hp: 100,
    breakDamage: 10,
    opacity: 1,
    droppable: true
  },
  GRASS: {
    id: 2,
    name: 'Grass',
    textures: { all: 'grass' },
    solid: true,
    floor: true,
    hp: 100,
    breakDamage: 10,
    opacity: 1,
    droppable: true
  },
  PLAYER_SPAWN: {
    id: 3,
    name: 'Player Spawn',
    textures: { all: 'gold' },
    solid: false,
    floor: false,
    hp: 999999,
    breakDamage: 0,
    opacity: 1,
    droppable: false
  }
};

const BLOCK_TYPES = await loadDefaultExportFromRom('config/blocks.js', fallback);
export default BLOCK_TYPES;
