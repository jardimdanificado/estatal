import { loadDefaultExportFromRom } from './rom_loader.js';
import FALLBACK_MENUS from '../menus.js';

const MENUS = await loadDefaultExportFromRom('config/menus.js', FALLBACK_MENUS);

export default MENUS;
