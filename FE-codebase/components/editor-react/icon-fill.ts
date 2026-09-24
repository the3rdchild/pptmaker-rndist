import { PresentationGenerationApi } from "@/app/(presentation-generator)/services/api/presentation-generation";
import { type Rec } from "@/components/editor-react/deck-layout-picker";
import { isTextLike } from "@/components/editor-react/text-fit";

/* ---------------------------- Icon auto-fill ------------------------------ */
//
// Every template pack's icon slots are hardcoded to this exact placeholder
// SVG, never swapped — confirmed by inspecting all 4 packs' template.json.
// The slots themselves (position/size within a card) are already correctly
// authored; only the actual icon graphic needs to change per slide.

const PLACEHOLDER_ICON_SRC = "/static/icons/placeholder.svg";

function isPlaceholderIcon(el: Rec): boolean {
  return el.type === "image" && el.is_icon === true && el.data === PLACEHOLDER_ICON_SRC;
}

// The icon index is a small (~120) curated set of single-word Tabler icons
// (see searchIcons in presentation-generation.ts). Its matcher is AND-based —
// EVERY whitespace-separated term in the query must be a substring of an
// icon's "name category" haystack (hyphens flattened to spaces). A real card
// title like "Responsible Tourism Practices" therefore matches NOTHING, which
// is why the placeholder icons were never getting swapped in practice: the
// old code searched the full title verbatim. So instead we tokenize the title,
// map each keyword to a concept icon (below), and fall back to searching the
// individual words. Synonym VALUES must be space-separated words that appear
// in an icon's name/category (never hyphenated — the matcher won't find
// "trending-up" but will find "trending up").
const ICON_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "at", "by",
  "your", "our", "their", "its", "is", "are", "be", "how", "what", "why", "when",
  "this", "that", "these", "those", "as", "we", "you", "it", "from", "into",
  "dan", "atau", "yang", "di", "ke", "untuk", "dengan", "pada", "adalah", "cara",
  "kita", "kami", "para", "akan", "agar", "serta", "juga", "ini", "itu",
]);

