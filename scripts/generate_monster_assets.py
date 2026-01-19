#!/usr/bin/env python3
import re
from pathlib import Path
from typing import Dict, List, Optional

MONSTER_ROOT = Path('data/images/dcss/monster')
TEXTURES_FILE = Path('data/config/textures.js')
NPC_FILE = Path('data/config/npcs.js')
AUTO_TEXTURES_FILE = Path('data/config/auto-monster-textures.js')
AUTO_NPCS_FILE = Path('data/config/auto-monster-npcs.js')

PART_SUFFIXES = (
    '_top', '_bottom', '_head', '_body', '_tail', '_front', '_back',
    '_left', '_right', '_arm', '_leg', '_wing', '_wings', '_core'
)

DEFAULT_STATS = {
    'faction': 'demon',
    'isHostile': True,
    'interactable': False,
    'width': 0.9,
    'height': 1.7,
    'maxHP': 220,
    'maxHunger': 140,
    'maxThirst': 130,
    'hungerDecay': 0.03,
    'thirstDecay': 0.03,
    'itemDrops': {'food_meat_ration': 1}
}

CATEGORY_OVERRIDES: Dict[str, Dict] = {
    '': {'faction': 'demon'},
    'animals': {'faction': 'animal_predator', 'maxHP': 160, 'width': 0.8, 'height': 1.4},
    'aquatic': {'faction': 'aquatic', 'maxHP': 150, 'height': 1.1},
    'abyss': {'faction': 'abyss', 'maxHP': 260, 'width': 1.0, 'height': 1.9, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'aberration': {'faction': 'demon', 'maxHP': 240, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'aberrations': {'faction': 'demon', 'maxHP': 240, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'demons': {'faction': 'demon', 'maxHP': 280, 'width': 1.05, 'height': 2.0, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'demonspawn': {'faction': 'demon', 'maxHP': 300, 'width': 1.1, 'height': 2.1, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'dragons': {'faction': 'demon', 'maxHP': 360, 'width': 1.2, 'height': 2.3, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'draco': {'faction': 'demon', 'maxHP': 300, 'width': 1.15, 'height': 2.2},
    'draconic': {'faction': 'demon', 'maxHP': 300, 'width': 1.1, 'height': 2.1},
    'unique': {'faction': 'demon', 'maxHP': 340, 'width': 1.15, 'height': 2.2, 'itemDrops': {'food_piece_of_ambrosia': 1}},
    'amorphous': {'faction': 'demon', 'maxHP': 200, 'itemDrops': {'food_chunk': 1}},
    'eyes': {'faction': 'spirit', 'maxHP': 150, 'width': 0.7, 'height': 0.9},
    'holy': {'faction': 'spirit', 'maxHP': 220},
    'plants': {'faction': 'plant', 'maxHP': 160, 'isHostile': False},
    'fungi_plants': {'faction': 'infested_plant', 'maxHP': 150, 'itemDrops': {'food_honeycomb': 1}},
    'humanoids': {'faction': 'demon', 'maxHP': 210},
    'humanoids/demonspawn': {'faction': 'demon', 'maxHP': 260},
    'humanoids/elves': {'faction': 'demon', 'maxHP': 220},
    'humanoids/giants': {'faction': 'beast', 'maxHP': 320, 'width': 1.3, 'height': 2.3},
    'humanoids/humans': {'faction': 'demon', 'maxHP': 200},
    'humanoids/orcs': {'faction': 'demon', 'maxHP': 230},
    'humanoids/spriggans': {'faction': 'animal_predator', 'maxHP': 220},
    'demihumanoids': {'faction': 'demon', 'maxHP': 210},
    'demihumanoids/merfolk': {'faction': 'aquatic', 'maxHP': 180, 'height': 1.4},
    'demihumanoids/naga': {'faction': 'demon', 'maxHP': 230},
    'demihumanoids/taurs': {'faction': 'beast', 'maxHP': 220},
    'mutantbeast': {'faction': 'beast', 'maxHP': 240},
    'nonliving': {'faction': 'construct', 'maxHP': 260, 'isHostile': False, 'itemDrops': {}},
    'nonliving/shadows': {'faction': 'undead', 'maxHP': 200},
    'panlord': {'faction': 'demon', 'maxHP': 280},
    'player': {'faction': 'player', 'isHostile': False},
    'sprint': {'faction': 'demon', 'maxHP': 250},
    'statues': {'faction': 'construct', 'maxHP': 240, 'isHostile': False, 'itemDrops': {}},
    'spriggan': {'faction': 'animal_predator', 'maxHP': 220},
    'skeletons': {'faction': 'undead', 'maxHP': 190, 'itemDrops': {'food_chunk_rotten': 1}},
    'undead': {'faction': 'undead', 'maxHP': 190, 'itemDrops': {'food_chunk_rotten': 1}},
    'undead/bound_souls': {'faction': 'undead', 'maxHP': 200},
    'undead/draugr': {'faction': 'undead', 'maxHP': 220},
    'undead/simulacra': {'faction': 'undead', 'maxHP': 210},
    'undead/skeletons': {'faction': 'undead', 'maxHP': 210},
    'undead/spectrals': {'faction': 'undead', 'maxHP': 180},
    'undead/zombies': {'faction': 'undead', 'maxHP': 200},
    'vault': {'faction': 'guard', 'maxHP': 260},
}



TEXTURE_PATTERN = re.compile(r"\{\s*key:\s*'([^']+)',\s*url:\s*'([^']+)'\s*\}")
TEXTURE_URL_MONSTER = '/monster/'
NPC_TEXTURE_PATTERN = re.compile(r"texture:\s*'([^']+)'" )
ID_PATTERN = re.compile(r"id:\s*(\d+)")


def parse_existing_texture_keys() -> set:
    text = TEXTURES_FILE.read_text()
    return {
        key
        for key, url in TEXTURE_PATTERN.findall(text)
        if TEXTURE_URL_MONSTER in url
    }


def parse_existing_npc_texture_keys() -> set:
    text = NPC_FILE.read_text()
    return set(NPC_TEXTURE_PATTERN.findall(text))


def get_max_npc_id() -> int:
    text = NPC_FILE.read_text()
    ids = [int(match) for match in ID_PATTERN.findall(text)]
    return max(ids) if ids else 0


def normalized_name(filename: str) -> (str, Optional[str]):
    variant = None
    base = filename
    for suffix in ('_old', '_new'):
        if base.endswith(suffix):
            variant = suffix.lstrip('_')
            base = base[: -len(suffix)]
            break
    return base or filename, variant


def should_skip_base(base: str) -> bool:
    lower = base.lower()
    return any(lower.endswith(suffix) for suffix in PART_SUFFIXES)


def normalize_category_path(parent: Path) -> str:
    if not parent or parent == Path('.'):
        return ''
    return parent.as_posix()


def format_entry_name(base: str) -> str:
    clean = base.replace('_', ' ').replace('-', ' ')
    words = [w.capitalize() for w in clean.split() if w]
    return ' '.join(words) if words else base.capitalize()


def format_key(base: str) -> str:
    return 'AUTO_' + re.sub(r'[^A-Za-z0-9]', '_', base).upper()


def get_category_stats(category_path: Optional[str]) -> Dict:
    stats = dict(DEFAULT_STATS)
    if not category_path:
        override = CATEGORY_OVERRIDES.get('')
        if override:
            stats.update(override)
        return stats
    parts = category_path.split('/')
    for depth in range(len(parts), 0, -1):
        key = '/'.join(parts[:depth]).lower()
        override = CATEGORY_OVERRIDES.get(key)
        if override:
            stats.update(override)
            return stats
    override = CATEGORY_OVERRIDES.get(parts[0].lower())
    if override:
        stats.update(override)
    return stats


def write_textures(entries: List[Dict]):
    lines = ['export default [']
    for entry in entries:
        lines.append(f"    {{ key: '{entry['key']}', url: '{entry['url']}' }},")
    lines.append('];')
    AUTO_TEXTURES_FILE.write_text('\n'.join(lines) + '\n')


def format_value(value):
    if isinstance(value, str):
        return f"'{value}'"
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, dict):
        items = ', '.join(f"{k}: {format_value(v)}" for k, v in value.items())
        return '{ ' + items + ' }'
    return str(value)


def write_npcs(entries: Dict[str, Dict]):
    lines = ['export default {']
    for key, entry in entries.items():
        lines.append(f"    {key}: {{")
        for prop, val in entry.items():
            lines.append(f"        {prop}: {format_value(val)},")
        lines.append('    },')
    lines.append('};')
    AUTO_NPCS_FILE.write_text('\n'.join(lines) + '\n')


def main():
    if not MONSTER_ROOT.exists():
        raise SystemExit('monster folder missing')
    existing_texture_keys = parse_existing_texture_keys()
    existing_npc_textures = parse_existing_npc_texture_keys()
    max_id = get_max_npc_id()

    base_map: Dict[str, Dict] = {}

    for path in sorted(MONSTER_ROOT.rglob('*.png')):
        rel = path.relative_to(MONSTER_ROOT)
        parts = rel.parts
        base_name, variant = normalized_name(path.stem)
        if should_skip_base(base_name):
            continue
        if base_name in ('', '.', '..'):
            continue
        store = base_map.get(base_name)
        replace = False
        if store is None:
            replace = True
        else:
            existing_variant = store.get('variant')
            if existing_variant != 'old' and variant == 'old':
                replace = True
        if replace:
            category_path = normalize_category_path(rel.parent)
            base_map[base_name] = {
                'path': path,
                'variant': variant,
                'category_path': category_path
            }

    texture_entries = []
    npc_entries: Dict[str, Dict] = {}
    next_id = max_id + 1

    for base in sorted(base_map):
        texture_key = f'monster_{base}'
        entry_data = base_map[base]
        if texture_key not in existing_texture_keys:
            texture_entries.append({
                'key': texture_key,
                'url': f"./{entry_data['path'].as_posix()}"
            })
        if texture_key in existing_npc_textures:
            continue
        stats = get_category_stats(entry_data.get('category_path'))
        name = format_entry_name(base)
        entry = {
            'id': next_id,
            'name': name,
            'texture': texture_key,
            'width': stats['width'],
            'height': stats['height'],
            'interactable': stats.get('interactable', False),
            'faction': stats['faction'],
            'isHostile': stats['isHostile'],
            'maxHP': stats['maxHP'],
            'maxHunger': stats['maxHunger'],
            'maxThirst': stats['maxThirst'],
            'hungerDecay': stats['hungerDecay'],
            'thirstDecay': stats['thirstDecay']
        }
        drops = stats.get('itemDrops') or {}
        if drops:
            entry['itemDrops'] = drops
        key_label = format_key(base)
        npc_entries[key_label] = entry
        next_id += 1

    write_textures(texture_entries)
    write_npcs(npc_entries)
    print(f'Generated {len(texture_entries)} auto textures and {len(npc_entries)} auto NPCs.')


if __name__ == '__main__':
    main()
