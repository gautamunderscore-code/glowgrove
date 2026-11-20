// Content packs: plants, mushrooms and birds are data, not code.
// New species can be added by publishing a new JSON pack, with no app update.

export async function loadContentPack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load content pack ${url} (${res.status})`);
  return indexPack(await res.json());
}

export function indexPack(pack) {
  return {
    ...pack,
    placeableById: new Map(pack.placeables.map((p) => [p.id, p])),
    birdById: new Map(pack.birds.map((b) => [b.id, b])),
  };
}