const ICON_SYNONYMS: Record<string, string> = {
  growth: "trending up", grow: "trending up", growing: "trending up", increase: "trending up",
  scale: "trending up", scaling: "trending up", revenue: "report money", profit: "coin",
  income: "coin", money: "wallet", finance: "wallet", financial: "wallet", cost: "credit card",
  price: "credit card", pricing: "credit card", budget: "receipt", invoice: "receipt",
  sales: "shopping cart", sell: "shopping cart", ecommerce: "shopping cart", shop: "shopping cart",
  store: "building bank", bank: "building bank", banking: "building bank",
  market: "chart bar", marketing: "speakerphone", advertising: "speakerphone",
  analytics: "chart line", analysis: "chart line", metric: "gauge", metrics: "gauge",
  statistics: "chart bar", stats: "chart bar", performance: "gauge", measure: "gauge",
  report: "file text", reporting: "file text", dashboard: "gauge",
  strategy: "target", strategic: "target", goal: "target", goals: "target", objective: "target",
  target: "target", mission: "flag", vision: "bulb", plan: "checklist", planning: "checklist",
  roadmap: "route", journey: "route", path: "route", direction: "route", step: "checklist",
  steps: "checklist", process: "refresh", cycle: "refresh", workflow: "refresh",
  team: "users", teams: "users", teamwork: "users group", people: "users", staff: "users",
  collaboration: "users group", collaborate: "users group", partner: "users group",
  partnership: "users group", community: "users group", audience: "users", member: "user",
  members: "users", customer: "user circle", customers: "users", client: "user circle",
  clients: "users", user: "user", users: "users", leadership: "crown", leader: "crown",
  ceo: "crown", founder: "crown", idea: "bulb", ideas: "bulb", innovation: "bulb",
  innovative: "bulb", creative: "brush", creativity: "brush", design: "palette",
  branding: "palette", solution: "puzzle", solutions: "puzzle", integration: "puzzle",
  technology: "cpu", tech: "cpu", digital: "cpu", software: "code", develop: "code",
  development: "code", developer: "code", coding: "code", programming: "code",
  engineering: "settings", ai: "robot", automation: "robot", machine: "robot", robot: "robot",
  cloud: "cloud", hosting: "cloud", security: "shield lock", secure: "shield lock",
  privacy: "lock", protection: "shield check", safety: "shield check", compliance: "shield check",
  device: "device laptop", laptop: "device laptop", computer: "device laptop",
  mobile: "device mobile", phone: "phone", app: "device mobile", application: "device mobile",
  network: "wifi", internet: "wifi", connection: "wifi", connectivity: "wifi",
  infrastructure: "server", server: "server", hardware: "cpu", database: "database",
  data: "database", storage: "database", communication: "message", communicate: "message",
  chat: "message circle", messaging: "message", message: "message", email: "mail",
  contact: "mail", inbox: "mail", call: "phone", social: "share", sharing: "share",
  share: "share", global: "world", world: "world", international: "world", worldwide: "world",
  reach: "world", time: "clock", schedule: "calendar", timing: "clock", deadline: "alarm",
  timeline: "calendar event", event: "calendar event", events: "calendar event",
  history: "hourglass", duration: "hourglass", speed: "bolt", energy: "bolt", power: "bolt",
  fast: "rocket", launch: "rocket", startup: "rocket", start: "rocket", boost: "rocket",
  accelerate: "rocket", quality: "award", award: "award", achievement: "award",
  achieve: "award", success: "star", successful: "star", win: "star", winning: "star",
  best: "star", excellence: "star", premium: "star", rating: "star", review: "star",
  feedback: "star", document: "file text", documentation: "file text", file: "file",
  files: "folder", folder: "folder", content: "clipboard", checklist: "checklist",
  task: "clipboard check", tasks: "clipboard check", todo: "clipboard check",
  note: "notebook", notes: "notebook", book: "book", education: "book", learning: "book",
  learn: "book", knowledge: "book", training: "book", course: "book", study: "book",
  research: "book", guide: "book", location: "map pin", place: "map pin", travel: "map pin",
  tourism: "map pin", tourist: "map pin", trip: "map pin", map: "map pin",
  destination: "map pin", region: "map pin", area: "map pin", health: "heart",
  healthcare: "heart", care: "heart", wellness: "heart", love: "heart", passion: "heart",
  environment: "leaf", environmental: "leaf", nature: "leaf", natural: "leaf", green: "leaf",
  sustainability: "leaf", sustainable: "leaf", eco: "leaf", climate: "leaf", ocean: "world",
  marine: "world", forest: "leaf", forests: "leaf", tree: "leaf", trees: "leaf", woodland: "leaf",
  jungle: "leaf", plant: "leaf", plants: "leaf", flora: "leaf", biodiversity: "world",
  wildlife: "world", animal: "world", animals: "world", species: "world", ecosystem: "world",
  conservation: "leaf", habitat: "leaf", carbon: "cloud", emission: "cloud", emissions: "cloud",
  pollution: "cloud", smoke: "cloud", fire: "alert triangle", burning: "alert triangle",
  blaze: "alert triangle", deforest: "alert triangle", deforestation: "alert triangle",
  logging: "alert triangle", threat: "alert triangle", threats: "alert triangle",
  danger: "alert triangle", endangered: "alert triangle", protect: "shield check",
  preserve: "leaf", preservation: "leaf", restore: "refresh",
  restoration: "refresh", renewable: "refresh",
  water: "world", river: "world", lake: "world", sea: "world", benefit: "thumb up", benefits: "thumb up", advantage: "thumb up",
  pros: "thumb up", feature: "star", features: "star", value: "star", values: "heart",
  service: "headset", services: "headset", support: "headset", help: "headset",
  assistance: "headset", info: "info circle", information: "info circle", detail: "info circle",
  details: "info circle", about: "info circle", overview: "info circle", warning: "alert triangle",
  risk: "alert triangle", risks: "alert triangle", problem: "alert triangle",
  challenge: "alert triangle", challenges: "alert triangle", issue: "alert triangle",
  photo: "photo", image: "photo", picture: "photo", gallery: "photo", video: "video",
  media: "movie", music: "music", audio: "music", camera: "camera", product: "gift",
  products: "gift", gift: "gift", offer: "gift", company: "building skyscraper",
  business: "briefcase", corporate: "building skyscraper", office: "briefcase",
  enterprise: "building skyscraper", organization: "building skyscraper", industry: "building skyscraper",
  presentation: "presentation", meeting: "users group", conference: "users group",
  chart: "chart bar", graph: "chart line", trend: "trending up", percent: "percentage",
  percentage: "percentage", conversion: "percentage", productivity: "gauge",
  efficiency: "gauge", flexible: "puzzle", scalable: "trending up", secure2: "lock",
};

