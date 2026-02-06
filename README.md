# estatal Engine + ROM Editor

This project is a browser 3D voxel game engine and a ROM-based content pipeline.
A ROM is a `.zip` package containing **all gameplay/config/map/assets data**.

The repository ships three main entry points:

- `index.html`: menu/launcher (pick ROM, then open play or editor)
- `play.html`: game runtime
- `editor.html`: full ROM/map/content editor

---

## 1. Core Concept

The project is built around a ROM-first workflow:

- The runtime can load game data from `?rom=some.zip` or `?romref=<indexeddb-token>`.
- The editor can import a ROM zip, edit everything, and export a new ROM zip.
- Config/data are JavaScript/JSON modules inside the ROM (`config/*.js`, `maps/*.json`, `images/*`, `audio/*`).

There are fallback files in `src/` for local development, but the intended flow is ROM-driven.

---

## 2. Quick Start

### 2.1 Serve locally (important)
Use a static HTTP server (not `file://`), because ES modules and MIME types are required.

Examples:

```bash
# Python
python3 -m http.server 3000

# Node (if installed)
npx serve -p 3000
```

Then open:

- `http://127.0.0.1:3000/index.html`

### 2.2 Default ROM behavior
If no ROM is specified, runtime/editor try `data.zip` by default.

### 2.3 URL params

- `?rom=data.zip`
- `?rom=/path/to/rom.zip`
- `?romref=<token>` (ROM blob stored in IndexedDB by launcher)
- `?map=map-name.json` (runtime map selection from ROM)
- `?rom=0` forces built-in/fallback mode

---

## 3. Project Structure

- `index.html`: ROM picker and launch links
- `play.html`: game page shell (crosshair/interactions + loads `src/main.js`)
- `editor.html`: complete editor app (map/content/ROM)

Engine modules:

- `src/main.js`: boot, ROM loading, input, UI overlays, mode switching, loop
- `src/world.js`: world state, block/entity lifecycle, terrain meshing orchestration
- `src/entity.js`: entity behavior, pathfinding, AI/faction combat, movement logic
- `src/bullet.js`: projectile spawning, hit detection, effects
- `src/item.js`: dropped items, pickup, item use
- `src/collision.js`: AABB collision and ground probes
- `src/surfaceNets.js`: terrain mesh generation algorithm
- `src/terrainWorker.js`: worker offload for terrain meshing
- `src/audio.js`: FMOD integration
- `src/inspector.js`: popup object inspector
- `src/menus.js`: default exclusive menu definitions

ROM config loader modules:

- `src/rom-config/rom_loader.js`
- `src/rom-config/config.js`
- `src/rom-config/blocks.js`
- `src/rom-config/items.js`
- `src/rom-config/npcs.js`
- `src/rom-config/textures.js`
- `src/rom-config/factions.js`
- `src/rom-config/menus.js`

---

## 4. Runtime Boot Sequence

High-level (`src/main.js`):

1. Imports config/content modules from `src/rom-config/*`.
2. Creates Three.js scene/camera/renderer.
3. Detects mode (`editor` or `game`/integrated).
4. Loads ROM at boot (`data.zip` or URL param).
5. Loads textures from ROM into `world._internal.blockTextures`.
6. Builds world/map/entities.
7. Starts animation loop.

During loading:

- A black loading overlay is shown.
- Renderer stays hidden until initialization completes.

Title behavior:

- In play mode, document title uses ROM/config game name.

---

## 5. ROM System (Runtime)

`loadRomFromZipFile(file)` in `src/main.js` does:

- Parse `config/blocks.js`, `items.js`, `npcs.js`, `textures.js`, `factions.js`.
- Replace in-memory registries (`BLOCK_TYPES`, `ITEMS`, `NPC_TYPES`, etc.).
- Resolve texture files in zip, create object URLs, map texture key -> blob URL.
- Load maps from `maps/*.json` (multi-map support).
- Set default map payload (`default.json` preferred).
- Optionally bind FMOD banks from ROM audio files.

