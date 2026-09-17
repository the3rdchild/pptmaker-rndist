export interface SlidePhotoRequestInput {
  imageBrief?: string;
  subject?: string;
  deckTopic?: string;
  slotHint?: string;
  additionalGuidance?: string;
  style: string;
}

/** Builds one image request without allowing a template's generic slot hint to
 * replace the page-specific subject approved in the outline. */
export function buildSlidePhotoRequest({
  imageBrief,
  subject,
  deckTopic,
  slotHint,
  additionalGuidance,
  style,
}: SlidePhotoRequestInput): { prompt: string; searchHint: string } {
  const content = imageBrief?.trim() || subject?.trim() || deckTopic?.trim() || "presentation subject";
  const composition = slotHint?.trim();
  const parts = [
    content,
    composition ? `Slot composition: ${composition}` : "",
    additionalGuidance?.trim() ? `Additional guidance: ${additionalGuidance.trim()}` : "",
    style.trim(),
  ].filter(Boolean);
  return {
    prompt: parts.join(". "),
    searchHint: content,
  };
}
