// ============================================================
// CONSTANTES E CONFIGURAÇÃO
// ============================================================
import CONFIG from "./rom-config/config.js"
import NPC_TYPES from "./rom-config/npcs.js"
import BLOCK_TYPES from "./rom-config/blocks.js"
import ITEMS from "./rom-config/items.js"
import texturesToLoad from "./rom-config/textures.js"
import MENUS from "./rom-config/menus.js"
import UI_LAYOUT from "./rom-config/ui-layout.js"
import { vocabulario } from "../lib/vocabulario.js"
import { FACTIONS, FACTION_RELATIONS, FACTION_ORDER } from "./rom-config/factions.js"
import world from "./world.js"
import { updateEntity, checkInteractionTarget, refreshEntityIndicators } from "./entity.js"
import { handleInteraction } from './entity.js';
import { createProjectile, placeBlock } from './bullet.js';
import { updateProjectiles } from './bullet.js';
import { updateItems, spawnBlockDrop, spawnItemDrop } from './item.js';
import { useItem } from './item.js';
import { spawnMessage, updateMessages } from './message.js';
import audioSystem from './audio.js';
import { getGroundLevel } from './collision.js';
import { openInspectorWindow } from './inspector.js';

const ROM_RUNTIME = {
    enabled: false,
    name: null,
    mapPayload: null,
    mapByName: {},
    textureUrlByKey: {},
    assetUrlByPath: {},
    objectUrls: []
};

let TEXTURE_PREVIEW_MAP = {};
let INVENTORY_ITEM_OPTIONS = [];
let INVENTORY_BLOCK_OPTIONS = [];
const GENERATED_UI_TEXTURE_CACHE = new Map();
let ROM_AUDIO_CONFIG = {
    banks: [],
    events: {}
};
let ROM_INVENTORY_PRESETS = {};

function replaceObjectContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source || {});
}

function replaceArrayContents(target, source) {
    if (!Array.isArray(target)) return;
    target.splice(0, target.length, ...(Array.isArray(source) ? source : []));
}

function parseDefaultExportModule(code) {
    const source = String(code || '');
    try {
        const transformed = source.replace(/export\s+default/, 'const __default_export__ =');
        return new Function(`${transformed}\nreturn typeof __default_export__ !== 'undefined' ? __default_export__ : null;`)();
    } catch {
        const exec = new Function(`${source.replace(/export\s+default/, 'return')}`);
        return exec();
    }
}

function parseFactionsModule(code) {
    const transformed = code
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+default\s+/g, 'const __default_export__ = ');
    const wrapped = `${transformed}\nreturn { FACTIONS, FACTION_RELATIONS, FACTION_ORDER };`;
    return new Function(wrapped)();
}

