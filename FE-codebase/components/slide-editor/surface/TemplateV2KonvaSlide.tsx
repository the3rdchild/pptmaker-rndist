"use client";

import {
  useCallback,
  useEffect,
  useId,
  memo,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
} from "react";
import type Konva from "konva";
import { useDispatch } from "react-redux";
import { Loader2 } from "lucide-react";
import { Layer, Stage } from "react-konva";
import { notify } from "@/components/ui/sonner";
import type { TemplateV2Layout } from "@/components/slide-editor/importing/template-v2-import";
import {
  templateFontOptionsFromMap,
} from "@/components/slide-editor/text/google-fonts";
import {
  canUngroupTemplateV2Component,
  ungroupTemplateV2ComponentInUi,
} from "@/components/slide-editor/model/template-v2-ungroup";
import { textRunsContent } from "@/components/slide-editor/text/text-runs";

import {
  normalizeRawTextMarkdownElement,
  rawTextContent,
  rawTextListRunsForEditor,
  rawTextRunsForEditor,
  rawTextStyle,
  setRawTextListRunsContent,
  setRawTextRunsContent,
} from "@/components/slide-editor/text/template-v2-text";
import type {
  SlideElement,
  TextRun,
} from "@/components/slide-editor/types";
import {
  useTableCellSelection,
  useTemplateV2InlineEditing,
  type ChartSlideElement,
  type TableSlideElement,
} from "@/components/slide-editor/state/state";
import { ElementToolbar } from "@/components/slide-editor/toolbar/ElementToolbar";
import { ChartDataEditorPopover } from "@/components/slide-editor/charts/ChartEditorContent";
import { TableInlineEditor } from "@/components/slide-editor/tables/TableInlineEditor";
import { TemplateV2InlineEditor } from "@/components/slide-editor/text/TemplateV2InlineEditor";
import {
  measureWordWrappedTextRunsHeight,
  type TemplateV2InlineEditBox,
  type TemplateV2TextEditStyle,
  wordWrappedTextRuns,
} from "@/components/slide-editor/text/template-v2-text-editing";


import { updateSlideUi } from "@/store/slices/presentationGeneration";
import { resolveBackendAssetSource } from "@/utils/api";
import { bucketFileSize, sanitizeAnalyticsError } from "@/utils/analytics";
import { MixpanelEvent, trackEvent } from "@/utils/mixpanel";
import { ImagesApi } from "@/app/(presentation-generator)/services/api/images";
import IconsEditor from "@/components/slide-editor/images/IconsEditor";
import {
  createTemplateV2ClipboardPayload,
  pasteTemplateV2ClipboardPayload,
  type TemplateV2ClipboardPayload,
} from "@/components/slide-editor/clipboard/clipboard";
import { useTemplateV2Clipboard } from "@/components/slide-editor/clipboard/useClipboard";
import {
  isTemplateV2FlowLayoutElement,
  isTemplateV2GroupElement,
  isTemplateV2LayoutElement,
  type TemplateV2SelectionComponentActions,
} from "@/components/slide-editor/layout/LayoutToolbar";
import { TemplateV2SelectionToolbar } from "@/components/slide-editor/selection/SelectionToolbar";
import {
  getTemplateV2SelectionToolbarAnchorBox,
  getTemplateV2SelectionToolbarBounds,
  getTemplateV2SelectionToolbarPosition,
  hasTemplateV2SelectionToolbar,
} from "@/components/slide-editor/selection/toolbarPosition";
import {
  getTemplateV2SelectionChartToolbarTarget,
  getTemplateV2SelectionEditorToolbarTarget,
  getTemplateV2SelectionTableToolbarTarget,
  getTemplateV2SelectionToolbarTarget,
} from "@/components/slide-editor/selection/toolbarTarget";
import { updateComponentLayoutElement } from "@/components/slide-editor/layout/layoutResize";
import {
  reorderComponentLayer,
  type ComponentLayerAction,
} from "@/components/slide-editor/selection/layering";
import { AlignDistributeToolbar } from "@/components/slide-editor/selection/AlignDistributeToolbar";
import { TemplateV2SelectionTransformers } from "@/components/slide-editor/selection/SelectionTransformers";
import { extractDominantColors } from "@/components/slide-editor/utils/extract-image-colors";
import { useFontLoadState } from "@/components/slide-editor/surface/fontLoading";
import { SlideBackground } from "@/components/slide-editor/surface/SlideBackground";
import {
  clearSnapGuides,
  computeSnap,
  drawSnapGuides,
  stopsForBoxes,
  type SnapStops,
} from "@/components/slide-editor/surface/snap-guides";
import {
  clearSpacingBadges,
  computeSpacingBadges,
  drawSpacingBadges,
} from "@/components/slide-editor/surface/spacing-badges";
import {
  MARQUEE_DRAG_THRESHOLD,
  boxFromPoints,
  clearMarqueeRect,
  drawMarqueeRect,
} from "@/components/slide-editor/surface/marquee-select";
import {
  MemoizedRawComponentNode,
  MemoizedRawElementNode,
} from "@/components/slide-editor/surface/nodes";
import {
  MAX_HISTORY_ENTRIES,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  SCROLL_DISMISS_THRESHOLD_PX,
  STAGE_BOX,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  absoluteBoxForSelection,
  absoluteInlineEditBox,
  appendInsertedContent,
  asRecord,
  childArrayInfo,
  childrenBounds,
  cloneJson,
  alignComponentsInUi,
  componentBox,
  componentForClipboardSelection,
  componentIndexesForSelection,
  componentIndexesIntersectingBox,
  deleteSelectionFromUi,
  distributeComponentsInUi,
  groupComponentsInUi,
  editorChartToRawChart,
  elementBox,
  elementSize,
  elementWithInlineDraft,
  elementWithNormalizedLayoutChildren,
  eventTargetsThisSlide,
  getElementAtSelection,
  syncComponentHeightToElement,
  isBackgroundComponent,
  isEditableTarget,
  isManualPositioned,
  isRecord,
  isRawIconElement,
  keyForSelection,
  keysForSelection,
  layoutChildren,
  normalizeMarkdownTextInUi,
  componentKey,
  mergeEditorToolbarElement,
  rawChartToEditorChart,
  rawElementForEditorToolbar,
  rawElementKey,
  rawIconQuery,
  readArray,
  readPoint,
  readString,
  recolorRawElement,
  recolorRawElements,
  renderedLocalBoxForElementSelection,
  rootElementsComponent,
  selectionWithComponentToggle,
  setComponentPositionsInUi,
  surfaceSelectionTarget,
  unclampedPositionFromNodeInParent,
  updateComponentInUi,
  updateElementInUi,
  type AlignAction,
  type Box,
  type ComponentSelection,
  type DistributeAxis,
  type ElementSelection,
  type MultiComponentDragState,
  type Point,
  type RawComponent,
  type RawElement,
  type RawUi,
  type SelectOptions,
  type Selection,
  type UnknownRecord,
} from "@/components/slide-editor/model/model";
import {
  TEMPLATE_V2_ACTIVATE_SURFACE_EVENT,
  TEMPLATE_V2_APPLY_COLOR_EVENT,
  TEMPLATE_V2_EXTRACT_IMAGE_COLORS_EVENT,
  TEMPLATE_V2_HISTORY_EVENT,
  TEMPLATE_V2_IMAGE_COLORS_RESULT_EVENT,
  TEMPLATE_V2_INSERT_ELEMENTS_EVENT,
  TEMPLATE_V2_REDO_EVENT,
  TEMPLATE_V2_SELECT_ELEMENT_EVENT,
  TEMPLATE_V2_SURFACE_SELECTED_EVENT,
  TEMPLATE_V2_UNDO_EVENT,
  type TemplateV2ActivateSurfaceDetail,
  type TemplateV2ApplyColorDetail,
  type TemplateV2HistoryDetail,
  type TemplateV2ImageColorsResultDetail,
  type TemplateV2InsertElementsDetail,
  type TemplateV2SelectElementDetail,
  type TemplateV2SurfaceSelectedDetail,
} from "@/components/slide-editor/events/events";

function autoSizeInlineTextFrame(
  frame: TemplateV2InlineEditBox | null | undefined,
  runs: TextRun[],
  style: TemplateV2TextEditStyle,
) {
  if (!frame) return frame;
  const contentHeight = measureWordWrappedTextRunsHeight(
    runs,
    frame.width,
    style,
  );
  return {
    ...frame,
    height: Math.max(1, contentHeight),
  };
}

const EDITING_SCENE_DEVICE_OVERSAMPLE = 1.5;
const MIN_EDITING_SCENE_PIXEL_RATIO = 3;
const MAX_EDITING_SCENE_PIXEL_RATIO = 4;

function syncEditingScenePixelRatio(layer: Konva.Layer | null) {
  if (!layer || typeof window === "undefined") return;
  const pixelRatio = Math.min(
    MAX_EDITING_SCENE_PIXEL_RATIO,
    Math.max(
      MIN_EDITING_SCENE_PIXEL_RATIO,
      (window.devicePixelRatio || 1) * EDITING_SCENE_DEVICE_OVERSAMPLE,
    ),
  );
  const canvas = layer.getCanvas();
  if (Math.abs(canvas.getPixelRatio() - pixelRatio) < 0.01) return;
  canvas.setPixelRatio(pixelRatio);
  layer.batchDraw();
}

export {
  TEMPLATE_V2_ACTIVATE_SURFACE_EVENT,
  TEMPLATE_V2_INSERT_ELEMENTS_EVENT,
  TEMPLATE_V2_SURFACE_SELECTED_EVENT,
  type TemplateV2ActivateSurfaceDetail,
  type TemplateV2InsertElementsDetail,
  type TemplateV2SurfaceSelectedDetail,
} from "@/components/slide-editor/events/events";

type TemplateV2KonvaSlideProps = {
  layout: TemplateV2Layout;
  isEditMode: boolean;
  slideId?: string | number | null;
  presentationId?: string;
  slideIndex: number;
  renderIndex?: number;
  fonts?: unknown;
};

