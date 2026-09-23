"use client";

export {
  alignmentOffset,
  asRecord,
  clamp,
  cloneJson,
  DECORATIVE_LINE_LENGTH,
  DECORATIVE_LINE_THICKNESS,
  isEditableTarget,
  isRecord,
  MAX_HISTORY_ENTRIES,
  normalizeId,
  readArray,
  readBoolean,
  readNumber,
  readOptionalSize,
  readPadding,
  readPoint,
  readSize,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  SCROLL_DISMISS_THRESHOLD_PX,
  STAGE_BOX,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TEXT_AVERAGE_CHAR_EM,
  withHash,
} from "@/components/slide-editor/model/core";
export type {
  Box,
  ChildArrayInfo,
  ComponentSelection,
  ElementSelection,
  LaidOutChild,
  MultiComponentDragState,
  MultiComponentSelection,
  Point,
  RawComponent,
  RawElement,
  RawUi,
  SelectOptions,
  Selection,
  Size,
  UnknownRecord,
} from "@/components/slide-editor/model/core";
export {
  editorChartToRawChart,
  rawChartToEditorChart,
} from "@/components/slide-editor/model/chart-model";
export {
  appendInsertedContent,
  convertInsertedChildArrays,
  hasTemplateV2Metadata,
  insertedComponentToRaw,
  insertedElementToComponent,
  normalizeInsertedBorderRadius,
  normalizeInsertedElementGeometry,
  normalizeInsertedTableCells,
  normalizeInsertedTableRows,
  normalizeInsertedTextCollections,
  normalizeInsertedTextListItems,
  normalizeInsertedTextRuns,
  rawElementFromInsertedElement,
  sourceElementBox,
  sourceElementSize,
} from "@/components/slide-editor/model/inserted-content";
export {
  backgroundColor,
  borderRadius,
  colorWithOpacity,
  fillColor,
  fillOpacity,
  shadowProps,
  strokeColor,
  strokeDash,
  strokeOpacity,
  strokeWidth,
} from "@/components/slide-editor/model/render-style";

// Pure geometry/layout computation: coordinate math, box measurement, and
// the element-tree structural helpers (childArrayInfo etc.) that geometry
// and every other concern in this folder builds on.
export {
  absoluteBoxForElementLocalFrame,
  absoluteBoxForSelection,
  absoluteElementBox,
  absoluteElementLocalFrame,
  boxContainingBoxes,
  boxEqual,
  boxesIntersect,
  childArrayInfo,
  childrenBounds,
  clampRelativePosition,
  componentBox,
  elementBox,
  elementSize,
  estimateTextHeight,
  estimateTextWidth,
  isManualPositioned,
  layoutChildren,
  layoutContainerChildren,
  localElementBox,
  nullableBoxEqual,
  numberPathEqual,
  positionFromNodeInParent,
  renderedLocalBoxForElementSelection,
  rootElementsComponent,
  shouldUseCenterOrigin,
  unclampedPositionFromNodeInParent,
  withUpdatedChildItems,
} from "@/components/slide-editor/model/geometry";

// Small element/component-type predicates and per-type rendering helpers.
export {
  componentKey,
  isBackgroundComponent,
  isBoxVisualType,
  isRawIconElement,
  isStaticSvgIconSource,
  linePoints,
  pointOnCircle,
  rawElementKey,
  rawIconQuery,
  shouldClipElementChildren,
  valueProgress,
} from "@/components/slide-editor/model/element-predicates";

// Selection identity (keys/paths), lookup, and event-targeting for the
// current Selection/ElementSelection state.
export {
  absoluteInlineEditBox,
  componentDisplayLabel,
  componentIndexesForSelection,
  componentIndexesIntersectingBox,
  elementPathForSelection,
  eventTargetsThisSlide,
  getElementAtSelection,
  getElementFromArray,
  keyForSelection,
  keysForSelection,
  selectionForComponentIndexes,
  selectionFromKey,
  selectionTouchesComponent,
  selectionTouchesElement,
  selectionWithComponentToggle,
  surfaceSelectionTarget,
} from "@/components/slide-editor/model/selection";

// Copy/paste: turning a selection into a standalone clipboard component.
export {
  componentForClipboardSelection,
  rootElementClipboardComponent,
} from "@/components/slide-editor/model/clipboard";

// Component grouping, alignment, and distribution.
export {
  alignComponentsInUi,
  distributeComponentsInUi,
  groupComponentsInUi,
} from "@/components/slide-editor/model/alignment";
export type {
  AlignAction,
  ComponentGroupSelection,
  DistributeAxis,
} from "@/components/slide-editor/model/alignment";

// Palette recoloring of raw elements.
export {
  recolorRawElement,
  recolorRawElements,
} from "@/components/slide-editor/model/recolor";

// Adapters between the raw UI element shape and the editor toolbar's
// SlideElement shape.
export {
  editorBorderRadiusToRaw,
  editorStrokeToRaw,
  editorTableCellToRaw,
  mergeEditorToolbarElement,
  rawBorderRadiusForEditor,
  rawElementForEditorToolbar,
  rawStrokeForEditor,
  rawTableCellForEditor,
} from "@/components/slide-editor/model/toolbar-element-adapters";

// Mutation ops that produce an updated RawUi/RawElement/RawComponent:
// selection-scoped edits, resize/scale, layout normalization, inline-edit
// drafts, and markdown-text normalization.
export {
  deleteSelectionFromUi,
  elementWithInlineDraft,
  elementWithNormalizedLayoutChildren,
  normalizeMarkdownTextElementArray,
  normalizeMarkdownTextElementTree,
  normalizeMarkdownTextInUi,
  normalizeSingleChartWrapperComponent,
  preserveInlineEditFrame,
  resizeComponent,
  resizeComponentElementBounds,
  resizeComponentFrame,
  resizeRawElementBounds,
  resizeRootElement,
  scaleRawElements,
  scaleRawElementTextMetrics,
  setComponentPositionsInUi,
  syncComponentHeightToElement,
  updateComponentInUi,
  updateElementArray,
  updateElementInUi,
} from "@/components/slide-editor/model/ui-mutations";
export type { RootElementResizeMode } from "@/components/slide-editor/model/ui-mutations";