function normalizeRomPath(path) {
    return String(path || '').replace(/^\.\//, '').replace(/^\/+/, '');
}

function pickZipFile(zip, candidates) {
    for (const c of candidates) {
        const normalized = normalizeRomPath(c);
        let file = zip.file(normalized);
        if (!file) {
            const suffix = `/${normalized}`;
            file = Object.values(zip.files).find((f) => !f.dir && normalizeRomPath(f.name).endsWith(suffix)) || null;
        }
        if (file) return file;
    }
    return null;
}

function findZipEntryByPath(zip, path) {
    const normalized = normalizeRomPath(path);
    const variants = [normalized];
    if (normalized.startsWith('data/')) variants.push(normalized.slice(5));
    else variants.push(`data/${normalized}`);
    for (const candidate of variants) {
        const exact = zip.file(candidate);
        if (exact) return exact;
        const suffix = `/${candidate}`;
        const bySuffix = Object.values(zip.files).find((f) => !f.dir && normalizeRomPath(f.name).endsWith(suffix));
        if (bySuffix) return bySuffix;
    }
    return null;
}

function resolveTextureLoadUrl(key, fallbackUrl) {
    if (ROM_RUNTIME.enabled) {
        return ROM_RUNTIME.textureUrlByKey[key] || null;
    }
    const raw = String(ROM_RUNTIME.textureUrlByKey[key] || fallbackUrl || '').trim();
    if (!raw) return null;
    if (/^data:image\//i.test(raw)) return raw;
    if (/^blob:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return null;
}

function blockTypeLooksLikeDoor(blockType) {
    if (!blockType || typeof blockType !== 'object') return false;
    if (blockType.isDoor === true || blockType.door === true) return true;
    const name = String(blockType.name || '').toLowerCase();
    const key = String(blockType.key || '').toLowerCase();
    const textures = blockType.textures && typeof blockType.textures === 'object'
        ? Object.values(blockType.textures).map((v) => String(v || '').toLowerCase()).join(' ')
        : '';
    const hints = `${name} ${key} ${textures}`;
    return hints.includes('door') || hints.includes('porta');
}

function usesLegacyDoorGrouping(onUseFn) {
    if (typeof onUseFn !== 'function') return false;
    const src = String(onUseFn).replace(/\s+/g, ' ');
    return src.includes('onUse === DOOR_USE') || src.includes('onUse === block.type.onUse');
}

function applyDoorVisualState(targetBlock, solid) {
    if (!targetBlock || !targetBlock.mesh) return;
    const mats = Array.isArray(targetBlock.mesh.material)
        ? targetBlock.mesh.material
        : (targetBlock.mesh.material ? [targetBlock.mesh.material] : []);
    for (const mat of mats) {
        if (!mat) continue;
        if ('opacity' in mat) mat.opacity = solid ? (targetBlock.type.opacity ?? 1) : 0.35;
        if ('transparent' in mat) mat.transparent = (mat.opacity ?? 1) < 1;
    }
}

const SHARED_DOOR_TOGGLE_ON_USE = function (world, block, creature) {
    const worldBlocks = world && Array.isArray(world.blocks) ? world.blocks : [];
    if (!worldBlocks.length || !block || !block.userData) return;
    const isOpening = !!block.userData.solid;
    const targetSolid = !isOpening;
    const EPS = 0.01;
    const isAt = (b, x, y, z) =>
        Math.abs(b.x - x) < EPS &&
        Math.abs(b.y - y) < EPS &&
        Math.abs(b.z - z) < EPS;
    const isDoorBlock = (b) => {
        if (!b || !b.type) return false;
        const hasUse = !!(b.hasUseFunction || typeof b.type.onUse === 'function');
        return hasUse && blockTypeLooksLikeDoor(b.type);
    };

    const visited = new Set();
    const queue = [{ x: block.userData.x, y: block.userData.y, z: block.userData.z }];
    while (queue.length > 0) {
        const current = queue.shift();
        const cellKey = `${current.x},${current.y},${current.z}`;
        if (visited.has(cellKey)) continue;
        visited.add(cellKey);

        const targetBlock = worldBlocks.find((b) => isAt(b, current.x, current.y, current.z) && isDoorBlock(b));
        if (!targetBlock) continue;
        targetBlock.solid = targetSolid;
        if (isAt({ x: block.userData.x, y: block.userData.y, z: block.userData.z }, current.x, current.y, current.z)) {
            block.userData.solid = targetSolid;
        }
        applyDoorVisualState(targetBlock, targetSolid);

        queue.push(
            { x: current.x + 1, y: current.y, z: current.z },
            { x: current.x - 1, y: current.y, z: current.z },
            { x: current.x, y: current.y, z: current.z + 1 },
            { x: current.x, y: current.y, z: current.z - 1 },
            { x: current.x, y: current.y + 1, z: current.z },
            { x: current.x, y: current.y - 1, z: current.z }
        );
    }
    if (world && typeof world.markTerrainDirty === 'function') {
        world.markTerrainDirty();
    }
};

function normalizeLegacyDoorScriptsInBlockTypes() {
    const candidates = Object.values(BLOCK_TYPES || {}).filter((bt) =>
        bt &&
        typeof bt.onUse === 'function' &&
        blockTypeLooksLikeDoor(bt) &&
        usesLegacyDoorGrouping(bt.onUse)
    );
    if (!candidates.length) return;
    for (const blockType of candidates) {
        blockType.onUse = SHARED_DOOR_TOGGLE_ON_USE;
    }
}

function refreshCatalogCaches() {
    normalizeLegacyDoorScriptsInBlockTypes();
    const textureEntries = Array.isArray(texturesToLoad) ? texturesToLoad : [];
    TEXTURE_PREVIEW_MAP = textureEntries.reduce((map, entry) => {
        map[entry.key] = entry.url;
        return map;
    }, {});

    INVENTORY_ITEM_OPTIONS = Object.values(ITEMS)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((itemDef) => ({
            id: itemDef.id,
            label: itemDef.name,
            textureKey: getItemTextureKey(itemDef, 'ui'),
            textureUrl: resolvePreviewTextureUrl(getItemTextureKey(itemDef, 'ui'))
        }));

    INVENTORY_BLOCK_OPTIONS = Object.values(BLOCK_TYPES)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((blockType) => {
            const textureKey = getBlockThumbnailTextureKey(blockType);
            return {
                id: blockType.id,
                label: blockType.name,
                textureKey,
                textureUrl: resolvePreviewTextureUrl(textureKey)
            };
        });
}

function resolvePreviewTextureUrl(key) {
    if (!key) return null;
    const romUrl = ROM_RUNTIME.textureUrlByKey[key];
    if (romUrl) return romUrl;
    if (isGeneratedUiTextureKey(key)) return getGeneratedUiTextureDataUrl(key);
    const raw = String(TEXTURE_PREVIEW_MAP[key] || '').trim();
    if (!raw) return null;
    if (/^data:image\//i.test(raw)) return raw;
    if (/^blob:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return null;
}

function isGeneratedUiTextureKey(key) {
    return key === 'ui_player_face' ||
        key === 'ui_empty_hand' ||
        key.startsWith('sensed_') ||
        key.startsWith('mdam_');
}

function getGeneratedUiTextureDataUrl(key) {
    if (GENERATED_UI_TEXTURE_CACHE.has(key)) {
        return GENERATED_UI_TEXTURE_CACHE.get(key);
    }
    const size = key === 'ui_player_face' ? 64 : 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const emojiByKey = {
        ui_player_face: '😀',
        sensed_friendly: '🙂',
        sensed_friendly_unseen: '😶',
        sensed_hostile: '😠',
        sensed_hostile_unseen: '👿',
        mdam_almost_dead: '💀',
        mdam_severely_damaged: '😵',
        mdam_heavily_damaged: '😣',
        mdam_moderately_damaged: '😐',
        mdam_lightly_damaged: '🙂',
        ui_empty_hand: '✋'
    };
    const emoji = emojiByKey[key] || '❔';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(size * 0.72)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(emoji, size / 2, size / 2 + 1);

    const dataUrl = canvas.toDataURL('image/png');
    GENERATED_UI_TEXTURE_CACHE.set(key, dataUrl);
    return dataUrl;
}

function getItemTextureKey(itemDef, purpose = 'ui') {
    if (!itemDef) return null;
    if (purpose === 'hand') {
        return itemDef.handTextureKey || itemDef.uiTextureKey || itemDef.textureKey || null;
    }
    if (purpose === 'drop') {
        return itemDef.dropTextureKey || itemDef.textureKey || null;
    }
    if (purpose === 'projectile') {
        return itemDef.projectileTextureKey || itemDef.textureKey || null;
    }
    return itemDef.uiTextureKey || itemDef.textureKey || null;
}

function getBlockThumbnailTextureKey(blockType) {
    if (!blockType || !blockType.textures) return null;
    return blockType.textures.all ||
        blockType.textures.top ||
        blockType.textures.side ||
        blockType.textures.bottom ||
        null;
}

function getPreferredBlockType(...keys) {
    for (const key of keys) {
        if (key && BLOCK_TYPES[key]) return BLOCK_TYPES[key];
    }
    const first = Object.values(BLOCK_TYPES)[0] || null;
    return first;
}

function getPlayerFactionId() {
    const byUpper = FACTIONS.PLAYER && FACTIONS.PLAYER.id ? FACTIONS.PLAYER.id : null;
    if (byUpper) return byUpper;
    const byLower = FACTIONS.player && FACTIONS.player.id ? FACTIONS.player.id : null;
    if (byLower) return byLower;
    const first = Object.values(FACTIONS).find((f) => f && typeof f.id === 'string');
    return first ? first.id : 'neutral';
}

function revokeRomTextureUrls() {
    for (const url of ROM_RUNTIME.objectUrls) {
        URL.revokeObjectURL(url);
    }
    ROM_RUNTIME.objectUrls = [];
}

async function loadRomFromZipFile(file) {
    if (!window.JSZip) throw new Error('JSZip indisponível');
    const zip = await window.JSZip.loadAsync(file);

    const blocksFile = pickZipFile(zip, ['data/config/blocks.js', 'config/blocks.js']);
    const itemsFile = pickZipFile(zip, ['data/config/items.js', 'config/items.js']);
    const npcsFile = pickZipFile(zip, ['data/config/npcs.js', 'config/npcs.js']);
    const texturesFile = pickZipFile(zip, ['data/config/textures.js', 'config/textures.js']);
    const factionsFile = pickZipFile(zip, ['data/config/factions.js', 'config/factions.js']);
    const uiLayoutFile = pickZipFile(zip, ['data/config/ui-layout.js', 'config/ui-layout.js']);
    const audioConfigFile = pickZipFile(zip, ['data/config/audio.json', 'config/audio.json']);
    const presetsFile = pickZipFile(zip, ['data/config/inventory-presets.json', 'config/inventory-presets.json']);
    const mapFile = pickZipFile(zip, ['data/maps/default.json', 'maps/default.json', 'map.json']);

    if (blocksFile) replaceObjectContents(BLOCK_TYPES, parseDefaultExportModule(await blocksFile.async('string')));
    if (itemsFile) replaceObjectContents(ITEMS, parseDefaultExportModule(await itemsFile.async('string')));
    if (npcsFile) replaceObjectContents(NPC_TYPES, parseDefaultExportModule(await npcsFile.async('string')));
    if (texturesFile) {
        const parsedTextures = parseDefaultExportModule(await texturesFile.async('string'));
        replaceArrayContents(texturesToLoad, Array.isArray(parsedTextures) ? parsedTextures : []);
    }

    if (factionsFile) {
        const parsedFactions = parseFactionsModule(await factionsFile.async('string'));
        replaceObjectContents(FACTIONS, parsedFactions.FACTIONS || {});
        replaceObjectContents(FACTION_RELATIONS, parsedFactions.FACTION_RELATIONS || {});
        replaceArrayContents(FACTION_ORDER, parsedFactions.FACTION_ORDER || []);
    }
    if (uiLayoutFile) {
        const parsedLayout = parseDefaultExportModule(await uiLayoutFile.async('string'));
        replaceObjectContents(UI_LAYOUT, parsedLayout && typeof parsedLayout === 'object' ? parsedLayout : UI_LAYOUT);
    }
    ROM_AUDIO_CONFIG = { banks: [], events: {} };
    if (audioConfigFile) {
        try {
            const parsedAudio = JSON.parse(await audioConfigFile.async('string'));
            const banks = Array.isArray(parsedAudio && parsedAudio.banks) ? parsedAudio.banks : [];
            const events = (parsedAudio && parsedAudio.events && typeof parsedAudio.events === 'object')
                ? parsedAudio.events
                : {};
            ROM_AUDIO_CONFIG = {
                banks: banks.map((b) => ({
                    id: String((b && b.id) || ''),
                    path: String((b && b.path) || ''),
                    autoLoad: b && b.autoLoad !== false,
                    loadSamples: b && b.loadSamples !== false
                })).filter((b) => b.path),
                events: { ...events }
            };
        } catch {
            ROM_AUDIO_CONFIG = { banks: [], events: {} };
        }
    }
    ROM_INVENTORY_PRESETS = {};
    if (presetsFile) {
        try {
            const parsedPresets = JSON.parse(await presetsFile.async('string'));
            ROM_INVENTORY_PRESETS = parsedPresets && typeof parsedPresets === 'object' ? parsedPresets : {};
        } catch {
            ROM_INVENTORY_PRESETS = {};
        }
    }

    revokeRomTextureUrls();
    ROM_RUNTIME.textureUrlByKey = {};
    ROM_RUNTIME.assetUrlByPath = {};
    for (const tex of texturesToLoad) {
        if (!tex || !tex.key || !tex.url) continue;
        const path = normalizeRomPath(tex.url);
        const imageFile = findZipEntryByPath(zip, path);
        if (!imageFile) continue;
        const blob = await imageFile.async('blob');
        const objectUrl = URL.createObjectURL(blob);
        ROM_RUNTIME.textureUrlByKey[tex.key] = objectUrl;
        ROM_RUNTIME.assetUrlByPath[path] = objectUrl;
        if (path.startsWith('data/')) {
            ROM_RUNTIME.assetUrlByPath[path.slice(5)] = objectUrl;
        } else {
            ROM_RUNTIME.assetUrlByPath[`data/${path}`] = objectUrl;
        }
        ROM_RUNTIME.objectUrls.push(objectUrl);
    }

    const emptyHandPath = 'images/empty-hand.png';
    if (!ROM_RUNTIME.assetUrlByPath[emptyHandPath]) {
        const emptyHandFile = findZipEntryByPath(zip, emptyHandPath);
        if (emptyHandFile) {
            const emptyHandBlob = await emptyHandFile.async('blob');
            const emptyHandUrl = URL.createObjectURL(emptyHandBlob);
            ROM_RUNTIME.assetUrlByPath[emptyHandPath] = emptyHandUrl;
            ROM_RUNTIME.assetUrlByPath[`data/${emptyHandPath}`] = emptyHandUrl;
            ROM_RUNTIME.textureUrlByKey['empty-hand'] = ROM_RUNTIME.textureUrlByKey['empty-hand'] || emptyHandUrl;
            ROM_RUNTIME.objectUrls.push(emptyHandUrl);
        }
    }

    ROM_RUNTIME.mapPayload = null;
    ROM_RUNTIME.mapByName = {};
    const zipMapFiles = Object.values(zip.files).filter((f) => !f.dir && /(?:^|\/)(?:data\/)?maps\/.+\.json$/i.test(normalizeRomPath(f.name)));
    for (const mf of zipMapFiles) {
        try {
            const payload = JSON.parse(await mf.async('string'));
            if (!payload || !Array.isArray(payload.blocks)) continue;
            const shortName = normalizeRomPath(mf.name).replace(/^.*(?:data\/)?maps\//i, '');
            ROM_RUNTIME.mapByName[shortName] = payload;
        } catch {}
    }
    if (!Object.keys(ROM_RUNTIME.mapByName).length && mapFile) {
        try {
            const fallbackMap = JSON.parse(await mapFile.async('string'));
            if (fallbackMap && Array.isArray(fallbackMap.blocks)) {
                ROM_RUNTIME.mapByName['default.json'] = fallbackMap;
            }
        } catch (err) {
            console.warn('ROM sem mapa válido:', err);
        }
    }
    ROM_RUNTIME.mapPayload = ROM_RUNTIME.mapByName['default.json'] || Object.values(ROM_RUNTIME.mapByName)[0] || null;

    const audioFiles = Object.values(zip.files).filter((f) => !f.dir && /(?:^|\/)(?:data\/)?audio\/.+/i.test(normalizeRomPath(f.name)));
    for (const af of audioFiles) {
        const blob = await af.async('blob');
        const url = URL.createObjectURL(blob);
        const normalized = normalizeRomPath(af.name);
        ROM_RUNTIME.assetUrlByPath[normalized] = url;
        if (normalized.startsWith('data/')) {
            ROM_RUNTIME.assetUrlByPath[normalized.slice(5)] = url;
        } else {
            ROM_RUNTIME.assetUrlByPath[`data/${normalized}`] = url;
        }
        ROM_RUNTIME.objectUrls.push(url);
    }
    const masterUrl = ROM_RUNTIME.assetUrlByPath['audio/Master.bank'] || ROM_RUNTIME.assetUrlByPath['data/audio/Master.bank'];
    const stringsUrl = ROM_RUNTIME.assetUrlByPath['audio/Master.strings.bank'] || ROM_RUNTIME.assetUrlByPath['data/audio/Master.strings.bank'];
    if (masterUrl) ROM_RUNTIME.assetUrlByPath['audio/Master.bank'] = masterUrl;
    if (stringsUrl) ROM_RUNTIME.assetUrlByPath['audio/Master.strings.bank'] = stringsUrl;

    ROM_RUNTIME.enabled = true;
    ROM_RUNTIME.name = file.name;
    refreshCatalogCaches();
}

async function fetchRomFileFromParam(romParam) {
    const raw = String(romParam || '').trim();
    if (!raw || raw === '0') return null;
    const romUrl = new URL(raw, window.location.href);
    const response = await fetch(romUrl.toString());
    if (!response.ok) {
        throw new Error(`ROM fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    const fileName = romUrl.pathname.split('/').pop() || 'rom.zip';
    return new File([blob], fileName, { type: blob.type || 'application/zip' });
}

async function fetchRomFileFromRef(romRef) {
    const ref = String(romRef || '').trim();
    if (!ref) return null;
    const openReq = indexedDB.open('rom-file-store', 1);
    const db = await new Promise((resolve, reject) => {
        openReq.onupgradeneeded = () => {
            const dbUp = openReq.result;
            if (!dbUp.objectStoreNames.contains('files')) dbUp.createObjectStore('files');
        };
        openReq.onsuccess = () => resolve(openReq.result);
        openReq.onerror = () => reject(openReq.error || new Error('indexedDB open failed'));
    });
    const blob = await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get(ref);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('indexedDB read failed'));
    });
    db.close();
    if (!blob) return null;
    return new File([blob], 'rom-from-picker.zip', { type: blob.type || 'application/zip' });
}

function buildRomPrompt() {
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.background = 'rgba(0,0,0,0.86)';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.style.zIndex = '120';
    wrap.style.fontFamily = '"Courier New", monospace';

    const card = document.createElement('div');
    card.style.width = 'min(92vw, 520px)';
    card.style.background = '#131722';
    card.style.border = '1px solid rgba(255,255,255,0.2)';
    card.style.borderRadius = '12px';
    card.style.padding = '14px';
    card.style.color = 'white';

    const title = document.createElement('div');
    title.textContent = 'ROM Loader';
    title.style.fontSize = '18px';
    title.style.marginBottom = '8px';

    const text = document.createElement('div');
    text.textContent = 'Selecione um ROM (.zip) para carregar conteúdo do jogo, ou use os dados embutidos.';
    text.style.fontSize = '13px';
    text.style.opacity = '0.9';
    text.style.marginBottom = '12px';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.flexWrap = 'wrap';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Carregar ROM (.zip)';
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Usar embutido';

    [loadBtn, skipBtn].forEach((btn) => {
        btn.style.padding = '8px 10px';
        btn.style.borderRadius = '8px';
        btn.style.border = '1px solid rgba(255,255,255,0.3)';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.color = 'white';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'inherit';
    });

    row.appendChild(loadBtn);
    row.appendChild(skipBtn);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(row);
    wrap.appendChild(card);
    return { wrap, loadBtn, skipBtn };
}

async function maybeLoadRomAtBoot() {
    const params = new URLSearchParams(window.location.search);
    const romRef = params.get('romref');
    const romParamRaw = params.get('rom');
    const romParam = String(romParamRaw == null ? 'data.zip' : romParamRaw).trim();
    const forceBuiltIn = romParam === '0';
    if (forceBuiltIn || !window.JSZip) {
        refreshCatalogCaches();
        return;
    }
    showLoadingOverlay('Carregando ROM...');
    try {
        const romFile = romRef
            ? await fetchRomFileFromRef(romRef)
            : await fetchRomFileFromParam(romParam);
        if (romFile) {
            await loadRomFromZipFile(romFile);
        }
    } catch (err) {
        console.warn(`Falha ao carregar ROM (${romRef ? `ref=${romRef}` : romParam}):`, err);
    } finally {
        hideLoadingOverlay();
    }
    refreshCatalogCaches();
}

let loadingOverlay = null;

function getConfiguredGameName() {
    const candidates = [
        CONFIG && CONFIG.GAME_NAME,
        CONFIG && CONFIG.GAME_TITLE,
        CONFIG && CONFIG.NAME,
        CONFIG && CONFIG.TITLE
    ];
    for (const value of candidates) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function getRomDisplayName() {
    const raw = String(ROM_RUNTIME.name || '').trim();
    if (!raw) return '';
    return raw.replace(/\.(rom\.)?zip$/i, '').replace(/\.zip$/i, '').trim();
}

function updateDocumentTitleForMode(mode = 'game') {
    if (mode === 'editor') return;
    const gameName = getConfiguredGameName() || getRomDisplayName() || 'maquina estatal';
    document.title = gameName;
}

function setRendererVisible(world, visible) {
    const renderer = world && world._internal ? world._internal.renderer : null;
    if (!renderer || !renderer.domElement) return;
    renderer.domElement.style.display = visible ? 'block' : 'none';
}

function ensureLoadingOverlay() {
    if (loadingOverlay) return loadingOverlay;
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.85)';
    overlay.style.color = 'white';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '80';
    overlay.style.fontFamily = '"Courier New", monospace';
    overlay.style.fontSize = '18px';
    overlay.style.textAlign = 'center';
    overlay.style.pointerEvents = 'auto';
    overlay.innerText = 'Carregando…';
    document.body.appendChild(overlay);
    loadingOverlay = overlay;
    return overlay;
}

function showLoadingOverlay(message = 'Carregando…') {
    const overlay = ensureLoadingOverlay();
    overlay.textContent = message;
    overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
    if (!loadingOverlay) return;
    loadingOverlay.style.display = 'none';
}

function setGameplayUiVisible(world, visible) {
    const ids = ['crosshair', 'interaction', 'block-outline', 'current-item', 'hud', 'hand-item', 'mobile-controls', 'ui-layout-root'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.display = visible ? '' : 'none';
    }
}

function normalizeMenuElement(el = {}, index = 0) {
    const type = String(el.type || 'button').toLowerCase();
    const out = {
        id: String(el.id || `element_${index}`),
        type: (type === 'input' || type === 'text' || type === 'button' || type === 'image') ? type : 'button',
        x: Number(el.x || 0),
        y: Number(el.y || 0),
        width: Math.max(12, Number(el.width || 160)),
        height: Math.max(12, Number(el.height || 40)),
        rotation: Number(el.rotation || 0),
        flipX: Boolean(el.flipX),
        flipY: Boolean(el.flipY),
        text: String(el.text || ''),
        placeholder: String(el.placeholder || ''),
        bind: String(el.bind || ''),
        flatColor: String(el.flatColor || ''),
        textColor: String(el.textColor || '#ffffff'),
        spriteKey: String(el.spriteKey || ''),
        spriteFit: ['cover', 'contain', 'stretch'].includes(String(el.spriteFit || '').toLowerCase()) ? String(el.spriteFit).toLowerCase() : 'cover',
        opacity: Math.max(0, Math.min(1, Number(el.opacity == null ? 1 : el.opacity))),
        action: String(el.action || 'none'),
        targetMenu: String(el.targetMenu || ''),
        script: String(el.script || ''),
        fontSize: Number(el.fontSize || 16),
        align: String(el.align || 'center')
    };
    return out;
}

function normalizeMenusConfig(raw) {
    const payload = raw && typeof raw === 'object' ? raw : {};
    const menusRaw = payload.menus && typeof payload.menus === 'object' ? payload.menus : {};
    const menus = {};
    for (const [key, value] of Object.entries(menusRaw)) {
        if (!value || typeof value !== 'object') continue;
        const id = String(value.id || key).trim() || key;
        const elements = Array.isArray(value.elements) ? value.elements.map((el, i) => normalizeMenuElement(el, i)) : [];
        menus[id] = {
            id,
            title: String(value.title || id),
            backgroundColor: String(value.backgroundColor || '#000000'),
            elements
        };
    }
    const menuIds = Object.keys(menus);
    const defaultEscapeMenuId = String(payload.defaultEscapeMenu || '').trim() || (menuIds.includes('escape') ? 'escape' : (menuIds[0] || null));
    const startMenu = String(payload.startMenu || '').trim() || null;
    return {
        defaultEscapeMenu: defaultEscapeMenuId,
        startMenu,
        menus
    };
}

function isExclusiveMenuOpen(world) {
    return Boolean(world && world._internal && world._internal.menuSystem && world._internal.menuSystem.activeMenuId);
}

function closeExclusiveMenu(world) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys) return;
    sys.activeMenuId = null;
    sys.stack = [];
    if (sys.root) {
        sys.root.style.display = 'none';
        sys.root.innerHTML = '';
    }
    world._internal.simulationPaused = false;
    world._internal.keys = {};
    setRendererVisible(world, true);
    setGameplayUiVisible(world, true);
    if (document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
    }
}

function goBackExclusiveMenu(world) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys || !sys.stack.length) return closeExclusiveMenu(world);
    if (sys.stack.length <= 1) return closeExclusiveMenu(world);
    sys.stack.pop();
    const prev = sys.stack[sys.stack.length - 1];
    if (!prev) return closeExclusiveMenu(world);
    sys.activeMenuId = prev;
    renderExclusiveMenu(world);
}

function buildMenuText(world, menu, textRaw) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    const vars = sys && sys.vars ? sys.vars : {};
    const text = String(textRaw || '');
    return text.replace(/\{\{\s*([A-Za-z0-9_.$-]+)\s*\}\}/g, (_, token) => {
        if (token === 'gameName') return getConfiguredGameName() || getRomDisplayName() || 'maquina estatal';
        if (token === 'menu') return menu && menu.title ? menu.title : '';
        if (Object.prototype.hasOwnProperty.call(vars, token)) return String(vars[token] ?? '');
        return '';
    });
}

function runExclusiveMenuAction(world, menu, element) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys) return;
    const action = String(element.action || 'none').trim();
    if (action === 'close_menu') {
        closeExclusiveMenu(world);
        return;
    }
    if (action === 'back_menu') {
        goBackExclusiveMenu(world);
        return;
    }
    if (action === 'open_menu') {
        const next = String(element.targetMenu || '').trim();
        if (next) showExclusiveMenu(world, next, true);
        return;
    }
    if (action === 'script' && element.script) {
        try {
            const api = {
                closeMenu: () => closeExclusiveMenu(world),
                backMenu: () => goBackExclusiveMenu(world),
                openMenu: (id) => showExclusiveMenu(world, id, true),
                getVar: (k) => sys.vars[String(k)] ?? '',
                setVar: (k, v) => {
                    sys.vars[String(k)] = v;
                    renderExclusiveMenu(world);
                },
                exportMap: () => exportMap(world),
                importMap: () => requestMapImport(world),
                menuId: menu.id
            };
            const fn = new Function('api', 'world', 'menu', 'element', String(element.script));
            fn(api, world, menu, element);
        } catch (err) {
            console.error('Menu script error:', err);
        }
    }
}

function renderExclusiveMenu(world) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys || !sys.root) return;
    const menu = sys.config.menus[sys.activeMenuId];
    if (!menu) {
        closeExclusiveMenu(world);
        return;
    }
    const root = sys.root;
    root.innerHTML = '';
    root.style.display = 'block';
    root.style.background = menu.backgroundColor || '#000000';

    const layer = document.createElement('div');
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.overflow = 'hidden';
    root.appendChild(layer);

    for (const element of menu.elements) {
        const base = element.type === 'button'
            ? document.createElement('button')
            : (element.type === 'input' ? document.createElement('input') : document.createElement('div'));
        base.className = `exclusive-menu-element type-${element.type}`;
        base.style.position = 'absolute';
        base.style.left = `${element.x}px`;
        base.style.top = `${element.y}px`;
        base.style.width = `${Math.max(1, element.width)}px`;
        base.style.height = `${Math.max(1, element.height)}px`;
        base.style.transformOrigin = 'center center';
        const sx = element.flipX ? -1 : 1;
        const sy = element.flipY ? -1 : 1;
        base.style.transform = `rotate(${Number(element.rotation || 0)}deg) scale(${sx}, ${sy})`;
        base.style.border = '1px solid rgba(255,255,255,0.25)';
        base.style.backgroundColor = element.flatColor || 'rgba(255,255,255,0.05)';
        base.style.color = element.textColor || '#ffffff';
        base.style.fontSize = `${Math.max(8, Number(element.fontSize || 16))}px`;
        base.style.fontFamily = '"Courier New", monospace';
        base.style.display = 'flex';
        base.style.alignItems = 'center';
        base.style.justifyContent = element.align === 'left' ? 'flex-start' : (element.align === 'right' ? 'flex-end' : 'center');
        base.style.padding = element.type === 'input' ? '0 8px' : '4px 8px';
        base.style.boxSizing = 'border-box';
        base.style.userSelect = 'none';
        base.style.opacity = String(Math.max(0, Math.min(1, Number(element.opacity == null ? 1 : element.opacity))));

        const spriteUrl = element.spriteKey ? resolvePreviewTextureUrl(element.spriteKey) : null;
        if (spriteUrl) {
            base.style.backgroundImage = `url("${spriteUrl}")`;
            base.style.backgroundSize = element.spriteFit === 'contain' ? 'contain' : (element.spriteFit === 'stretch' ? '100% 100%' : 'cover');
            base.style.backgroundPosition = 'center';
            base.style.backgroundRepeat = 'no-repeat';
        }

        if (element.type === 'input') {
            base.type = 'text';
            base.placeholder = element.placeholder || '';
            if (element.bind) {
                base.value = String(sys.vars[element.bind] || '');
                base.addEventListener('input', () => {
                    sys.vars[element.bind] = base.value;
                    const labels = layer.querySelectorAll('.exclusive-menu-element.type-text');
                    labels.forEach((el) => {
                        if (el.dataset.template) {
                            el.textContent = buildMenuText(world, menu, el.dataset.template);
                        }
                    });
                });
            }
        } else {
            const text = buildMenuText(world, menu, element.text || '');
            base.textContent = text;
            if (element.type === 'text') {
                base.dataset.template = String(element.text || '');
                base.style.pointerEvents = 'none';
                base.style.border = 'none';
                base.style.backgroundColor = element.flatColor || 'transparent';
            } else if (element.type === 'image') {
                base.textContent = '';
                base.style.pointerEvents = 'none';
                base.style.border = 'none';
                if (!spriteUrl) base.style.backgroundColor = element.flatColor || 'transparent';
            }
        }

        if (element.type === 'button') {
            base.style.cursor = 'pointer';
            base.addEventListener('click', (ev) => {
                ev.preventDefault();
                runExclusiveMenuAction(world, menu, element);
            });
        }

        layer.appendChild(base);
    }
}

function showExclusiveMenu(world, menuId, pushStack = true) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys) return false;
    const id = String(menuId || '').trim();
    if (!id || !sys.config.menus[id]) return false;
    if (pushStack) {
        if (!sys.stack.length || sys.stack[sys.stack.length - 1] !== id) {
            sys.stack.push(id);
        }
    } else {
        sys.stack = [id];
    }
    sys.activeMenuId = id;
    world._internal.simulationPaused = true;
    world._internal.keys = {};
    if (document.pointerLockElement === document.body) {
        document.exitPointerLock();
    }
    setRendererVisible(world, false);
    setGameplayUiVisible(world, false);
    renderExclusiveMenu(world);
    return true;
}

function ensureExclusiveMenuRoot(world) {
    let root = document.getElementById('exclusive-menu-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'exclusive-menu-root';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.zIndex = '70';
    root.style.display = 'none';
    root.style.pointerEvents = 'auto';
    root.style.background = '#000';
    document.body.appendChild(root);
    return root;
}

function initializeExclusiveMenus(world) {
    const config = normalizeMenusConfig(MENUS);
    world._internal.menuSystem = {
        config,
        root: ensureExclusiveMenuRoot(world),
        activeMenuId: null,
        stack: [],
        lastPointerLocked: document.pointerLockElement === document.body,
        vars: {
            saveName: ''
        }
    };
}

function handleExclusiveMenuKeyDown(world, e) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys) return false;
    if (e.code === 'Escape') {
        e.preventDefault();
        if (isExclusiveMenuOpen(world)) {
            if (sys.stack.length > 1) goBackExclusiveMenu(world);
            else closeExclusiveMenu(world);
        } else if (sys.config.defaultEscapeMenu) {
            showExclusiveMenu(world, sys.config.defaultEscapeMenu, false);
        }
        return true;
    }
    if (isExclusiveMenuOpen(world)) {
        if (e.code !== 'F8') {
            e.preventDefault();
            return true;
        }
    }
    return false;
}

function handlePointerLockChangeForMenus(world) {
    const sys = world && world._internal ? world._internal.menuSystem : null;
    if (!sys) return;
    if (isMobile()) return;
    const isLocked = document.pointerLockElement === document.body;
    const wasLocked = Boolean(sys.lastPointerLocked);
    sys.lastPointerLocked = isLocked;
    if (isLocked) return;
    if (!wasLocked) return;
    if (isExclusiveMenuOpen(world)) return;
    if (world.mode !== 'game') return;
    if (world._internal.simulationPaused) return;
    if (!sys.config.defaultEscapeMenu) return;
    showExclusiveMenu(world, sys.config.defaultEscapeMenu, false);
}

function normalizeUiLayoutElement(el = {}, index = 0) {
    const type = String(el.type || 'text').toLowerCase();
    return {
        id: String(el.id || `ui_el_${index}`),
        type: (type === 'button' || type === 'input' || type === 'text' || type === 'image') ? type : 'text',
        x: Number(el.x || 0),
        y: Number(el.y || 0),
        anchorX: String(el.anchorX || 'left') === 'right' ? 'right' : 'left',
        anchorY: String(el.anchorY || 'top') === 'bottom' ? 'bottom' : 'top',
        width: Math.max(4, Number(el.width || 100)),
        height: Math.max(4, Number(el.height || 28)),
        rotation: Number(el.rotation || 0),
        flipX: Boolean(el.flipX),
        flipY: Boolean(el.flipY),
        text: String(el.text || ''),
        placeholder: String(el.placeholder || ''),
        bind: String(el.bind || ''),
        flatColor: String(el.flatColor || 'transparent'),
        textColor: String(el.textColor || '#ffffff'),
        spriteKey: String(el.spriteKey || ''),
        spriteVar: String(el.spriteVar || ''),
        spriteFit: ['cover', 'contain', 'stretch'].includes(String(el.spriteFit || '').toLowerCase()) ? String(el.spriteFit).toLowerCase() : 'cover',
        opacity: Math.max(0, Math.min(1, Number(el.opacity == null ? 1 : el.opacity))),
        style: (el.style && typeof el.style === 'object' && !Array.isArray(el.style)) ? { ...el.style } : {},
        fontSize: Math.max(8, Number(el.fontSize || 14)),
        align: String(el.align || 'center'),
        action: String(el.action || 'none'),
        keyCode: String(el.keyCode || ''),
        targetMenu: String(el.targetMenu || ''),
        script: String(el.script || '')
    };
}

function applyInlineStyleObject(node, styleObj) {
    if (!node || !styleObj || typeof styleObj !== 'object') return;
    for (const [key, value] of Object.entries(styleObj)) {
        if (value == null) continue;
        try {
            node.style[key] = String(value);
        } catch {
            // ignore invalid css prop names
        }
    }
}

function normalizeUiLayoutConfig(raw) {
    const payload = raw && typeof raw === 'object' ? raw : {};
    const layersRaw = payload.layers && typeof payload.layers === 'object' ? payload.layers : {};
    const layers = {};
    for (const [key, layer] of Object.entries(layersRaw)) {
        if (!layer || typeof layer !== 'object') continue;
        const id = String(layer.id || key);
        const elements = Array.isArray(layer.elements) ? layer.elements.map((el, i) => normalizeUiLayoutElement(el, i)) : [];
        layers[id] = { id, elements };
    }
    if (!layers.hud) layers.hud = { id: 'hud', elements: [] };
    if (!layers.mobile) layers.mobile = { id: 'mobile', elements: [] };
    return {
        enabled: payload.enabled !== false,
        layers
    };
}

function ensureUiLayoutRoot() {
    let root = document.getElementById('ui-layout-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ui-layout-root';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '25';
    document.body.appendChild(root);
    return root;
}

function buildUiLayoutText(world, template) {
    const sys = world && world._internal ? world._internal.uiLayoutSystem : null;
    const vars = sys && sys.vars ? sys.vars : {};
    const text = String(template || '');
    return text.replace(/\{\{\s*([A-Za-z0-9_.$-]+)\s*\}\}/g, (_, token) => String(vars[token] ?? ''));
}

function handleUiLayoutAction(world, element, phase, pointerEvent = null) {
    if (!element) return;
    const action = String(element.action || 'none');
    const keyCode = String(element.keyCode || '');
    if (action === 'key_hold' && keyCode) {
        world._internal.keys[keyCode] = phase === 'down';
        return;
    }
    if (action === 'down_hold') {
        const downKey = world.mode === 'editor' ? 'ControlLeft' : 'KeyC';
        world._internal.keys[downKey] = phase === 'down';
        return;
    }
    if (phase !== 'down') return;
    if (action === 'primary_action') {
        primaryAction(world);
        return;
    }
    if (action === 'secondary_action') {
        secondaryAction(world);
        return;
    }
    if (action === 'jump') {
        const player = world.getPlayerEntity();
        if (!player) return;
        if (world.mode === 'editor') world._internal.keys['Space'] = true;
        else if (player.onGround) {
            player.velocityY = CONFIG.JUMP_FORCE;
            player.onGround = false;
        }
        return;
    }
    if (action === 'drop_selected') {
        dropSelectedBlock(world);
        return;
    }
    if (action === 'step_prev') {
        stepSelection(world, -1);
        return;
    }
    if (action === 'step_next') {
        stepSelection(world, 1);
        return;
    }
    if (action === 'toggle_mode') {
        const nextMode = world.mode === 'editor' ? 'game' : 'editor';
        setWorldMode(world, nextMode);
        return;
    }
    if (action === 'export_map') {
        exportMap(world);
        return;
    }
    if (action === 'import_map') {
        requestMapImport(world);
        return;
    }
    if (action === 'open_editor_menu') {
        if (world.mode !== 'editor') return;
        openEditorContextMenu(world, {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
        });
        return;
    }
    if (action === 'open_menu') {
        if (element.targetMenu) showExclusiveMenu(world, element.targetMenu, false);
        return;
    }
    if (action === 'script' && element.script) {
        try {
            const api = {
                primaryAction: () => primaryAction(world),
                secondaryAction: () => secondaryAction(world),
                dropSelected: () => dropSelectedBlock(world),
                stepPrev: () => stepSelection(world, -1),
                stepNext: () => stepSelection(world, 1),
                setKey: (k, v) => { world._internal.keys[String(k)] = !!v; },
                openMenu: (id) => showExclusiveMenu(world, id, false),
                closeMenu: () => closeExclusiveMenu(world),
                mode: world.mode
            };
            const fn = new Function('api', 'world', 'element', 'event', String(element.script));
            fn(api, world, element, pointerEvent);
        } catch (err) {
            console.error('ui-layout script error:', err);
        }
    }
}

function renderUiLayoutLayer(world, layerId) {
    const sys = world && world._internal ? world._internal.uiLayoutSystem : null;
    if (!sys || !sys.root) return;
    const layer = sys.config.layers[layerId];
    if (!layer) return;
    const old = sys.layerNodes[layerId];
    if (old && old.parentElement) old.parentElement.removeChild(old);
    const host = document.createElement('div');
    host.className = `ui-layout-layer ui-layout-layer-${layerId}`;
    host.style.position = 'absolute';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    for (const element of layer.elements) {
        const node = element.type === 'input' ? document.createElement('input') : (element.type === 'button' ? document.createElement('button') : document.createElement('div'));
        node.dataset.uiElementId = element.id;
        node.style.position = 'absolute';
        node.style.left = element.anchorX === 'right' ? 'auto' : `${element.x}px`;
        node.style.right = element.anchorX === 'right' ? `${element.x}px` : 'auto';
        node.style.top = element.anchorY === 'bottom' ? 'auto' : `${element.y}px`;
        node.style.bottom = element.anchorY === 'bottom' ? `${element.y}px` : 'auto';
        node.style.width = `${element.width}px`;
        node.style.height = `${element.height}px`;
        node.style.transformOrigin = 'center center';
        node.style.transform = `rotate(${element.rotation}deg) scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})`;
        node.style.background = element.flatColor || 'transparent';
        node.style.color = element.textColor || '#fff';
        node.style.border = element.type === 'button' || element.type === 'input' ? '1px solid rgba(255,255,255,0.24)' : 'none';
        node.style.fontFamily = '"Courier New", monospace';
        node.style.fontSize = `${element.fontSize}px`;
        node.style.display = 'flex';
        node.style.alignItems = 'center';
        node.style.justifyContent = element.align === 'left' ? 'flex-start' : (element.align === 'right' ? 'flex-end' : 'center');
        node.style.whiteSpace = 'pre-wrap';
        node.style.padding = '4px 8px';
        node.style.boxSizing = 'border-box';
        node.style.pointerEvents = (element.type === 'text' || element.type === 'image') ? 'none' : 'auto';
        node.style.opacity = String(Math.max(0, Math.min(1, Number(element.opacity == null ? 1 : element.opacity))));
        applyInlineStyleObject(node, element.style);

        const spriteKey = element.spriteVar ? String(sys.vars[element.spriteVar] || '') : element.spriteKey;
        const spriteUrl = spriteKey ? resolvePreviewTextureUrl(spriteKey) : null;
        if (spriteUrl) {
            node.style.backgroundImage = `url("${spriteUrl}")`;
            node.style.backgroundSize = element.spriteFit === 'contain' ? 'contain' : (element.spriteFit === 'stretch' ? '100% 100%' : 'cover');
            node.style.backgroundPosition = 'center';
            node.style.backgroundRepeat = 'no-repeat';
        }

        if (element.type === 'input') {
            node.type = 'text';
            node.placeholder = element.placeholder || '';
            if (element.bind) node.value = String(sys.vars[element.bind] || '');
            node.addEventListener('input', () => {
                if (element.bind) sys.vars[element.bind] = node.value;
                updateUiLayoutRuntime(world);
            });
        } else if (element.type === 'image') {
            node.textContent = '';
        } else {
            const tpl = element.type === 'text' ? element.text : (element.text || '');
            node.textContent = buildUiLayoutText(world, tpl);
            if (element.type === 'text') node.dataset.template = tpl;
        }

        if (element.type === 'button') {
            node.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                handleUiLayoutAction(world, element, 'down', ev);
            });
            node.addEventListener('pointerup', (ev) => {
                ev.preventDefault();
                handleUiLayoutAction(world, element, 'up', ev);
            });
            node.addEventListener('pointercancel', () => handleUiLayoutAction(world, element, 'up'));
            node.addEventListener('pointerleave', () => handleUiLayoutAction(world, element, 'up'));
        }

        if (element.action === 'look_drag' && element.type === 'button') {
            node.style.touchAction = 'none';
            let activePointer = null;
            let lastX = 0;
            let lastY = 0;
            node.addEventListener('pointerdown', (ev) => {
                activePointer = ev.pointerId;
                lastX = ev.clientX;
                lastY = ev.clientY;
                node.setPointerCapture(ev.pointerId);
            });
            node.addEventListener('pointermove', (ev) => {
                if (activePointer !== ev.pointerId) return;
                const player = world.getPlayerEntity();
                if (!player) return;
                const dx = ev.clientX - lastX;
                const dy = ev.clientY - lastY;
                lastX = ev.clientX;
                lastY = ev.clientY;
                player.yaw -= dx * CONFIG.LOOK_SPEED;
                player.pitch -= dy * CONFIG.LOOK_SPEED;
                player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
            });
            const end = (ev) => {
                if (activePointer !== ev.pointerId) return;
                activePointer = null;
            };
            node.addEventListener('pointerup', end);
            node.addEventListener('pointercancel', end);
        }

        host.appendChild(node);
    }
    sys.root.appendChild(host);
    sys.layerNodes[layerId] = host;
}

function initializeUiLayoutSystem(world) {
    const config = normalizeUiLayoutConfig(UI_LAYOUT);
    world._internal.uiLayoutSystem = {
        enabled: config.enabled !== false,
        config,
        root: ensureUiLayoutRoot(),
        layerNodes: {},
        vars: {}
    };
    if (!world._internal.uiLayoutSystem.enabled) return;
    renderUiLayoutLayer(world, 'hud');
    if (isMobile()) renderUiLayoutLayer(world, 'mobile');
}

function refreshUiLayoutSystemFromConfig(world) {
    const sys = world && world._internal ? world._internal.uiLayoutSystem : null;
    if (!sys) return;
    sys.config = normalizeUiLayoutConfig(UI_LAYOUT);
    sys.enabled = sys.config.enabled !== false;
    if (!sys.root) sys.root = ensureUiLayoutRoot();
    if (!sys.enabled) {
        sys.root.style.display = 'none';
        sys.root.innerHTML = '';
        sys.layerNodes = {};
        return;
    }
    sys.root.innerHTML = '';
    sys.layerNodes = {};
    renderUiLayoutLayer(world, 'hud');
    if (isMobile()) renderUiLayoutLayer(world, 'mobile');
    updateUiLayoutRuntime(world);
}

function updateUiLayoutRuntime(world) {
    const sys = world && world._internal ? world._internal.uiLayoutSystem : null;
    if (!sys || !sys.enabled || !sys.root) return;
    const player = world.getPlayerEntity();
    const showingExclusive = isExclusiveMenuOpen(world);
    sys.root.style.display = showingExclusive ? 'none' : 'block';
    const hudLayer = sys.layerNodes.hud;
    const mobileLayer = sys.layerNodes.mobile;
    if (hudLayer) hudLayer.style.display = world.mode === 'game' ? 'block' : 'none';
    if (mobileLayer) mobileLayer.style.display = (world.mode === 'game' && isMobile()) ? 'block' : 'none';
    if (showingExclusive) return;
    if (!player) {
        sys.vars.playerName = 'A.S.S';
        sys.vars.playerPortraitTexture = 'ui_player_face';
        sys.vars.hp = 0;
        sys.vars.hpMax = 1;
        sys.vars.itemName = '-';
        sys.vars.itemCount = '-';
        sys.vars.selectedItemTexture = '';
        sys.vars.selectedHandTexture = 'ui_empty_hand';
        sys.vars.itemLine = 'Item: - x-';
        sys.vars.hpLine = 'HP: -';
        sys.vars.coinsLine = 'Coins: -';
        sys.vars.hudStatsText = 'HP: -\nItem: -\nCoins: -';
        sys.vars.mode = String(world.mode || 'game');
        return;
    }

    let itemName = '-';
    let itemCount = '-';
    let previewSpriteKey = '';
    let handSpriteKey = '';
    let useEmptyHand = true;
    if (player.selectedItem) {
        if (player.selectedItem.kind === 'block') {
            const bt = Object.values(BLOCK_TYPES).find((b) => b.id === player.selectedItem.id);
            itemName = bt ? bt.name : '-';
            itemCount = player.inventory ? (player.inventory[player.selectedItem.id] || 0) : 0;
            previewSpriteKey = bt && bt.textures ? (bt.textures.all || bt.textures.top || '') : '';
            handSpriteKey = bt ? (bt.handTextureKey || '') : '';
            useEmptyHand = !handSpriteKey;
        } else if (player.selectedItem.kind === 'item') {
            const it = Object.values(ITEMS).find((x) => x.id === player.selectedItem.id);
            itemName = it ? it.name : '-';
            itemCount = player.itemInventory ? (player.itemInventory[player.selectedItem.id] || 0) : 0;
            previewSpriteKey = it ? (it.uiTextureKey || it.textureKey || '') : '';
            handSpriteKey = it ? (it.handTextureKey || '') : '';
            useEmptyHand = !handSpriteKey;
        } else if (player.selectedItem.kind === 'empty') {
            itemName = 'Mãos';
            itemCount = '-';
            previewSpriteKey = 'ui_empty_hand';
            useEmptyHand = true;
        } else if (player.selectedItem.kind === 'entity') {
            itemName = 'Spawner';
            itemCount = '-';
            const npcType = getNpcTypeById(player.selectedItem.npcTypeId);
            previewSpriteKey = npcType ? (npcType.texture || '') : '';
            useEmptyHand = false;
        }
    } else if (player.selectedBlockType) {
        previewSpriteKey = getBlockThumbnailTextureKey(player.selectedBlockType) || '';
        handSpriteKey = player.selectedBlockType.handTextureKey || '';
        useEmptyHand = !handSpriteKey;
        itemName = player.selectedBlockType.name || '-';
        itemCount = player.inventory ? (player.inventory[player.selectedBlockType.id] || 0) : 0;
    }
    const emptyHandKeyCandidates = ['empty-hand', 'empty_hand', 'ui_empty_hand'];
    let emptyHandKey = 'ui_empty_hand';
    for (const candidate of emptyHandKeyCandidates) {
        if (resolvePreviewTextureUrl(candidate) || isGeneratedUiTextureKey(candidate)) {
            emptyHandKey = candidate;
            break;
        }
    }
    const finalHandSprite = handSpriteKey || (useEmptyHand ? emptyHandKey : '');

    sys.vars.playerName = String(player.name || 'A.S.S');
    sys.vars.playerPortraitTexture = String(player.uiPortraitKey || 'ui_player_face');
    sys.vars.hp = Math.max(0, Math.round(Number(player.hp || 0)));
    sys.vars.hpMax = Math.max(1, Math.round(Number(player.maxHP || 1)));
    sys.vars.itemName = String(itemName || '-');
    sys.vars.itemCount = String(itemCount);
    sys.vars.selectedItemTexture = String(previewSpriteKey || '');
    sys.vars.selectedHandTexture = String(finalHandSprite || '');
    sys.vars.itemLine = `Item: ${itemName || '-'} x${itemCount}`;
    sys.vars.hpLine = `HP: ${sys.vars.hp}/${sys.vars.hpMax}`;
    sys.vars.coinsLine = 'Coins: -';
    sys.vars.hudStatsText = `${sys.vars.hpLine}\n${sys.vars.itemLine}\n${sys.vars.coinsLine}`;
    sys.vars.mode = String(world.mode || 'game');

    for (const layerId of Object.keys(sys.layerNodes)) {
        const layerNode = sys.layerNodes[layerId];
        if (!layerNode) continue;
        const layer = sys.config.layers[layerId];
        if (!layer) continue;
        for (const element of layer.elements) {
            const node = layerNode.querySelector(`[data-ui-element-id="${element.id}"]`);
            if (!node) continue;
            if (element.type === 'text') {
                node.textContent = buildUiLayoutText(world, element.text || '');
            } else if (element.type === 'input') {
                if (element.bind && document.activeElement !== node) {
                    node.value = String(sys.vars[element.bind] || '');
                }
            }
            const spriteKey = element.spriteVar ? String(sys.vars[element.spriteVar] || '') : element.spriteKey;
            const spriteUrl = spriteKey ? resolvePreviewTextureUrl(spriteKey) : null;
            if (spriteUrl) {
                node.style.backgroundImage = `url("${spriteUrl}")`;
                node.style.backgroundSize = element.spriteFit === 'contain' ? 'contain' : (element.spriteFit === 'stretch' ? '100% 100%' : 'cover');
                node.style.backgroundPosition = 'center';
                node.style.backgroundRepeat = 'no-repeat';
            } else if (!element.spriteKey && !element.spriteVar) {
                node.style.backgroundImage = '';
            } else if (element.spriteVar && !sys.vars[element.spriteVar]) {
                node.style.backgroundImage = '';
            }
            node.style.opacity = String(Math.max(0, Math.min(1, Number(element.opacity == null ? 1 : element.opacity))));
        }
    }
}

const INVENTORY_CATEGORIES = [
    { id: 'item', label: 'Itens' },
    { id: 'block', label: 'Blocos' }
];

let inventoryEditorState = null;
// ============================================================
// INICIALIZAÇÃO
// ============================================================
function getFactionName(factionId) {
    const entry = Object.values(FACTIONS).find((faction) => faction.id === factionId);
    return entry ? entry.name : factionId;
}

function getRandomNamePart() {
    const names = vocabulario.nomes;
    for (let attempt = 0; attempt < 30; attempt++) {
        const raw = names[Math.floor(Math.random() * names.length)] || '';
        const clean = raw.replace(/[^a-záéíóúâêôãõç]/gi, '');
        if (clean.length >= 2) return clean;
    }
    return 'SemNome';
}

function generateUniqueName(world) {
    const used = world._internal.usedNames;
    for (let attempt = 0; attempt < 80; attempt++) {
        const first = getRandomNamePart();
        const last = getRandomNamePart();
        const useSurname = Math.random() < 0.55 && last !== first;
        const name = useSurname ? `${first} ${last}` : first;
        if (!used.has(name)) {
            used.add(name);
            return name;
        }
    }
    const fallback = `SemNome${used.size + 1}`;
    used.add(fallback);
    return fallback;
}

function ensureUniqueName(world, name) {
    const used = world._internal.usedNames;
    if (!name) return generateUniqueName(world);
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    return generateUniqueName(world);
}

async function init() {
    showLoadingOverlay('Carregando ROM...');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 1, 50);
    
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.03,
        1000
    );
    
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(1);
    document.body.appendChild(renderer.domElement);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);
    
    world._internal.scene = scene;
    world._internal.camera = camera;
    world._internal.renderer = renderer;
    const bootMode = getModeFromLocation();
    world._internal.integrated = bootMode === 'integrated';
    world.mode = bootMode === 'integrated' ? 'game' : bootMode;
    world._internal.simulationPaused = true;
    setRendererVisible(world, false);
    document.body.dataset.mode = world.mode;
    updateDocumentTitleForMode(world.mode);
    initializeUiLayoutSystem(world);
    if (!world._internal.uiLayoutSystem || !world._internal.uiLayoutSystem.enabled) {
        ensureItemLabel();
        ensureHud();
        ensureHandOverlay();
    }
    initializeExclusiveMenus(world);
    setGameplayUiVisible(world, false);
    setupRenderDebugHotkey(world);
    if (!world._internal.uiLayoutSystem || !world._internal.uiLayoutSystem.enabled) {
        setupMobileControls(world);
    }

    await maybeLoadRomAtBoot();
    refreshUiLayoutSystemFromConfig(world);
    updateDocumentTitleForMode(world.mode);
    
    initAudioOnFirstGesture();
    
    showLoadingOverlay('Carregando texturas...');
    loadTextures(world);
    
    window.addEventListener('resize', () => onWindowResize(world));
    document.addEventListener('keydown', (e) => onKeyDown(world, e));
    document.addEventListener('keyup', (e) => world._internal.keys[e.code] = false);
    document.addEventListener('wheel', (e) => onWheel(world, e), { passive: false });
    document.addEventListener('pointerlockchange', () => handlePointerLockChangeForMenus(world));
    
    document.addEventListener('click', (event) => {
        if (isMobile()) return;
        if (isExclusiveMenuOpen(world)) return;
        const menu = document.getElementById('editor-context-menu');
        if (menu && menu.style.display === 'block') return;
        const picker = document.getElementById('editor-picker-panel');
        if (picker && picker.style.display === 'block') return;
        if (isInventoryEditorOpen()) return;
        document.body.requestPointerLock();
});
    
    document.addEventListener('mousemove', (e) => onMouseMove(world, e));
    document.addEventListener('mousedown', (e) => onMouseDown(world, e));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    animate(world);
}

function setupRenderDebugHotkey(world) {
    if (window.__RENDER_DEBUG_HOTKEY__) return;
    window.__RENDER_DEBUG_HOTKEY__ = true;
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'F9') return;
        const next = !world._internal.useTerrainMesh;
        world.setTerrainRenderEnabled(next);
    });
}

// ============================================================
// INICIALIZAÇÃO DE ÁUDIO
// ============================================================
async function initAudio() {
    try {
        await audioSystem.init();
        const masterBank = ROM_RUNTIME.assetUrlByPath['audio/Master.bank'];
        const stringsBank = ROM_RUNTIME.assetUrlByPath['audio/Master.strings.bank'];
        if (masterBank) await audioSystem.loadBank(masterBank, true);
        if (stringsBank) await audioSystem.loadBank(stringsBank, false);
        const configuredBanks = Array.isArray(ROM_AUDIO_CONFIG.banks) ? ROM_AUDIO_CONFIG.banks : [];
        for (const bank of configuredBanks) {
            if (bank && bank.autoLoad === false) continue;
            const rawPath = String((bank && bank.path) || '').trim();
            if (!rawPath) continue;
            const normalized = normalizeRomPath(rawPath).replace(/^data\//, '');
            if (normalized === 'audio/Master.bank' || normalized === 'audio/Master.strings.bank') continue;
            const bankUrl = ROM_RUNTIME.assetUrlByPath[normalized] || ROM_RUNTIME.assetUrlByPath[`data/${normalized}`];
            if (!bankUrl) continue;
            await audioSystem.loadBank(bankUrl, bank.loadSamples !== false);
        }
        
        console.log('✅ Audio FMOD ready');
    } catch (error) {
        console.warn('⚠️ FMOD não disponível - jogo rodando sem áudio');
        console.warn('Para habilitar áudio: baixe FMOD em https://www.fmod.com/download');
    }
}

function initAudioOnFirstGesture() {
    let started = false;
    const start = async () => {
        if (started) return;
        started = true;
        window.removeEventListener('pointerdown', start);
        window.removeEventListener('keydown', start);
        await initAudio();
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
}

// ============================================================
// CARREGAMENTO DE TEXTURAS
// ============================================================
function finalizeWorldBootstrap(world) {
    const menuSystem = world && world._internal ? world._internal.menuSystem : null;
    const startMenuId = menuSystem && menuSystem.config ? menuSystem.config.startMenu : null;
    if (startMenuId) {
        showExclusiveMenu(world, startMenuId, false);
    } else {
        world._internal.simulationPaused = false;
        setRendererVisible(world, true);
        setGameplayUiVisible(world, true);
    }
    hideLoadingOverlay();
}

function loadTextures(world) {
    const loader = new THREE.TextureLoader();
    let loaded = 0;
    const total = texturesToLoad.length;

    if (total === 0) {
        world._internal.texturesLoaded = true;
        showLoadingOverlay('Gerando terreno…');
        initWorld(world).then(() => {
            finalizeWorldBootstrap(world);
        }).catch((err) => {
            world._internal.simulationPaused = false;
            console.error(err);
            setRendererVisible(world, true);
            setGameplayUiVisible(world, true);
            hideLoadingOverlay();
        });
        return;
    }
    
    function checkLoaded() {
        loaded++;
        if (loaded === total) {
            world._internal.texturesLoaded = true;
            showLoadingOverlay('Gerando terreno…');
            initWorld(world).then(() => {
                finalizeWorldBootstrap(world);
            }).catch((err) => {
                world._internal.simulationPaused = false;
                console.error(err);
                setRendererVisible(world, true);
                setGameplayUiVisible(world, true);
                hideLoadingOverlay();
            });
        }
    }
    
    function createFallbackTextureForKey(key) {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const colors = {
            'stone': '#808080',
            'grass': '#228B22',
            'wood': '#8B4513',
            'dirt': '#654321',
            'gold': '#FFD700',
            'door': '#654321',
            'sand': '#C2B280'
        };
        if (ctx) {
            ctx.fillStyle = colors[key] || '#888888';
            ctx.fillRect(0, 0, 16, 16);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }

    texturesToLoad.forEach(({ key, url }) => {
        const loadUrl = resolveTextureLoadUrl(key, url);
        if (!loadUrl) {
            world._internal.blockTextures[key] = createFallbackTextureForKey(key);
            checkLoaded();
            return;
        }
        loader.load(loadUrl, (tex) => {
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            world._internal.blockTextures[key] = tex;
            checkLoaded();
        }, undefined, () => {
            world._internal.blockTextures[key] = createFallbackTextureForKey(key);
            checkLoaded();
        });
    });
}

// ============================================================
// CRIAÇÃO DO MUNDO E ENTIDADES
// ============================================================
async function initWorld(world) {
    createPlayer(world);
    if (world.mode === 'editor') {
        const payload = buildEditorDefaultMap();
        applyMap(world, payload);
    } else {
        await loadInitialMap(world);
    }
    updateCurrentItemLabel(world);
    if (world._internal.useTerrainMesh && (world._internal.terrainBuilding || world._internal.dirtyChunks.size > 0 || world._internal.terrainBuildTimer)) {
        await new Promise((resolve) => {
            world._internal.onTerrainReady = resolve;
        });
    }
}

function createPlayer(world) {
    const isEditor = world.mode === 'editor';
    const spawnBlockType = getPreferredBlockType('GRASS', 'STONE');
    const playerNpcData = {
        texture: 'npc',
        width: 0.8,
        height: 1.6
    };
    const editorInventory = {};
    if (isEditor && spawnBlockType) {
        editorInventory[spawnBlockType.id] = 999;
    }

    world.addEntity({
        name: 'A.S.S',
        type: 'player',
        x: 7.5,
        y: 2,
        z: 5.5,
        isControllable: true,
        isInteractable: false,
        isEditor: isEditor,
        noClip: isEditor,
        inventory: isEditor ? editorInventory : {},
        itemInventory: isEditor ? {} : {
            revolver: 24,
            cuscuz: 6,
            pedra: 12
        },
        selectedBlockType: isEditor ? spawnBlockType : null,
        selectedItem: isEditor
            ? { kind: 'block', id: spawnBlockType ? spawnBlockType.id : 0 }
            : { kind: 'empty' },
        entitySpawners: [],
        npcData: playerNpcData,
        hp: isEditor ? 999999 : 100,
        maxHP: isEditor ? 999999 : 100,
        faction: getPlayerFactionId(),
        uiPortraitKey: 'ui_player_face'
    });
}

function createNpcEntity(world, npcType, position, nameOverride = null, factionOverride = null, options = {}) {
    const entityName = nameOverride ? ensureUniqueName(world, nameOverride) : generateUniqueName(world);
    const normalizeInventoryObject = (obj) => {
        const out = {};
        if (!obj || typeof obj !== 'object') return out;
        for (const [k, v] of Object.entries(obj)) {
            const qty = Math.max(0, Math.floor(Number(v) || 0));
            if (!qty) continue;
            out[String(k)] = qty;
        }
        return out;
    };
    const getFactionDefaultPresetKey = (factionId) => {
        const id = String(factionId || '').trim();
        if (!id) return '';
        const factionEntry = Object.values(FACTIONS || {}).find((f) => f && String(f.id || '') === id) || null;
        if (!factionEntry) return '';
        return String(factionEntry.defaultInventoryPresetKey || '').trim();
    };
    const getNpcDefaultPresetKey = () => {
        const byNpc = String(npcType && npcType.defaultInventoryPresetKey || '').trim();
        if (byNpc) return byNpc;
        return getFactionDefaultPresetKey(factionOverride || npcType.faction || 'neutral');
    };
    const getPresetPayload = (presetKey) => {
        const key = String(presetKey || '').trim();
        if (!key) return null;
        const preset = ROM_INVENTORY_PRESETS && ROM_INVENTORY_PRESETS[key];
        if (!preset || typeof preset !== 'object') return null;
        return {
            inventory: normalizeInventoryObject(preset.inventory),
            itemInventory: normalizeInventoryObject(preset.itemInventory)
        };
    };

    const hasInventoryOverride = options.inventory && typeof options.inventory === 'object';
    const hasItemInventoryOverride = options.itemInventory && typeof options.itemInventory === 'object';
    const defaultPreset = getPresetPayload(getNpcDefaultPresetKey());
    const inventory = (!hasInventoryOverride && defaultPreset) ? { ...(defaultPreset.inventory || {}) } : {};
    if (npcType.inventory && typeof npcType.inventory === 'object') {
        Object.assign(inventory, npcType.inventory);
    } else if (npcType.blockDrops && typeof npcType.blockDrops === 'object') {
        for (const [blockKey, count] of Object.entries(npcType.blockDrops)) {
            const blockType = BLOCK_TYPES[blockKey];
            if (!blockType) continue;
            const qty = Math.max(0, Math.floor(Number(count) || 0));
            if (qty <= 0) continue;
            inventory[blockType.id] = qty;
        }
    }
    if (hasInventoryOverride) {
        Object.assign(inventory, options.inventory);
    }
    const itemInventory = (!hasItemInventoryOverride && defaultPreset) ? { ...(defaultPreset.itemInventory || {}) } : {};
    const npcItemBase = npcType.itemDrops || npcType.itemInventory || {};
    if (npcItemBase && typeof npcItemBase === 'object') {
        Object.assign(itemInventory, normalizeInventoryObject(npcItemBase));
    }
    if (hasItemInventoryOverride) {
        Object.assign(itemInventory, normalizeInventoryObject(options.itemInventory));
    }
    const disableFallback = options && options.disableInventoryFallback;
    if (!Object.keys(inventory).length && !disableFallback) {
        const faction = factionOverride || npcType.faction || 'neutral';
        const fallbackByFaction = {
            village: BLOCK_TYPES.WOOD,
            guard: BLOCK_TYPES.STONE,
            outlaw: BLOCK_TYPES.WOOD,
            beast: BLOCK_TYPES.GRASS,
            aquatic: BLOCK_TYPES.SAND,
            undead: BLOCK_TYPES.STONE,
            demon: BLOCK_TYPES.GOLD,
            plant: BLOCK_TYPES.PLANT,
            construct: BLOCK_TYPES.STONE,
            neutral: BLOCK_TYPES.STONE
        };
        const fallback = fallbackByFaction[faction] || BLOCK_TYPES.STONE;
        inventory[fallback.id] = 50;
    }
    let selectedBlockType = null;
    let bestDamage = -Infinity;
    for (const blockType of Object.values(BLOCK_TYPES)) {
        const count = inventory[blockType.id] || 0;
        if (count <= 0 || blockType.droppable === false) continue;
        const damage = typeof blockType.breakDamage === 'number' ? blockType.breakDamage : 0;
        if (damage > bestDamage) {
            bestDamage = damage;
            selectedBlockType = blockType;
        }
    }
    if (options.selectedBlockTypeId) {
        const forced = Object.values(BLOCK_TYPES).find((b) => b.id === options.selectedBlockTypeId);
        if (forced) {
            selectedBlockType = forced;
        }
    }
    const entity = world.addEntity({
        name: entityName,
        type: 'npc',
        x: position.x,
        y: position.y,
        z: position.z,
        hp: npcType.maxHP,
        maxHP: npcType.maxHP,
        isControllable: npcType.isControllable !== false,
        isInteractable: npcType.interactable !== false,
        npcData: npcType,
        npcTypeId: npcType.id,
        faction: factionOverride || npcType.faction || 'neutral',
        isHostile: !!npcType.isHostile,
        inventory: inventory,
        itemInventory: itemInventory,
        selectedBlockType: selectedBlockType || BLOCK_TYPES.STONE,
        target: null,
        onInteract: (world, entity) => {
            const dialogue = entity.npcData.dialogue;
            if (entity.audioInstance) {
                audioSystem.stopEvent(entity.audioInstance, true);
                entity.audioInstance = null;
            }
            entity.isSpeaking = true;

            const npcTalkEvent = String((ROM_AUDIO_CONFIG.events && ROM_AUDIO_CONFIG.events.npcTalk) || 'event:/teste');
            audioSystem.playEvent(npcTalkEvent, {}, { autoStart: true }).then((instance) => {
                if (!instance) return;
                audioSystem.attachEvent(instance, {
                    relative: entity,
                    offset: { x: 0, y: 1.6, z: 0 }
                });
                entity.audioInstance = instance;
            });
            
            spawnMessage(world, `${entity.name}: ${dialogue}`, {
                relative: entity,
                offset: { x: 0, y: 1.9, z: 0 },
                duration: 2500
            });

            setTimeout(() => {
                if (entity.audioInstance) {
                    audioSystem.stopEvent(entity.audioInstance, true);
                    entity.audioInstance = null;
                }
                entity.isSpeaking = false;
            }, 2400);
        }
    });

    return entity;
}

function getNpcTypeById(id) {
    return Object.values(NPC_TYPES).find((type) => type.id === id) || null;
}

// ============================================================
// INPUT
// ============================================================
export function selectBlockType(world, blockType) {
    const player = world.getPlayerEntity();
    if (player && player.inventory) {
        player.selectedBlockType = blockType;
    }
}

function ensureItemLabel() {
    if (document.getElementById('current-item')) return;
    const label = document.createElement('div');
    label.id = 'current-item';
    label.textContent = 'Item: -';
    label.style.position = 'fixed';
    label.style.top = '10px';
    label.style.right = '10px';
    label.style.color = 'white';
    label.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    label.style.fontSize = '14px';
    label.style.zIndex = '10';
    document.body.appendChild(label);
}

function ensureHud() {
    if (document.getElementById('hud')) return;
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.style.position = 'fixed';
    hud.style.top = '10px';
    hud.style.left = '10px';
    hud.style.color = 'white';
    hud.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    hud.style.fontSize = '15px';
    hud.style.lineHeight = '1.4';
    hud.style.whiteSpace = 'pre-line';
    hud.style.zIndex = '10';
    hud.style.display = 'flex';
    hud.style.alignItems = 'center';
    hud.style.gap = '12px';
    hud.style.padding = '10px 12px';
    hud.style.border = '1px solid rgba(255,255,255,0.2)';
    hud.style.borderRadius = '10px';

    const playerCard = document.createElement('div');
    playerCard.id = 'hud-player';
    playerCard.style.display = 'flex';
    playerCard.style.flexDirection = 'column';
    playerCard.style.alignItems = 'center';
    playerCard.style.gap = '6px';

    const playerPhoto = document.createElement('img');
    playerPhoto.id = 'hud-player-photo';
    playerPhoto.src = resolvePreviewTextureUrl('ui_player_face') || getGeneratedUiTextureDataUrl('ui_player_face');
    playerPhoto.alt = 'Foto do jogador';
    playerPhoto.style.width = '68px';
    playerPhoto.style.height = '68px';
    playerPhoto.style.borderRadius = '10px';
    playerPhoto.style.border = '1px solid rgba(255,255,255,0.45)';
    playerPhoto.style.objectFit = 'cover';
    playerPhoto.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
    playerPhoto.onerror = () => {
        const fallback = getGeneratedUiTextureDataUrl('ui_player_face');
        if (fallback && playerPhoto.src !== fallback) playerPhoto.src = fallback;
    };

    const playerName = document.createElement('div');
    playerName.id = 'hud-player-name';
    playerName.textContent = 'A.S.S';
    playerName.style.fontSize = '13px';
    playerName.style.letterSpacing = '0.4px';
    playerName.style.textTransform = 'uppercase';

    const hudText = document.createElement('div');
    hudText.id = 'hud-text';
    hudText.textContent = 'HP: -\nItem: -\nCoins: -';
    hudText.style.fontFamily = '"Courier New", monospace';
    hudText.style.whiteSpace = 'pre-line';

    const hudPreview = document.createElement('div');
    hudPreview.id = 'hud-item-preview';
    hudPreview.style.width = '48px';
    hudPreview.style.height = '48px';
    hudPreview.style.border = '1px solid rgba(255,255,255,0.4)';
    hudPreview.style.background = 'rgba(0,0,0,0.35)';
    hudPreview.style.backgroundSize = 'contain';
    hudPreview.style.backgroundRepeat = 'no-repeat';
    hudPreview.style.backgroundPosition = 'center';
    hudPreview.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.6)';

    const hudStats = document.createElement('div');
    hudStats.id = 'hud-stats';
    hudStats.style.display = 'flex';
    hudStats.style.alignItems = 'center';
    hudStats.style.gap = '10px';

    playerCard.appendChild(playerPhoto);
    playerCard.appendChild(playerName);
    hudStats.appendChild(hudText);
    hudStats.appendChild(hudPreview);
    hud.appendChild(playerCard);
    hud.appendChild(hudStats);
    document.body.appendChild(hud);
}

function ensureHandOverlay() {
    if (document.getElementById('hand-item')) return;
    const hand = document.createElement('div');
    hand.id = 'hand-item';
    hand.style.position = 'fixed';
    hand.style.right = '0';
    hand.style.bottom = '-80px';
    hand.style.width = '420px';
    hand.style.height = '420px';
    hand.style.pointerEvents = 'none';
    hand.style.zIndex = '12';
    hand.style.display = 'none';

    const handImg = document.createElement('img');
    handImg.id = 'hand-item-image';
    handImg.alt = 'Item na mão';
    handImg.style.width = '100%';
    handImg.style.height = '100%';
    handImg.style.objectFit = 'contain';

    hand.appendChild(handImg);
    document.body.appendChild(hand);
}

function ensureEditorCoords() {
    let coords = document.getElementById('editor-coords');
    if (coords) return coords;
    coords = document.createElement('div');
    coords.id = 'editor-coords';
    coords.style.position = 'fixed';
    coords.style.bottom = '10px';
    coords.style.left = '10px';
    coords.style.color = 'white';
    coords.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    coords.style.fontSize = '12px';
    coords.style.fontFamily = '"Courier New", monospace';
    coords.style.zIndex = '10';
    coords.style.display = 'none';
    document.body.appendChild(coords);
    return coords;
}

function updateEditorCoords(world) {
    const coords = ensureEditorCoords();
    if (world.mode !== 'editor') {
        coords.style.display = 'none';
        return;
    }
    const player = world.getPlayerEntity();
    if (!player) return;
    coords.style.display = 'block';
    const fmt = (value) => (Math.round(value * 100) / 100).toFixed(2);
    coords.textContent = `XYZ: ${fmt(player.x)}, ${fmt(player.y)}, ${fmt(player.z)}`;
}

function getModeFromLocation() {
    if (window.__MODE__ === 'editor' || window.__MODE__ === 'game' || window.__MODE__ === 'shooter' || window.__MODE__ === 'integrated') {
        return window.__MODE__ === 'shooter' ? 'game' : window.__MODE__;
    }
    const params = new URLSearchParams(window.location.search);
    const queryMode = params.get('mode');
    if (queryMode === 'editor') return 'editor';
    if (queryMode === 'game' || queryMode === 'shooter') return 'game';
    return 'game';
}

function setWorldMode(world, mode) {
    const normalized = mode === 'shooter' ? 'game' : mode;
    if (normalized !== 'editor' && normalized !== 'game') return;
    world.mode = normalized;
    document.body.dataset.mode = world.mode;
    const player = world.getPlayerEntity();
    if (player) {
        player.isEditor = normalized === 'editor';
        if (normalized === 'editor') {
            if (!player._savedInventory) {
                player._savedInventory = player.inventory ? { ...player.inventory } : null;
                player._savedItemInventory = player.itemInventory ? { ...player.itemInventory } : null;
                player._savedEntitySpawners = Array.isArray(player.entitySpawners) ? [...player.entitySpawners] : [];
            }
            if (!player._editorInventory || player._editorInventoryVersion !== 2) {
                const editorSpawnBlock = getPreferredBlockType('GRASS', 'STONE');
                const editorSpawnId = editorSpawnBlock && typeof editorSpawnBlock.id === 'number' ? editorSpawnBlock.id : 1;
                player._editorInventory = {
                    [editorSpawnId]: 999
                };
                player._editorItemInventory = {};
                player._editorEntitySpawners = [];
                player._editorInventoryVersion = 2;
            }
            player.inventory = { ...player._editorInventory };
            player.itemInventory = player._editorItemInventory ? { ...player._editorItemInventory } : {};
            player.entitySpawners = Array.isArray(player._editorEntitySpawners) ? [...player._editorEntitySpawners] : [];
            player.noClip = true;
        } else {
            player._editorInventory = player.inventory ? { ...player.inventory } : {};
            player._editorItemInventory = player.itemInventory ? { ...player.itemInventory } : {};
            player._editorEntitySpawners = Array.isArray(player.entitySpawners) ? [...player.entitySpawners] : [];
            if (player._savedInventory) {
                player.inventory = { ...player._savedInventory };
            }
            if (player._savedItemInventory) {
                player.itemInventory = { ...player._savedItemInventory };
            }
            player.entitySpawners = Array.isArray(player._savedEntitySpawners) ? [...player._savedEntitySpawners] : [];
            player.noClip = false;
        }
    }
    updateCurrentItemLabel(world);
    updateHud(world);
    if (isExclusiveMenuOpen(world) && world.mode === 'editor') {
        closeExclusiveMenu(world);
    }
}


function removeTargetBlock(world) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    const blockMeshes = world.blocks.map(b => b.mesh);
    if (blockMeshes.length === 0) return;
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(blockMeshes, true);
    if (intersects.length === 0) return;
    
    const hitMesh = intersects[0].object;
    const block = world.blocks.find(b => matchesMesh(hitMesh, b.mesh));
    if (block) {
        world.removeBlock(block);
    }
}

function removeTargetEntity(world) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    const entityMeshes = world.entities
        .filter((e) => e.mesh && e.type !== 'player')
        .map((e) => e.mesh);
    if (entityMeshes.length === 0) return;
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(entityMeshes, true);
    if (intersects.length === 0) return;
    
    const hitMesh = intersects[0].object;
    const entity = world.entities.find((e) => matchesMesh(hitMesh, e.mesh));
    if (entity && entity.type !== 'player') {
        world.removeEntity(entity);
        return true;
    }
    return false;
}

function removeTargetItem(world) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    const itemMeshes = world.items.map((item) => item.mesh);
    if (itemMeshes.length === 0) return false;
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(itemMeshes, true);
    if (intersects.length === 0) return false;
    
    const hitMesh = intersects[0].object;
    const itemIndex = world.items.findIndex((item) => matchesMesh(hitMesh, item.mesh));
    if (itemIndex >= 0) {
        const item = world.items[itemIndex];
        world._internal.scene.remove(item.mesh);
        world.items.splice(itemIndex, 1);
        return true;
    }
    return false;
}

function matchesMesh(object, mesh) {
    let current = object;
    while (current) {
        if (current === mesh) return true;
        current = current.parent;
    }
    return false;
}

function getTargetUnderCrosshair(world) {
    const camera = world._internal.camera;
    const raycaster = world._internal.raycaster;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const entityMeshes = world.entities.filter((e) => e.mesh).map((e) => e.mesh);
    const blockMeshes = world.blocks.map((b) => b.mesh);
    const allMeshes = [...entityMeshes, ...blockMeshes];
    const intersects = raycaster.intersectObjects(allMeshes, true);
    if (intersects.length === 0) return null;
    const hitMesh = intersects[0].object;
    const entity = world.entities.find((e) => matchesMesh(hitMesh, e.mesh));
    if (entity) return { kind: 'entity', entity };
    const block = world.blocks.find((b) => matchesMesh(hitMesh, b.mesh));
    if (block) return { kind: 'block', block };
    return null;
}

function ensureEditorContextMenu() {
    let menu = document.getElementById('editor-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'editor-context-menu';
    menu.style.position = 'fixed';
    menu.style.minWidth = '180px';
    menu.style.background = 'rgba(0,0,0,0.85)';
    menu.style.border = '1px solid rgba(255,255,255,0.25)';
    menu.style.boxShadow = '0 6px 16px rgba(0,0,0,0.45)';
    menu.style.color = 'white';
    menu.style.fontFamily = '"Courier New", monospace';
    menu.style.fontSize = '12px';
    menu.style.padding = '6px';
    menu.style.zIndex = '40';
    menu.style.display = 'none';
    document.body.appendChild(menu);
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
            const picker = document.getElementById('editor-picker-panel');
            if (!picker || picker.style.display !== 'block') {
                if (!isInventoryEditorOpen() && document.pointerLockElement !== document.body) {
                    document.body.requestPointerLock();
                }
            }
        }
    });
    return menu;
}

function addMenuItem(menu, label, onClick) {
    const item = document.createElement('button');
    item.textContent = label;
    item.style.width = '100%';
    item.style.padding = '6px 8px';
    item.style.margin = '4px 0';
    item.style.textAlign = 'left';
    item.style.background = 'rgba(255,255,255,0.08)';
    item.style.color = 'white';
    item.style.border = '1px solid rgba(255,255,255,0.12)';
    item.style.cursor = 'pointer';
    item.onclick = () => {
        onClick();
        menu.style.display = 'none';
        const picker = document.getElementById('editor-picker-panel');
        if (!picker || picker.style.display !== 'block') {
            if (!isInventoryEditorOpen() && document.pointerLockElement !== document.body) {
                document.body.requestPointerLock();
            }
        }
    };
    menu.appendChild(item);
}

let pickerState = null;

function ensurePickerPanel() {
    let panel = document.getElementById('editor-picker-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'editor-picker-panel';
    panel.style.position = 'fixed';
    panel.style.inset = '20%';
    panel.style.background = 'rgba(0,0,0,0.9)';
    panel.style.border = '1px solid rgba(255,255,255,0.2)';
    panel.style.boxShadow = '0 10px 24px rgba(0,0,0,0.45)';
    panel.style.zIndex = '60';
    panel.style.display = 'none';
    panel.style.padding = '12px';
    panel.style.color = 'white';
    panel.style.fontFamily = '"Courier New", monospace';
    panel.style.fontSize = '12px';

    const title = document.createElement('div');
    title.id = 'editor-picker-title';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    const category = document.createElement('select');
    category.id = 'editor-picker-category';
    category.style.width = '100%';
    category.style.marginBottom = '6px';
    category.style.background = 'rgba(255,255,255,0.05)';
    category.style.color = 'white';
    category.style.border = '1px solid rgba(255,255,255,0.25)';
    category.style.padding = '4px';
    category.style.fontFamily = '"Courier New", monospace';
    category.style.fontSize = '12px';

    const faction = document.createElement('select');
    faction.id = 'editor-picker-faction';
    faction.style.width = '100%';
    faction.style.marginBottom = '6px';
    faction.style.display = 'none';
    faction.style.background = 'rgba(255,255,255,0.05)';
    faction.style.color = 'white';
    faction.style.border = '1px solid rgba(255,255,255,0.25)';
    faction.style.padding = '4px';
    faction.style.fontFamily = '"Courier New", monospace';
    faction.style.fontSize = '12px';

    const select = document.createElement('select');
    select.id = 'editor-picker-select';
    select.size = 8;
    select.style.width = '100%';
    select.style.background = 'rgba(10,10,10,0.9)';
    select.style.color = 'white';
    select.style.border = '1px solid rgba(255,255,255,0.25)';
    select.style.padding = '6px';
    select.style.fontFamily = '"Courier New", monospace';
    select.style.fontSize = '12px';

    const preview = document.createElement('div');
    preview.id = 'editor-picker-preview';
    preview.style.display = 'flex';
    preview.style.gap = '8px';
    preview.style.alignItems = 'center';
    preview.style.margin = '8px 0';
    preview.style.padding = '6px';
    preview.style.border = '1px solid rgba(255,255,255,0.25)';
    preview.style.minHeight = '90px';

    const previewImg = document.createElement('div');
    previewImg.id = 'editor-picker-preview-img';
    previewImg.style.width = '80px';
    previewImg.style.height = '80px';
    previewImg.style.background = 'rgba(0,0,0,0.4)';
    previewImg.style.border = '1px solid rgba(255,255,255,0.25)';
    previewImg.style.backgroundSize = 'contain';
    previewImg.style.backgroundRepeat = 'no-repeat';
    previewImg.style.backgroundPosition = 'center';

    const previewLabel = document.createElement('div');
    previewLabel.id = 'editor-picker-preview-label';
    previewLabel.style.flex = '1';
    previewLabel.style.fontSize = '11px';
    previewLabel.style.lineHeight = '1.2';
    previewLabel.style.overflow = 'hidden';
    previewLabel.style.wordBreak = 'break-word';

    preview.appendChild(previewImg);
    preview.appendChild(previewLabel);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';

    const makeBtn = (label) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.padding = '6px 10px';
        btn.style.fontFamily = '"Courier New", monospace';
        btn.style.fontSize = '12px';
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.style.color = 'white';
        btn.style.border = '1px solid rgba(255,255,255,0.2)';
        btn.style.cursor = 'pointer';
        return btn;
    };

    const cancelBtn = makeBtn('Cancelar');
    cancelBtn.onclick = () => {
        panel.style.display = 'none';
        if (!isInventoryEditorOpen() && document.pointerLockElement !== document.body) {
            document.body.requestPointerLock();
        }
    };
    const addBtn = makeBtn('Adicionar');
    addBtn.id = 'editor-picker-add';
    actions.appendChild(cancelBtn);
    actions.appendChild(addBtn);

    category.onchange = () => {
        pickerState.selectedFaction = 'all';
        rebuildPickerOptions();
    };
    faction.onchange = () => {
        pickerState.selectedFaction = faction.value;
        rebuildPickerOptions();
    };
    select.addEventListener('wheel', (e) => {
        e.preventDefault();
        const maxIdx = select.options.length - 1;
        if (maxIdx < 0) return;
        const offset = e.deltaY > 0 ? 1 : -1;
        const nextIdx = Math.min(maxIdx, Math.max(0, (select.selectedIndex >= 0 ? select.selectedIndex : 0) + offset));
        select.selectedIndex = nextIdx;
        rebuildPickerPreview();
    });
    select.addEventListener('change', rebuildPickerPreview);

    panel.appendChild(title);
    panel.appendChild(category);
    panel.appendChild(faction);
    panel.appendChild(preview);
    panel.appendChild(select);
    panel.appendChild(actions);
    document.body.appendChild(panel);
    return panel;
}

function ensureEntitySpawners(player) {
    if (!player) return [];
    if (!Array.isArray(player.entitySpawners)) {
        player.entitySpawners = [];
    }
    return player.entitySpawners;
}

function addEntitySpawner(player, spawner) {
    const list = ensureEntitySpawners(player);
    const normalized = {
        id: spawner.id || cryptoRandomId(),
        npcTypeId: spawner.npcTypeId,
        inventory: spawner.inventory ? { ...spawner.inventory } : null,
        itemInventory: spawner.itemInventory ? { ...spawner.itemInventory } : null,
        selectedBlockTypeId: spawner.selectedBlockTypeId || null,
        label: spawner.label || null
    };
    list.push(normalized);
    return normalized;
}

function cryptoRandomId() {
    return Math.random().toString(36).slice(2, 10);
}

function rebuildPickerOptions() {
    if (!pickerState) return;
    const panel = ensurePickerPanel();
    const category = panel.querySelector('#editor-picker-category');
    const select = panel.querySelector('#editor-picker-select');
    const currentId = category.value;
    const entry = pickerState.categories.find((cat) => cat.id === currentId);
    let options = entry ? entry.options : [];
    const factionSelect = panel.querySelector('#editor-picker-faction');
    if (entry && entry.id === 'entity') {
        const factionOptions = [{ id: 'all', name: 'Todas' }];
        const seen = new Set();
        options.forEach((opt) => {
            const factionId = opt.faction || 'neutral';
            if (!seen.has(factionId)) {
                seen.add(factionId);
                factionOptions.push({
                    id: factionId,
                    name: (opt.factionName || factionId.charAt(0).toUpperCase() + factionId.slice(1))
                });
            }
        });
        factionSelect.innerHTML = '';
        factionOptions.forEach((opt) => {
            const optionEl = document.createElement('option');
            optionEl.value = opt.id;
            optionEl.textContent = opt.name;
            factionSelect.appendChild(optionEl);
        });
        factionSelect.style.display = 'block';
        if (!pickerState.selectedFaction) {
            pickerState.selectedFaction = 'all';
        }
        factionSelect.value = pickerState.selectedFaction;
        if (pickerState.selectedFaction !== 'all') {
            options = options.filter((opt) => (opt.faction || 'neutral') === pickerState.selectedFaction);
        }
    } else {
        factionSelect.style.display = 'none';
    }
    select.innerHTML = '';
    options.forEach((opt, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = opt.label;
        select.appendChild(option);
    });
    select.selectedIndex = options.length ? 0 : -1;
    rebuildPickerPreview();
    pickerState.currentOptions = options;
}

function rebuildPickerPreview() {
    if (!pickerState) return;
    const panel = ensurePickerPanel();
    const select = panel.querySelector('#editor-picker-select');
    const previewImg = panel.querySelector('#editor-picker-preview-img');
    const previewLabel = panel.querySelector('#editor-picker-preview-label');
    const category = panel.querySelector('#editor-picker-category');
    const entry = pickerState.categories.find((cat) => cat.id === category.value);
    const selectedIndex = select.selectedIndex;
    const currentOptions = Array.isArray(pickerState.currentOptions) ? pickerState.currentOptions : [];
    const option = selectedIndex >= 0 && selectedIndex < currentOptions.length
        ? currentOptions[selectedIndex]
        : null;
    if (option && option.textureUrl) {
        previewImg.style.backgroundImage = `url("${option.textureUrl}")`;
    } else {
        previewImg.style.backgroundImage = '';
    }
    let labelText = option ? option.label : entry ? entry.label : '';
    if (entry && entry.id === 'entity' && option && option.factionName) {
        labelText += `\n${option.factionName}`;
    }
    previewLabel.textContent = labelText;
}

function openUnifiedPickerPanel({ title, categories, onPick }) {
    const panel = ensurePickerPanel();
    const titleEl = panel.querySelector('#editor-picker-title');
    const category = panel.querySelector('#editor-picker-category');
    const select = panel.querySelector('#editor-picker-select');
    const addBtn = panel.querySelector('#editor-picker-add');

    pickerState = { categories, onPick, selectedFaction: 'all' };
    titleEl.textContent = title;
    category.innerHTML = '';
    categories.forEach((cat, index) => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.label;
        category.appendChild(option);
    });
    category.selectedIndex = 0;
    rebuildPickerOptions();
    addBtn.onclick = () => {
        const entry = pickerState.categories.find((cat) => cat.id === category.value);
        const selectedIndex = select.selectedIndex;
        const currentOptions = Array.isArray(pickerState.currentOptions) ? pickerState.currentOptions : [];
        if (entry && currentOptions[selectedIndex]) {
            onPick(entry.id, currentOptions[selectedIndex]);
        }
        rebuildPickerPreview();
    };
    panel.style.display = 'block';
    if (document.pointerLockElement === document.body) {
        document.exitPointerLock();
    }
}

function getInventoryOptionList(category) {
    return category === 'block' ? INVENTORY_BLOCK_OPTIONS : INVENTORY_ITEM_OPTIONS;
}

function isInventoryEditorOpen() {
    const panel = document.getElementById('editor-entity-inventory-panel');
    return panel && panel.style.display === 'block';
}

function ensureEntityInventoryPanel() {
    let panel = document.getElementById('editor-entity-inventory-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'editor-entity-inventory-panel';
    panel.style.position = 'fixed';
    panel.style.inset = '12% 18%';
    panel.style.background = 'rgba(0,0,0,0.95)';
    panel.style.border = '1px solid rgba(255,255,255,0.3)';
    panel.style.boxShadow = '0 12px 30px rgba(0,0,0,0.6)';
    panel.style.zIndex = '65';
    panel.style.display = 'none';
    panel.style.padding = '14px';
    panel.style.color = 'white';
    panel.style.fontFamily = '"Courier New", monospace';
    panel.style.fontSize = '12px';
    panel.style.maxHeight = '75%';
    panel.style.overflow = 'auto';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.id = 'editor-inventory-title';
    title.style.fontWeight = 'bold';
    title.style.fontSize = '14px';
    title.textContent = 'Inventário';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fechar';
    closeBtn.style.marginLeft = '8px';
    closeBtn.style.padding = '4px 10px';
    closeBtn.style.fontFamily = '"Courier New", monospace';
    closeBtn.style.fontSize = '12px';
    closeBtn.style.background = 'rgba(255,255,255,0.08)';
    closeBtn.style.border = '1px solid rgba(255,255,255,0.2)';
    closeBtn.style.color = 'white';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = () => closeEntityInventoryPanel();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const category = document.createElement('select');
    category.id = 'editor-inventory-category';
    category.style.width = '100%';
    category.style.marginBottom = '6px';
    category.style.background = 'rgba(255,255,255,0.05)';
    category.style.color = 'white';
    category.style.border = '1px solid rgba(255,255,255,0.2)';
    category.style.padding = '4px';
    category.style.fontFamily = '"Courier New", monospace';
    category.style.fontSize = '12px';

    INVENTORY_CATEGORIES.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.label;
        category.appendChild(option);
    });

    const preview = document.createElement('div');
    preview.id = 'editor-inventory-preview';
    preview.style.display = 'flex';
    preview.style.gap = '8px';
    preview.style.alignItems = 'center';
    preview.style.margin = '8px 0';
    preview.style.padding = '6px';
    preview.style.border = '1px solid rgba(255,255,255,0.25)';
    preview.style.minHeight = '70px';

    const previewImg = document.createElement('div');
    previewImg.id = 'editor-inventory-preview-img';
    previewImg.style.width = '60px';
    previewImg.style.height = '60px';
    previewImg.style.border = '1px solid rgba(255,255,255,0.25)';
    previewImg.style.background = 'rgba(0,0,0,0.4)';
    previewImg.style.backgroundSize = 'contain';
    previewImg.style.backgroundRepeat = 'no-repeat';
    previewImg.style.backgroundPosition = 'center';

    const previewLabel = document.createElement('div');
    previewLabel.id = 'editor-inventory-preview-label';
    previewLabel.style.flex = '1';
    previewLabel.style.fontSize = '12px';
    previewLabel.style.lineHeight = '1.2';
    previewLabel.style.whiteSpace = 'pre-line';
    previewLabel.style.overflow = 'hidden';
    previewLabel.style.wordBreak = 'break-word';

    preview.appendChild(previewImg);
    preview.appendChild(previewLabel);

    const select = document.createElement('select');
    select.id = 'editor-inventory-select';
    select.size = 8;
    select.style.width = '100%';
    select.style.background = 'rgba(10,10,10,0.9)';
    select.style.color = 'white';
    select.style.border = '1px solid rgba(255,255,255,0.25)';
    select.style.padding = '6px';
    select.style.fontFamily = '"Courier New", monospace';
    select.style.fontSize = '12px';
    select.style.marginBottom = '8px';
    select.style.outline = 'none';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.justifyContent = 'space-between';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '8px';
    controls.style.marginBottom = '8px';

    const quantityGroup = document.createElement('div');
    quantityGroup.style.display = 'flex';
    quantityGroup.style.alignItems = 'center';
    quantityGroup.style.gap = '4px';
    quantityGroup.style.fontSize = '12px';

    const quantityLabel = document.createElement('span');
    quantityLabel.textContent = 'Quantidade:';
    quantityLabel.style.fontSize = '12px';

    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.min = '1';
    quantityInput.value = '1';
    quantityInput.style.width = '60px';
    quantityInput.style.padding = '4px';
    quantityInput.style.background = 'rgba(255,255,255,0.08)';
    quantityInput.style.border = '1px solid rgba(255,255,255,0.2)';
    quantityInput.style.color = 'white';
    quantityInput.style.fontFamily = '"Courier New", monospace';
    quantityInput.style.fontSize = '12px';

    quantityGroup.appendChild(quantityLabel);
    quantityGroup.appendChild(quantityInput);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Adicionar';
    addBtn.style.padding = '6px 12px';
    addBtn.style.fontFamily = '"Courier New", monospace';
    addBtn.style.fontSize = '12px';
    addBtn.style.background = 'rgba(255,255,255,0.1)';
    addBtn.style.border = '1px solid rgba(255,255,255,0.25)';
    addBtn.style.color = 'white';
    addBtn.style.cursor = 'pointer';

    controls.appendChild(quantityGroup);
    controls.appendChild(addBtn);

    const inventoryTitle = document.createElement('div');
    inventoryTitle.textContent = 'Inventário atual';
    inventoryTitle.style.margin = '8px 0 4px';
    inventoryTitle.style.fontSize = '12px';
    inventoryTitle.style.opacity = '0.8';

    const inventoryList = document.createElement('div');
    inventoryList.id = 'editor-inventory-list';
    inventoryList.style.display = 'flex';
    inventoryList.style.flexDirection = 'column';
    inventoryList.style.gap = '6px';
    inventoryList.style.maxHeight = '250px';
    inventoryList.style.overflowY = 'auto';
    inventoryList.style.paddingRight = '4px';

    const inventoryActions = document.createElement('div');
    inventoryActions.style.display = 'flex';
    inventoryActions.style.justifyContent = 'flex-end';
    inventoryActions.style.flexWrap = 'wrap';
    inventoryActions.style.gap = '8px';
    inventoryActions.style.marginTop = '6px';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Limpar inventário';
    clearBtn.style.padding = '4px 10px';
    clearBtn.style.fontFamily = '"Courier New", monospace';
    clearBtn.style.fontSize = '12px';
    clearBtn.style.background = 'rgba(255,255,255,0.08)';
    clearBtn.style.border = '1px solid rgba(255,255,255,0.2)';
    clearBtn.style.color = 'white';
    clearBtn.style.cursor = 'pointer';

    inventoryActions.appendChild(clearBtn);

    panel.appendChild(header);
    panel.appendChild(category);
    panel.appendChild(preview);
    panel.appendChild(select);
    panel.appendChild(controls);
    panel.appendChild(inventoryTitle);
    panel.appendChild(inventoryList);
    panel.appendChild(inventoryActions);

    category.onchange = () => {
        if (!inventoryEditorState) inventoryEditorState = {};
        inventoryEditorState.category = category.value;
        rebuildEntityInventorySelectionList();
    };
    select.addEventListener('change', rebuildEntityInventoryPreview);
    select.addEventListener('wheel', (e) => {
        e.preventDefault();
        const offset = e.deltaY > 0 ? 1 : -1;
        const nextIndex = Math.min(Math.max(0, (select.selectedIndex >= 0 ? select.selectedIndex : 0) + offset), select.options.length - 1);
        select.selectedIndex = nextIndex;
        rebuildEntityInventoryPreview();
    });

    addBtn.onclick = () => {
        const entity = inventoryEditorState && inventoryEditorState.entity;
        if (!entity) return;
        const categoryValue = category.value;
        const options = getInventoryOptionList(categoryValue);
        const option = options.find((opt) => String(opt.id) === select.value);
        if (!option) return;
        const qty = Math.max(1, Math.floor(Number(quantityInput.value) || 1));
        if (categoryValue === 'block') {
            entity.inventory = entity.inventory || {};
            const key = String(option.id);
            entity.inventory[key] = (entity.inventory[key] || 0) + qty;
        } else {
            entity.itemInventory = entity.itemInventory || {};
            const key = option.id;
            entity.itemInventory[key] = (entity.itemInventory[key] || 0) + qty;
        }
        updateEntityInventoryListDisplay();
        quantityInput.value = '1';
    };

    clearBtn.onclick = () => {
        const entity = inventoryEditorState && inventoryEditorState.entity;
        if (!entity) return;
        entity.inventory = {};
        entity.itemInventory = {};
        updateEntityInventoryListDisplay();
    };

    document.body.appendChild(panel);
    return panel;
}

function rebuildEntityInventorySelectionList() {
    const panel = ensureEntityInventoryPanel();
    const select = panel.querySelector('#editor-inventory-select');
    const category = panel.querySelector('#editor-inventory-category');
    const options = getInventoryOptionList(category.value);
    select.innerHTML = '';
    options.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.id;
        option.textContent = opt.label;
        select.appendChild(option);
    });
    if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
    rebuildEntityInventoryPreview();
}

function rebuildEntityInventoryPreview() {
    if (!inventoryEditorState) return;
    const panel = ensureEntityInventoryPanel();
    const select = panel.querySelector('#editor-inventory-select');
    const category = panel.querySelector('#editor-inventory-category');
    const previewImg = panel.querySelector('#editor-inventory-preview-img');
    const previewLabel = panel.querySelector('#editor-inventory-preview-label');
    const options = getInventoryOptionList(category.value);
    const selected = options.find((opt) => String(opt.id) === select.value);
    if (selected && selected.textureUrl) {
        previewImg.style.backgroundImage = `url("${selected.textureUrl}")`;
    } else {
        previewImg.style.backgroundImage = 'none';
    }
    previewLabel.textContent = selected ? selected.label : 'Selecione um item';
}

function getEntityInventoryEntries(entity) {
    if (!entity) return [];
    const entries = [];
    if (entity.inventory) {
        for (const [blockId, count] of Object.entries(entity.inventory)) {
            const qty = Math.max(0, Math.floor(Number(count) || 0));
            if (qty <= 0) continue;
            const blockType = Object.values(BLOCK_TYPES).find((block) => String(block.id) === String(blockId));
            if (!blockType) continue;
            const textureKey = getBlockThumbnailTextureKey(blockType);
            entries.push({
                kind: 'block',
                id: blockType.id,
                name: blockType.name,
                count: qty,
                textureUrl: resolvePreviewTextureUrl(textureKey)
            });
        }
    }
    if (entity.itemInventory) {
        for (const [itemId, count] of Object.entries(entity.itemInventory)) {
            const qty = Math.max(0, Math.floor(Number(count) || 0));
            if (qty <= 0) continue;
            const itemDef = Object.values(ITEMS).find((item) => item.id === itemId);
            if (!itemDef) continue;
            entries.push({
                kind: 'item',
                id: itemDef.id,
                name: itemDef.name,
                count: qty,
                textureUrl: resolvePreviewTextureUrl(getItemTextureKey(itemDef, 'ui'))
            });
        }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function updateEntityInventoryListDisplay() {
    const panel = document.getElementById('editor-entity-inventory-panel');
    if (!panel || !inventoryEditorState) return;
    const list = panel.querySelector('#editor-inventory-list');
    list.innerHTML = '';
    const entity = inventoryEditorState.entity;
    const entries = getEntityInventoryEntries(entity);
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Inventário vazio';
        empty.style.opacity = '0.6';
        list.appendChild(empty);
        return;
    }
    entries.forEach((entry) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '6px';
        row.style.border = '1px solid rgba(255,255,255,0.1)';
        row.style.background = 'rgba(255,255,255,0.02)';
        row.style.borderRadius = '4px';

        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.fontFamily = '"Courier New", monospace';
        info.textContent = `${entry.name} x${entry.count}`;

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        actions.style.flexWrap = 'wrap';

        const removeOne = document.createElement('button');
        removeOne.textContent = '-1';
        removeOne.style.padding = '2px 10px';
        removeOne.style.fontSize = '11px';
        removeOne.style.fontFamily = '"Courier New", monospace';
        removeOne.style.background = 'rgba(255,255,255,0.08)';
        removeOne.style.border = '1px solid rgba(255,255,255,0.2)';
        removeOne.style.color = 'white';
        removeOne.style.cursor = 'pointer';
        removeOne.onclick = () => {
            adjustEntityInventoryCount(entity, entry.kind, entry.id, -1);
            updateEntityInventoryListDisplay();
        };

        const removeAll = document.createElement('button');
        removeAll.textContent = 'Remover tudo';
        removeAll.style.padding = '2px 10px';
        removeAll.style.fontSize = '11px';
        removeAll.style.fontFamily = '"Courier New", monospace';
        removeAll.style.background = 'rgba(255,255,255,0.08)';
        removeAll.style.border = '1px solid rgba(255,255,255,0.2)';
        removeAll.style.color = 'white';
        removeAll.style.cursor = 'pointer';
        removeAll.onclick = () => {
            const delta = -entry.count;
            adjustEntityInventoryCount(entity, entry.kind, entry.id, delta);
            updateEntityInventoryListDisplay();
        };

        actions.appendChild(removeOne);
        actions.appendChild(removeAll);

        row.appendChild(info);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function adjustEntityInventoryCount(entity, kind, id, delta) {
    if (!entity) return;
    if (kind === 'block') {
        entity.inventory = entity.inventory || {};
        const key = String(id);
        const current = Math.max(0, Math.floor(Number(entity.inventory[key] || 0)));
        const next = Math.max(0, current + delta);
        if (next <= 0) {
            delete entity.inventory[key];
        } else {
            entity.inventory[key] = next;
        }
    } else if (kind === 'item') {
        entity.itemInventory = entity.itemInventory || {};
        const current = Math.max(0, Math.floor(Number(entity.itemInventory[id] || 0)));
        const next = Math.max(0, current + delta);
        if (next <= 0) {
            delete entity.itemInventory[id];
        } else {
            entity.itemInventory[id] = next;
        }
    }
}

function openEntityInventoryEditor(entity) {
    if (!entity) return;
    const panel = ensureEntityInventoryPanel();
    inventoryEditorState = {
        entity,
        category: 'item'
    };
    const title = panel.querySelector('#editor-inventory-title');
    title.textContent = `Inventário: ${entity.name || 'Entidade'}`;
    const category = panel.querySelector('#editor-inventory-category');
    category.value = 'item';
    rebuildEntityInventorySelectionList();
    updateEntityInventoryListDisplay();
    panel.style.display = 'block';
    if (document.pointerLockElement === document.body) {
        document.exitPointerLock();
    }
}

function closeEntityInventoryPanel() {
    const panel = document.getElementById('editor-entity-inventory-panel');
    if (!panel) return;
    panel.style.display = 'none';
    inventoryEditorState = null;
    if (document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
    }
}

function openEntityInspectorWindow(entity) {
    openInspectorWindow(entity, {
        title: 'Entity',
        onChange: (path, value, target) => {
            const key = path[path.length - 1];
            if (key === 'name' && target && target.indicatorGroup) {
                refreshEntityIndicators(world, target);
            }
        }
    });
}

function openBlockInspectorWindow(block) {
    openInspectorWindow(block, { title: 'Block' });
}

function openWorldInspectorWindow(world) {
    openInspectorWindow(world, { title: 'World' });
}

function openEditorContextMenu(world, event) {
    if (world.mode !== 'editor') return;
    const menu = ensureEditorContextMenu();
    menu.innerHTML = '';
    if (document.pointerLockElement === document.body) {
        document.exitPointerLock();
    }
    const target = getTargetUnderCrosshair(world);
    if (target && target.kind === 'entity') {
        const entity = target.entity;
        addMenuItem(menu, 'Controlar unidade', () => {
            const index = world.entities.indexOf(entity);
            if (index >= 0) {
                world.switchPlayerControl(index);
                updateCurrentItemLabel(world);
            }
        });
        addMenuItem(menu, 'Inspector (nova aba)', () => {
            openEntityInspectorWindow(entity);
        });
        addMenuItem(menu, 'Editar inventário', () => openEntityInventoryEditor(entity));
        addMenuItem(menu, 'Limpar inventário', () => {
            clearEntityInventory(entity);
        });
        addMenuItem(menu, 'Clonar entidade', () => {
            const player = world.getPlayerEntity();
            if (!player) return;
            const spawner = addEntitySpawner(player, {
                npcTypeId: entity.npcTypeId,
                inventory: entity.inventory,
                itemInventory: entity.itemInventory,
                selectedBlockTypeId: entity.selectedBlockType ? entity.selectedBlockType.id : null,
                label: `${entity.name} (${getFactionName(entity.faction || 'neutral')})`
            });
            player.selectedItem = {
                kind: 'entity',
                action: 'spawn',
                npcTypeId: spawner.npcTypeId,
                spawnerConfig: spawner
            };
            updateCurrentItemLabel(world);
        });
        if (entity.type === 'npc') {
            addMenuItem(menu, 'Venha ate aqui', () => {
                startEditorMoveCommand(world, entity);
            });
            addMenuItem(menu, 'Olhe pra mim', () => {
                const player = world.getPlayerEntity();
                if (!player) return;
                const dx = player.x - entity.x;
                const dz = player.z - entity.z;
                entity.yaw = Math.atan2(-dx, -dz);
            });
            addMenuItem(menu, 'Log no console', () => console.log('NPC:', entity));
        } else {
            addMenuItem(menu, 'Log no console', () => console.log('Entity:', entity));
        }
    } else if (target && target.kind === 'block') {
        addMenuItem(menu, 'Inspector bloco (nova aba)', () => openBlockInspectorWindow(target.block));
        addMenuItem(menu, 'Inspector world (nova aba)', () => openWorldInspectorWindow(world));
    } else {
        addMenuItem(menu, 'Inspector world (nova aba)', () => openWorldInspectorWindow(world));
        addMenuItem(menu, 'Fechar', () => {});
    }
    if (world.mode === 'editor') {
        addMenuItem(menu, 'Pegar conteúdo', () => {
            const npcList = Object.values(NPC_TYPES).slice().sort((a, b) => a.name.localeCompare(b.name));
            const npcOptions = npcList.map((npc) => {
                const textureKey = npc.texture || 'npc';
                return {
                    label: `${npc.name} (${getFactionName(npc.faction || 'neutral')})`,
                    value: npc.id,
                    faction: npc.faction || 'neutral',
                    factionName: getFactionName(npc.faction || 'neutral'),
                    textureKey,
                    textureUrl: resolvePreviewTextureUrl(textureKey)
                };
            });
            const blockOptions = Object.values(BLOCK_TYPES)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((blockType) => {
                    const textureKey = getBlockThumbnailTextureKey(blockType);
                    return {
                        label: blockType.name,
                        value: blockType.id,
                        textureKey,
                        textureUrl: resolvePreviewTextureUrl(textureKey)
                    };
                });
            const itemOptions = Object.values(ITEMS)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((itemDef) => {
                    const textureKey = getItemTextureKey(itemDef, 'ui');
                    return {
                        label: itemDef.name,
                        value: itemDef.id,
                        textureKey: textureKey || null,
                        textureUrl: resolvePreviewTextureUrl(textureKey)
                    };
                });
            openUnifiedPickerPanel({
                title: 'Selecionar tipo',
                categories: [
                    { id: 'entity', label: 'Entidades', options: npcOptions },
                    { id: 'block', label: 'Blocos', options: blockOptions },
                    { id: 'item', label: 'Itens', options: itemOptions }
                ],
                onPick: (categoryId, option) => {
                    const player = world.getPlayerEntity();
                    if (!player) return;
                    if (categoryId === 'entity') {
                        const spawner = addEntitySpawner(player, {
                            npcTypeId: option.value,
                            label: option.label
                        });
                        player.selectedItem = {
                            kind: 'entity',
                            action: 'spawn',
                            npcTypeId: spawner.npcTypeId,
                            spawnerConfig: spawner
                        };
                    } else if (categoryId === 'block') {
                        player.inventory = player.inventory || {};
                        player.inventory[option.value] = 999;
                        const blockType = Object.values(BLOCK_TYPES).find((b) => b.id === option.value);
                        if (blockType) {
                            player.selectedBlockType = blockType;
                            player.selectedItem = { kind: 'block', id: blockType.id };
                        }
                    } else if (categoryId === 'item') {
                        player.itemInventory = player.itemInventory || {};
                        player.itemInventory[option.value] = 999;
                        player.selectedItem = { kind: 'item', id: option.value };
                    }
                    updateCurrentItemLabel(world);
                }
            });
        });
    }
    const x = Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2;
    const y = Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
}

function cloneBlockTypeFrom(world, source) {
    if (!source) return;
    const maxId = Math.max(...Object.values(BLOCK_TYPES).map((b) => b.id || 0));
    const newId = maxId + 1;
    const name = prompt('Nome do novo bloco:', `${source.name} Copy`);
    if (!name) return;
    const clone = { ...source, id: newId, name };
    const key = `CUSTOM_${newId}`;
    BLOCK_TYPES[key] = clone;
    const player = world.getPlayerEntity();
    if (player && world.mode === 'editor' && player.inventory) {
        player.inventory[newId] = 999;
    }
}

function getEntityPreviewColor(entity) {
    const hue = ((entity.id || 1) * 0.17) % 1;
    const color = new THREE.Color();
    color.setHSL(hue, 0.75, 0.55);
    return color;
}

function clearPreviewGroup(group) {
    while (group.children.length > 0) {
        const child = group.children.pop();
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }
}

function startEditorMoveCommand(world, entity) {
    world._internal.editorMoveCommand = {
        entityId: entity.id
    };
    updateEditorMovePreview(world);
}

function commitEditorMoveCommand(world) {
    const command = world._internal.editorMoveCommand;
    if (!command) return;
    const entity = world.entities.find((e) => e.id === command.entityId);
    let targetPos = world.ui.targetBlockPosition;
    if (!targetPos) {
        const camera = world._internal.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        targetPos = {
            x: camera.position.x + dir.x * CONFIG.PLACEMENT_RANGE,
            y: camera.position.y + dir.y * CONFIG.PLACEMENT_RANGE,
            z: camera.position.z + dir.z * CONFIG.PLACEMENT_RANGE
        };
    }
    if (entity && targetPos) {
        entity.targetEntity = null;
        entity.target = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
        entity.path = [];
        entity.pathUpdateCounter = CONFIG.PATH_UPDATE_INTERVAL;
        entity.editorMoveActive = true;
    }
    world._internal.editorMoveCommand = null;
    if (world._internal.editorMoveLine) {
        world._internal.editorMoveLine.visible = false;
        clearPreviewGroup(world._internal.editorMoveLine);
    }
}

function updateEditorMovePreview(world) {
    const command = world._internal.editorMoveCommand;
    if (!command || world.mode !== 'editor') {
        if (world._internal.editorMoveLine) world._internal.editorMoveLine.visible = false;
        return;
    }
    const entity = world.entities.find((e) => e.id === command.entityId);
    if (!entity) return;
    let targetPos = world.ui.targetBlockPosition;
    if (!targetPos) {
        const camera = world._internal.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        targetPos = {
            x: camera.position.x + dir.x * CONFIG.PLACEMENT_RANGE,
            y: camera.position.y + dir.y * CONFIG.PLACEMENT_RANGE,
            z: camera.position.z + dir.z * CONFIG.PLACEMENT_RANGE
        };
    }
    const start = new THREE.Vector3(entity.x, entity.y + 0.2, entity.z);
    const end = new THREE.Vector3(targetPos.x, targetPos.y + 0.2, targetPos.z);
    const distance = start.distanceTo(end);
    const step = 0.6;
    const steps = Math.max(2, Math.ceil(distance / step));
    const color = getEntityPreviewColor(entity);

    if (!world._internal.editorMoveLine) {
        const group = new THREE.Group();
        world._internal.editorMoveLine = group;
        world._internal.scene.add(group);
    }
    const group = world._internal.editorMoveLine;
    group.visible = true;
    clearPreviewGroup(group);
    group.userData.color = color.getHex();

    const boxSize = 0.35;
    const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false
    });
    for (let i = 0; i < steps; i++) {
        const t = steps === 1 ? 0 : i / (steps - 1);
        const pos = new THREE.Vector3().lerpVectors(start, end, t);
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(pos.x, pos.y, pos.z);
        group.add(cube);
    }
}

function buildEditorDefaultMap() {
    const blocks = [];
    const size = 16;
    const floorType = getPreferredBlockType('GRASS', 'STONE');
    const floorTypeId = floorType && typeof floorType.id === 'number' ? floorType.id : 1;
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            blocks.push({
                x,
                y: -0.5,
                z,
                typeId: floorTypeId,
                isFloor: true
            });
        }
    }
    return {
        version: 1,
        player: { x: 7.5, y: 2, z: 7.5, yaw: 0, pitch: 0 },
        blocks,
        items: [],
        entities: []
    };
}

async function loadInitialMap(world) {
    const params = new URLSearchParams(window.location.search);
    const requestedMap = String(params.get('map') || '').trim();
    const normalizeMapName = (name) => {
        if (!name) return '';
        return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
    };
    const requestedMapName = normalizeMapName(requestedMap);

    if (ROM_RUNTIME.enabled) {
        const romMap = requestedMapName
            ? (ROM_RUNTIME.mapByName[requestedMapName] || ROM_RUNTIME.mapByName[requestedMap])
            : null;
        const selected = romMap || ROM_RUNTIME.mapPayload;
        if (selected && Array.isArray(selected.blocks)) {
            applyMap(world, selected);
            return;
        }
    }
    applyMap(world, buildEditorDefaultMap());
}

async function loadMapFromUrl(world, url, options = {}) {
    const { fallbackToEditorDefault = true } = options;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Map fetch failed: ${response.status}`);
        const payload = await response.json();
        applyMap(world, payload);
        return true;
    } catch (err) {
        console.warn('Falha ao carregar mapa:', err);
        if (fallbackToEditorDefault) {
            applyMap(world, buildEditorDefaultMap());
        }
        return false;
    }
}

function exportMap(world) {
    const payload = {
        version: 1,
        player: null,
        blocks: world.blocks.map((block) => ({
            x: block.x,
            y: block.y,
            z: block.z,
            typeId: block.type.id,
            isFloor: block.isFloor
        })),
        items: world.items.map((item) => ({
            kind: item.kind,
            blockTypeId: item.blockTypeId || null,
            itemId: item.itemId || null,
            amount: item.amount || 1,
            x: item.mesh.position.x,
            y: item.mesh.position.y,
            z: item.mesh.position.z
        })),
        entities: world.entities
            .filter((entity) => entity.type !== 'player')
            .map((entity) => ({
                type: entity.type,
                npcTypeId: entity.npcTypeId || (entity.npcData ? entity.npcData.id : null),
                name: entity.name || null,
                faction: entity.faction || null,
                x: entity.x,
                y: entity.y,
                z: entity.z,
                yaw: entity.yaw || 0,
                pitch: entity.pitch || 0,
                hp: entity.hp,
                maxHP: entity.maxHP,
                isHostile: !!entity.isHostile,
                inventory: entity.inventory || {},
                itemInventory: entity.itemInventory || {}
            }))
    };
    
    const player = world.getPlayerEntity();
    if (player) {
        payload.player = {
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: player.yaw || 0,
            pitch: player.pitch || 0,
            name: player.name || 'A.S.S',
            portraitTextureKey: player.uiPortraitKey || 'ui_player_face',
            inventory: player.inventory || {},
            itemInventory: player.itemInventory || {}
        };
    }
    
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'map.json';
    link.click();
    URL.revokeObjectURL(url);
}

function applyMap(world, payload) {
    if (!payload || !Array.isArray(payload.blocks)) {
        console.warn('Mapa invalido.');
        return;
    }

    world._internal.usedNames = new Set();
    
    world.beginTerrainBatch();
    world.clearBlocks();
    for (const item of world.items) {
        world._internal.scene.remove(item.mesh);
    }
    world.items = [];
    for (const proj of world.projectiles) {
        world._internal.scene.remove(proj.mesh);
    }
    world.projectiles = [];
    for (const message of world.messages) {
        world._internal.scene.remove(message.mesh);
    }
    world.messages = [];
    for (let i = world.entities.length - 1; i >= 0; i--) {
        const entity = world.entities[i];
        if (entity.type !== 'player') {
            world.removeEntity(entity);
        }
    }
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const isFiniteNumber = (n) => Number.isFinite(Number(n));
    for (const entry of payload.blocks) {
        if (!entry || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.z)) continue;
        const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === entry.typeId);
        if (!blockType) continue;
        const bx = Number(entry.x);
        const by = Number(entry.y);
        const bz = Number(entry.z);
        world.addBlock(bx, by, bz, blockType, entry.isFloor);
        if (bx < minX) minX = bx;
        if (bx > maxX) maxX = bx;
        if (bz < minZ) minZ = bz;
        if (bz > maxZ) maxZ = bz;
    }
    world.endTerrainBatch();
    if (minX !== Infinity) {
        world._internal.mapBounds = { minX, maxX, minZ, maxZ };
    } else {
        world._internal.mapBounds = null;
    }
    
    if (Array.isArray(payload.items)) {
        for (const entry of payload.items) {
            if (!entry || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.z)) continue;
            const pos = { x: Number(entry.x), y: Number(entry.y), z: Number(entry.z) };
            if (entry.kind === 'block') {
                const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === entry.blockTypeId);
                if (!blockType) continue;
                spawnBlockDrop(world, blockType, entry.amount || 1, pos);
            } else if (entry.kind === 'item') {
                spawnItemDrop(world, entry.itemId, entry.amount || 1, pos);
            }
        }
    }
    
    if (Array.isArray(payload.entities)) {
        for (const entry of payload.entities) {
            if (entry.type !== 'npc') continue;
            if (!isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.z)) continue;
            const npcType = getNpcTypeById(entry.npcTypeId);
            let entity = null;
            if (npcType) {
                const hasInventory = entry.inventory && typeof entry.inventory === 'object';
                const hasItemInventory = entry.itemInventory && typeof entry.itemInventory === 'object';
                entity = createNpcEntity(
                    world,
                    npcType,
                    { x: Number(entry.x), y: Number(entry.y), z: Number(entry.z) },
                    entry.name || null,
                    entry.faction || null,
                    {
                        inventory: entry.inventory || null,
                        itemInventory: entry.itemInventory || null,
                        selectedBlockTypeId: entry.selectedBlockTypeId || null,
                        disableInventoryFallback: hasInventory || hasItemInventory
                    }
                );
            }
            if (!entity) continue;
            entity.yaw = entry.yaw || 0;
            entity.pitch = entry.pitch || 0;
            if (typeof entry.hp === 'number') entity.hp = entry.hp;
            if (typeof entry.maxHP === 'number') entity.maxHP = entry.maxHP;
            entity.isHostile = !!entry.isHostile;
        }
    }
    
    if (payload.player && isFiniteNumber(payload.player.x) && isFiniteNumber(payload.player.z)) {
        world._internal.mapCenter = { x: payload.player.x, z: payload.player.z };
    } else if (minX !== Infinity) {
        world._internal.mapCenter = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    } else {
        world._internal.mapCenter = { x: 0, z: 0 };
    }
    const player = world.getPlayerEntity();
    if (payload.player && player && isFiniteNumber(payload.player.x) && isFiniteNumber(payload.player.y) && isFiniteNumber(payload.player.z)) {
        player.x = payload.player.x;
        player.y = payload.player.y;
        player.z = payload.player.z;
        player.yaw = payload.player.yaw || 0;
        player.pitch = payload.player.pitch || 0;
    } else if (player) {
        const center = world._internal.mapCenter || { x: 0, z: 0 };
        player.x = Number(center.x) + 0.5;
        player.y = 2;
        player.z = Number(center.z) + 0.5;
        player.yaw = 0;
        player.pitch = 0;
    }
    if (payload.player && player) {
        if (payload.player.inventory && typeof payload.player.inventory === 'object') {
            player.inventory = { ...payload.player.inventory };
        }
        if (payload.player.itemInventory && typeof payload.player.itemInventory === 'object') {
            player.itemInventory = { ...payload.player.itemInventory };
        }
        if (typeof payload.player.portraitTextureKey === 'string' && payload.player.portraitTextureKey.trim()) {
            player.uiPortraitKey = payload.player.portraitTextureKey;
        }
        if (typeof payload.player.name === 'string' && payload.player.name.trim()) {
            player.name = payload.player.name.trim();
        }
        if (typeof payload.player.portrait === 'string' && payload.player.portrait.trim()) {
            // backward compatibility with old maps (path-based portrait)
            if (!player.uiPortraitKey) player.uiPortraitKey = 'ui_player_face';
        }
    }
}

