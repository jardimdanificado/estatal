import { loadDefaultExportFromRom } from './_rom_loader.js';

const fallback = {
  PLAYER_SPEED: 0.08,
  GRAVITY: 0.012,
  JUMP_FORCE: 0.23,
  BREAK_RANGE: 4,
  PLACEMENT_RANGE: 6,
  INTERACTION_RANGE: 3,
  ENTITY_HEIGHT: 1.8
};

const CONFIG = await loadDefaultExportFromRom('config/config.js', fallback);

export default CONFIG;
