export type HtmlImageSource = "ai" | "stock";

type GenerateAi = (
  token: string,
  prompt: string,
  options: { model?: string; size: string },
) => Promise<string | null>;

type SearchStock = (
  preferredId: null,
  query: string,
  options: { page: number; perPage: number },
) => Promise<{ provider?: string; results: Array<{
  id?: string;
  url: string;
  provider?: string;
  description?: string;
  tags?: string[];
  credit?: string;
  creditUrl?: string;
  sourceUrl?: string;
  downloadLocation?: string;
}> }>;

export type ResolvedPhoto = {
  url: string;
  extra?: {
    credit?: string;
    credit_url?: string | null;
    source_url?: string;
  };
};

export type PhotoContext = {
  slideNumber?: number;
  heading?: string;
  /** The approved per-slide "Isi Gambar" value. */
  subject?: string;
};

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "with", "and", "or",
  "that", "this", "such", "as", "is", "are", "be", "high", "quality", "related",
  "topic", "scene", "landscape", "orientation", "wide", "cinematic", "documentary",
  "photograph", "photo", "image", "editorial", "refined", "full", "size", "natural",
  "lighting", "cohesive", "color", "grading", "composition", "guidance", "background",
  "backdrop", "shot", "view", "inside", "showing", "shows", "featuring", "feature",
  "gambar", "foto", "sinematik", "dokumenter", "lebar", "latar", "menampilkan",
  "memperlihatkan", "suasana", "di", "dan", "yang", "untuk", "dengan", "dari", "pada",
  "sebuah", "salah", "satu",
]);

function contentWords(value: string): string[] {
  const clean = value.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .filter((word) => !STOPWORDS.has(word));
}

function uniqueWords(words: string[]): string[] {
  return [...new Set(words)];
}

/** Keeps the approved subject represented while removing the style-heavy
 * prefixes that caused searches such as "cinematic documentary photograph"
 * to lose the actual noun near the end of a generated placeholder brief. */
export function simplifyPhotoSearchQuery(brief: string, subject = ""): string {
  const subjectWords = uniqueWords(contentWords(subject));
  const briefWords = contentWords(brief);
  // When an approved visual exists it owns the search. The generated slot
  // brief may describe framing, but it must never introduce a competing topic.
  const words = subjectWords.length ? subjectWords : uniqueWords(briefWords).slice(0, 12);
  if (words.length) return words.join(" ");
  return (subject || brief).trim().replace(/\s+/g, " ").split(" ").slice(0, 12).join(" ");
}

const WORD_ALIASES = new Map([
  ["biliar", "billiard"], ["billiards", "billiard"],
  ["pemain", "player"], ["bola", "ball"], ["meja", "table"],
  ["hijau", "green"], ["dua", "two"], ["atlet", "athlete"],
  ["kopi", "coffee"], ["petani", "farmer"],
]);

function matchWord(word: string): string {
  const singular = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
  return WORD_ALIASES.get(singular) ?? singular;
}

const WEAK_SUBJECT_WORDS = new Set([
  "one", "two", "three", "player", "person", "people", "man", "woman", "athlete",
  "professional", "playing", "play", "green", "red", "blue", "ball", "table",
  "sedang", "sambil", "melakukan", "bermain", "membidik", "mempersiapkan",
]);

// A small set of domains with reliable cross-language/provider aliases. These
// are safe as hard rejection gates. For other subjects we keep the provider's
// ranking, because its search understands far more languages than local exact
// token matching does.
const COMPARABLE_DOMAINS = new Set([
  "billiard", "basketball", "football", "baseball", "tennis", "golf", "coffee",
]);

function semanticWords(value: string): Set<string> {
  const rawWords = contentWords(value);
  const words = rawWords.map(matchWord);
  const result = new Set(words);
  // Unsplash frequently describes billiards as only "pool table" or "pool
  // cue". Treat that phrase as a billiards alias without misclassifying an
  // ordinary swimming pool.
  if (words.includes("pool") && (words.includes("table") || words.includes("cue"))) {
    result.add("billiard");
  }
  if (words.includes("basketball") || (rawWords.includes("bola") && rawWords.includes("basket"))) {
    result.add("basketball");
  }
  if (words.includes("football") || rawWords.includes("sepakbola")
    || (rawWords.includes("sepak") && rawWords.includes("bola"))) {
    result.add("football");
  }
  return result;
}

function rankStockResults<T extends { description?: string; tags?: string[] }>(
  results: T[],
  authoritativeText: string,
  guidanceText: string,
): Array<T & { subjectScore: number; subjectAnchorScore: number; guidanceScore: number }> {
  const subjectWords = semanticWords(authoritativeText);
  const subjectAnchors = new Set([...subjectWords].filter((word) => !WEAK_SUBJECT_WORDS.has(word)));
  const guidanceWords = semanticWords(guidanceText);
  return results
    .map((photo, index) => {
      const metadataWords = semanticWords(
        [photo.description, ...(photo.tags ?? [])].filter(Boolean).join(" "),
      );
      let subjectScore = 0;
      for (const word of subjectWords) {
        if (metadataWords.has(word)) subjectScore += 1;
      }
      let subjectAnchorScore = 0;
      for (const word of subjectAnchors) {
        if (metadataWords.has(word)) subjectAnchorScore += 1;
      }
      let guidanceScore = 0;
      for (const word of guidanceWords) {
        if (metadataWords.has(word)) guidanceScore += 1;
      }
      return { ...photo, subjectScore, subjectAnchorScore, guidanceScore, originalIndex: index };
    })
    .sort((a, b) => b.subjectAnchorScore - a.subjectAnchorScore
      || b.subjectScore - a.subjectScore
      || b.guidanceScore - a.guidanceScore
      || a.originalIndex - b.originalIndex);
}