let mapFileInput = null;
function requestMapImport(world) {
    if (!mapFileInput) {
        mapFileInput = document.createElement('input');
        mapFileInput.type = 'file';
        mapFileInput.accept = 'application/json';
        mapFileInput.style.display = 'none';
        document.body.appendChild(mapFileInput);
    }
    
    mapFileInput.value = '';
    mapFileInput.onchange = () => {
        const file = mapFileInput.files && mapFileInput.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const payload = JSON.parse(reader.result);
                applyMap(world, payload);
            } catch (err) {
                console.warn('Falha ao importar mapa:', err);
            }
        };
        reader.readAsText(file);
    };
    
    mapFileInput.click();
}

function dropSelectedBlock(world) {
    const player = world.getPlayerEntity();
    if (!player || !player.inventory) return;
    
    const count = player.inventory[player.selectedBlockType.id] || 0;
    if (count <= 0 && world.mode !== 'editor') return;
    
    if (world.mode !== 'editor') {
        player.inventory[player.selectedBlockType.id] = count - 1;
    }
    const forward = new THREE.Vector3();
    world._internal.camera.getWorldDirection(forward);
    const dropPos = {
        x: player.x + forward.x * 0.6,
        y: player.y + 1.1,
        z: player.z + forward.z * 0.6
    };
    const throwVelocity = forward.clone().multiplyScalar(0.5);
    spawnBlockDrop(world, player.selectedBlockType, 1, dropPos, {
        ignoreEntityId: player.id,
        ignoreUntil: performance.now() + 300,
        velocityY: 0,
        velocity: throwVelocity
    });
}

