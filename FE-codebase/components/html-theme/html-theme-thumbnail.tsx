import type { HtmlThemeSummary } from "@/lib/html-themes/types";

export function HtmlThemeThumbnail({ theme, className = "" }: { theme: Pick<HtmlThemeSummary, "name" | "previewUrl" | "backgroundImageUrl" | "colors" | "typography" | "effects" | "firstRecipe">; className?: string }) {
  if (theme.previewUrl) return <img src={theme.previewUrl} alt={`${theme.name} preview`} className={`h-full w-full object-cover ${className}`} />;
  return <div className={`relative h-full w-full overflow-hidden ${className}`} style={{ background: theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl}) center / cover` : theme.colors.background, color: theme.colors.text }}>
    {theme.effects.grid !== "none" && <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px),linear-gradient(90deg,${theme.colors.border} 1px,transparent 1px)`, backgroundSize: "28px 28px" }} />}
    <div className="absolute left-[12%] top-[18%] h-1 w-[22%]" style={{ background: theme.colors.accent }} />
    <div className="absolute left-[12%] top-[32%] w-[56%] text-[11px] font-bold leading-[0.95]" style={{ fontFamily: theme.typography.headingFont }}>{theme.name}</div>
    <div className="absolute bottom-[15%] left-[12%] h-px w-[38%]" style={{ background: theme.colors.border }} />
  </div>;
}