Path resolution rules are flexible:

- Supports `config/...` and `data/config/...` style paths.
- Supports `maps/...` and `data/maps/...` style paths.

---

## 6. Data Model

### 6.1 World State (`src/world.js`)

Main arrays:

- `world.blocks`
- `world.entities`
- `world.projectiles`
- `world.items`
- `world.messages`

Core internals:

- Spatial hash by exact block coordinate
- Chunk map (`CHUNK_SIZE = 8`)
- Dirty chunk set for incremental terrain rebuild
- Terrain root group + per-chunk mesh groups

### 6.2 Map JSON

Export/import shape (`exportMap` / `applyMap`):

- `version`
- `player`: position, yaw/pitch, name, portrait texture key, inventories
- `blocks`: `{x,y,z,typeId,isFloor}`
- `items`: drop entries (`kind`, ids, amount, position)
- `entities`: NPC entries (type, faction, hp, inventories, position)

### 6.3 Config Modules in ROM

- `config/config.js`: game constants (movement, gravity, AI ranges, etc.)
- `config/blocks.js`: block definitions
- `config/items.js`: items/weapons/consumables
- `config/npcs.js`: creature templates
- `config/factions.js`: factions and relations
- `config/textures.js`: texture catalog (`key` -> `url`)
- `config/menus.js`: exclusive menu definitions
- `config/inventory-presets.json`: preset inventories (editor)
- `config/ui.json`: UI aliases + player portrait/name (editor)

---

## 7. Terrain Mesh Generation (Detailed)

This project does **not** render every solid block as visible cube geometry in normal mode.
It builds smooth-ish terrain meshes from block occupancy using a Surface Nets-like method.

### 7.1 Where it happens

- Orchestration: `src/world.js` (`rebuildTerrainMesh`, chunk management)
- Algorithm: `src/surfaceNets.js` (`buildSurfaceNetGeometryData`)
- Optional worker offload: `src/terrainWorker.js`

### 7.2 Chunk pipeline

For each dirty chunk:

1. Collect chunk + neighboring blocks (context margin).
2. Group blocks by `blockType.id`.
3. For each type group, generate mesh data (`positions`, `normals`, `uvs`).
4. Build Three.js `BufferGeometry` and assign material by block type texture.
5. Replace only rebuilt chunk groups.

This keeps updates incremental and fast for edits.

### 7.3 Voxel field construction

In `buildSurfaceNetGeometryData`:

- Blocks are converted to voxel coordinates using `subdivisions`.
- Field is a binary scalar grid (`Float32Array`) with occupancy 0/1.
- Optional shape modifiers:
  - `dilation`
  - `fillInset`
  - block damage influence (`dmg` shrinks fill)

### 7.4 Surface vertex placement

For each grid cell:

- Read 8 corner scalar values.
- Skip fully empty/full cells.
- Find intersected edges among 12 cube edges.
- Interpolate edge crossing point at `isoLevel`.
- Average all crossing points to place one cell vertex.

That is the key Surface Nets idea: one representative vertex per active cell.

### 7.5 Face generation

The algorithm then scans axis-aligned transitions (x/y/z directions):

- Detect sign changes in scalar field between neighboring samples.
- Build quads using adjacent cell vertices.
- Split each quad into 2 triangles (`emitTriangle`).
- Flip winding based on inside/outside sign to keep normals consistent.

### 7.6 Normals and UVs

- Triangle normal: cross product of edges.
- Same normal duplicated per triangle vertex.
- UVs use triplanar-like projection by dominant normal axis:
  - top-like faces use XZ
  - side-like faces use ZY or XY
- Separate scaling for top vs side UV density.

### 7.7 Runtime options used

In `world.rebuildTerrainMesh()` options vary by mode:

- `subdivisions`: higher in editor
- `padding`: neighborhood margin
- `isoLevel`
- `uvScaleTop`, `uvScaleSide(U/V)`
- `dilation`

### 7.8 Fallback and safety