function buildSelectionList(world, player) {
    const list = [];
    if (!player) return list;
    
    const isEditor = world.mode === 'editor';
    if (!isEditor) {
        list.push({ kind: 'empty' });
    }
    Object.values(BLOCK_TYPES).forEach((blockType) => {
        const count = player.inventory ? (player.inventory[blockType.id] || 0) : 0;
        if (count > 0) {
            list.push({ kind: 'block', blockType });
        }
    });
    
    Object.values(ITEMS).forEach((itemDef) => {
        const count = player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
        if (count > 0) {
            list.push({ kind: 'item', itemDef });
        }
    });

    if (isEditor) {
        const spawners = Array.isArray(player.entitySpawners) ? player.entitySpawners : [];
        const npcList = spawners
            .map((entry) => {
                const npcType = getNpcTypeById(entry.npcTypeId);
                return npcType && { npcType, entry };
            })
            .filter(Boolean)
            .sort((a, b) => {
                const ia = FACTION_ORDER.indexOf(a.npcType.faction || '');
                const ib = FACTION_ORDER.indexOf(b.npcType.faction || '');
                const fa = ia === -1 ? 999 : ia;
                const fb = ib === -1 ? 999 : ib;
                if (fa !== fb) return fa - fb;
                return a.npcType.name.localeCompare(b.npcType.name);
            });
        npcList.forEach(({ npcType, entry }) => {
            list.push({ kind: 'entity', action: 'spawn', npcType, spawner: entry });
        });
        if (npcList.length) {
            list.push({ kind: 'entity', action: 'despawn' });
        }
    }
    
    return list;
}

