export interface LibraryPack {
  pack_id: string;
  name: string;
  group?: string;
  is_custom?: boolean;
}

export function readFavoriteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512)),
  ].slice(0, 1000);
}

export function filterPacks<T extends LibraryPack>(
  packs: T[],
  {
    query = '',
    favorites = [],
    favoritesOnly = false,
  }: {
    query?: string;
    favorites?: string[];
    favoritesOnly?: boolean;
  } = {},
): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const favoriteIds = new Set(favorites);
  return packs.filter((pack) => {
    if (favoritesOnly && !favoriteIds.has(pack.pack_id)) return false;
    const text = `${pack.name} ${pack.group ?? ''} ${pack.pack_id}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
