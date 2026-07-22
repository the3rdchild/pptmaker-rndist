import type { SlideElement } from "@/components/slide-editor/types";

export const TEMPLATE_V2_INSERT_ELEMENTS_EVENT =
  "presenton:template-v2-insert-elements";
export const TEMPLATE_V2_SURFACE_SELECTED_EVENT =
  "presenton:template-v2-surface-selected";
export const TEMPLATE_V2_ACTIVATE_SURFACE_EVENT =
  "presenton:template-v2-activate-surface";
export const TEMPLATE_V2_UNDO_EVENT = "presenton:template-v2-undo";
export const TEMPLATE_V2_REDO_EVENT = "presenton:template-v2-redo";
export const TEMPLATE_V2_HISTORY_EVENT = "presenton:template-v2-history";
export const TEMPLATE_V2_APPLY_COLOR_EVENT = "presenton:template-v2-apply-color";
export const TEMPLATE_V2_EXTRACT_IMAGE_COLORS_EVENT =
  "presenton:template-v2-extract-image-colors";
export const TEMPLATE_V2_IMAGE_COLORS_RESULT_EVENT =
  "presenton:template-v2-image-colors-result";
export const TEMPLATE_V2_SELECT_ELEMENT_EVENT = "presenton:template-v2-select-element";

export type TemplateV2InsertComponent = {
  id?: string;
  description?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  elements: SlideElement[];
};

export type TemplateV2InsertElementsDetail = {
  elements?: SlideElement[];
  components?: TemplateV2InsertComponent[];
  label?: string;
  slideId?: string | number | null;
  slideIndex?: number | null;
  handled?: boolean;
};

export type TemplateV2SingleSurfaceSelection = {
  kind: "component" | "element";
  slideIndex?: number | null;
  componentIndex?: number;
  componentId?: string;
  componentLabel?: string;
  elementPath?: string;
  elementType?: string;
  elementName?: string;
  targetLabel?: string;
};

export type TemplateV2MultiSurfaceSelection = {
  kind: "multi-component";
  slideIndex?: number | null;
  components: TemplateV2SingleSurfaceSelection[];
  componentIds?: string[];
  componentLabels?: string[];
  targetLabel?: string;
};

export type TemplateV2SurfaceSelectedDetail = {
  slideId?: string | number | null;
  slideIndex?: number | null;
  selection?: TemplateV2SingleSurfaceSelection | TemplateV2MultiSurfaceSelection | null;
};

export type TemplateV2ActivateSurfaceDetail = {
  slideId?: string | number | null;
  slideIndex?: number | null;
};

export type TemplateV2HistoryDetail = {
  canUndo: boolean;
  canRedo: boolean;
};

export type TemplateV2ApplyColorDetail = {
  color: string;
};

export type TemplateV2ImageColorsResultDetail = {
  colors: string[];
  error?: string;
};

export type TemplateV2SelectElementDetail = {
  slideIndex: number;
  componentIndex: number;
  elementPath: number[];
};
