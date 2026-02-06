import { loadDefaultExportFromRom } from './rom_loader.js';
const textures = await loadDefaultExportFromRom('config/textures.js', []);
export default textures;