- Worker failure falls back to main-thread generation.
- Geometry inputs are validated before mesh creation.
- Bounding volumes are computed for chunk meshes.

---

## 8. Collision, Camera, and Physics

### 8.1 Collision

`src/collision.js` uses AABB checks:

- Entity box vs nearby solid block boxes.
- Radius-based horizontal collision + dynamic height (crouch/stand).

### 8.2 Camera anti-clipping

`updatePlayerControlled` in `src/entity.js` performs extra head-level point probes using `checkPointCollision` around eye position before allowing movement.
This prevents camera penetration into walls (including corner cases).

### 8.3 Physics

- Gravity from config.
- Ground snap on collision.
- Fall damage based on fall distance threshold/multiplier.

---

## 9. AI and Pathfinding Algorithms

### 9.1 A* pathfinding (`src/entity.js`)

`findPath`:

- Grid-based A* over integer coordinates.
- Heuristic: Manhattan distance (`|dx|+|dy|+|dz|`).
- Neighbor generation includes:
  - walk
  - crouch path
  - jumps
  - short gap jumps
  - controlled drops

Costs are weighted (normal/crouch/jump/drop penalties).

### 9.2 Visibility and stealth

- FOV cone check (`VISION_FOV_DEG`)
- Distance range check
- Raycast line-of-sight against solid block meshes
- Proximity detection for non-crouching targets

### 9.3 Factions

- Per-entity faction id
- Hostility from `getFactionRelation(a,b)`
- AI targets visible hostile entities only

### 9.4 Combat

- NPCs can select best available weapon from inventories.
- Projectile systems support item and block projectiles.
- Cooldowns and range logic.

---

## 10. Rendering and Visual Layers

### 10.1 World

- Three.js scene + fog + directional/ambient light.
- Terrain mesh for solids.
- Cross-plane rendering for vegetation-like blocks (`render: 'cross'`).

### 10.2 UI/HUD

HUD is HTML overlay (`ensureHud` / `updateHud`) with:

- player portrait
- name
- hp/item info
- selected item preview

### 10.3 Hand overlay

`#hand-item` shows held item texture.
Fallback order includes:

- explicit hand texture
- `images/empty-hand.png` (ROM)
- generated emoji texture fallback

### 10.4 Generated UI textures

When missing, UI icons can be generated via canvas/emoji for keys like:

- `ui_player_face`
- sensed/faction status icons
- damage state icons
- empty hand

---

## 11. Exclusive Menu System

Implemented in `src/main.js` + default definitions in `src/menus.js`.

### 11.1 What "exclusive" means

When menu is open:

- Game renderer is hidden.
- Gameplay HUD is hidden.
- Simulation is paused.
- Menu receives mouse input.

### 11.2 Triggers

- ESC opens configured pause menu (`defaultEscapeMenu`).
- ESC closes/goes back menu stack.
- Pointer-lock ESC fallback also opens pause menu.
- Optional `startMenu` auto-opens at boot.

### 11.3 Menu element types

- `button`
- `input`
- `text`

### 11.4 Transform controls in runtime format

Each element supports:

- `x`, `y`, `width`, `height`
- `rotation`
- `flipX`, `flipY`
- `flatColor`, `textColor`
- `spriteKey`
- `fontSize`

### 11.5 Button actions

- `none`
- `close_menu`
- `back_menu`
- `open_menu` + `targetMenu`
- `script`

### 11.6 Script action API

`action: 'script'` executes custom JS with:

- `api.closeMenu()`
- `api.backMenu()`
- `api.openMenu(id)`
- `api.getVar(key)`
- `api.setVar(key,value)`
- `api.exportMap()`
- `api.importMap()`
- `api.menuId`

Text supports templating: `{{varName}}`, plus built-ins like `{{gameName}}`.

---

## 12. Input and Controls

## 12.1 Desktop

Movement/view:

- `W A S D`: move
- Mouse: look
- `Space`: jump
- `C`: crouch (game mode)
- Mouse wheel: cycle selected slot

