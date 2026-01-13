// ============================================================
// CONSTANTES E CONFIGURAÇÃO
// ============================================================
import CONFIG from "../data/config/config.js"
import NPC_TYPES from "../data/config/npcs.js"
import BLOCK_TYPES from "../data/config/blocks.js"
import ITEMS from "../data/config/items.js"
import texturesToLoad from "../data/config/textures.js"
import world from "./world.js"
import { updateEntity, checkInteractionTarget } from "./entity.js"
import { handleInteraction } from './entity.js';
import { createProjectile, placeBlock } from './bullet.js';
import { updateProjectiles } from './bullet.js';
import { updateItems, spawnBlockDrop, spawnItemDrop } from './item.js';
import { useItem } from './item.js';
import { spawnMessage, updateMessages } from './message.js';
import audioSystem from './audio.js';

// ============================================================
// INICIALIZAÇÃO
// ============================================================
async function init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 1, 50);
    
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
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
    world.mode = getModeFromLocation();
    document.body.dataset.mode = world.mode;
    ensureItemLabel();
    ensureHud();
    setupMobileControls(world);
    
    await initAudio();
    
    loadTextures(world);
    
    window.addEventListener('resize', () => onWindowResize(world));
    document.addEventListener('keydown', (e) => onKeyDown(world, e));
    document.addEventListener('keyup', (e) => world._internal.keys[e.code] = false);
    document.addEventListener('wheel', (e) => onWheel(world, e), { passive: false });
    
    document.addEventListener('click', () => {
        document.body.requestPointerLock();
    });
    
    document.addEventListener('mousemove', (e) => onMouseMove(world, e));
    document.addEventListener('mousedown', (e) => onMouseDown(world, e));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    animate(world);
}

// ============================================================
// INICIALIZAÇÃO DE ÁUDIO
// ============================================================
async function initAudio() {
    try {
        await audioSystem.init();
        
        // Carrega o banco Master
        await audioSystem.loadBank('./data/audio/Master.bank', true);
        
        // Carrega o banco de strings (necessário para resolver nomes de eventos)
        await audioSystem.loadBank('./data/audio/Master.strings.bank', false);
        
        console.log('✅ Audio FMOD ready');
    } catch (error) {
        console.warn('⚠️ FMOD não disponível - jogo rodando sem áudio');
        console.warn('Para habilitar áudio: baixe FMOD em https://www.fmod.com/download');
    }
}