function TemplateV2KonvaSlideComponent({
  layout,
  isEditMode,
  slideId = null,
  presentationId,
  slideIndex,
  renderIndex,
  fonts,
}: TemplateV2KonvaSlideProps) {
  const dispatch = useDispatch();
  const surfaceId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const contentLayerRef = useRef<Konva.Layer | null>(null);
  const snapGuidesLayerRef = useRef<Konva.Layer | null>(null);
  const spacingBadgesLayerRef = useRef<Konva.Layer | null>(null);
  const marqueeLayerRef = useRef<Konva.Layer | null>(null);
  const marqueeDragRef = useRef<{ start: Point; dragging: boolean } | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageUploadRef = useRef<ElementSelection | null>(null);
  const undoStackRef = useRef<RawUi[]>([]);
  const redoStackRef = useRef<RawUi[]>([]);
  const multiComponentDragRef = useRef<MultiComponentDragState | null>(null);
  // Per-gesture cache for applyDragOverlay: snap stops and the dragged
  // node's client rect only need computing once per drag (translation
  // doesn't change a subtree's local bounds), not on every dragmove frame.
  // Nodes here are also Konva-cached for the gesture so a heavy subtree
  // (shadows, many children, images) redraws as one bitmap blit instead of
  // walking+repainting every child on every frame.
  const dragOverlayCacheRef = useRef<{
    others: Box[];
    stops: SnapStops;
    startPos: Point;
    startBox: Box;
    cachedNodes: Konva.Node[];
  } | null>(null);
  const [uiDraft, setUiDraft] = useState<RawUi>(() =>
    normalizeMarkdownTextInUi(cloneJson(layout as RawUi)),
  );
  const templateFonts = useMemo(() => templateFontOptionsFromMap(fonts), [
    fonts,
  ]);
  const fontLoadState = useFontLoadState(uiDraft, templateFonts);
  const currentUiRef = useRef<RawUi>(uiDraft);
  const [selection, setSelection] = useState<Selection>(null);
  const selectionRef = useRef<Selection>(selection);
  const {
    inlineEdit,
    clearInlineEdit,
    startInlineEdit,
    updateInlineDraft,
    updateInlineEdit,
    updateInlineTextSelectionRange,
  } = useTemplateV2InlineEditing<ElementSelection>({
    keyForSelection,
  });
  const [iconEditorSelection, setIconEditorSelection] =
    useState<ElementSelection | null>(null);
  const [chartEditorSelection, setChartEditorSelection] =
    useState<ElementSelection | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const {
    clearTableCellEditing,
    clearTableCellSelection,
    editingTableCell,
    editTableCellSelection,
    selectedTableCell,
    selectTableCellSelection,
    selectTableRow,
    selectTableColumn,
    visibleSelectedTableCell,
  } = useTableCellSelection<Selection, ElementSelection>({
    keyForSelection,
    selection,
  });
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    setRootElement(node);
  }, []);

  const components = useMemo(
    () => readArray(uiDraft.components).filter(isRecord) as RawComponent[],
    [uiDraft.components],
  );
  const rootElements = useMemo(
    () => readArray(uiDraft.elements).filter(isRecord) as RawElement[],
    [uiDraft.elements],
  );
  const setSelectionNodeRef = useCallback(
    (key: string, node: Konva.Node | null) => {
      if (node) nodeRefs.current.set(key, node);
      else nodeRefs.current.delete(key);
    },
    [],
  );
  const selectedComponentIndexes = useMemo(
    () => componentIndexesForSelection(selection),
    [selection],
  );
  const selectedComponentIndexesRef = useRef<number[]>(selectedComponentIndexes);
  const selectedComponentIndexSet = useMemo(
    () => new Set(selectedComponentIndexes),
    [selectedComponentIndexes],
  );
  const selectedKeys = useMemo(() => keysForSelection(selection), [selection]);
  const selectedKey = selectedKeys.length === 1 ? selectedKeys[0] : null;
  const selectedParentComponentKey =
    selection?.kind === "element" &&
      selection.componentIndex !== ROOT_ELEMENTS_COMPONENT_INDEX
      ? keyForSelection({
        kind: "component",
        componentIndex: selection.componentIndex,
      })
      : null;
  const editingKey = inlineEdit ? keyForSelection(inlineEdit.selection) : null;
  const selectedElement =
    selection?.kind === "element"
      ? getElementAtSelection(uiDraft, selection)
      : null;
  const selectedComponent =
    selection?.kind === "component"
      ? asRecord(readArray(uiDraft.components)[selection.componentIndex])
      : null;
  const selectedBox = selection
    ? absoluteBoxForSelection(uiDraft, selection)
    : null;
  const layoutToolbarTarget = useMemo(
    () =>
      getTemplateV2SelectionToolbarTarget({
        selection,
        selectedBox,
        selectedComponent,
        selectedElement,
        absoluteBoxForSelection: (targetSelection) =>
          absoluteBoxForSelection(uiDraft, targetSelection),
      }),
    [selectedBox, selectedComponent, selectedElement, selection, uiDraft],
  );
  const chartToolbarTarget = useMemo(
    () =>
      layoutToolbarTarget
        ? null
        : getTemplateV2SelectionChartToolbarTarget({
            selection,
            selectedBox,
            selectedComponent,
            selectedElement,
            absoluteBoxForSelection: (targetSelection) =>
              absoluteBoxForSelection(uiDraft, targetSelection),
          }),
    [
      layoutToolbarTarget,
      selectedBox,
      selectedComponent,
      selectedElement,
      selection,
      uiDraft,
    ],
  );
  const tableToolbarTarget = useMemo(
    () =>
      layoutToolbarTarget || chartToolbarTarget || editingTableCell
        ? null
        : getTemplateV2SelectionTableToolbarTarget({
            selection,
            selectedBox,
            selectedComponent,
            selectedElement,
            absoluteBoxForSelection: (targetSelection) =>
              absoluteBoxForSelection(uiDraft, targetSelection),
          }),
    [
      chartToolbarTarget,
      editingTableCell,
      layoutToolbarTarget,
      selectedBox,
      selectedComponent,
      selectedElement,
      selection,
      uiDraft,
    ],
  );
  const editorToolbarTarget = useMemo(
    () =>
      layoutToolbarTarget || chartToolbarTarget || tableToolbarTarget
        ? null
        : getTemplateV2SelectionEditorToolbarTarget({
            selection,
            selectedBox,
            selectedComponent,
            selectedElement,
            absoluteBoxForSelection: (targetSelection) =>
              absoluteBoxForSelection(uiDraft, targetSelection),
          }),
    [
      chartToolbarTarget,
      layoutToolbarTarget,
      selectedBox,
      selectedComponent,
      selectedElement,
      selection,
      tableToolbarTarget,
      uiDraft,
    ],
  );
  const toolbarElement = useMemo(
    () => {
      if (!selectedElement || !selectedBox) return null;
      const inlineTextElement =
        inlineEdit &&
          inlineEdit.kind === "text" &&
          inlineEdit.runs &&
          selection?.kind === "element" &&
          keyForSelection(inlineEdit.selection) === keyForSelection(selection)
          ? setRawTextRunsContent(selectedElement, inlineEdit.runs)
          : inlineEdit &&
            inlineEdit.kind === "text-list" &&
            inlineEdit.runs &&
            selection?.kind === "element" &&
            keyForSelection(inlineEdit.selection) === keyForSelection(selection)
            ? setRawTextListRunsContent(selectedElement, inlineEdit.runs)
            : selectedElement;
      return rawElementForEditorToolbar(inlineTextElement, selectedBox);
    },
    [inlineEdit, selectedBox, selectedElement, selection],
  );
  const canUngroupSelectedComponent = useMemo(
    () =>
      selection?.kind === "component" &&
      selectedComponent != null &&
      canUngroupTemplateV2Component(selectedComponent),
    [selectedComponent, selection],
  );
  const canUngroupLayoutTargetComponent = useMemo(() => {
    const componentIndex = layoutToolbarTarget?.selection.componentIndex;
    if (
      componentIndex == null ||
      componentIndex < 0 ||
      !layoutToolbarTarget ||
      (!isTemplateV2FlowLayoutElement(layoutToolbarTarget.element) &&
        !isTemplateV2GroupElement(layoutToolbarTarget.element))
    ) {
      return false;
    }
    const component = asRecord(readArray(uiDraft.components)[componentIndex]);
    return canUngroupTemplateV2Component(component);
  }, [layoutToolbarTarget, uiDraft.components]);
  const [, setToolbarViewportVersion] = useState(0);
  const hasDismissibleEditorUi = Boolean(
    selection ||
    inlineEdit ||
    iconEditorSelection ||
    chartEditorSelection ||
    selectedTableCell ||
    editingTableCell,
  );
  const floatingToolbarAnchorBox = getTemplateV2SelectionToolbarAnchorBox({
    chartTarget: chartToolbarTarget,
    layoutTarget: layoutToolbarTarget,
    selectedBox,
    selection,
    tableTarget: tableToolbarTarget,
  });
  const hasFloatingToolbar = hasTemplateV2SelectionToolbar({
    anchorBox: floatingToolbarAnchorBox,
    chartTarget: chartToolbarTarget,
    isEditMode,
    layoutTarget: layoutToolbarTarget,
    selection,
    tableTarget: tableToolbarTarget,
  });
  const selectionToolbarPosition = getTemplateV2SelectionToolbarPosition({
    anchorBox: floatingToolbarAnchorBox,
    chartTarget: chartToolbarTarget,
    layoutTarget: layoutToolbarTarget,
    root: rootElement,
    tableTarget: tableToolbarTarget,
  });
  const selectionToolbarBounds =
    getTemplateV2SelectionToolbarBounds(rootElement);
  // Multi-component selections get their own compact toolbar (align/
  // distribute) rather than routing through TemplateV2SelectionToolbar,
  // which only ever anchors single-component/element/chart/table targets.
  const alignDistributePosition =
    selection?.kind === "multi-component" && selectedBox
      ? getTemplateV2SelectionToolbarPosition({
          anchorBox: selectedBox,
          layoutTarget: null,
          root: rootElement,
        })
      : null;
  const inlineEditBox = inlineEdit
    ? absoluteInlineEditBox(uiDraft, inlineEdit.selection, inlineEdit.frame)
    : null;
  const iconEditorElement = iconEditorSelection
    ? getElementAtSelection(uiDraft, iconEditorSelection)
    : null;
  const chartEditorElement = chartEditorSelection
    ? getElementAtSelection(uiDraft, chartEditorSelection)
    : null;
  const surfaceSlideIndex = useMemo(() => {
    const index = typeof renderIndex === "number" ? renderIndex : slideIndex;
    return Number.isFinite(index) ? index : null;
  }, [renderIndex, slideIndex]);
  const editorAnalyticsProps = useCallback(
    (props: Record<string, unknown> = {}) => ({
      presentation_id: presentationId ?? null,
      slide_index: surfaceSlideIndex ?? slideIndex,
      ...props,
    }),
    [presentationId, slideIndex, surfaceSlideIndex],
  );
  const selectedSurfaceTarget = useMemo(
    () => surfaceSelectionTarget(uiDraft, selection, surfaceSlideIndex),
    [selection, surfaceSlideIndex, uiDraft],
  );
  const toolbarSelectedTableCell =
    tableToolbarTarget &&
    selectedTableCell?.elementPath ===
      keyForSelection(tableToolbarTarget.selection)
      ? selectedTableCell
      : null;
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (!fontLoadState.ready) return;
    contentLayerRef.current?.batchDraw();
  }, [fontLoadState.ready, fontLoadState.revision]);

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;
    const refreshPixelRatio = () =>
      syncEditingScenePixelRatio(contentLayerRef.current);
    refreshPixelRatio();
    window.addEventListener("resize", refreshPixelRatio);
    return () => window.removeEventListener("resize", refreshPixelRatio);
  }, [isEditMode]);

  useEffect(() => {
    selectedComponentIndexesRef.current = selectedComponentIndexes;
  }, [selectedComponentIndexes]);

  useEffect(() => {
    if (layout === currentUiRef.current) return;
    const next = normalizeMarkdownTextInUi(cloneJson(layout as RawUi));
    currentUiRef.current = next;
    setUiDraft(next);
    setSelection(null);
    clearTableCellSelection();
    clearInlineEdit();
    setIconEditorSelection(null);
    setChartEditorSelection(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryAvailability({ canUndo: false, canRedo: false });
  }, [clearInlineEdit, clearTableCellSelection, layout]);

  useEffect(() => {
    if (!hasFloatingToolbar || typeof window === "undefined") return;
    let frame = 0;
    const refreshToolbarPosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setToolbarViewportVersion((version) => version + 1);
      });
    };
    window.addEventListener("resize", refreshToolbarPosition);
    refreshToolbarPosition();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", refreshToolbarPosition);
    };
  }, [hasFloatingToolbar]);

  const isSurfaceActive = useCallback(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.templateV2KonvaActiveSurface === surfaceId,
    [surfaceId],
  );

  const activateSurface = useCallback((nextSelection?: Selection) => {
    if (
      !isEditMode ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }
    document.documentElement.dataset.templateV2KonvaActiveSurface = surfaceId;
    if (surfaceSlideIndex != null) {
      document.documentElement.dataset.templateV2KonvaActiveSlideIndex =
        String(surfaceSlideIndex);
    }
    window.dispatchEvent(
      new CustomEvent<TemplateV2SurfaceSelectedDetail>(
        TEMPLATE_V2_SURFACE_SELECTED_EVENT,
        {
          detail: {
            slideId,
            slideIndex: surfaceSlideIndex,
            selection: surfaceSelectionTarget(
              currentUiRef.current,
              nextSelection === undefined ? selectionRef.current : nextSelection,
              surfaceSlideIndex,
            ),
          },
        },
      ),
    );
    // Re-announce this surface's own undo/redo availability so the toolbar
    // button reflects whichever slide just became active, not the last one.
    window.dispatchEvent(
      new CustomEvent<TemplateV2HistoryDetail>(TEMPLATE_V2_HISTORY_EVENT, {
        detail: {
          canUndo: undoStackRef.current.length > 0,
          canRedo: redoStackRef.current.length > 0,
        },
      }),
    );
  }, [isEditMode, slideId, surfaceId, surfaceSlideIndex]);

  useEffect(() => {
    if (!isEditMode || !isSurfaceActive() || typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent<TemplateV2SurfaceSelectedDetail>(
        TEMPLATE_V2_SURFACE_SELECTED_EVENT,
        {
          detail: {
            slideId,
            slideIndex: surfaceSlideIndex,
            selection: selectedSurfaceTarget,
          },
        },
      ),
    );
  }, [
    isEditMode,
    isSurfaceActive,
    selectedSurfaceTarget,
    slideId,
    surfaceSlideIndex,
  ]);

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleActivateSurface = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2ActivateSurfaceDetail>)
        .detail;
      if (
        !detail ||
        !eventTargetsThisSlide(detail, slideId, surfaceSlideIndex, () => false)
      ) {
        return;
      }
      activateSurface();
    };

    window.addEventListener(
      TEMPLATE_V2_ACTIVATE_SURFACE_EVENT,
      handleActivateSurface,
    );
    return () =>
      window.removeEventListener(
        TEMPLATE_V2_ACTIVATE_SURFACE_EVENT,
        handleActivateSurface,
      );
  }, [activateSurface, isEditMode, slideId, surfaceSlideIndex]);

  const clearSurface = useCallback(() => {
    if (typeof document === "undefined") return;
    if (
      document.documentElement.dataset.templateV2KonvaActiveSurface === surfaceId
    ) {
      delete document.documentElement.dataset.templateV2KonvaActiveSurface;
      delete document.documentElement.dataset.templateV2KonvaActiveSlideIndex;
    }
  }, [surfaceId]);

  const clearEditorUiState = useCallback(
    (options?: { clearActiveSurface?: boolean }) => {
      multiComponentDragRef.current = null;
      const dragCache = dragOverlayCacheRef.current;
      if (dragCache) {
        for (const target of dragCache.cachedNodes) target.clearCache();
        dragOverlayCacheRef.current = null;
      }
      setSelection(null);
      clearTableCellSelection();
      clearTableCellEditing();
      clearInlineEdit();
      setIconEditorSelection(null);
      setChartEditorSelection(null);
      if (options?.clearActiveSurface) {
        clearSurface();
      }
    },
    [
      clearInlineEdit,
      clearSurface,
      clearTableCellEditing,
      clearTableCellSelection,
    ],
  );

  useEffect(() => {
    if (isEditMode) return;
    clearEditorUiState({ clearActiveSurface: true });
    pendingImageUploadRef.current = null;
  }, [clearEditorUiState, isEditMode]);

  useEffect(() => {
    if (
      !isEditMode ||
      !hasDismissibleEditorUi ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return;
    }

    let cleared = false;
    let accumulatedScrollDistance = 0;
    const lastScrollPositionByTarget = new Map<EventTarget, Point>([
      [
        document,
        {
          x: window.scrollX,
          y: window.scrollY,
        },
      ],
    ]);
    const scrollStateForTarget = (target: EventTarget | null) => {
      if (
        target instanceof Element &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        return {
          key: target,
          position: {
            x: target.scrollLeft,
            y: target.scrollTop,
          },
        };
      }

      return {
        key: document,
        position: {
          x: window.scrollX,
          y: window.scrollY,
        },
      };
    };
    const handleScroll = (event: Event) => {
      if (cleared) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-inline-edit-ignore='true']")) return;

      const { key, position } = scrollStateForTarget(event.target);
      const previousPosition = lastScrollPositionByTarget.get(key);
      lastScrollPositionByTarget.set(key, position);
      if (!previousPosition) return;

      accumulatedScrollDistance +=
        Math.abs(position.x - previousPosition.x) +
        Math.abs(position.y - previousPosition.y);
      if (accumulatedScrollDistance < SCROLL_DISMISS_THRESHOLD_PX) return;

      cleared = true;
      clearEditorUiState({ clearActiveSurface: true });
    };

    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [clearEditorUiState, hasDismissibleEditorUi, isEditMode]);

  const commitUi = useCallback(
    (nextUi: RawUi, pushHistory = true) => {
      if (!isEditMode) return;
      if (nextUi === currentUiRef.current) return;
      if (pushHistory) {
        undoStackRef.current.push(currentUiRef.current);
        if (undoStackRef.current.length > MAX_HISTORY_ENTRIES) {
          undoStackRef.current.shift();
        }
        redoStackRef.current = [];
      }
      currentUiRef.current = nextUi;
      setUiDraft(nextUi);
      dispatch(
        updateSlideUi({
          index: surfaceSlideIndex ?? slideIndex,
          ui: nextUi as Record<string, unknown>,
        }),
      );
      const nextHistoryAvailability = {
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
      };
      setHistoryAvailability(nextHistoryAvailability);
      if (typeof window !== "undefined" && isSurfaceActive()) {
        window.dispatchEvent(
          new CustomEvent<TemplateV2HistoryDetail>(TEMPLATE_V2_HISTORY_EVENT, {
            detail: nextHistoryAvailability,
          }),
        );
      }
    },
    [dispatch, isEditMode, isSurfaceActive, slideIndex, surfaceSlideIndex],
  );

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(currentUiRef.current);
    commitUi(previous, false);
  }, [commitUi]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(currentUiRef.current);
    commitUi(next, false);
  }, [commitUi]);

  const select = useCallback(
    (nextSelection: Selection, options?: SelectOptions) => {
      clearTableCellSelection();
      const resolvedSelection = selectionWithComponentToggle(
        selectionRef.current,
        nextSelection,
        options,
      );
      selectionRef.current = resolvedSelection;
      setSelection(resolvedSelection);
      activateSurface(resolvedSelection);
    },
    [activateSurface, clearTableCellSelection],
  );

  // Drag-to-select: mousedown on empty canvas starts tracking a start point.
  // If the pointer moves past the threshold before mouseup, it's a marquee
  // drag — components overlapping the dragged rect become the selection.
  // If it never moves, mouseup falls back to the plain "click empty space
  // to deselect" behavior.
  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (event.target !== event.target.getStage()) {
        activateSurface();
        return;
      }
      const pointer = event.target.getStage()?.getPointerPosition();
      if (!pointer) {
        activateSurface(null);
        clearEditorUiState();
        return;
      }
      marqueeDragRef.current = { start: pointer, dragging: false };
    },
    [activateSurface, clearEditorUiState],
  );

  const handleStageMouseMove = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const dragState = marqueeDragRef.current;
      if (!dragState) return;
      const pointer = event.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      if (!dragState.dragging) {
        const dx = pointer.x - dragState.start.x;
        const dy = pointer.y - dragState.start.y;
        if (Math.hypot(dx, dy) < MARQUEE_DRAG_THRESHOLD) return;
        dragState.dragging = true;
      }
      drawMarqueeRect(marqueeLayerRef.current, boxFromPoints(dragState.start, pointer));
    },
    [],
  );

  const handleStageMouseUp = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const dragState = marqueeDragRef.current;
      marqueeDragRef.current = null;
      clearMarqueeRect(marqueeLayerRef.current);
      if (!dragState) return;
      if (!dragState.dragging) {
        activateSurface(null);
        clearEditorUiState();
        return;
      }
      const pointer =
        event.target.getStage()?.getPointerPosition() ?? dragState.start;
      const box = boxFromPoints(dragState.start, pointer);
      const indexes = componentIndexesIntersectingBox(currentUiRef.current, box);
      if (indexes.length === 0) {
        activateSurface(null);
        clearEditorUiState();
        return;
      }
      clearTableCellSelection();
      clearInlineEdit();
      setIconEditorSelection(null);
      setChartEditorSelection(null);
      const nextSelection: Selection =
        indexes.length === 1
          ? { kind: "component", componentIndex: indexes[0] }
          : { kind: "multi-component", componentIndexes: indexes };
      selectionRef.current = nextSelection;
      setSelection(nextSelection);
      activateSurface(nextSelection);
    },
    [activateSurface, clearEditorUiState, clearInlineEdit, clearTableCellSelection],
  );

  // -1 in either slot is a sentinel from the row/column handle strips
  // (TemplateV2TableElement) — no new prop needed through the whole
  // render tree, just a different interpretation at this one boundary.
  const selectTableCell = useCallback(
    (
      elementSelection: ElementSelection,
      rowIndex: number,
      colIndex: number,
    ) => {
      activateSurface(elementSelection);
      setSelection(elementSelection);
      clearInlineEdit();
      setIconEditorSelection(null);
      if (colIndex === -1) {
        selectTableRow(elementSelection, rowIndex);
      } else if (rowIndex === -1) {
        selectTableColumn(elementSelection, colIndex);
      } else {
        selectTableCellSelection(elementSelection, rowIndex, colIndex);
      }
    },
    [
      activateSurface,
      clearInlineEdit,
      selectTableCellSelection,
      selectTableColumn,
      selectTableRow,
    ],
  );

  const editTableCell = useCallback(
    (
      elementSelection: ElementSelection,
      rowIndex: number,
      colIndex: number,
    ) => {
      activateSurface(elementSelection);
      setSelection(elementSelection);
      clearInlineEdit();
      setIconEditorSelection(null);
      editTableCellSelection(elementSelection, rowIndex, colIndex);
    },
    [activateSurface, clearInlineEdit, editTableCellSelection],
  );

  const updateComponent = useCallback(
    (
      componentIndex: number,
      updater: (component: RawComponent) => RawComponent,
      pushHistory = true,
    ) => {
      commitUi(updateComponentInUi(currentUiRef.current, componentIndex, updater), pushHistory);
    },
    [commitUi],
  );

  const componentBoxesExcluding = useCallback(
    (excludeIndexes: Iterable<number>) => {
      const excluded = new Set(excludeIndexes);
      return readArray(currentUiRef.current.components).flatMap((raw, index) => {
        if (excluded.has(index)) return [];
        const component = asRecord(raw);
        return component ? [componentBox(component)] : [];
      });
    },
    [],
  );

  const getResizeSnapStops = useCallback(
    (excludeComponentIndex: number) =>
      stopsForBoxes(
        componentBoxesExcluding([excludeComponentIndex]),
        STAGE_WIDTH,
        STAGE_HEIGHT,
      ),
    [componentBoxesExcluding],
  );

  // Snap stops and the dragged node's client rect only depend on the
  // gesture's starting state (a plain drag only translates, it doesn't
  // resize/rotate the subtree), so they're computed once here instead of
  // on every dragmove frame. The dragged node(s) are also Konva-cached for
  // the gesture: with many components sharing one Layer, batchDraw()
  // repaints the whole layer every frame regardless of which node moved,
  // so turning a heavy subtree (shadows, many children, images) into one
  // pre-rendered bitmap is what actually keeps that per-frame repaint cheap.
  const primeDragOverlayCache = useCallback(
    (node: Konva.Node, excludedIndexes: number[], passengerNodes: Konva.Node[]) => {
      const layer = node.getLayer();
      if (!layer) {
        dragOverlayCacheRef.current = null;
        return;
      }
      const others = componentBoxesExcluding(excludedIndexes);
      const stops = stopsForBoxes(others, STAGE_WIDTH, STAGE_HEIGHT);
      const startBox = node.getClientRect({ relativeTo: layer });
      const cachedNodes = [node, ...passengerNodes];
      for (const target of cachedNodes) target.cache();
      dragOverlayCacheRef.current = {
        others,
        stops,
        startPos: { x: node.x(), y: node.y() },
        startBox,
        cachedNodes,
      };
    },
    [componentBoxesExcluding],
  );

  const clearDragOverlayCache = useCallback(() => {
    const cache = dragOverlayCacheRef.current;
    if (!cache) return;
    for (const target of cache.cachedNodes) target.clearCache();
    dragOverlayCacheRef.current = null;
  }, []);

  const handleComponentDragStart = useCallback(
    (componentIndex: number, node: Konva.Node) => {
      const selectedIndexes = selectedComponentIndexesRef.current;
      if (
        selectedIndexes.length < 2 ||
        !selectedIndexes.includes(componentIndex)
      ) {
        multiComponentDragRef.current = null;
        primeDragOverlayCache(node, [componentIndex], []);
        return;
      }

      const sourceComponents = readArray(currentUiRef.current.components);
      const nodes = selectedIndexes.flatMap((selectedIndex) => {
        const selectedNode = nodeRefs.current.get(
          keyForSelection({ kind: "component", componentIndex: selectedIndex }),
        );
        if (!selectedNode) return [];
        const nodePosition = selectedNode.position();
        const component = asRecord(sourceComponents[selectedIndex]);
        const modelPosition = component
          ? readPoint(component.position)
          : nodePosition;
        return [
          {
            componentIndex: selectedIndex,
            node: selectedNode,
            nodeStart: { x: nodePosition.x, y: nodePosition.y },
            modelStart: { x: modelPosition.x, y: modelPosition.y },
          },
        ];
      });
      const draggedNodeStart = node.position();
      multiComponentDragRef.current = {
        draggedComponentIndex: componentIndex,
        draggedNodeStart: { x: draggedNodeStart.x, y: draggedNodeStart.y },
        nodes,
      };
      primeDragOverlayCache(
        node,
        nodes.map((entry) => entry.componentIndex),
        nodes
          .filter((entry) => entry.componentIndex !== componentIndex)
          .map((entry) => entry.node),
      );
    },
    [primeDragOverlayCache],
  );

  const applyDragOverlay = useCallback(
    (componentIndex: number, node: Konva.Node) => {
      const layer = node.getLayer();
      if (!layer) return;
      const cache = dragOverlayCacheRef.current;
      let others: Box[];
      let stops: SnapStops;
      let box: Box;
      if (cache) {
        others = cache.others;
        stops = cache.stops;
        const position = node.position();
        box = {
          ...cache.startBox,
          x: cache.startBox.x + (position.x - cache.startPos.x),
          y: cache.startBox.y + (position.y - cache.startPos.y),
        };
      } else {
        const dragState = multiComponentDragRef.current;
        const excluded =
          dragState?.draggedComponentIndex === componentIndex
            ? dragState.nodes.map((entry) => entry.componentIndex)
            : [componentIndex];
        others = componentBoxesExcluding(excluded);
        stops = stopsForBoxes(others, STAGE_WIDTH, STAGE_HEIGHT);
        box = node.getClientRect({ relativeTo: layer });
      }
      const snap = computeSnap(box, stops);
      if (snap.dx !== 0) node.x(node.x() + snap.dx);
      if (snap.dy !== 0) node.y(node.y() + snap.dy);
      drawSnapGuides(snapGuidesLayerRef.current, snap, STAGE_WIDTH, STAGE_HEIGHT);
      const snappedBox = { ...box, x: box.x + snap.dx, y: box.y + snap.dy };
      const badges = computeSpacingBadges(snappedBox, others);
      drawSpacingBadges(spacingBadgesLayerRef.current, badges);
    },
    [componentBoxesExcluding],
  );

  const handleComponentDragMove = useCallback(
    (componentIndex: number, node: Konva.Node) => {
      applyDragOverlay(componentIndex, node);
      const dragState = multiComponentDragRef.current;
      if (!dragState || dragState.draggedComponentIndex !== componentIndex) {
        node.getLayer()?.batchDraw();
        return;
      }
      const position = node.position();
      const delta = {
        x: position.x - dragState.draggedNodeStart.x,
        y: position.y - dragState.draggedNodeStart.y,
      };
      dragState.nodes.forEach(({ node, nodeStart }) => {
        node.position({
          x: nodeStart.x + delta.x,
          y: nodeStart.y + delta.y,
        });
      });
      node.getLayer()?.batchDraw();
    },
    [applyDragOverlay],
  );

  const handleComponentDragEnd = useCallback(
    (componentIndex: number, node: Konva.Node) => {
      clearSnapGuides(snapGuidesLayerRef.current);
      clearSpacingBadges(spacingBadgesLayerRef.current);
      clearDragOverlayCache();
      const dragState = multiComponentDragRef.current;
      if (!dragState || dragState.draggedComponentIndex !== componentIndex) {
        updateComponent(componentIndex, (current) => ({
          ...current,
          position: unclampedPositionFromNodeInParent(
            node,
            STAGE_BOX,
            componentBox(current),
          ),
        }));
        return;
      }

      multiComponentDragRef.current = null;
      const position = node.position();
      const delta = {
        x: position.x - dragState.draggedNodeStart.x,
        y: position.y - dragState.draggedNodeStart.y,
      };
      if (Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01) {
        return;
      }
      commitUi(
        setComponentPositionsInUi(
          currentUiRef.current,
          dragState.nodes.map(({ componentIndex, modelStart }) => ({
            componentIndex,
            position: {
              x: modelStart.x + delta.x,
              y: modelStart.y + delta.y,
            },
          })),
        ),
      );
    },
    [clearDragOverlayCache, commitUi, updateComponent],
  );

  const updateElement = useCallback(
    (
      elementSelection: ElementSelection,
      updater: (element: RawElement) => RawElement,
      pushHistory = true,
    ) => {
      commitUi(updateElementInUi(currentUiRef.current, elementSelection, updater), pushHistory);
    },
    [commitUi],
  );

  const closeChartEditor = useCallback(() => {
    setChartEditorSelection(null);
  }, []);

  const deleteComponentAtIndex = useCallback(
    (componentIndex: number) => {
      const components = [...readArray(currentUiRef.current.components)];
      if (componentIndex < 0 || componentIndex >= components.length) return;
      components.splice(componentIndex, 1);
      trackEvent(MixpanelEvent.Editor_Element_Deleted, {
        ...editorAnalyticsProps({
          target_kind: "component",
          element_type: "component",
        }),
      });
      commitUi({ ...currentUiRef.current, components });
      setSelection(null);
      clearTableCellSelection();
      clearInlineEdit();
      setIconEditorSelection(null);
      closeChartEditor();
    },
    [
      clearInlineEdit,
      clearTableCellSelection,
      closeChartEditor,
      commitUi,
      editorAnalyticsProps,
    ],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    const element =
      selection.kind === "element"
        ? getElementAtSelection(currentUiRef.current, selection)
        : null;
    trackEvent(MixpanelEvent.Editor_Element_Deleted, {
      ...editorAnalyticsProps({
        target_kind: selection.kind,
        element_type:
          selection.kind === "element"
            ? readString(element?.type) || "unknown"
            : "component",
      }),
    });
    commitUi(deleteSelectionFromUi(currentUiRef.current, selection));
    setSelection(null);
    clearTableCellSelection();
    clearInlineEdit();
    setIconEditorSelection(null);
    closeChartEditor();
  }, [
    clearInlineEdit,
    clearTableCellSelection,
    closeChartEditor,
    commitUi,
    editorAnalyticsProps,
    selection,
  ]);

  const createClipboardPayload = useCallback((): TemplateV2ClipboardPayload | null => {
    const clipboardComponent = componentForClipboardSelection(
      currentUiRef.current,
      selection,
    );
    return clipboardComponent
      ? createTemplateV2ClipboardPayload(
        clipboardComponent.components.map((item) => ({
          data: item.component,
          absoluteBox: item.box,
        })),
      )
      : null;
  }, [selection]);

  const pasteClipboardPayload = useCallback(
    (payload: TemplateV2ClipboardPayload, offset: number) => {
      const result = pasteTemplateV2ClipboardPayload({
        sourceUi: currentUiRef.current,
        payload,
        offset,
      });
      if (!result) return;
      commitUi(result.ui);
      setSelection(result.selection);
      clearTableCellSelection();
      clearInlineEdit();
      setIconEditorSelection(null);
      activateSurface(result.selection);
    },
    [activateSurface, clearInlineEdit, clearTableCellSelection, commitUi],
  );

  const duplicateComponentAtIndex = useCallback(
    (componentIndex: number) => {
      const clipboardComponent = componentForClipboardSelection(
        currentUiRef.current,
        { kind: "component", componentIndex },
      );
      if (!clipboardComponent) return;
      trackEvent(MixpanelEvent.Editor_Element_Duplicated, {
        ...editorAnalyticsProps({
          target_kind: "component",
        }),
      });
      pasteClipboardPayload(
        createTemplateV2ClipboardPayload(
          clipboardComponent.components.map((item) => ({
            data: item.component,
            absoluteBox: item.box,
          })),
        ),
        16,
      );
    },
    [editorAnalyticsProps, pasteClipboardPayload],
  );

  const duplicateSelection = useCallback(() => {
    const payload = createClipboardPayload();
    if (!payload) return;
    trackEvent(MixpanelEvent.Editor_Element_Duplicated, {
      ...editorAnalyticsProps({
        target_kind: selection?.kind ?? "selection",
      }),
    });
    pasteClipboardPayload(payload, 16);
  }, [createClipboardPayload, editorAnalyticsProps, pasteClipboardPayload, selection]);

  useTemplateV2Clipboard({
    enabled: isEditMode,
    isSurfaceActive,
    isEditableTarget,
    onCopy: createClipboardPayload,
    onPaste: pasteClipboardPayload,
  });

  const openInlineEditor = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (!element) return;
      clearTableCellEditing();
      const type = readString(element.type);
      const frame = renderedLocalBoxForElementSelection(
        currentUiRef.current,
        elementSelection,
      );
      if (type === "text") {
        const normalized = normalizeRawTextMarkdownElement(element);
        if (normalized.changed) {
          updateElement(elementSelection, () => normalized.element, false);
        }
        const style = rawTextStyle(normalized.element);
        const runs = wordWrappedTextRuns(normalized.runs);
        startInlineEdit({
          kind: "text",
          selection: elementSelection,
          draft: textRunsContent(runs),
          runs,
          frame: autoSizeInlineTextFrame(frame, runs, style),
          style,
        });
      } else if (type === "text-list") {
        const runs = wordWrappedTextRuns(rawTextListRunsForEditor(element));
        const style = rawTextStyle(element);
        startInlineEdit({
          kind: "text-list",
          selection: elementSelection,
          draft: textRunsContent(runs),
          runs,
          frame: autoSizeInlineTextFrame(frame, runs, style),
          style,
        });
      }
    },
    [clearTableCellEditing, startInlineEdit, updateElement],
  );

  const closeInlineEditor = useCallback(
    (commit = true, runsOverride?: TextRun[]) => {
      const current = inlineEdit;
      if (!current) return;
      if (commit) {
        const runs =
          current.kind === "text" || current.kind === "text-list"
            ? runsOverride ?? current.runs
            : current.runs;
        const style =
          (current.kind === "text" || current.kind === "text-list") &&
          current.style
            ? current.style
            : current.style;
        const frame =
          (current.kind === "text" || current.kind === "text-list") &&
          style &&
          runs
            ? autoSizeInlineTextFrame(current.frame, runs, style)
            : current.frame;
        const previousElement = getElementAtSelection(
          currentUiRef.current,
          current.selection,
        );
        const previousContent =
          !previousElement
            ? ""
            : current.kind === "text"
            ? rawTextContent(previousElement as any)
            : textRunsContent(rawTextListRunsForEditor(previousElement as any));
        const nextContent = runsOverride
          ? textRunsContent(runsOverride)
          : current.draft;
        commitUi(
          syncComponentHeightToElement(
            updateElementInUi(
              currentUiRef.current,
              current.selection,
              (element) =>
                elementWithInlineDraft(
                  element,
                  current.kind,
                  runsOverride
                    ? textRunsContent(runsOverride)
                    : current.draft,
                  style,
                  frame,
                  runs,
                ),
            ),
            current.selection,
          ),
        );
        if (previousContent !== nextContent) {
          trackEvent(MixpanelEvent.Editor_Element_Text_Edited, {
            ...editorAnalyticsProps({
              element_type: current.kind,
              target_kind: current.selection.kind,
            }),
          });
        }
      }
      setSelection(current.selection);
      clearInlineEdit();
    },
    [clearInlineEdit, commitUi, editorAnalyticsProps, inlineEdit],
  );

  const commitInlineTextRuns = useCallback(
    (elementSelection: ElementSelection, runs: TextRun[]) => {
      updateInlineEdit(elementSelection, (active) => {
        if (active.kind !== "text" && active.kind !== "text-list") {
          return active;
        }
        const nextRuns = wordWrappedTextRuns(runs);
        const style = active.style
          ? active.style
          : undefined;
        return {
          ...active,
          draft: textRunsContent(nextRuns),
          runs: nextRuns,
          style,
          frame:
            style != null
              ? autoSizeInlineTextFrame(active.frame, nextRuns, style)
              : active.frame,
        };
      });
    },
    [updateInlineEdit],
  );

  const applyToolbarElementChange = useCallback(
    (editorElement: SlideElement) => {
      if (selection?.kind !== "element") return;
      const current = getElementAtSelection(currentUiRef.current, selection);
      const box = absoluteBoxForSelection(currentUiRef.current, selection);
      if (!current || !box) return;
      const next = mergeEditorToolbarElement(current, editorElement, box);
      updateElement(selection, () => next);
      trackEvent(MixpanelEvent.Editor_Element_Style_Changed, {
        ...editorAnalyticsProps({
          element_type: readString(current.type) || editorElement.type,
          change_source: "element_toolbar",
        }),
      });
      updateInlineEdit(selection, (active) => {
        if (
          !active?.style ||
          keyForSelection(active.selection) !== keyForSelection(selection)
        ) {
          return active;
        }
        if (active.kind === "text") {
          const runs = wordWrappedTextRuns(rawTextRunsForEditor(next));
          const style = rawTextStyle(next);
          return {
            ...active,
            draft: rawTextContent(next),
            runs,
            style,
            frame: autoSizeInlineTextFrame(active.frame, runs, style),
          };
        }
        if (active.kind === "text-list") {
          const runs = wordWrappedTextRuns(rawTextListRunsForEditor(next));
          const style = rawTextStyle(next);
          return {
            ...active,
            draft: textRunsContent(runs),
            runs,
            style,
            frame: autoSizeInlineTextFrame(active.frame, runs, style),
          };
        }
        return { ...active, style: rawTextStyle(next) };
      });
    },
    [editorAnalyticsProps, selection, updateElement, updateInlineEdit],
  );

  const applyLayoutElementChange = useCallback(
    (changes: Record<string, unknown>) => {
      if (!layoutToolbarTarget) return;
      trackEvent(MixpanelEvent.Editor_Element_Style_Changed, {
        ...editorAnalyticsProps({
          element_type: "layout",
          change_source: "layout_toolbar",
        }),
      });
      if (
        layoutToolbarTarget.selection.componentIndex ===
        ROOT_ELEMENTS_COMPONENT_INDEX
      ) {
        const updatedRoot = updateComponentLayoutElement(
          rootElementsComponent(currentUiRef.current),
          layoutToolbarTarget.selection.elementPath,
          changes,
          layoutToolbarTarget.box,
          {
            childrenBounds,
            elementBox,
            elementSize,
            isManualPositioned,
            normalizeLayoutChildren: elementWithNormalizedLayoutChildren,
          },
        );
        commitUi({
          ...currentUiRef.current,
          elements: readArray(updatedRoot.elements),
        });
        return;
      }
      updateComponent(layoutToolbarTarget.selection.componentIndex, (component) =>
        updateComponentLayoutElement(
          component,
          layoutToolbarTarget.selection.elementPath,
          changes,
          layoutToolbarTarget.box,
          {
            childrenBounds,
            elementBox,
            elementSize,
            isManualPositioned,
            normalizeLayoutChildren: elementWithNormalizedLayoutChildren,
          },
        ),
      );
    },
    [commitUi, editorAnalyticsProps, layoutToolbarTarget, updateComponent],
  );

  const applyChartToolbarElementChange = useCallback(
    (editorElement: ChartSlideElement) => {
      if (!chartToolbarTarget) return;
      const current = getElementAtSelection(
        currentUiRef.current,
        chartToolbarTarget.selection,
      );
      const box = absoluteBoxForSelection(
        currentUiRef.current,
        chartToolbarTarget.selection,
      );
      if (!current || !box) return;
      const next = mergeEditorToolbarElement(current, editorElement, box);
      updateElement(chartToolbarTarget.selection, () => next);
      trackEvent(MixpanelEvent.Editor_Element_Style_Changed, {
        ...editorAnalyticsProps({
          element_type: "chart",
          change_source: "chart_toolbar",
        }),
      });
    },
    [chartToolbarTarget, editorAnalyticsProps, updateElement],
  );

  const applyTableToolbarElementChange = useCallback(
    (editorElement: TableSlideElement) => {
      if (!tableToolbarTarget) return;
      const current = getElementAtSelection(
        currentUiRef.current,
        tableToolbarTarget.selection,
      );
      const box = absoluteBoxForSelection(
        currentUiRef.current,
        tableToolbarTarget.selection,
      );
      if (!current || !box) return;
      const next = mergeEditorToolbarElement(current, editorElement, box);
      updateElement(tableToolbarTarget.selection, () => next);
      trackEvent(MixpanelEvent.Editor_Element_Style_Changed, {
        ...editorAnalyticsProps({
          element_type: "table",
          change_source: "table_toolbar",
        }),
      });
    },
    [editorAnalyticsProps, tableToolbarTarget, updateElement],
  );

  const applyEditorToolbarTargetElementChange = useCallback(
    (editorElement: SlideElement) => {
      if (!editorToolbarTarget) return;
      const current = getElementAtSelection(
        currentUiRef.current,
        editorToolbarTarget.selection,
      );
      const box = absoluteBoxForSelection(
        currentUiRef.current,
        editorToolbarTarget.selection,
      );
      if (!current || !box) return;
      const next = mergeEditorToolbarElement(current, editorElement, box);
      updateElement(editorToolbarTarget.selection, () => next);
      trackEvent(MixpanelEvent.Editor_Element_Style_Changed, {
        ...editorAnalyticsProps({
          element_type: readString(current.type) || editorElement.type,
          change_source: "component_element_toolbar",
        }),
      });
    },
    [editorAnalyticsProps, editorToolbarTarget, updateElement],
  );

  const ungroupComponentAtIndex = useCallback((componentIndex: number) => {
    if (componentIndex < 0) return;
    const component = asRecord(
      readArray(currentUiRef.current.components)[componentIndex],
    );
    if (!canUngroupTemplateV2Component(component)) return;
    const result = ungroupTemplateV2ComponentInUi(
      currentUiRef.current,
      componentIndex,
      {
        childArrayInfo,
        componentBox,
        elementBox,
        layoutChildren,
      },
    );
    if (!result) return;
    commitUi(result.ui as RawUi);
    trackEvent(MixpanelEvent.Editor_Component_Ungrouped, {
      ...editorAnalyticsProps(),
    });
    setSelection(result.selection);
    clearInlineEdit();
    clearTableCellSelection();
    setIconEditorSelection(null);
  }, [
    clearInlineEdit,
    clearTableCellSelection,
    commitUi,
    editorAnalyticsProps,
  ]);

  const ungroupSelectedComponent = useCallback(() => {
    if (selection?.kind !== "component") return;
    ungroupComponentAtIndex(selection.componentIndex);
  }, [selection, ungroupComponentAtIndex]);

  const ungroupLayoutTargetComponent = useCallback(() => {
    const componentIndex = layoutToolbarTarget?.selection.componentIndex;
    if (componentIndex == null || componentIndex < 0) return;
    ungroupComponentAtIndex(componentIndex);
  }, [layoutToolbarTarget, ungroupComponentAtIndex]);

  // Merges the current multi-component selection into one component (the
  // inverse of Ungroup). Triggered via Ctrl/Cmd+G.
  const groupSelectedComponents = useCallback(() => {
    if (selection?.kind !== "multi-component") return;
    const result = groupComponentsInUi(
      currentUiRef.current,
      selection.componentIndexes,
    );
    if (!result) return;
    commitUi(result.ui);
    trackEvent(MixpanelEvent.Editor_Component_Grouped, {
      ...editorAnalyticsProps(),
    });
    setSelection(result.selection);
    selectionRef.current = result.selection;
    clearInlineEdit();
    clearTableCellSelection();
    setIconEditorSelection(null);
  }, [
    clearInlineEdit,
    clearTableCellSelection,
    commitUi,
    editorAnalyticsProps,
    selection,
  ]);

  const alignSelectedComponents = useCallback(
    (action: AlignAction) => {
      if (selection?.kind !== "multi-component") return;
      const next = alignComponentsInUi(
        currentUiRef.current,
        selection.componentIndexes,
        action,
      );
      commitUi(next);
    },
    [commitUi, selection],
  );

  const distributeSelectedComponents = useCallback(
    (axis: DistributeAxis) => {
      if (selection?.kind !== "multi-component") return;
      const next = distributeComponentsInUi(
        currentUiRef.current,
        selection.componentIndexes,
        axis,
      );
      commitUi(next);
    },
    [commitUi, selection],
  );

  const reorderComponentLayerAtIndex = useCallback(
    (componentIndex: number, action: ComponentLayerAction) => {
      const result = reorderComponentLayer(
        readArray(currentUiRef.current.components),
        componentIndex,
        action,
      );
      if (!result) return;
      const nextSelection: ComponentSelection = {
        kind: "component",
        componentIndex: result.componentIndex,
      };
      commitUi({
        ...currentUiRef.current,
        components: result.components,
      });
      trackEvent(MixpanelEvent.Editor_Component_Layer_Changed, {
        ...editorAnalyticsProps({
          action,
        }),
      });
      setSelection(nextSelection);
      clearTableCellSelection();
      clearInlineEdit();
      setIconEditorSelection(null);
      activateSurface(nextSelection);
    },
    [
      activateSurface,
      clearInlineEdit,
      clearTableCellSelection,
      commitUi,
      editorAnalyticsProps,
    ],
  );

  const reorderSelectedComponentLayer = useCallback(
    (action: ComponentLayerAction) => {
      if (selection?.kind !== "component") return;
      reorderComponentLayerAtIndex(selection.componentIndex, action);
    },
    [reorderComponentLayerAtIndex, selection],
  );

  const targetComponentActions =
    useMemo<TemplateV2SelectionComponentActions | null>(() => {
      const componentIndex =
        tableToolbarTarget?.selection.componentIndex ??
        chartToolbarTarget?.selection.componentIndex;
      if (componentIndex == null || componentIndex < 0) return null;
      const component = asRecord(readArray(uiDraft.components)[componentIndex]);
      return {
        canUngroup: canUngroupTemplateV2Component(component),
        componentCount: components.length,
        componentIndex,
        onDelete: () => deleteComponentAtIndex(componentIndex),
        onDuplicate: () => duplicateComponentAtIndex(componentIndex),
        onLayerAction: (action: ComponentLayerAction) =>
          reorderComponentLayerAtIndex(componentIndex, action),
        onUngroup: () => ungroupComponentAtIndex(componentIndex),
      };
    }, [
      chartToolbarTarget,
      components.length,
      deleteComponentAtIndex,
      duplicateComponentAtIndex,
      reorderComponentLayerAtIndex,
      tableToolbarTarget,
      uiDraft.components,
      ungroupComponentAtIndex,
    ]);

  const openImageUpload = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (readString(element?.type) !== "image") return;
      activateSurface(elementSelection);
      pendingImageUploadRef.current = elementSelection;
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = "";
        imageUploadInputRef.current.click();
      }
    },
    [activateSurface],
  );

  const openIconEditor = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(
        currentUiRef.current,
        elementSelection,
      );
      if (!element || !isRawIconElement(element)) {
        return;
      }
      activateSurface(elementSelection);
      setSelection(elementSelection);
      clearInlineEdit();
      setIconEditorSelection(elementSelection);
    },
    [activateSurface, clearInlineEdit],
  );

  const handleIconChange = useCallback(
    (newIconUrl: string, query?: string) => {
      if (!iconEditorSelection || !newIconUrl) return;
      updateElement(iconEditorSelection, (element) => ({
        ...element,
        data: newIconUrl,
        ...(query ? { icon_query: query } : {}),
      }));
      trackEvent(MixpanelEvent.Editor_Icon_Replaced, {
        ...editorAnalyticsProps({
          query_present: Boolean(query),
        }),
      });
    },
    [editorAnalyticsProps, iconEditorSelection, updateElement],
  );

  const openChartEditor = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      if (!element || readString(element.type) !== "chart") return;
      activateSurface(elementSelection);
      setSelection(elementSelection);
      clearInlineEdit();
      setIconEditorSelection(null);
      setChartEditorSelection(elementSelection);
    },
    [activateSurface, clearInlineEdit],
  );

  const handleImageUploadChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      const target = pendingImageUploadRef.current;
      if (!file || !target) return;

      if (!file.type.startsWith("image/")) {
        trackEvent(MixpanelEvent.Editor_Image_Replace_Failed, {
          ...editorAnalyticsProps({
            error_message: "Invalid image file type",
          }),
        });
        notify.warning("Invalid file", "Please upload an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        trackEvent(MixpanelEvent.Editor_Image_Replace_Failed, {
          ...editorAnalyticsProps({
            file_size_bucket: bucketFileSize(file.size),
            error_message: "Image file too large",
          }),
        });
        notify.warning("File too large", "Image files must be smaller than 5MB.");
        return;
      }

      try {
        setIsUploadingImage(true);
        const uploaded = await ImagesApi.uploadImage(file);
        const imageUrl = resolveBackendAssetSource(uploaded);
        if (!imageUrl) throw new Error("Upload did not return an image URL.");
        updateElement(target, (element) => ({
          ...element,
          data: imageUrl,
          name: element.name ?? file.name,
        }));
        trackEvent(MixpanelEvent.Editor_Image_Replaced, {
          ...editorAnalyticsProps({
            file_size_bucket: bucketFileSize(file.size),
          }),
        });
        notify.success("Image updated", "The selected image was replaced.");
      } catch (error) {
        trackEvent(MixpanelEvent.Editor_Image_Replace_Failed, {
          ...editorAnalyticsProps({
            error_message: sanitizeAnalyticsError(
              error,
              "Failed to upload image"
            ),
          }),
        });
        notify.error(
          "Upload failed",
          error instanceof Error
            ? error.message
            : "Failed to upload image. Please try again.",
        );
      } finally {
        pendingImageUploadRef.current = null;
        setIsUploadingImage(false);
      }
    },
    [editorAnalyticsProps, updateElement],
  );

  const handleElementDoubleClick = useCallback(
    (elementSelection: ElementSelection) => {
      const element = getElementAtSelection(currentUiRef.current, elementSelection);
      const type = readString(element?.type);
      if (type === "image") {
        if (element && isRawIconElement(element)) {
          openIconEditor(elementSelection);
        }
        return;
      }
      if (type === "chart") {
        openChartEditor(elementSelection);
        return;
      }
      openInlineEditor(elementSelection);
    },
    [openChartEditor, openIconEditor, openInlineEditor],
  );

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      if (!selection) return;
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelection, isEditMode, selection]);

  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleInsertElements = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2InsertElementsDetail>).detail;
      const elements = detail?.elements ?? [];
      const insertedComponents = detail?.components ?? [];
      if (elements.length === 0 && insertedComponents.length === 0) return;
      if (!eventTargetsThisSlide(detail, slideId, surfaceSlideIndex, isSurfaceActive)) {
        return;
      }

      const nextIndex = readArray(currentUiRef.current.components).length;
      const nextUi = appendInsertedContent(
        currentUiRef.current,
        elements as unknown as UnknownRecord[],
        insertedComponents as unknown as UnknownRecord[],
        detail.label,
      );
      commitUi(nextUi);
      setSelection({
        kind: "component",
        componentIndex: Math.max(0, nextIndex),
      });
      detail.handled = true;
    };

    window.addEventListener(TEMPLATE_V2_INSERT_ELEMENTS_EVENT, handleInsertElements);
    return () =>
      window.removeEventListener(
        TEMPLATE_V2_INSERT_ELEMENTS_EVENT,
        handleInsertElements,
      );
  }, [commitUi, isEditMode, isSurfaceActive, slideId, surfaceSlideIndex]);

  useEffect(() => {
    if (!isEditMode || typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const targetNode = event.target instanceof Node ? event.target : null;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "[data-template-v2-floating-toolbar='true'], [data-inline-edit-ignore='true']",
        )
      ) {
        if (isSurfaceActive()) {
          activateSurface();
        }
        return;
      }
      if (targetNode && root?.contains(targetNode)) {
        activateSurface();
        return;
      }

      clearEditorUiState({ clearActiveSurface: true });
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      clearSurface();
    };
  }, [
    activateSurface,
    clearEditorUiState,
    clearSurface,
    isEditMode,
    isSurfaceActive,
  ]);

  useEffect(() => {
    if (!isEditMode || typeof document === "undefined") return;

    const handleUndoRedoShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !isSurfaceActive() ||
        isEditableTarget(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const wantsUndo = key === "z" && !event.shiftKey;
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!wantsUndo && !wantsRedo) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (wantsUndo) {
        undo();
        return;
      }
      redo();
    };

    document.addEventListener("keydown", handleUndoRedoShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleUndoRedoShortcut, true);
  }, [isEditMode, isSurfaceActive, redo, undo]);

  // Ctrl/Cmd+G groups the current multi-component selection into one.
  useEffect(() => {
    if (!isEditMode || typeof document === "undefined") return;

    const handleGroupShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !isSurfaceActive() ||
        isEditableTarget(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "g"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      groupSelectedComponents();
    };

    document.addEventListener("keydown", handleGroupShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleGroupShortcut, true);
  }, [groupSelectedComponents, isEditMode, isSurfaceActive]);

  // Lets the header's Undo/Redo buttons trigger the same history stack as
  // Ctrl/Cmd+Z / Ctrl/Cmd+Y — only the currently active surface responds.
  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleUndoEvent = () => {
      if (!isSurfaceActive()) return;
      undo();
    };
    const handleRedoEvent = () => {
      if (!isSurfaceActive()) return;
      redo();
    };

    window.addEventListener(TEMPLATE_V2_UNDO_EVENT, handleUndoEvent);
    window.addEventListener(TEMPLATE_V2_REDO_EVENT, handleRedoEvent);
    return () => {
      window.removeEventListener(TEMPLATE_V2_UNDO_EVENT, handleUndoEvent);
      window.removeEventListener(TEMPLATE_V2_REDO_EVENT, handleRedoEvent);
    };
  }, [isEditMode, isSurfaceActive, redo, undo]);

  // Lets the color-palette panel apply a swatch directly to whatever's
  // currently selected — text font color, shape fills, line strokes, icon
  // tints, chart/infographic accents, or a whole component's elements.
  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleApplyColor = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2ApplyColorDetail>).detail;
      const color = detail?.color;
      if (!color || !selection) return;

      if (selection.kind === "element") {
        const current = getElementAtSelection(currentUiRef.current, selection);
        if (!current) return;
        const next = recolorRawElement(current, color);
        if (next === current) return;
        updateElement(selection, () => next);
        return;
      }

      const componentIndexes =
        selection.kind === "component"
          ? [selection.componentIndex]
          : selection.componentIndexes;
      let ui = currentUiRef.current;
      for (const componentIndex of componentIndexes) {
        ui = updateComponentInUi(ui, componentIndex, (component) => {
          const elements = readArray(component.elements);
          const recolored = recolorRawElements(elements, color);
          return recolored === elements
            ? component
            : { ...component, elements: recolored };
        });
      }
      if (ui === currentUiRef.current) return;
      commitUi(ui);
    };

    window.addEventListener(TEMPLATE_V2_APPLY_COLOR_EVENT, handleApplyColor);
    return () =>
      window.removeEventListener(TEMPLATE_V2_APPLY_COLOR_EVENT, handleApplyColor);
  }, [commitUi, isEditMode, selection, updateElement]);

  // Lets the palette panel's "Extract color from this image" button pull
  // dominant colors from the currently selected image element.
  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleExtractColors = () => {
      const respond = (detail: TemplateV2ImageColorsResultDetail) => {
        window.dispatchEvent(
          new CustomEvent<TemplateV2ImageColorsResultDetail>(
            TEMPLATE_V2_IMAGE_COLORS_RESULT_EVENT,
            { detail },
          ),
        );
      };
      if (!isSurfaceActive() || !selection || selection.kind !== "element") {
        respond({ colors: [], error: "Select an image first." });
        return;
      }
      const current = getElementAtSelection(currentUiRef.current, selection);
      const src = current && readString(current.type) === "image" ? readString(current.data) : null;
      if (!src) {
        respond({ colors: [], error: "Select an image first." });
        return;
      }
      extractDominantColors(src)
        .then((colors) => respond({ colors }))
        .catch(() => respond({ colors: [], error: "Couldn't read colors from this image." }));
    };

    window.addEventListener(TEMPLATE_V2_EXTRACT_IMAGE_COLORS_EVENT, handleExtractColors);
    return () =>
      window.removeEventListener(TEMPLATE_V2_EXTRACT_IMAGE_COLORS_EVENT, handleExtractColors);
  }, [isEditMode, isSurfaceActive, selection]);

  // Lets Find & Replace jump to (select + highlight) a specific match's
  // element, on whichever slide instance it targets.
  useEffect(() => {
    if (!isEditMode || typeof window === "undefined") return;

    const handleSelectElement = (event: Event) => {
      const detail = (event as CustomEvent<TemplateV2SelectElementDetail>).detail;
      if (!detail || !eventTargetsThisSlide(detail, slideId, surfaceSlideIndex, () => false)) {
        return;
      }
      select({
        kind: "element",
        componentIndex: detail.componentIndex,
        elementPath: detail.elementPath,
      });
    };

    window.addEventListener(TEMPLATE_V2_SELECT_ELEMENT_EVENT, handleSelectElement);
    return () =>
      window.removeEventListener(TEMPLATE_V2_SELECT_ELEMENT_EVENT, handleSelectElement);
  }, [isEditMode, select, slideId, surfaceSlideIndex]);

  if (!uiDraft) {
    return (
      <div className="flex h-full aspect-video flex-col items-center justify-center rounded-lg bg-gray-100">
        <Loader2 className="mb-2 h-4 w-4 animate-spin" />
        <p className="text-center text-sm text-gray-600">Loading slide layout...</p>
      </div>
    );
  }

  return (
    <div
      ref={setRootNode}
      data-template-v2-konva-surface={surfaceId}
      className="relative h-full w-full overflow-hidden bg-white"
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
      onPointerDown={() => activateSurface()}
    >
      {isEditMode ? (
        <input
          ref={imageUploadInputRef}
          accept="image/*"
          className="hidden"
          type="file"
          onChange={handleImageUploadChange}
        />
      ) : null}
      <Stage
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={(event) => {
          if (event.target === event.target.getStage()) {
            activateSurface(null);
            clearEditorUiState();
            return;
          }
          activateSurface();
        }}
      >
        <Layer listening={false}>
          <SlideBackground ui={uiDraft} />
        </Layer>
        <Layer ref={contentLayerRef} listening={isEditMode}>
          {rootElements.map((element, elementIndex) => (
            <MemoizedRawElementNode
              key={`root:${rawElementKey(element, elementIndex)}`}
              element={element}
              componentIndex={ROOT_ELEMENTS_COMPONENT_INDEX}
              elementPath={[elementIndex]}
              isEditMode={isEditMode}
              editingKey={editingKey}
              selectedTableCell={visibleSelectedTableCell}
              setNodeRef={setSelectionNodeRef}
              onSelect={select}
              onTableCellSelect={selectTableCell}
              onTableCellEdit={editTableCell}
              onOpenEditor={handleElementDoubleClick}
              onElementChange={updateElement}
              parentBox={STAGE_BOX}
              layoutManaged={false}
              fontRevision={fontLoadState.revision}
            />
          ))}
          {components.map((component, componentIndex) => (
            <MemoizedRawComponentNode
              key={componentKey(component, componentIndex)}
              component={component}
              componentIndex={componentIndex}
              isBackground={isBackgroundComponent(component)}
              isEditMode={isEditMode}
              isMultiSelectedComponent={
                selectedComponentIndexes.length > 1 &&
                selectedComponentIndexSet.has(componentIndex)
              }
              editingKey={editingKey}
              selectedTableCell={visibleSelectedTableCell}
              setNodeRef={setSelectionNodeRef}
              onSelect={select}
              onTableCellSelect={selectTableCell}
              onTableCellEdit={editTableCell}
              onOpenElementEditor={handleElementDoubleClick}
              onComponentChange={updateComponent}
              onComponentDragStart={handleComponentDragStart}
              onComponentDragMove={handleComponentDragMove}
              onComponentDragEnd={handleComponentDragEnd}
              onElementChange={updateElement}
              fontRevision={fontLoadState.revision}
            />
          ))}
          {isEditMode ? (
            <TemplateV2SelectionTransformers
              nodeRefs={nodeRefs}
              parentComponentKey={inlineEdit ? null : selectedParentComponentKey}
              selectedKey={selectedKey}
              selectedKeys={selectedKeys}
              selectionKind={selection?.kind ?? null}
              horizontalResizeOnly={editorToolbarTarget?.element.type === "line"}
              suppressSelectedOutline={Boolean(
                selectedTableCell ||
                  inlineEdit ||
                  readString(selectedElement?.type) === "chart",
              )}
              snapGuidesLayerRef={snapGuidesLayerRef}
              getResizeSnapStops={getResizeSnapStops}
            />
          ) : null}
        </Layer>
        <Layer ref={snapGuidesLayerRef} listening={false} />
        <Layer ref={spacingBadgesLayerRef} listening={false} />
        <Layer ref={marqueeLayerRef} listening={false} />
      </Stage>
      <TemplateV2SelectionToolbar
        anchorBox={floatingToolbarAnchorBox}
        canUngroupComponent={canUngroupSelectedComponent}
        canUngroupLayoutTarget={canUngroupLayoutTargetComponent}
        chartTarget={chartToolbarTarget}
        componentCount={components.length}
        editorTarget={editorToolbarTarget}
        isEditMode={isEditMode}
        layoutTarget={layoutToolbarTarget}
        position={selectionToolbarPosition}
        selectedTableCell={toolbarSelectedTableCell}
        selection={selection}
        selectionKey={keyForSelection(selection)}
        tableTarget={tableToolbarTarget}
        targetComponentActions={targetComponentActions}
        templateFonts={templateFonts}
        toolbarBounds={selectionToolbarBounds}
        onChartChange={applyChartToolbarElementChange}
        onChartEdit={() => {
          if (chartToolbarTarget) {
            openChartEditor(chartToolbarTarget.selection);
          }
        }}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        onEditorChange={applyEditorToolbarTargetElementChange}
        onLayoutChange={applyLayoutElementChange}
        onLayerAction={reorderSelectedComponentLayer}
        onTableChange={applyTableToolbarElementChange}
        onUngroupComponent={ungroupSelectedComponent}
        onUngroupLayoutTarget={ungroupLayoutTargetComponent}
      />
      {isEditMode && selection?.kind === "multi-component" ? (
        <AlignDistributeToolbar
          position={alignDistributePosition}
          canDistribute={selection.componentIndexes.length >= 3}
          onAlign={alignSelectedComponents}
          onDistribute={distributeSelectedComponents}
        />
      ) : null}
      {isEditMode &&
        selection?.kind === "element" &&
        selectedElement &&
        selectedBox &&
        toolbarElement &&
        !chartToolbarTarget &&
        !tableToolbarTarget &&
        !isTemplateV2LayoutElement(selectedElement) &&
        !isTemplateV2GroupElement(selectedElement) &&
        !isRawIconElement(selectedElement) &&
        !(editingTableCell && readString(selectedElement.type) === "table") ? (
        <ElementToolbar
          element={toolbarElement}
          index={selection.componentIndex}
          anchorBox={selectedBox}
          path={keyForSelection(selection)}
          scale={1}
          selectedTableCell={selectedTableCell}
          templateFonts={templateFonts}
          textSelectionRange={
            inlineEdit &&
              (inlineEdit.kind === "text" || inlineEdit.kind === "text-list") &&
              keyForSelection(inlineEdit.selection) === keyForSelection(selection)
              ? inlineEdit.textSelectionRange
              : null
          }
          onChange={(_index, element) => applyToolbarElementChange(element)}
          onEditImage={() => openImageUpload(selection)}
          onEditText={() => openInlineEditor(selection)}
        />
      ) : null}
      {isEditMode &&
        selection?.kind === "element" &&
        editingTableCell &&
        toolbarElement &&
        readString((toolbarElement as UnknownRecord).type) === "table" ? (
        <TableInlineEditor
          key={`${keyForSelection(selection)}:${editingTableCell.rowIndex}:${editingTableCell.colIndex}`}
          element={toolbarElement as TableSlideElement}
          index={selection.componentIndex}
          scale={1}
          selectedCell={editingTableCell}
          templateFonts={templateFonts}
          onChange={(_index, element) => applyToolbarElementChange(element)}
          onClose={clearTableCellEditing}
        />
      ) : null}
      {isEditMode && inlineEdit && inlineEditBox ? (
        <TemplateV2InlineEditor
          key={keyForSelection(inlineEdit.selection)}
          draft={inlineEdit.draft}
          kind={inlineEdit.kind}
          box={inlineEditBox}
          runs={inlineEdit.runs}
          style={inlineEdit.style}
          onChange={updateInlineDraft}
          onSelectionChange={(textSelectionRange) =>
            updateInlineTextSelectionRange(
              inlineEdit.selection,
              textSelectionRange,
            )
          }
          onRunsChange={(runs) =>
            commitInlineTextRuns(inlineEdit.selection, runs)
          }
          onClose={(commit, runs) => closeInlineEditor(commit, runs)}
        />
      ) : null}
      {isEditMode &&
        chartEditorSelection &&
        chartEditorElement &&
        readString(chartEditorElement.type) === "chart" ? (
        <ChartDataEditorPopover
          key={keyForSelection(chartEditorSelection)}
          chart={rawChartToEditorChart(chartEditorElement)}
          chartPath={keyForSelection(chartEditorSelection)}
          onChange={(chart) =>
            updateElement(chartEditorSelection, (element) =>
              editorChartToRawChart(
                element,
                chart as unknown as UnknownRecord,
              ),
            )
          }
          onClose={closeChartEditor}
        />
      ) : null}
      {isEditMode &&
        iconEditorSelection &&
        iconEditorElement &&
        isRawIconElement(iconEditorElement) ? (
        <IconsEditor
          key={keyForSelection(iconEditorSelection)}
          icon_prompt={[rawIconQuery(iconEditorElement)]}
          currentIconUrl={readString(iconEditorElement.data) ?? ""}
          onClose={() => setIconEditorSelection(null)}
          onIconChange={handleIconChange}
        />
      ) : null}
      {isUploadingImage ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/35">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-[#191919] shadow-md">
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading image...
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const TemplateV2KonvaSlide = memo(TemplateV2KonvaSlideComponent);
TemplateV2KonvaSlide.displayName = "TemplateV2KonvaSlide";