Actions:

- Left click:
  - game: shoot
  - editor: remove target
- Right click:
  - game: use/interact/place
  - editor: place/spawn
- `Q`: drop selected block

Mode/debug:

- `F8`: toggle game/editor mode
- `F9`: toggle terrain mesh render path

Map import/export shortcuts:

- `O`: export map JSON
- `I`: import map JSON

Quick block select:

- `1..6`: direct block hotselect (`STONE`, `GRASS`, `WOOD`, `GOLD`, `DOOR`, `SAND`)

Menu:

- `Esc`: open/close/back exclusive menu

## 12.2 Mobile

`setupMobileControls` creates touch overlays:

- Left pad: WASD
- Right pad: Shoot / Action / Drop / Jump / Down
- Top bar: Prev / Next / Mode / Menu / Export / Import
- Full-screen look pad for touch camera control

---

## 13. Editor (Complete Feature Reference)

`editor.html` is a full ROM editor with top-level section dropdown.

### 13.1 ROM section

- Import ROM zip
- Export ROM zip
- Status logs

### 13.2 Map section

- Load `default.json`
- Import/export map JSON
- Clear map
- Multi-map manager:
  - select map
  - new/rename/delete map
- Set player spawn interactively (`Set player pos`)
- Edit player HUD portrait texture key + upload
- Edit player display name

### 13.3 Map tools section

- Tool mode:
  - block paint
  - creature place
  - item/weapon drop place
  - erase
- Y layer editing
- Brush or rectangle paint
- Zoom and catalog search
- Layer utilities:
  - copy current Y
  - paste to current Y
  - clear current Y

### 13.4 Palette section

- Search-filtered palette with texture thumbnails
- Contextual list based on active tool mode

### 13.5 Inventory section

Visual entity inventory editor:

- choose target entity/player
- choose category (blocks/items)
- add/remove/clear quantities
- apply inventory preset

### 13.6 Content sections

#### Blocks

- full block CRUD
- fields: id, name, HP, break dmg, opacity, solid/floor/droppable
- texture key + image upload + preview
- `onUse` script editor:
  - none
  - presets (`door_toggle`, `gold_flash`)
  - custom JS function

#### Items/Weapons

- full item/weapon CRUD
- consumable and heal fields
- damage/projectile speed/projectile damage
- projectile visual controls:
  - projectile texture key + upload + preview
  - projectile size
  - projectile gravity scale
  - projectile drag
- texture roles synchronized (`texture/ui/drop/hand`)

#### Creatures

- creature CRUD
- dimensions, hp, hostility, interactability
- faction assignment
- dialogue
- texture key/upload/preview

#### Factions

- faction CRUD
- full relation matrix editor (`friendly/neutral/hostile`)

#### Textures

- texture catalog CRUD
- key/url edit
- image upload + preview
- key rename refactor updates references across blocks/items/npcs

#### UI

- UI texture alias editor (`alias -> source texture key`)
- upload for alias
- preview

#### Menus

Visual exclusive-menu editor:

- menu CRUD
- set default ESC menu
- set start menu
- per-menu background color
- element CRUD (`button/input/text`)
- drag to move on stage
- resize using handle
- rotate with mouse wheel on stage
- flip X/Y
- text/placeholder/bind editing
- sprite key assignment
- action presets + custom script

#### Config

- direct JSON editor for `config.js` object
- save/reset in memory

#### Presets Inv.

Visual inventory preset manager:

- preset CRUD
- add/remove quantities by catalog (not raw JSON only)
- real-time preset content list

### 13.7 ROM export details

Editor export writes:

- `data/config/blocks.js`
- `data/config/items.js`
- `data/config/npcs.js`
- `data/config/config.js`
- `data/config/textures.js`
- `data/config/factions.js`
- `data/config/menus.js`
- `data/config/inventory-presets.json`
- `data/config/ui.json`
- `data/maps/*.json` (multi-map)
- embedded image binaries for uploaded textures
- `editor-manifest.json`

