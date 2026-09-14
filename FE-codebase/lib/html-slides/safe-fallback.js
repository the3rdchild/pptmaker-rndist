function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function compact(value, limit) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

/** A deliberately plain, extractable layout used only after the model fails
 * measured layout validation twice. Its fixed panel leaves no room for
 * accidental overlap, while a theme background still renders underneath. */
export function buildSafeFallbackFragment({ slide, index, total }) {
  const number = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const heading = compact(slide?.heading || "Untitled slide", 86);
  const body = compact(slide?.brief || "", 260);
  return {
    styleBlock: `<style>
.safe-fallback-panel { position:absolute; left:64px; top:64px; width:600px; max-height:592px; overflow:hidden; padding:44px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); }
.safe-fallback-index { margin-bottom:26px; color:var(--color-accent); font-family:var(--font-body); font-size:var(--fs-small); font-weight:700; letter-spacing:0.16em; }
.safe-fallback-heading { font-family:var(--font-heading); font-size:var(--fs-h1); line-height:1.02; letter-spacing:-0.04em; }
.safe-fallback-body { margin-top:26px; color:var(--color-muted); font-family:var(--font-body); font-size:var(--fs-body); line-height:1.45; }
.safe-fallback-rule { width:88px; height:4px; margin-top:30px; background:var(--color-accent); }
</style>`,
    sectionHtml: `<section class="slide"><div class="safe-fallback-panel"><p class="safe-fallback-index">${number}</p><h1 class="safe-fallback-heading">${escapeHtml(heading)}</h1><p class="safe-fallback-body">${escapeHtml(body)}</p><div class="safe-fallback-rule"></div></div></section>`,
  };
}
