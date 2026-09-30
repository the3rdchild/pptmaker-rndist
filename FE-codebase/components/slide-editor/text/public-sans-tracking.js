export function isPublicSans(family) {
  return typeof family === "string" && /^['"]?Public Sans['"]?$/i.test(family.trim());
}

export function letterSpacingForFont(family, spacing) {
  return isPublicSans(family) ? 0 : spacing;
}
