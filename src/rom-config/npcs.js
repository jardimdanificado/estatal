import { loadDefaultExportFromRom } from './_rom_loader.js';
const NPC_TYPES = await loadDefaultExportFromRom('config/npcs.js', {});
export default NPC_TYPES;