// ============================================================
// CARREGAMENTO DE TEXTURAS
// ============================================================
function loadTextures(world) {
    const loader = new THREE.TextureLoader();
    let loaded = 0;
    const total = texturesToLoad.length;
    
    function checkLoaded() {
        loaded++;
        if (loaded === total) {
            world._internal.texturesLoaded = true;
            initWorld(world);
        }
    }
    
    texturesToLoad.forEach(({ key, url }) => {
        loader.load(url, (tex) => {
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            world._internal.blockTextures[key] = tex;
            checkLoaded();
        }, undefined, () => {
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
            
            ctx.fillStyle = colors[key] || '#888888';
            ctx.fillRect(0, 0, 16, 16);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            world._internal.blockTextures[key] = texture;
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
}

function createPlayer(world) {
    const isEditor = world.mode === 'editor';
    const editorInventory = {};
    if (isEditor) {
        Object.values(BLOCK_TYPES).forEach((blockType) => {
            editorInventory[blockType.id] = 999;
        });
    }

    world.addEntity({
        name: 'Player',
        type: 'player',
        x: 7.5,
        y: 2,
        z: 5.5,
        isControllable: true,
        isInteractable: false,
        isEditor: isEditor,
        noClip: isEditor,
        inventory: isEditor ? editorInventory : {
            [BLOCK_TYPES.STONE.id]: 20,
            [BLOCK_TYPES.GRASS.id]: 30,
            [BLOCK_TYPES.WOOD.id]: 25,
            [BLOCK_TYPES.GOLD.id]: 10,
            [BLOCK_TYPES.DOOR.id]: 15,
            [BLOCK_TYPES.SAND.id]: 20
        },
        itemInventory: {},
        selectedBlockType: BLOCK_TYPES.GRASS,
        selectedItem: { kind: 'block', id: BLOCK_TYPES.GRASS.id },
        npcData: null,
        hp: isEditor ? 999999 : 100,
        maxHP: isEditor ? 999999 : 100
    });
}

function createNpcEntity(world, npcType, position) {
    const entity = world.addEntity({
        name: npcType.name,
        type: 'npc',
        x: position.x,
        y: position.y,
        z: position.z,
        hp: npcType.maxHP,
        maxHP: npcType.maxHP,
        isControllable: true,
        isInteractable: true,
        npcData: npcType,
        npcTypeId: npcType.id,
        inventory: {
            [BLOCK_TYPES.STONE.id]: 50,
            [BLOCK_TYPES.GRASS.id]: 10,
            [BLOCK_TYPES.WOOD.id]: 10
        },
        selectedBlockType: BLOCK_TYPES.STONE,
        target: null,
        onInteract: (world, entity) => {
            const dialogue = entity.npcData.dialogue;
            if (entity.audioInstance) {
                audioSystem.stopEvent(entity.audioInstance, true);
                entity.audioInstance = null;
            }

            audioSystem.playEvent('event:/teste', {}, { autoStart: true }).then((instance) => {
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
    hud.textContent = 'HP: -\nItem: -\nCoins: -';
    hud.style.position = 'fixed';
    hud.style.top = '10px';
    hud.style.left = '10px';
    hud.style.color = 'white';
    hud.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    hud.style.fontSize = '14px';
    hud.style.lineHeight = '1.4';
    hud.style.whiteSpace = 'pre-line';
    hud.style.zIndex = '10';
    document.body.appendChild(hud);
}

function getModeFromLocation() {
    if (window.__MODE__ === 'editor' || window.__MODE__ === 'shooter') {
        return window.__MODE__;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'editor' ? 'editor' : 'shooter';
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

function buildEditorDefaultMap() {
    const blocks = [];
    const size = 16;
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            blocks.push({
                x,
                y: -0.5,
                z,
                typeId: BLOCK_TYPES.GRASS.id,
                isFloor: true
            });
        }
    }
    blocks.push({
        x: Math.floor(size / 2),
        y: 0.5,
        z: Math.floor(size / 2),
        typeId: BLOCK_TYPES.PLAYER_SPAWN.id,
        isFloor: false
    });
    return {
        version: 1,
        player: { x: 7.5, y: 2, z: 7.5, yaw: 0, pitch: 0 },
        blocks,
        items: [],
        entities: []
    };
}

async function loadInitialMap(world) {
    await loadMapFromUrl(world, './data/maps/default.json');
}

async function loadMapFromUrl(world, url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Map fetch failed: ${response.status}`);
        const payload = await response.json();
        applyMap(world, payload);
    } catch (err) {
        console.warn('Falha ao carregar mapa, usando default:', err);
        applyMap(world, buildEditorDefaultMap());
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
                x: entity.x,
                y: entity.y,
                z: entity.z,
                yaw: entity.yaw || 0,
                pitch: entity.pitch || 0,
                hp: entity.hp,
                maxHP: entity.maxHP,
                isHostile: !!entity.isHostile
            }))
    };
    
    const player = world.getPlayerEntity();
    if (player) {
        payload.player = {
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: player.yaw || 0,
            pitch: player.pitch || 0
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
    
    for (const entry of payload.blocks) {
        const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === entry.typeId);
        if (!blockType) continue;
        world.addBlock(entry.x, entry.y, entry.z, blockType, entry.isFloor);
    }
    
    if (Array.isArray(payload.items)) {
        for (const entry of payload.items) {
            if (entry.kind === 'block') {
                const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === entry.blockTypeId);
                if (!blockType) continue;
                spawnBlockDrop(world, blockType, entry.amount || 1, { x: entry.x, y: entry.y, z: entry.z });
            } else if (entry.kind === 'item') {
                spawnItemDrop(world, entry.itemId, entry.amount || 1, { x: entry.x, y: entry.y, z: entry.z });
            }
        }
    }
    
    if (Array.isArray(payload.entities)) {
        for (const entry of payload.entities) {
            if (entry.type !== 'npc') continue;
            const npcType = getNpcTypeById(entry.npcTypeId);
            let entity = null;
            if (npcType) {
                entity = createNpcEntity(world, npcType, { x: entry.x, y: entry.y, z: entry.z });
            }
            if (!entity) continue;
            entity.yaw = entry.yaw || 0;
            entity.pitch = entry.pitch || 0;
            if (typeof entry.hp === 'number') entity.hp = entry.hp;
            if (typeof entry.maxHP === 'number') entity.maxHP = entry.maxHP;
            entity.isHostile = !!entry.isHostile;
        }
    }
    
    let spawnBlock = world.blocks.find((block) => block.type && block.type.id === BLOCK_TYPES.PLAYER_SPAWN.id);
    if (spawnBlock) {
        world._internal.mapCenter = { x: spawnBlock.x, z: spawnBlock.z };
    } else if (payload.player) {
        world._internal.mapCenter = { x: payload.player.x, z: payload.player.z };
    } else {
        world._internal.mapCenter = { x: 0, z: 0 };
    }
    const player = world.getPlayerEntity();
    if (spawnBlock && player) {
        player.x = spawnBlock.x;
        player.y = spawnBlock.y + 1;
        player.z = spawnBlock.z;
        player.yaw = 0;
        player.pitch = 0;
    } else if (payload.player && player) {
        player.x = payload.player.x;
        player.y = payload.player.y;
        player.z = payload.player.z;
        player.yaw = payload.player.yaw || 0;
        player.pitch = payload.player.pitch || 0;
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
        if (isEditor || count > 0) {
            list.push({ kind: 'block', blockType });
        }
    });
    
    Object.values(ITEMS).forEach((itemDef) => {
        const count = player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
        if (isEditor || count > 0) {
            list.push({ kind: 'item', itemDef });
        }
    });

    if (isEditor) {
        Object.values(NPC_TYPES).forEach((npcType) => {
            list.push({ kind: 'entity', action: 'spawn', npcType });
        });
        list.push({ kind: 'entity', action: 'despawn' });
    }
    
    return list;
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
            npcTypeId: entry.npcType ? entry.npcType.id : null
        };
    }
    
    updateCurrentItemLabel(world);
}

function updateCurrentItemLabel(world) {
    const label = document.getElementById('current-item');
    if (!label) return;
    if (world.mode === 'shooter') {
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
        label.textContent = 'Item: Vazio';
    } else if (player.selectedItem.kind === 'entity') {
        if (player.selectedItem.action === 'despawn') {
            label.textContent = 'Item: Despawn';
        } else {
            const npcType = getNpcTypeById(player.selectedItem.npcTypeId);
            label.textContent = `Item: Spawn ${npcType ? npcType.name : '-'}`;
        }
    }
}

function updateHud(world) {
    const hud = document.getElementById('hud');
    if (!hud) return;
    if (world.mode !== 'shooter') {
        hud.style.display = 'none';
        return;
    }
    hud.style.display = 'block';
    
    const player = world.getPlayerEntity();
    if (!player) {
        hud.textContent = 'HP: -\nItem: -\nCoins: -';
        return;
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
            itemName = 'Vazio';
            itemCount = '-';
        } else if (player.selectedItem.kind === 'entity') {
            itemName = 'Spawner';
            itemCount = '-';
        }
    }
    
    const coins = player.itemInventory ? (player.itemInventory.coin || 0) : 0;
    hud.textContent = `HP: ${hp}/${hpMax}\nItem: ${itemName} x${itemCount}\nCoins: ${coins}`;
}

function handleUseAction(world) {
    const player = world.getPlayerEntity();
    if (!player) return;
    if (player.selectedItem && player.selectedItem.kind === 'item') {
        const itemDef = Object.values(ITEMS).find((item) => item.id === player.selectedItem.id);
        if (itemDef) {
            const count = player.itemInventory ? (player.itemInventory[itemDef.id] || 0) : 0;
            if (world.mode === 'editor' || count > 0) {
                useItem(world, player, itemDef, 1);
                if (itemDef.isConsumable && world.mode !== 'editor') {
                    player.itemInventory[itemDef.id] = Math.max(0, count - 1);
                }
                updateCurrentItemLabel(world);
                return true;
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
    const player = world.getPlayerEntity();
    
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
        if (e.code === 'KeyN') {
            if (!player) return;
            player.noClip = !player.noClip;
            spawnMessage(world, `Noclip ${player.noClip ? 'ON' : 'OFF'}`, {
                relative: player,
                offset: { x: 0, y: 2.2, z: 0 },
                duration: 1500
            });
        }
        if (e.code === 'KeyQ') {
            dropSelectedBlock(world);
        }
    } else {
        if (e.code === 'KeyQ') {
            dropSelectedBlock(world);
        }
    }
    
    if (e.code === 'Tab') {
        e.preventDefault();
        const nextIndex = (world.playerEntityIndex + 1) % world.entities.length;
        world.switchPlayerControl(nextIndex);
        updateCurrentItemLabel(world);
    }
    
    if (e.code === 'Digit1') selectBlockType(world, BLOCK_TYPES.STONE);
    if (e.code === 'Digit2') selectBlockType(world, BLOCK_TYPES.GRASS);
    if (e.code === 'Digit3') selectBlockType(world, BLOCK_TYPES.WOOD);
    if (e.code === 'Digit4') selectBlockType(world, BLOCK_TYPES.GOLD);
    if (e.code === 'Digit5') selectBlockType(world, BLOCK_TYPES.DOOR);
    if (e.code === 'Digit6') selectBlockType(world, BLOCK_TYPES.SAND);
}

function onWheel(world, event) {
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

function onMouseMove(world, event) {
    if (document.pointerLockElement !== document.body) return;
    
    const player = world.getPlayerEntity();
    if (player) {
        player.yaw -= event.movementX * CONFIG.LOOK_SPEED;
        player.pitch -= event.movementY * CONFIG.LOOK_SPEED;
        player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
    }
}

function onMouseDown(world, event) {
    if (document.pointerLockElement !== document.body) return;
    if (event.button === 0) {
        primaryAction(world);
    } else if (event.button === 2) {
        secondaryAction(world);
    }
}

function primaryAction(world) {
    if (world.mode === 'editor') {
        const player = world.getPlayerEntity();
        const selection = player ? player.selectedItem : null;
        if (selection && selection.kind === 'entity' && selection.action === 'despawn') {
            if (!removeTargetItem(world)) {
                if (!removeTargetEntity(world)) {
                    removeTargetBlock(world);
                }
            }
        } else {
            removeTargetBlock(world);
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
            const npcType = getNpcTypeById(selection.npcTypeId);
            if (npcType) {
                createNpcEntity(world, npcType, { x: targetPos.x, y: targetPos.y + 0.5, z: targetPos.z });
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
    
    const lookPad = document.createElement('div');
    lookPad.style.position = 'fixed';
    lookPad.style.inset = '0';
    lookPad.style.pointerEvents = 'auto';
    lookPad.style.background = 'transparent';
    lookPad.style.zIndex = '1';
    container.appendChild(lookPad);
    
    const makeButton = (label, onDown, onUp) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.width = '60px';
        btn.style.height = '60px';
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
    leftPad.appendChild(makeButton('S', () => pressKey('KeyS'), () => releaseKey('KeyS')));
    leftPad.appendChild(makeButton('D', () => pressKey('KeyD'), () => releaseKey('KeyD')));
    leftPad.appendChild(document.createElement('div'));
    leftPad.appendChild(makeButton('Jump', jumpAction, jumpRelease));
    leftPad.appendChild(makeButton('Down', downAction, downRelease));
    
    rightPad.appendChild(makeButton('Shoot', () => primaryAction(world)));
    rightPad.appendChild(makeButton('Action', () => secondaryAction(world)));
    rightPad.appendChild(makeButton('Drop', () => dropSelectedBlock(world)));
    rightPad.appendChild(makeButton('Noclip', () => {
        if (world.mode !== 'editor') return;
        const player = world.getPlayerEntity();
        if (!player) return;
        player.noClip = !player.noClip;
    }));
    
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
        // Atualiza entidades
        world.entities.forEach(entity => updateEntity(world, entity));
        updateProjectiles(world);
        updateItems(world);
        updateMessages(world);
        checkInteractionTarget(world);
        updateCurrentItemLabel(world);
        updateHud(world);
        
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
    
    // Atualiza sistema de áudio do FMOD
    audioSystem.update();
    
    // Renderiza a cena
    world._internal.renderer.render(world._internal.scene, world._internal.camera);
}

init();
