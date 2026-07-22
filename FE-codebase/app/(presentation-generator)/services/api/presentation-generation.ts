// Backed by a curated, categorized subset of Tabler Icons (MIT) generated
// into public/static/icons/ — see FE-codebase/scripts/generate-tabler-icons.cjs.
// No network/backend round-trip: the index is a static JSON file served
// alongside the SVGs.

export type IconCategory = { id: string; label: string };
type IconIndexEntry = {
  name: string;
  category: string;
  outline: string;
  filled: string | null;
};
type IconIndex = { categories: IconCategory[]; icons: IconIndexEntry[] };

let cachedIndex: Promise<IconIndex> | null = null;

function loadIconIndex(): Promise<IconIndex> {
  if (!cachedIndex) {
    cachedIndex = fetch("/static/icons/index.json")
      .then((res) => (res.ok ? res.json() : { categories: [], icons: [] }))
      .catch(() => ({ categories: [], icons: [] }));
  }
  return cachedIndex;
}

export async function loadIconCategories(): Promise<IconCategory[]> {
  const index = await loadIconIndex();
  return index.categories;
}

// "fill"/"duotone" weights use the filled variant when one exists; every
// other weight (thin/light/regular/bold) uses the outline variant — Tabler
// only ships two real visual styles, unlike the app's older 6-weight scheme.
function urlForWeight(entry: IconIndexEntry, weight: string | undefined): string {
  const wantsFilled = weight === "fill" || weight === "duotone";
  if (wantsFilled && entry.filled) return entry.filled;
  return entry.outline;
}

export const PresentationGenerationApi = {
  async searchIcons(options: {
    query: string;
    limit?: number;
    icon_weight?: string;
    category?: string | null;
  }): Promise<string[]> {
    const index = await loadIconIndex();
    const query = options.query.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);

    const matches = index.icons.filter((entry) => {
      if (options.category && entry.category !== options.category) return false;
      if (terms.length === 0) return true;
      const haystack = `${entry.name} ${entry.category}`.replace(/-/g, " ");
      return terms.every((term) => haystack.includes(term));
    });

    return matches
      .slice(0, options.limit ?? 40)
      .map((entry) => urlForWeight(entry, options.icon_weight));
  },
};
