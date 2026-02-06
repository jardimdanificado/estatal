import { loadFactionsFromRom } from './rom_loader.js';

const fallback = {
  FACTIONS: { neutral: { id: 'neutral', name: 'Neutral' }, PLAYER: { id: 'player', name: 'Player' } },
  FACTION_RELATIONS: { neutral: { neutral: 'friendly', player: 'neutral' }, player: { player: 'friendly', neutral: 'neutral' } },
  FACTION_ORDER: ['player', 'neutral']
};

const loaded = await loadFactionsFromRom('config/factions.js', fallback);

export const FACTIONS = loaded.FACTIONS;
export const FACTION_RELATIONS = loaded.FACTION_RELATIONS;
export const FACTION_ORDER = loaded.FACTION_ORDER;

export function getFactionRelation(a, b) {
  if (a === b) return 'friendly';
  const row = FACTION_RELATIONS[a];
  if (row && row[b]) return row[b];
  return 'hostile';
}