// Guaranteed-nonempty decorative pool: when a card's title maps to no concept
// icon, we still drop in one of these (rotated across the deck) so the slot is
// a real icon rather than the bland placeholder box. Same "space-separated,
// must exist in the index" rule as synonym values.
const ICON_DECOR_FALLBACK = [
  "bulb", "target", "star", "rocket", "checklist", "chart bar",
  "puzzle", "award", "leaf", "flag", "bolt", "thumb up",
];
let decorFallbackCursor = 0;

function iconQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ICON_STOPWORDS.has(w));
}

async function searchOneIcon(term: string): Promise<string | null> {
  const r = await PresentationGenerationApi.searchIcons({ query: term, limit: 1 }).catch(
    () => [] as string[],
  );
  return r[0] ?? null;
}

/** Best content-relevant icon URL for a card title/label: concept synonyms
 * first (so "growth" → a trending-up icon, not a literal "growth" search that
 * matches nothing), then the individual words. Null if the title yields no
 * match at all (caller then uses the decorative fallback). */
async function pickIconUrl(query: string): Promise<string | null> {
  const tokens = iconQueryTokens(query);
  for (const t of tokens) {
    const syn = ICON_SYNONYMS[t];
    if (syn) {
      const url = await searchOneIcon(syn);
      if (url) return url;
    }
  }
  for (const t of tokens) {
    const url = await searchOneIcon(t);
    if (url) return url;
  }
  return null;
}

async function pickDecorFallbackIcon(): Promise<string | null> {
  for (let i = 0; i < ICON_DECOR_FALLBACK.length; i++) {
    const name = ICON_DECOR_FALLBACK[decorFallbackCursor++ % ICON_DECOR_FALLBACK.length];
    const url = await searchOneIcon(name);
    if (url) return url;
  }
  return null;
}

interface IconScope {
  icons: Rec[];
  text: string;
  /** Present when this scope's card has NO existing icon slot at all — the
   *  card node to synthesize+inject a new icon element into (see injectIcon).
   *  Nil for cards that already had a placeholder icon (swap-only path). */
  injectCard?: Rec;
}

function collectPlaceholderIcons(node: Rec, out: Rec[]): void {
  if (isPlaceholderIcon(node)) {
    out.push(node);
    return;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) collectPlaceholderIcons(child, out);
    return;
  }
  const child = node.child as Rec | undefined;
  if (child) collectPlaceholderIcons(child, out);
}

function firstTextUnder(node: Rec): string {
  if (isTextLike(node)) {
    const runs = (node.runs as Rec[] | undefined) ?? [];
    return runs.map((r) => String(r.text ?? "")).join("");
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      const t = firstTextUnder(child);
      if (t) return t;
    }
    return "";
  }
  const child = node.child as Rec | undefined;
  return child ? firstTextUnder(child) : "";
}

