import { loadDefaultExportFromRom } from './rom_loader.js';
import FALLBACK_UI_LAYOUT from '../ui-layout.js';

const UI_LAYOUT = await loadDefaultExportFromRom('config/ui-layout.js', FALLBACK_UI_LAYOUT);

export default UI_LAYOUT;