function clearEntityInventory(entity) {
    if (!entity) return;
    entity.inventory = {};
    entity.itemInventory = {};
    entity.selectedBlockType = null;
}

function getSelectionIndex(list, player) {
    if (!player) return 0;
    if (player.selectedItem) {
        const idx = list.findIndex((entry) => (
            entry.kind === player.selectedItem.kind &&
            (entry.kind === 'block'
                ? entry.blockType.id === player.selectedItem.id
                : entry.kind === 'item'
                    ? entry.itemDef.id === player.selectedItem.id
                    : entry.kind === 'entity'
                        ? entry.action === player.selectedItem.action &&
                            (entry.action !== 'spawn' || (
                                (entry.npcType && entry.npcType.id === player.selectedItem.npcTypeId)
                            ))
                        : entry.kind === 'empty')
        ));
        if (idx >= 0) return idx;
    }
    if (player.selectedBlockType) {
        const idx = list.findIndex((entry) => entry.kind === 'block' && entry.blockType.id === player.selectedBlockType.id);
        if (idx >= 0) return idx;
    }
    return 0;
}

function applySelection(world, entry) {
    const player = world.getPlayerEntity();
    if (!player || !entry) return;
    
    if (entry.kind === 'block') {
        player.selectedBlockType = entry.blockType;
        player.selectedItem = { kind: 'block', id: entry.blockType.id };
    } else if (entry.kind === 'item') {
        player.itemInventory = player.itemInventory || {};
        if (world.mode === 'editor') {
            player.itemInventory[entry.itemDef.id] = Math.max(1, player.itemInventory[entry.itemDef.id] || 0);
        }
        player.selectedItem = { kind: 'item', id: entry.itemDef.id };
    } else if (entry.kind === 'empty') {
        player.selectedItem = { kind: 'empty' };
    } else if (entry.kind === 'entity') {
        player.selectedItem = {
            kind: 'entity',
            action: entry.action,
            npcTypeId: entry.npcType ? entry.npcType.id : null,
            spawnerConfig: entry.spawner
        };
    }
    
    updateCurrentItemLabel(world);
}

