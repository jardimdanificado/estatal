// ============================================================
// CONSTANTES E CONFIGURAÇÃO
// ============================================================
import CONFIG from "./data/config.js"
import NPC_TYPES from "./data/npcs.js"
import BLOCK_TYPES from "./data/blocks.js"
import texturesToLoad from "./data/textures.js"
import world from "./src/world.js"
import { updateEntity, updateHostileAI, checkInteractionTarget } from "./src/entity.js"
import { handleInteraction } from './src/entity.js';
import { createProjectile, placeBlock } from './src/bullet.js';
import { updateProjectiles } from './src/bullet.js';
import audioSystem from './src/audio.js';

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
    
    await initAudio();
    
    loadTextures(world);
    
    window.addEventListener('resize', () => onWindowResize(world));
    document.addEventListener('keydown', (e) => onKeyDown(world, e));
    document.addEventListener('keyup', (e) => world._internal.keys[e.code] = false);
    
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
            createWorld(world);
            createEntities(world);
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
function createWorld(world) {
    const MAP_W = world.mapData[0].length;
    const MAP_H = world.mapData.length;
    
    for (let z = 0; z < MAP_H; z++) {
        for (let x = 0; x < MAP_W; x++) {
            const typeId = world.mapData[z][x];
            
            world.addBlock( x, -0.5, z, BLOCK_TYPES.STONE, false);
            
            if (typeId > 0) {
                const blockType = Object.values(BLOCK_TYPES).find(bt => bt.id === typeId);
                if (blockType) {
                    world.addBlock( x, 0.5, z, blockType, false);
                    
                    if (typeId === 1 || Math.random() < 0.2) {
                        world.addBlock( x, 1.5, z, blockType, false);
                    }
                }
            }
        }
    }
}

function createEntities(world) {
    world.addEntity({
        name: 'Player',
        type: 'player',
        x: 7.5,
        y: 2,
        z: 5.5,
        isControllable: true,
        isInteractable: false,
        isEditor: true,
        inventory: {
            [BLOCK_TYPES.STONE.id]: 20,
            [BLOCK_TYPES.GRASS.id]: 30,
            [BLOCK_TYPES.WOOD.id]: 25,
            [BLOCK_TYPES.GOLD.id]: 10,
            [BLOCK_TYPES.DOOR.id]: 15,
            [BLOCK_TYPES.SAND.id]: 20
        },
        selectedBlockType: BLOCK_TYPES.GRASS,
        npcData: NPC_TYPES.VILLAGER
    });
    
    const npcSpawns = [
        { x: 3.5, z: 3.5, type: NPC_TYPES.VILLAGER },
        { x: 10.5, z: 5.5, type: NPC_TYPES.GUARD },
        { x: 7.5, z: 8.5, type: NPC_TYPES.MERCHANT }
    ];
    
    npcSpawns.forEach(spawn => {
        world.addEntity({
            name: spawn.type.name,
            type: 'npc',
            x: spawn.x,
            y: 2,
            z: spawn.z,
            hp: spawn.type.maxHP,
            maxHP: spawn.type.maxHP,
            isControllable: true,
            isInteractable: true,
            npcData: spawn.type,
            inventory: {
                [BLOCK_TYPES.STONE.id]: 50,
                [BLOCK_TYPES.GRASS.id]: 10,
                [BLOCK_TYPES.WOOD.id]: 10
            },
            selectedBlockType: BLOCK_TYPES.STONE,
            target: { x: spawn.x + 3, y: 2, z: spawn.z + 3 },
            onInteract: (world, entity) => {
                const dialogue = entity.npcData.dialogue;
                alert(`${entity.name}: ${dialogue}`);
                //audioSystem.playOneShot('event:/teste', { x: entity.x, y: entity.y, z: entity.z });
            }
        });
    });
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

// Variáveis globais (adicione no topo do main.js)
let fixedSoundPosition = null;
let soundMarker = null;

// Função para criar/atualizar marcador visual
function updateSoundMarker(world, position) {
    const scene = world._internal.scene;
    
    // Remove marcador antigo
    if (soundMarker) {
        scene.remove(soundMarker);
    }
    
    if (position) {
        // Cria novo marcador (esfera vermelha pulsante)
        const geometry = new THREE.SphereGeometry(0.3, 8, 8);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xff0000,
            transparent: true,
            opacity: 0.7
        });
        soundMarker = new THREE.Mesh(geometry, material);
        soundMarker.position.set(position.x, position.y + 0.5, position.z);
        scene.add(soundMarker);
        
        // Adiciona animação de pulso
        soundMarker.userData.pulse = 0;
    }
}