function authoritativeAnchors(value: string): Set<string> {
  return new Set([...semanticWords(value)].filter((word) => !WEAK_SUBJECT_WORDS.has(word)));
}

function comparableDomains(value: string): Set<string> {
  return new Set([...semanticWords(value)].filter((word) => COMPARABLE_DOMAINS.has(word)));
}

function authoritativePrompt(brief: string, context?: PhotoContext): string {
  const subject = context?.subject?.trim() || context?.heading?.trim();
  return subject ? `${subject}. Composition guidance: ${brief}` : brief;
}

function logResolution(
  source: HtmlImageSource,
  brief: string,
  context: PhotoContext | undefined,
  details: Record<string, unknown>,
): void {
  console.info("[html-slides][photo]", JSON.stringify({
    source,
    slide: context?.slideNumber,
    heading: context?.heading,
    approvedVisual: context?.subject,
    slotBrief: brief,
    ...details,
  }));
}

export function createPhotoResolver({
  imageSource,
  sessionToken,
  imageModel,
  generateAi,
  searchStock,
  trackStockDownload,
}: {
  imageSource: HtmlImageSource;
  sessionToken: string;
  imageModel?: string;
  generateAi: GenerateAi;
  searchStock: SearchStock;
  trackStockDownload?: (downloadLocation: string) => Promise<void>;
}): (brief: string, context?: PhotoContext) => Promise<ResolvedPhoto | null> {
  const resolveWithAi = async (
    brief: string,
    context?: PhotoContext,
    fallbackReason?: string,
  ): Promise<ResolvedPhoto | null> => {
    if (!sessionToken) {
      logResolution("ai", brief, context, {
        outcome: fallbackReason ? "fallback-skipped" : "generation-skipped",
        fallbackReason,
        reason: "missing-session",
        model: imageModel,
        resolved: false,
      });
      return null;
    }
    const prompt = `${authoritativePrompt(brief, context)}. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo`;
    try {
      const url = await generateAi(sessionToken, prompt, { model: imageModel, size: "1344x768" });
      logResolution("ai", brief, context, {
        outcome: fallbackReason
          ? url ? "fallback-resolved" : "fallback-no-image"
          : url ? "resolved" : "no-image",
        fallbackReason,
        model: imageModel,
        resolved: Boolean(url),
      });
      return url ? { url } : null;
    } catch (error) {
      logResolution("ai", brief, context, {
        outcome: fallbackReason ? "fallback-error" : "generation-error",
        fallbackReason,
        model: imageModel,
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  if (imageSource === "ai") {
    return resolveWithAi;
  }

  return async (brief, context) => {
    const authoritativeText = context?.subject?.trim() || context?.heading?.trim() || "";
    const query = simplifyPhotoSearchQuery(brief, authoritativeText);
    if (!query) {
      logResolution("stock", brief, context, { outcome: "empty-query", resolved: false });
      return resolveWithAi(brief, context, "empty-query");
    }
    try {
      const result = await searchStock(null, query, { page: 1, perPage: 8 });
      const anchors = authoritativeAnchors(authoritativeText);
      const requiredDomains = comparableDomains(authoritativeText);
      const photo = rankStockResults(result.results, authoritativeText || query, brief)[0];
      const photoDomains = photo
        ? comparableDomains([photo.description, ...(photo.tags ?? [])].filter(Boolean).join(" "))
        : new Set<string>();
      const matchesRequiredDomain = requiredDomains.size === 0
        || [...requiredDomains].every((domain) => photoDomains.has(domain));
      if (!photo?.url || !matchesRequiredDomain) {
        logResolution("stock", brief, context, {
          query,
          outcome: "no-relevant-result",
          resolved: false,
          provider: result.provider || photo?.provider,
          requiredDomains: [...requiredDomains],
          subjectAnchors: [...anchors],
          bestPhotoId: photo?.id,
          bestSubjectScore: photo?.subjectScore,
          bestGuidanceScore: photo?.guidanceScore,
        });
        return resolveWithAi(brief, context, "no-relevant-result");
      }
      const selectedProvider = photo.provider || result.provider;
      logResolution("stock", brief, context, {
        query,
        outcome: "resolved",
        provider: selectedProvider,
        photoId: photo.id,
        subjectScore: photo.subjectScore,
        subjectAnchorScore: photo.subjectAnchorScore,
        guidanceScore: photo.guidanceScore,
      });
      if (selectedProvider === "unsplash" && photo.downloadLocation && trackStockDownload) {
        await trackStockDownload(photo.downloadLocation).catch(() => {});
      }
      const hasAttribution = Boolean(photo.credit || photo.creditUrl || photo.sourceUrl);
      return {
        url: photo.url,
        ...(hasAttribution
          ? {
              extra: {
                credit: photo.credit,
                credit_url: photo.creditUrl ?? null,
                source_url: photo.sourceUrl,
              },
            }
          : {}),
      };
    } catch (error) {
      logResolution("stock", brief, context, {
        query,
        outcome: "search-error",
        resolved: false,
        provider: "configured-fallback-chain",
        error: error instanceof Error ? error.message : String(error),
      });
      return resolveWithAi(brief, context, "search-error");
    }
  };
}