function updateCurrentItemLabel(world) {
    const label = document.getElementById('current-item');
    if (!label) return;
    if (world.mode === 'game') {
        label.style.display = 'none';
        return;
    }
    label.style.display = 'block';
    const player = world.getPlayerEntity();
    if (!player) {
        label.textContent = 'Item: -';
        return;
    }
    if (!player.selectedItem && player.selectedBlockType) {
        player.selectedItem = { kind: 'block', id: player.selectedBlockType.id };
    }
    if (!player.selectedItem) {
        label.textContent = 'Item: -';
        return;
    }
    if (player.selectedItem.kind === 'block') {
        const name = player.selectedBlockType ? player.selectedBlockType.name : '-';
        const count = player.selectedBlockType && player.inventory
            ? (player.inventory[player.selectedBlockType.id] || 0)
            : 0;
        const amount = world.mode === 'editor' ? '∞' : count;
        label.textContent = `Item: ${name} x${amount}`;
    } else if (player.selectedItem.kind === 'item') {
        const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
        const count = itemDef && player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
        const amount = world.mode === 'editor' ? '∞' : count;
        label.textContent = `Item: ${itemDef ? itemDef.name : '-'} x${amount}`;
    } else if (player.selectedItem.kind === 'empty') {
        label.textContent = 'Item: Mão';
    } else if (player.selectedItem.kind === 'entity') {
        if (player.selectedItem.action === 'despawn') {
            label.textContent = 'Item: Despawn';
        } else {
            const npcType = getNpcTypeById(player.selectedItem.npcTypeId);
            const factionLabel = npcType ? getFactionName(npcType.faction || 'neutral') : '-';
            label.textContent = `Item: Spawn ${npcType ? npcType.name : '-'} (${factionLabel})`;
        }
    }
}