/** Splits a component element into icon "scopes" so each card in a grid gets
 * its OWN title as the icon query, instead of every card in the grid sharing
 * card #1's title (the old bug). A card grid (grid/flex with >1 children) →
 * one scope per card; anything else → one scope for the whole element.
 *
 * Cards that have NO placeholder icon at all still get a scope (with
 * `injectCard` set) so fillPlaceholderIcons can synthesize a new icon for
 * them — otherwise whole packs (e.g. `standard`, ~0 icon slots per layout)
 * would render decks with zero icons forever. */
function collectIconScopes(el: Rec, scopes: IconScope[]): void {
  const children = el.children as Rec[] | undefined;
  if ((el.type === "grid" || el.type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const card of children) {
      const text = firstTextUnder(card);
      const icons: Rec[] = [];
      collectPlaceholderIcons(card, icons);
      if (icons.length) {
        scopes.push({ icons, text });
      } else if (text) {
        scopes.push({ icons, text, injectCard: card });
      }
    }
    return;
  }
  const text = firstTextUnder(el);
  const icons: Rec[] = [];
  collectPlaceholderIcons(el, icons);
  if (icons.length) {
    scopes.push({ icons, text });
  } else if (text) {
    scopes.push({ icons, text, injectCard: el });
  }
}

/** Replaces every placeholder icon in `ui` with a real, content-relevant icon
 * (per-card title as the query), falling back to `fallbackQuery` (the slide's
 * title) and then to a rotating decorative icon so NO slot is left as the
 * bland placeholder box.
 *
 * Also SYNTHESIZES a new icon element for cards that never had one (whole
 * packs like `standard` ship with ~0 icon slots, so without this their decks
 * render with no icons at all). */
export async function fillPlaceholderIcons(ui: Rec, fallbackQuery: string): Promise<Rec> {
  const components = (ui.components as Rec[]) ?? [];
  const scopes: IconScope[] = [];
  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) collectIconScopes(el, scopes);
  }
  if (!scopes.length) return ui;

  const urlByIcon = new Map<Rec, string>();
  // injectCard → resolved icon URL to synthesize for that card.
  const injectByCard = new Map<Rec, string>();
  await Promise.all(
    scopes.map(async (scope) => {
      const relevant = await pickIconUrl(scope.text || fallbackQuery);
      for (const icon of scope.icons) {
        const url = relevant ?? (await pickDecorFallbackIcon());
        if (url) urlByIcon.set(icon, url);
      }
      if (scope.injectCard) {
        const url = relevant ?? (await pickDecorFallbackIcon());
        if (url) injectByCard.set(scope.injectCard, url);
      }
    }),
  );
  if (!urlByIcon.size && !injectByCard.size) return ui;

  // Inject synthesized icon elements into card nodes first (mutating the
  // captured card objects in place), so the patch walk below then sees them
  // as ordinary children to clone.
  injectByCard.forEach((url, card) => injectIconIntoCard(card, url));

  // fillLayout mutates elements in place (setText etc.) rather than cloning,
  // so the node references captured above are still the exact objects that
  // will be encountered here — safe to match by identity.
  function patch(node: Rec): Rec {
    if (isPlaceholderIcon(node) && urlByIcon.has(node)) {
      return { ...node, data: urlByIcon.get(node) };
    }
    let next = node;
    if (Array.isArray(next.children)) {
      next = { ...next, children: (next.children as Rec[]).map(patch) };
    }
    if (next.child && typeof next.child === "object") {
      next = { ...next, child: patch(next.child as Rec) };
    }
    return next;
  }

  return {
    ...ui,
    components: components.map((component) => ({
      ...component,
      elements: ((component.elements as Rec[]) ?? []).map(patch),
    })),
  };
}

/** Minimum card size (area) before we bother injecting an icon — tiny rows
 *  (e.g. a tight comparison bullet) would just get cluttered. */
const ICON_INJECT_MIN_AREA = 18000;
const ICON_TILE_SIZE = 72;

