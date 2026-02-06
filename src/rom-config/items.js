import { loadDefaultExportFromRom } from './_rom_loader.js';
const ITEMS = await loadDefaultExportFromRom('config/items.js', {});
export default ITEMS;