function updateHud(world) {
    const hud = document.getElementById('hud');
    const hudText = document.getElementById('hud-text');
    const hudPreview = document.getElementById('hud-item-preview');
    const hudPhoto = document.getElementById('hud-player-photo');
    const hudName = document.getElementById('hud-player-name');
    if (!hud || !hudText || !hudPreview) return;
    if (world.mode !== 'game') {
        hud.style.display = 'none';
        updateHandOverlay(world, null);
        return;
    }
    hud.style.display = 'flex';
    
    const player = world.getPlayerEntity();
    if (!player) {
        hudText.textContent = 'HP: -\nItem: -\nCoins: -';
        hudPreview.style.backgroundImage = 'none';
        if (hudPhoto) hudPhoto.src = resolvePreviewTextureUrl('ui_player_face') || getGeneratedUiTextureDataUrl('ui_player_face');
        if (hudName) hudName.textContent = 'A.S.S';
        updateHandOverlay(world, null);
        return;
    }
    if (hudName) hudName.textContent = String(player.name || 'A.S.S');
    if (hudPhoto) {
        const portraitKey = player.uiPortraitKey || 'ui_player_face';
        hudPhoto.src = resolvePreviewTextureUrl(portraitKey) || getGeneratedUiTextureDataUrl('ui_player_face');
    }
    
    const hpMax = player.maxHP || 0;
    const hp = typeof player.hp === 'number' ? player.hp : 0;
    let itemName = '-';
    let itemCount = '-';
    if (!player.selectedItem && player.selectedBlockType) {
        player.selectedItem = { kind: 'block', id: player.selectedBlockType.id };
    }
    if (player.selectedItem) {
        if (player.selectedItem.kind === 'block') {
            itemName = player.selectedBlockType ? player.selectedBlockType.name : '-';
            itemCount = player.selectedBlockType && player.inventory
                ? (player.inventory[player.selectedBlockType.id] || 0)
                : 0;
        } else if (player.selectedItem.kind === 'item') {
            const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
            itemName = itemDef ? itemDef.name : '-';
            itemCount = itemDef && player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
        } else if (player.selectedItem.kind === 'empty') {
            itemName = 'Mão';
            itemCount = '-';
        } else if (player.selectedItem.kind === 'entity') {
            itemName = 'Spawner';
            itemCount = '-';
        }
    }
    
    hudText.textContent = `HP: ${hp}/${hpMax}\nItem: ${itemName} x${itemCount}\nCoins: -`;

    let previewKey = null;
    if (player.selectedItem) {
        if (player.selectedItem.kind === 'block') {
            previewKey = getBlockThumbnailTextureKey(player.selectedBlockType);
        } else if (player.selectedItem.kind === 'item') {
        const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
        previewKey = itemDef ? getItemTextureKey(itemDef, 'ui') : null;
        } else if (player.selectedItem.kind === 'entity') {
            const npcType = getNpcTypeById(player.selectedItem.npcTypeId);
            previewKey = npcType ? npcType.texture : null;
        }
    } else if (player.selectedBlockType) {
        previewKey = getBlockThumbnailTextureKey(player.selectedBlockType);
    }
    const previewUrl = resolvePreviewTextureUrl(previewKey);
    hudPreview.style.backgroundImage = previewUrl ? `url("${previewUrl}")` : 'none';

    updateHandOverlay(world, player);
}

