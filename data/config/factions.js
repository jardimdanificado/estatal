export const FACTIONS = {
    PLAYER: { id: 'player', name: 'Jogador' },
    VILLAGE: { id: 'village', name: 'Vila' },
    GUARD: { id: 'guard', name: 'Guarda' },
    OUTLAW: { id: 'outlaw', name: 'Bandidos' },
    BEAST: { id: 'beast', name: 'Feras' },
    AQUATIC: { id: 'aquatic', name: 'Aquaticos' },
    UNDEAD: { id: 'undead', name: 'Mortos-Vivos' },
    DEMON: { id: 'demon', name: 'Demônios' },
    PLANT: { id: 'plant', name: 'Plantas' },
    CONSTRUCT: { id: 'construct', name: 'Constructos' }
};

const FRIENDLY_GROUPS = {
    player: ['plant', 'player', 'village', 'guard'],
    village: ['plant', 'player', 'village', 'guard'],
    guard: ['plant', 'player', 'village', 'guard'],
    outlaw: ['outlaw'],
    beast: ['undead', 'demon', 'beast'],
    aquatic: ['aquatic'],
    undead: ['undead', 'demon', 'beast'],
    demon: ['undead', 'demon', 'beast'],
    plant: ['plant', 'player', 'village', 'guard'],
    construct: ['construct']
};

export const FACTION_RELATIONS = Object.values(FACTIONS).reduce((acc, faction) => {
    const id = faction.id;
    acc[id] = {};
    const friends = FRIENDLY_GROUPS[id] || [id];
    for (const other of Object.values(FACTIONS)) {
        acc[id][other.id] = friends.includes(other.id) ? 'friendly' : 'hostile';
    }
    return acc;
}, {});

export function getFactionRelation(a, b) {
    if (a === b) return 'friendly';
    const row = FACTION_RELATIONS[a];
    if (row && row[b]) return row[b];
    return 'hostile';
}

export const FACTION_ORDER = [
    FACTIONS.VILLAGE.id,
    FACTIONS.GUARD.id,
    FACTIONS.OUTLAW.id,
    FACTIONS.BEAST.id,
    FACTIONS.AQUATIC.id,
    FACTIONS.UNDEAD.id,
    FACTIONS.DEMON.id,
    FACTIONS.PLANT.id,
    FACTIONS.CONSTRUCT.id,
    FACTIONS.PLAYER.id
];
