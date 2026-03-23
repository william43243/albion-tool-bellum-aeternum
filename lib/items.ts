// Complete Albion Online items database
// Source: ao-data/ao-bin-dumps (GitHub)
// Loaded from assets/items-db.json at runtime

import itemsData from '../assets/items-db.json';

export interface AlbionItem {
  id: string;   // UniqueName (API ID)
  n: string;    // English name
  t: string;    // Tier (1-8)
  c: string;    // Category (resource, equipment, weapon, mount, consumable, etc.)
  sc: string;   // Shop category
  ss: string;   // Shop subcategory
  iv: number;   // Item Value (for crafting fee calc, 0 if unknown)
}

// Type the imported JSON
const ALL_ITEMS: AlbionItem[] = itemsData as AlbionItem[];

export const ITEM_CATEGORIES = [
  'resource',
  'equipment',
  'weapon',
  'consumable',
  'mount',
  'farmable',
  'furniture',
  'journal',
  'trophy',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  resource: { fr: 'Ressources', en: 'Resources' },
  equipment: { fr: 'Équipement', en: 'Equipment' },
  weapon: { fr: 'Armes', en: 'Weapons' },
  consumable: { fr: 'Consommables', en: 'Consumables' },
  mount: { fr: 'Montures', en: 'Mounts' },
  farmable: { fr: 'Agriculture', en: 'Farming' },
  furniture: { fr: 'Mobilier', en: 'Furniture' },
  journal: { fr: 'Journaux', en: 'Journals' },
  trophy: { fr: 'Trophées', en: 'Trophies' },
};

/**
 * Search items by name or ID — returns max `limit` results for performance
 */
export function searchItems(
  query: string,
  category?: string,
  tier?: string,
  limit: number = 50
): AlbionItem[] {
  const q = query.toLowerCase();
  let count = 0;
  const results: AlbionItem[] = [];

  for (const item of ALL_ITEMS) {
    if (count >= limit) break;

    const matchesQuery =
      !q ||
      item.n.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q);

    const matchesCat = !category || item.c === category;
    const matchesTier = !tier || item.t === tier;

    if (matchesQuery && matchesCat && matchesTier) {
      results.push(item);
      count++;
    }
  }

  return results;
}

/**
 * Get item by exact ID
 */
export function getItemById(id: string): AlbionItem | undefined {
  return ALL_ITEMS.find((item) => item.id === id);
}

/**
 * Get total number of items in database
 */
export function getItemCount(): number {
  return ALL_ITEMS.length;
}