function updateHandOverlay(world, player) {
    const hand = document.getElementById('hand-item');
    const handImg = document.getElementById('hand-item-image');
    if (!hand || !handImg) return;
    if (world.mode !== 'game') {
        hand.style.display = 'none';
        return;
    }
    let handKey = null;
    let useEmptyHand = true;
    if (player) {
        if (!player.selectedItem && player.selectedBlockType) {
            player.selectedItem = { kind: 'block', id: player.selectedBlockType.id };
        }
        if (player.selectedItem) {
            if (player.selectedItem.kind === 'block') {
                handKey = player.selectedBlockType
                    ? (player.selectedBlockType.handTextureKey || null)
                    : null;
                useEmptyHand = !handKey;
            } else if (player.selectedItem.kind === 'item') {
                const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
                handKey = itemDef ? (itemDef.handTextureKey || null) : null;
                useEmptyHand = !handKey;
            } else if (player.selectedItem.kind === 'empty') {
                useEmptyHand = true;
            }
        } else if (player.selectedBlockType) {
            handKey = player.selectedBlockType.handTextureKey || null;
            useEmptyHand = !handKey;
        }
    }
    const handUrl = resolvePreviewTextureUrl(handKey);
    const emptyHandUrl = resolvePreviewTextureUrl('empty-hand') ||
        ROM_RUNTIME.assetUrlByPath['images/empty-hand.png'] ||
        ROM_RUNTIME.assetUrlByPath['data/images/empty-hand.png'] ||
        resolvePreviewTextureUrl('empty_hand') ||
        resolvePreviewTextureUrl('ui_empty_hand');
    const finalUrl = handUrl || (useEmptyHand ? (emptyHandUrl || getGeneratedUiTextureDataUrl('ui_empty_hand')) : null);
    if (finalUrl) {
        handImg.src = finalUrl;
        hand.style.display = 'block';
    } else {
        hand.style.display = 'none';
    }
}

function handleUseAction(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    if (player.selectedItem && player.selectedItem.kind === 'item') {
        const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
        if (itemDef) {
            const count = player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
            if (world.mode === 'editor' || count > 0) {
                const used = useItem(world, player, itemDef, 1);
                if (used) {
                    if (itemDef.isConsumable && world.mode !== 'editor') {
                        player.itemInventory[itemDef.id] = Math.max(0, count - 1);
                    }
                    updateCurrentItemLabel(world);
                    return true;
                }
            }
        }
        return false;
    }
    if (world.ui.interactionTarget) {
        const target = world.ui.interactionTarget;
        if (target.type === 'npc') {
            handleInteraction(world, target);
            return true;
        }
        if (target.hasUseFunction) {
            handleInteraction(world, target);
            return true;
        }
    }
    return false;
}

// Modifique o onKeyDown para usar o marcador visual:
function onKeyDown(world, e) {
    world._internal.keys[e.code] = true;
    if (handleExclusiveMenuKeyDown(world, e)) return;
    const player = world.getPlayerEntity();
    if (e.code === 'F8') {
        e.preventDefault();
        const nextMode = world.mode === 'editor' ? 'game' : 'editor';
        setWorldMode(world, nextMode);
        return;
    }
    
    if (e.code === 'Space' && player.onGround) {
        player.velocityY = CONFIG.JUMP_FORCE;
        player.onGround = false;
    }
    
    if (e.code === 'KeyO') {
        exportMap(world);
    }
    if (e.code === 'KeyI') {
        requestMapImport(world);
    }

    
    
    if (world.mode === 'editor') {
        if (e.code === 'KeyQ') {
            dropSelectedBlock(world);
        }
    } else {
        if (e.code === 'KeyQ') {
            dropSelectedBlock(world);
        }
    }
    
    if (e.code === 'Digit1') selectBlockType(world, BLOCK_TYPES.STONE);
    if (e.code === 'Digit2') selectBlockType(world, BLOCK_TYPES.GRASS);
    if (e.code === 'Digit3') selectBlockType(world, BLOCK_TYPES.WOOD);
    if (e.code === 'Digit4') selectBlockType(world, BLOCK_TYPES.GOLD);
    if (e.code === 'Digit5') selectBlockType(world, BLOCK_TYPES.DOOR);
    if (e.code === 'Digit6') selectBlockType(world, BLOCK_TYPES.SAND);
}

function onWheel(world, event) {
    if (isExclusiveMenuOpen(world)) return;
    const player = world.getPlayerEntity();
    if (!player) return;
    const list = buildSelectionList(world, player);
    if (list.length === 0) return;
    
    event.preventDefault();
    const currentIndex = getSelectionIndex(list, player);
    const delta = event.deltaY > 0 ? 1 : -1;
    let nextIndex = (currentIndex + delta) % list.length;
    if (nextIndex < 0) nextIndex += list.length;
    applySelection(world, list[nextIndex]);
}

function stepSelection(world, delta) {
    const player = world.getPlayerEntity();
    if (!player) return;
    const list = buildSelectionList(world, player);
    if (list.length === 0) return;
    const currentIndex = getSelectionIndex(list, player);
    let nextIndex = (currentIndex + delta) % list.length;
    if (nextIndex < 0) nextIndex += list.length;
    applySelection(world, list[nextIndex]);
}

function onMouseMove(world, event) {
    if (isExclusiveMenuOpen(world)) return;
    if (document.pointerLockElement !== document.body) return;
    
    const player = world.getPlayerEntity();
    if (player) {
        player.yaw -= event.movementX * CONFIG.LOOK_SPEED;
        player.pitch -= event.movementY * CONFIG.LOOK_SPEED;
        player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
    }
}

function onMouseDown(world, event) {
    if (isExclusiveMenuOpen(world)) return;
    const isLocked = document.pointerLockElement === document.body;
    if (event.button === 1 && world.mode === 'editor') {
        if (isLocked) {
            document.exitPointerLock();
        }
        openEditorContextMenu(world, event);
        return;
    }
    if (!isLocked) return;
    if (event.button === 0) {
        if (world.mode === 'editor' && world._internal.editorMoveCommand) {
            commitEditorMoveCommand(world);
            return;
        }
        primaryAction(world);
    } else if (event.button === 2) {
        secondaryAction(world);
    }
}

function primaryAction(world) {
    if (world.mode === 'editor') {
        if (!removeTargetBlock(world)) {
            if (!removeTargetEntity(world)) {
                removeTargetItem(world);
            }
        }
    } else {
        createProjectile(world);
    }
}

function secondaryAction(world) {
    if (world.mode === 'editor') {
        const player = world.getPlayerEntity();
        const selection = player ? player.selectedItem : null;
        if (!selection) return;
        const targetPos = world.ui.targetBlockPosition || { x: player.x, y: player.y, z: player.z };
        if (selection.kind === 'entity' && selection.action === 'spawn') {
            const npcType = getNpcTypeById(selection.npcTypeId || (selection.spawnerConfig && selection.spawnerConfig.npcTypeId));
            if (npcType) {
                const spawnerConfig = selection.spawnerConfig || selection.spawner;
                createNpcEntity(world, npcType, { x: targetPos.x, y: targetPos.y + 0.5, z: targetPos.z }, null, null, {
                    inventory: spawnerConfig ? spawnerConfig.inventory : null,
                    itemInventory: spawnerConfig ? spawnerConfig.itemInventory : null,
                    selectedBlockTypeId: spawnerConfig ? spawnerConfig.selectedBlockTypeId : null
                });
            }
        } else if (selection.kind === 'item') {
            spawnItemDrop(world, selection.id, 1, { x: targetPos.x, y: targetPos.y + 0.5, z: targetPos.z });
        } else {
            placeBlock(world);
        }
    } else {
        if (!handleUseAction(world)) {
            placeBlock(world);
        }
    }
}


function isMobile() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function setupMobileControls(world) {
    if (!isMobile()) return;
    if (document.getElementById('mobile-controls')) return;
    
    document.documentElement.style.touchAction = 'none';
    
    const container = document.createElement('div');
    container.id = 'mobile-controls';
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '20';
    document.body.appendChild(container);
    
    const leftPad = document.createElement('div');
    leftPad.style.position = 'fixed';
    leftPad.style.left = '16px';
    leftPad.style.bottom = '16px';
    leftPad.style.display = 'grid';
    leftPad.style.gridTemplateColumns = '60px 60px 60px';
    leftPad.style.gridTemplateRows = '60px 60px 60px';
    leftPad.style.gap = '8px';
    leftPad.style.pointerEvents = 'auto';
    leftPad.style.zIndex = '2';
    container.appendChild(leftPad);
    
    const rightPad = document.createElement('div');
    rightPad.style.position = 'fixed';
    rightPad.style.right = '16px';
    rightPad.style.bottom = '16px';
    rightPad.style.display = 'grid';
    rightPad.style.gridTemplateColumns = '70px 70px';
    rightPad.style.gridTemplateRows = '60px 60px 60px';
    rightPad.style.gap = '8px';
    rightPad.style.pointerEvents = 'auto';
    rightPad.style.zIndex = '2';
    container.appendChild(rightPad);

    const topBar = document.createElement('div');
    topBar.style.position = 'fixed';
    topBar.style.top = '10px';
    topBar.style.left = '50%';
    topBar.style.transform = 'translateX(-50%)';
    topBar.style.display = 'grid';
    topBar.style.gridTemplateColumns = 'repeat(4, 70px)';
    topBar.style.gridAutoRows = '42px';
    topBar.style.gap = '6px';
    topBar.style.pointerEvents = 'auto';
    topBar.style.zIndex = '2';
    container.appendChild(topBar);
    
    const lookPad = document.createElement('div');
    lookPad.style.position = 'fixed';
    lookPad.style.inset = '0';
    lookPad.style.pointerEvents = 'auto';
    lookPad.style.background = 'transparent';
    lookPad.style.zIndex = '1';
    container.appendChild(lookPad);
    
    const makeButton = (label, onDown, onUp, size = 60) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.width = `${size}px`;
        btn.style.height = `${size}px`;
        btn.style.borderRadius = '10px';
        btn.style.border = '1px solid rgba(255,255,255,0.4)';
        btn.style.background = 'rgba(0,0,0,0.4)';
        btn.style.color = 'white';
        btn.style.fontFamily = 'inherit';
        btn.style.fontSize = '12px';
        btn.style.touchAction = 'none';
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            onDown();
        });
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (onUp) onUp();
        });
        return btn;
    };
    const makeTopButton = (label, onDown, onUp) => makeButton(label, onDown, onUp, 42);
    
    const pressKey = (code) => {
        world._internal.keys[code] = true;
    };
    const releaseKey = (code) => {
        world._internal.keys[code] = false;
    };
    const jumpAction = () => {
        const player = world.getPlayerEntity();
        if (!player) return;
        if (world.mode === 'editor') {
            pressKey('Space');
            return;
        }
        if (player.onGround) {
            player.velocityY = CONFIG.JUMP_FORCE;
            player.onGround = false;
        }
    };
    const jumpRelease = () => {
        if (world.mode === 'editor') {
            releaseKey('Space');
        }
    };
    const downAction = () => {
        if (world.mode === 'editor') {
            pressKey('ControlLeft');
        } else {
            pressKey('KeyC');
        }
    };
    const downRelease = () => {
        if (world.mode === 'editor') {
            releaseKey('ControlLeft');
        } else {
            releaseKey('KeyC');
        }
    };
    
    leftPad.appendChild(document.createElement('div'));
    leftPad.appendChild(makeButton('W', () => pressKey('KeyW'), () => releaseKey('KeyW')));
    leftPad.appendChild(document.createElement('div'));
    leftPad.appendChild(makeButton('A', () => pressKey('KeyA'), () => releaseKey('KeyA')));
    leftPad.appendChild(document.createElement('div'));
    leftPad.appendChild(makeButton('D', () => pressKey('KeyD'), () => releaseKey('KeyD')));
    leftPad.appendChild(document.createElement('div'));
    leftPad.appendChild(makeButton('S', () => pressKey('KeyS'), () => releaseKey('KeyS')));
    leftPad.appendChild(document.createElement('div'));
    
    rightPad.appendChild(makeButton('Shoot', () => primaryAction(world)));
    rightPad.appendChild(makeButton('Action', () => secondaryAction(world)));
    rightPad.appendChild(makeButton('Drop', () => dropSelectedBlock(world)));
    rightPad.appendChild(makeButton('Jump', jumpAction, jumpRelease));
    rightPad.appendChild(makeButton('Down', downAction, downRelease));

    topBar.appendChild(makeTopButton('Prev', () => stepSelection(world, -1)));
    topBar.appendChild(makeTopButton('Next', () => stepSelection(world, 1)));
    topBar.appendChild(makeTopButton('Mode', () => {
        const nextMode = world.mode === 'editor' ? 'game' : 'editor';
        setWorldMode(world, nextMode);
    }));
    topBar.appendChild(makeTopButton('Menu', () => {
        if (world.mode !== 'editor') return;
        openEditorContextMenu(world, {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
        });
    }));
    topBar.appendChild(makeTopButton('Export', () => exportMap(world)));
    topBar.appendChild(makeTopButton('Import', () => requestMapImport(world)));
    let lookActive = false;
    let lastX = 0;
    let lastY = 0;
    lookPad.addEventListener('touchstart', (e) => {
        if (e.target !== lookPad) return;
        lookActive = true;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    }, { passive: true });
    lookPad.addEventListener('touchend', () => {
        lookActive = false;
    });
    lookPad.addEventListener('touchmove', (e) => {
        if (!lookActive) return;
        const player = world.getPlayerEntity();
        if (!player) return;
        const dx = e.touches[0].clientX - lastX;
        const dy = e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        player.yaw -= dx * CONFIG.LOOK_SPEED;
        player.pitch -= dy * CONFIG.LOOK_SPEED;
        player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
    }, { passive: true });
}

function onWindowResize(world) {
    world._internal.camera.aspect = window.innerWidth / window.innerHeight;
    world._internal.camera.updateProjectionMatrix();
    world._internal.renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================
// LOOP DE ANIMAÇÃO
// ============================================================
// Substitua a função animate() no seu main.js por esta versão:

// Modifique a função animate para animar o marcador:
// Substitua a função animate() completa no seu main.js:

function animate(world) {
    requestAnimationFrame(() => animate(world));
    
    if (world._internal.texturesLoaded) {
        if (!world._internal.simulationPaused) {
            // Atualiza entidades
            world.entities.forEach(entity => updateEntity(world, entity));
            updateProjectiles(world);
            updateItems(world);
            updateMessages(world);
            checkInteractionTarget(world);
            updateEditorMovePreview(world);
            updateCurrentItemLabel(world);
            updateHud(world);
            updateUiLayoutRuntime(world);
            updateEditorCoords(world);
            
            // Atualiza câmera e listener de áudio
            const player = world.getPlayerEntity();
            if (player) {
                const camera = world._internal.camera;
                
                // Atualiza posição da câmera
                const eyeHeight = player.isCrouching
                    ? CONFIG.ENTITY_HEIGHT_CROUCHED * 0.8
                    : CONFIG.ENTITY_HEIGHT * 0.8;
                camera.position.set(player.x, player.y + eyeHeight, player.z);
                camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
                camera.updateMatrixWorld(); // IMPORTANTE: atualiza a matriz antes de pegar vetores
                
                // Pega vetores de direção atualizados
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
                
                // ============================================================
                // ATUALIZA LISTENER DO FMOD (automático a cada frame)
                // ============================================================
                audioSystem.setListenerPosition(
                    { x: player.x, y: player.y + eyeHeight, z: player.z },
                    { x: forward.x, y: forward.y, z: forward.z },
                    { x: up.x, y: up.y, z: up.z }
                );
            }
        }
    }
    
    // Atualiza sistema de áudio do FMOD
    audioSystem.update();
    
    // Renderiza a cena
    world._internal.renderer.render(world._internal.scene, world._internal.camera);
}

init();
