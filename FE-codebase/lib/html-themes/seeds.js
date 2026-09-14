const region = (kind, placement, emphasis = "primary") => ({ kind, placement, emphasis });

const base = ({ id, name, description, colors, typography, effects, guidance, recipes }) => ({
  schemaVersion: 1,
  id,
  name,
  description,
  previewUrl: null,
  colors,
  typography,
  effects,
  guidance,
  recipes,
  updatedAt: "2026-09-14T00:00:00.000Z",
});

export const DEFAULT_HTML_THEME_ID = "corporate-tech-glass";

export const STARTER_HTML_THEMES = [
  base({
    id: "corporate-tech-glass",
    name: "Corporate Tech Glass",
    description: "Deep navy technology storytelling with cyan signal accents, technical grids, and transparent information panels.",
    colors: { background: "#031024", surface: "#071C3D", primary: "#62C6FF", secondary: "#9EDCFF", accent: "#62C6FF", text: "#FFFFFF", muted: "#AFC1D9", border: "#365477" },
    typography: { headingFont: "Manrope", bodyFont: "Inter", scale: "expressive" },
    effects: { surface: "translucent", radius: "round", shadow: "elevated", imageTreatment: "duotone", grid: "technical", slideNumber: "rule" },
    guidance: {
      artDirection: "Corporate technology system: deep blue atmosphere, luminous cyan signals, precision grid, and calm glass-like information layers.",
      dos: ["Use cyan only as a signal accent", "Keep technical grid lines subtle", "Use real outlined SVG icons inside bounded boxes"],
      donts: ["Do not use backdrop blur or filters", "Do not make every slide a card grid", "Do not use warm colours outside data accents"],
    },
    recipes: [
      { id: "section-divider", name: "Section Divider", roles: ["cover", "section"], composition: "editorial-right", description: "Oversized section index left, editorial title block right.", regions: [region("label", "top"), region("heading", "right"), region("body", "right", "secondary"), region("footer", "bottom", "supporting")], decorations: ["grid", "pill", "accent-rule", "section-index", "slide-number"], instructions: "Place an oversized low-opacity section number on the left. Put a right-aligned heading block on the right with cyan rule above it." },
      { id: "content-kpi-rail", name: "Content + KPI", roles: ["content", "stat"], composition: "metric-rail", description: "Narrative left with a vertical rail of three key metrics right.", regions: [region("heading", "left"), region("body", "left", "secondary"), region("bullets", "left", "secondary"), region("metric", "right"), region("footer", "bottom", "supporting")], decorations: ["grid", "pill", "accent-rule", "icon-box", "slide-number"], instructions: "Use the left half for a concise narrative and bullets. Place three stacked metric panels in a narrow right rail, with a small source/note below." },
      { id: "visual-focus", name: "Visual Focus", roles: ["content", "visual"], composition: "visual-focus", description: "Header with one large diagram, product image, or architecture visual.", regions: [region("heading", "top"), region("image", "center"), region("label", "bottom", "secondary")], decorations: ["grid", "pill", "slide-number"], instructions: "Reserve the centre for one dominant screenshot, diagram, or image. Frame it with an extractable translucent rectangle and small supporting labels." },
      { id: "quote-statement", name: "Quote Statement", roles: ["quote"], composition: "quote-statement", description: "One memorable statement with author attribution.", regions: [region("quote", "left"), region("label", "bottom", "secondary"), region("footer", "right", "supporting")], decorations: ["grid", "accent-rule", "slide-number"], instructions: "Use one oversized quote mark as a real text element, a large left-aligned statement, and a compact author block at bottom left." },
      { id: "two-column-comparison", name: "Two Column Comparison", roles: ["comparison", "closing"], composition: "two-column", description: "Two equal alternatives with icons, titles, and concise metric rows.", regions: [region("heading", "right"), region("metric", "left"), region("metric", "right"), region("footer", "bottom", "supporting")], decorations: ["grid", "accent-rule", "icon-box", "slide-number"], instructions: "Place a right-aligned title at top. Below it use two equal translucent columns, each with an icon box, short paragraph, and three compact data rows." },
    ],
  }),
  base({
    id: "paper-editorial", name: "Paper Editorial", description: "Warm paper, forest green, copper, and expressive editorial typography.",
    colors: { background: "#FBF8F3", surface: "#FFFFFF", primary: "#1F4B3F", secondary: "#DDE9DF", accent: "#C4622D", text: "#1A1A18", muted: "#6E6A62", border: "#D9D2C6" },
    typography: { headingFont: "Fraunces", bodyFont: "Inter", scale: "expressive" }, effects: { surface: "flat", radius: "soft", shadow: "subtle", imageTreatment: "natural", grid: "subtle", slideNumber: "minimal" },
    guidance: { artDirection: "Refined print editorial: generous blank space, strong serif headlines, and small copper editorial marks.", dos: ["Let the title breathe", "Use asymmetrical image crops"], donts: ["Do not use glass panels", "Do not overdecorate" ] },
    recipes: [
      { id: "editorial-cover", name: "Editorial Cover", roles: ["cover"], composition: "split-right", description: "Serif title with an image anchor.", regions: [region("heading", "left"), region("body", "left", "secondary"), region("image", "right")], decorations: ["accent-rule", "slide-number"], instructions: "Use an oversized serif title and one carefully cropped image on the right." },
      { id: "editorial-content", name: "Editorial Content", roles: ["content", "section", "closing"], composition: "editorial-right", description: "Narrative and supporting pull quote.", regions: [region("heading", "left"), region("body", "left", "secondary"), region("quote", "right", "secondary")], decorations: ["accent-rule", "slide-number"], instructions: "Use a left narrative column and a restrained right-side pull quote or image." },
      { id: "editorial-comparison", name: "Editorial Comparison", roles: ["comparison", "stat", "visual", "quote"], composition: "two-column", description: "A clean two-column editorial comparison.", regions: [region("heading", "top"), region("body", "left"), region("body", "right")], decorations: ["accent-rule", "slide-number"], instructions: "Keep two columns airy with rules instead of heavy cards." },
    ],
  }),
  base({
    id: "midnight-signal", name: "Midnight Signal", description: "High-contrast midnight dashboard language with violet and gold signals.",
    colors: { background: "#0B0F1A", surface: "#151B2B", primary: "#6C8CFF", secondary: "#293456", accent: "#F5C563", text: "#F2F5FF", muted: "#8B94AD", border: "#303B57" },
    typography: { headingFont: "Manrope", bodyFont: "Inter", scale: "balanced" }, effects: { surface: "translucent", radius: "soft", shadow: "elevated", imageTreatment: "monochrome", grid: "none", slideNumber: "rule" },
    guidance: { artDirection: "Focused nocturnal product intelligence with rich contrast and a single gold signal.", dos: ["Use cards for quantifiable information", "Use gold sparingly"], donts: ["Do not use low contrast text", "Do not mix many accent colours"] },
    recipes: [
      { id: "signal-cover", name: "Signal Cover", roles: ["cover", "section"], composition: "centered", description: "Centered high-contrast opening.", regions: [region("heading", "center"), region("body", "center", "secondary")], decorations: ["accent-rule", "slide-number"], instructions: "Use one central promise and a subtle off-centre signal shape." },
      { id: "signal-metrics", name: "Signal Metrics", roles: ["content", "stat", "visual"], composition: "metric-rail", description: "Headline with compact metric rail.", regions: [region("heading", "left"), region("metric", "right"), region("body", "left", "secondary")], decorations: ["pill", "icon-box", "slide-number"], instructions: "Use a strong title with a dense but legible data rail." },
      { id: "signal-compare", name: "Signal Compare", roles: ["comparison", "quote", "closing"], composition: "two-column", description: "Two contrasting dark surfaces.", regions: [region("heading", "top"), region("body", "left"), region("body", "right")], decorations: ["accent-rule", "slide-number"], instructions: "Use two high-contrast surfaces with a single highlighted recommended state." },
    ],
  }),
  base({
    id: "warm-studio", name: "Warm Studio", description: "Light, rounded, image-led strategy storytelling with coral and ink contrast.",
    colors: { background: "#FFF7F1", surface: "#FFFFFF", primary: "#3A2D2A", secondary: "#F5DDD1", accent: "#E77C5C", text: "#30221F", muted: "#796864", border: "#E9CFC3" },
    typography: { headingFont: "DM Serif Display", bodyFont: "DM Sans", scale: "balanced" }, effects: { surface: "flat", radius: "round", shadow: "subtle", imageTreatment: "natural", grid: "none", slideNumber: "minimal" },
    guidance: { artDirection: "Optimistic strategy workshop with tactile rounded surfaces and intentional imagery.", dos: ["Use warm whitespace", "Use rounded image crops"], donts: ["Do not use neon or hard technical grids", "Do not pack every region"] },
    recipes: [
      { id: "studio-cover", name: "Studio Cover", roles: ["cover"], composition: "split-left", description: "Image-led warm cover.", regions: [region("image", "left"), region("heading", "right"), region("body", "right", "secondary")], decorations: ["accent-rule", "slide-number"], instructions: "Use one rounded image on the left and a concise title block on the right." },
      { id: "studio-story", name: "Studio Story", roles: ["content", "visual", "quote"], composition: "split-right", description: "Narrative with visual evidence.", regions: [region("heading", "left"), region("body", "left", "secondary"), region("image", "right")], decorations: ["pill", "slide-number"], instructions: "Balance concise narrative with one friendly rounded visual." },
      { id: "studio-plan", name: "Studio Plan", roles: ["stat", "comparison", "section", "closing"], composition: "two-column", description: "Tactile two-column plan.", regions: [region("heading", "top"), region("metric", "left"), region("metric", "right")], decorations: ["accent-rule", "icon-box", "slide-number"], instructions: "Use two rounded panels with clear next steps or metric groups." },
    ],
  }),
];