// Modifique o onKeyDown para usar o marcador visual:
function onKeyDown(world, e) {
    world._internal.keys[e.code] = true;
    const player = world.getPlayerEntity();
    
    if (e.code === 'Space' && player.onGround) {
        player.velocityY = CONFIG.JUMP_FORCE;
        player.onGround = false;
    }
    
    if (e.code === 'KeyE' && world.ui.interactionTarget) {
        handleInteraction(world, world.ui.interactionTarget);
    }
    
    if (e.code === 'Tab') {
        e.preventDefault();
        const nextIndex = (world.playerEntityIndex + 1) % world.entities.length;
        world.switchPlayerControl(nextIndex);
    }
    
    // MARCAR posição do som
    if (e.code === 'KeyT') {
        if (!fixedSoundPosition) {
            fixedSoundPosition = { x: player.x, y: player.y, z: player.z };
            updateSoundMarker(world, fixedSoundPosition);
            console.log('🎯 Posição marcada:', fixedSoundPosition);
            console.log('▶️ Pressione Y para tocar som nesta posição');
            console.log('🚶 Ande para longe e pressione Y novamente!');
        } else {
            fixedSoundPosition = null;
            updateSoundMarker(world, null);
            console.log('❌ Marcador removido');
        }
    }
    
    // TOCAR som na posição marcada
    if (e.code === 'KeyY') {
        if (!fixedSoundPosition) {
            console.log('⚠️ Pressione T primeiro para marcar!');
        } else {
            audioSystem.playOneShot('event:/teste', fixedSoundPosition);
            
            const dx = player.x - fixedSoundPosition.x;
            const dz = player.z - fixedSoundPosition.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            console.log(`🔊 Som na posição: (${fixedSoundPosition.x.toFixed(1)}, ${fixedSoundPosition.y.toFixed(1)}, ${fixedSoundPosition.z.toFixed(1)})`);
            console.log(`📏 Distância: ${distance.toFixed(1)} blocos`);
            console.log(`🎧 Volume esperado: ${distance < 5 ? 'ALTO 🔊' : distance < 10 ? 'MÉDIO 🔉' : 'BAIXO 🔈'}`);
        }
    }
    
    if (e.code === 'Digit1') selectBlockType(world, BLOCK_TYPES.STONE);
    if (e.code === 'Digit2') selectBlockType(world, BLOCK_TYPES.GRASS);
    if (e.code === 'Digit3') selectBlockType(world, BLOCK_TYPES.WOOD);
    if (e.code === 'Digit4') selectBlockType(world, BLOCK_TYPES.GOLD);
    if (e.code === 'Digit5') selectBlockType(world, BLOCK_TYPES.DOOR);
    if (e.code === 'Digit6') selectBlockType(world, BLOCK_TYPES.SAND);
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
    
    const player = world.getPlayerEntity();
    
    if (event.button === 0) {
        createProjectile(world);
    } else if (event.button === 2) {
        placeBlock(world);
    }
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
        checkInteractionTarget(world);
        
        // Anima marcador de som
        if (soundMarker) {
            soundMarker.userData.pulse += 0.1;
            const scale = 1 + Math.sin(soundMarker.userData.pulse) * 0.3;
            soundMarker.scale.set(scale, scale, scale);
        }
        
        // Atualiza câmera e listener de áudio
        const player = world.getPlayerEntity();
        if (player) {
            const camera = world._internal.camera;
            
            // Atualiza posição da câmera
            camera.position.set(player.x, player.y + 1.6, player.z);
            camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
            camera.updateMatrixWorld(); // IMPORTANTE: atualiza a matriz antes de pegar vetores
            
            // Pega vetores de direção atualizados
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            
            // ============================================================
            // ATUALIZA LISTENER DO FMOD (automático a cada frame)
            // ============================================================
            audioSystem.setListenerPosition(
                { x: player.x, y: player.y + 1.6, z: player.z }, // Mesma altura da câmera
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