---

## 14. ROM Package Format

Canonical expected structure:

```text
<rom>.zip
  config/
    config.js
    blocks.js
    items.js
    npcs.js
    textures.js
    factions.js
    menus.js
    inventory-presets.json
    ui.json
  maps/
    default.json
    *.json
  images/
    ... png/jpg/webp
  audio/
    Master.bank
    Master.strings.bank
```

Compatibility:

- Loader also accepts `data/config`, `data/maps`, `data/images`, `data/audio` prefixes.

---

## 15. Audio (FMOD)

- FMOD is initialized lazily on first user gesture.
- Runtime tries to load:
  - `audio/Master.bank`
  - `audio/Master.strings.bank`
- If FMOD is unavailable or bank load fails, game continues without audio.

---

## 16. Editor and Runtime Inspector Tools

In editor mode (runtime), middle-click opens context menu with operations such as:

- control selected entity
- inspect entity/block/world in popup inspector
- edit entity inventory
- clone entity as spawn preset
- command NPC movement/look

`src/inspector.js` provides a tree editor popup with optional hot-reload apply behavior.

---

## 17. Performance Model

Main performance systems:

- Chunked terrain rebuild (dirty chunks only)
- Worker-based meshing when available
- Spatial hash lookup for blocks
- Conditional simulation pause during loading/exclusive menus

Editor mode rebuild policy is more immediate; game mode can delay rebuild (`terrainBuildDelay`) for smoother runtime.

---

## 18. Known Operational Notes

- Use HTTP server with correct module MIME types.
- If textures fail, check that `textures.js` keys point to files present in ROM.
- `romref` depends on IndexedDB storage from launcher.
- Exclusive menu definitions in ROM override default `src/menus.js`.

---

## 19. Important Runtime Constants

From `config/config.js` (ROM), common ones include:

- movement: `MOVE_SPEED`, `CROUCH_SPEED_MULTIPLIER`, `LOOK_SPEED`
- physics: `GRAVITY`, `JUMP_FORCE`, `ENTITY_HEIGHT`, `ENTITY_RADIUS`
- world: `WORLD_MAX_RADIUS`, `WORLD_MIN_Y`
- interaction: `INTERACTION_RANGE`, `PLACEMENT_RANGE`, `ITEM_PICKUP_RANGE`
- AI/path: `PATH_UPDATE_INTERVAL`, `MAX_PATH_ITERATIONS`
- combat: `HOSTILE_*`, `VISION_*`, `MELEE_*`
- damage: `FALL_DAMAGE_*`

---

## 20. Extending the Project

### 20.1 Add a new block type

1. Add entry in blocks editor (or `config/blocks.js`).
2. Assign texture key.
3. Add texture entry in textures catalog and image file.
4. Optionally add `onUse` function script.

### 20.2 Add a new gun/weapon

1. Create item with weapon enabled.
2. Set projectile fields (`projectileDamage`, `projectileSpeed`, etc.).
3. Set projectile texture key and upload image.

### 20.3 Add a custom menu flow

1. Open Menus editor tab.
2. Create menu and elements.
3. Add button actions (`open_menu`, `script`, etc.).
4. Set `startMenu` or `defaultEscapeMenu`.
5. Export ROM.

---

## 21. Security and Scripting Note

Several systems intentionally evaluate user-authored JS from ROM/editor data:

- block `onUse` custom functions
- menu button `script` action
- module parsing via transformed `export default` code

Treat ROM files as trusted content. Do not load untrusted ROMs in sensitive environments.

---

## 22. Practical Test Checklist

After editing/exporting a ROM, verify:

1. Play boot with `?rom=...` or launcher-selected ROM.
2. Terrain renders correctly and textures appear.
3. NPC factions/relations behave as expected.
4. Weapons fire with configured projectile visuals.
5. Exclusive start and pause menus work (`Esc`, start flow).
6. Map import/export and multi-map selection are correct.
7. Editor re-import of exported ROM preserves data.

