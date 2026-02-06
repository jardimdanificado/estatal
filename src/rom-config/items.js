import { loadDefaultExportFromRom } from './rom_loader.js';
const ITEMS = await loadDefaultExportFromRom('config/items.js', {});
export default ITEMS;