/** True if the card contains a text element whose box width is at least 85%
 *  of the card width AND sits in the card's top third (where the injected
 *  top-corner tile would land). Used to avoid overlapping a centered/wide
 *  heading. The threshold is high (0.85) so typical card titles — which span
 *  much of the card width but leave the corner clear — still get an icon;
 *  only genuinely full-bleed centered headings are skipped. */
function hasWideText(card: Rec, cardWidth: number): boolean {
  let found = false;
  const visit = (node: Rec | undefined): void => {
    if (!node) return;
    const type = node.type;
    if (type === "text" || type === "text-list") {
      const sz = node.size as { width?: number } | undefined;
      const pos = node.position as { y?: number } | undefined;
      const w = typeof sz?.width === "number" ? sz.width : 0;
      const y = typeof pos?.y === "number" ? pos.y : 0;
      const cardH = (card.size as { height?: number } | undefined)?.height ?? 0;
      if (w >= cardWidth * 0.85 && y < cardH / 3) found = true;
      return;
    }
    const children = node.children as Rec[] | undefined;
    if (Array.isArray(children)) {
      for (const c of children) visit(c);
      return;
    }
    if (node.child && typeof node.child === "object") visit(node.child as Rec);
  };
  visit(card);
  return found;
}

/** Synthesizes a rounded accent tile + tinted icon and appends it to the
 *  card's children (positioned in the card's top-right corner). Mutates the
 *  card node in place. No-op if the card has no readable size, is too small,
 *  or already carries a wide/centered title that the tile would overlap —
 *  overlapping a full-width centered heading is worse than having no icon.
 *  The tile's rectangle fill + the icon's tint both get recolored later by
 *  applyPaletteToUi (rectangle → shape, is_icon image → icon hue). */
function injectIconIntoCard(card: Rec, iconUrl: string): void {
  const size = card.size as { width?: number; height?: number } | undefined;
  const width = typeof size?.width === "number" ? size.width : 0;
  const height = typeof size?.height === "number" ? size.height : 0;
  if (!width || !height || width * height < ICON_INJECT_MIN_AREA) return;

  // Skip when a text element already spans most of the card width — its
  // rendered glyph run would collide with a top-corner tile. Cards like
  // `centered_card_row`'s portrait cards (centered full-width name) sit here.
  if (hasWideText(card, width)) return;

  const margin = Math.max(20, Math.round(Math.min(width, height) * 0.08));
  const tileSize = Math.min(ICON_TILE_SIZE, Math.round(Math.min(width, height) * 0.22));
  const iconSize = Math.round(tileSize * 0.6);
  const tileX = width - tileSize - margin;
  const tileY = margin;

  const tile = {
    type: "rectangle",
    position: { x: tileX, y: tileY },
    size: { width: tileSize, height: tileSize },
    fill: { color: "#9333EA", opacity: 1 },
    border_radius: {
      tl: tileSize / 2,
      tr: tileSize / 2,
      bl: tileSize / 2,
      br: tileSize / 2,
    },
    decorative: true,
    name: "injected_icon_tile",
  };
  const icon = {
    type: "image",
    position: {
      x: tileX + (tileSize - iconSize) / 2,
      y: tileY + (tileSize - iconSize) / 2,
    },
    size: { width: iconSize, height: iconSize },
    data: iconUrl,
    fit: "contain",
    color: "#FFFFFF",
    decorative: true,
    name: "injected_icon",
    is_icon: true,
  };

  // Card node is either a group/container with a `children` array, or a
  // container with a single `child`. Promote single-child containers to a
  // children array so the injected icon renders as a sibling.
  const children = (card.children as Rec[] | undefined) ?? [];
  if (Array.isArray(card.children)) {
    card.children = [...children, tile, icon];
    return;
  }
  if (card.child && typeof card.child === "object") {
    card.children = [card.child as Rec, tile, icon];
    delete card.child;
    return;
  }
  card.children = [tile, icon];
}
