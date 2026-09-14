import type { HtmlThemeSummary } from "@/lib/html-themes/types";

export function HtmlThemeThumbnail({ theme, className = "" }: { theme: Pick<HtmlThemeSummary, "name" | "previewUrl" | "colors" | "typography" | "effects" | "firstRecipe">; className?: string }) {
  if (theme.previewUrl) return <img src={theme.previewUrl} alt={`${theme.name} preview`} className={`h-full w-full object-cover ${className}`} />;
  const radius = theme.effects.radius === "round" ? 22 : theme.effects.radius === "soft" ? 12 : 0;
  return <div className={`relative h-full w-full overflow-hidden ${className}`} style={{ background: theme.colors.background, color: theme.colors.text }}>
    {theme.effects.grid !== "none" && <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px),linear-gradient(90deg,${theme.colors.border} 1px,transparent 1px)`, backgroundSize: "28px 28px" }} />}
    <div className="absolute left-[12%] top-[18%] h-1 w-[22%]" style={{ background: theme.colors.accent }} />
    <div className="absolute left-[12%] top-[32%] w-[48%] text-[clamp(11px,2vw,24px)] font-bold leading-none" style={{ fontFamily: theme.typography.headingFont }}>{theme.name}</div>
    <div className="absolute bottom-[13%] left-[12%] right-[12%] grid grid-cols-2 gap-[5%]">
      {[0, 1].map((card) => <div key={card} className="h-[22px]" style={{ borderRadius: radius, background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, opacity: 0.9 }} />)}
    </div>
  </div>;
}
