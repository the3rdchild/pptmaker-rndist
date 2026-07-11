"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type Konva from "konva";
import {
  Arc,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  Text,
} from "react-konva";
import { effectiveLineHeight } from "@/components/slide-editor/text/text-line-height";
import { textRunsContent } from "@/components/slide-editor/text/text-runs";
import {
  displayText,
  layoutRenderTextRuns,
  lineRenderHeight,
  lineStartX,
  fontScaleFromResize,
  rawFont,
  rawRenderTextRuns,
  rawTextContent,
  rawTextListRenderTextRuns,
  textVisualLocalBox,
  type RenderTextRun,
} from "@/components/slide-editor/text/template-v2-text";
import type { TableCellSelection } from "@/components/slide-editor/state/state";
import { loadKonvaImage } from "@/components/slide-editor/surface/exportAssets";
import { TemplateV2ChartJsElement as RawChartElement } from "@/components/slide-editor/charts/TemplateV2ChartJsElement";
import { TemplateV2TableElement as RawTableElement } from "@/components/slide-editor/tables/TemplateV2TableElement";
import { buildSvgUpdateUrl } from "@/lib/svg-color";
import {
  asRecord,
  borderRadius,
  childArrayInfo,
  clamp,
  colorWithOpacity,
  componentBox,
  elementBox,
  fillColor,
  fillOpacity,
  boxEqual,
  isBoxVisualType,
  isManualPositioned,
  isRawIconElement,
  isStaticSvgIconSource,
  isRecord,
  keyForSelection,
  layoutChildren,
  linePoints,
  nullableBoxEqual,
  numberPathEqual,
  positionFromNodeInParent,
  rawElementKey,
  readArray,
  readBoolean,
  readNumber,
  readString,
  ROOT_ELEMENTS_COMPONENT_INDEX,
  STAGE_BOX,
  resizeComponent,
  resizeComponentElementBounds,
  resizeComponentFrame,
  scaleRawElementTextMetrics,
  selectionTouchesComponent,
  selectionTouchesElement,
  shadowProps,
  shouldClipElementChildren,
  shouldUseCenterOrigin,
  strokeColor,
  strokeOpacity,
  strokeWidth,
  valueProgress,
  pointOnCircle,
  withHash,
  type Box,
  type ComponentSelection,
  type ElementSelection,
  type Point,
  type RawComponent,
  type RawElement,
  type SelectOptions,
  type Selection,
} from "@/components/slide-editor/model/model";

type ComponentTransformAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "rotater";

type ComponentResizeMode =
  | "scale-content"
  | "resize-element-bounds"
  | "resize-frame";

type ComponentTransformBox = Box & {
  scaleX: number;
  scaleY: number;
  rawWidth: number;
  rawHeight: number;
};

const HORIZONTAL_RESIZE_ANCHORS = new Set<ComponentTransformAnchor>([
  "middle-left",
  "middle-right",
]);
const VERTICAL_RESIZE_ANCHORS = new Set<ComponentTransformAnchor>([
  "top-center",
  "bottom-center",
]);

function componentTransformAnchorForNode(
  node: Konva.Node,
): ComponentTransformAnchor | null {
  const stage = node.getStage();
  if (!stage) return null;
  const transformer = stage
    .find<Konva.Transformer>("Transformer")
    .find((candidate) => candidate.getNodes().includes(node));
  const activeAnchor = transformer?.getActiveAnchor();
  return isComponentTransformAnchor(activeAnchor) ? activeAnchor : null;
}

function isComponentTransformAnchor(
  value: string | null | undefined,
): value is ComponentTransformAnchor {
  return (
    value === "top-left" ||
    value === "top-center" ||
    value === "top-right" ||
    value === "middle-left" ||
    value === "middle-right" ||
    value === "bottom-left" ||
    value === "bottom-center" ||
    value === "bottom-right" ||
    value === "rotater"
  );
}

function componentResizeModeForTransform(
  anchor: ComponentTransformAnchor | null,
  scaleX: number,
  scaleY: number,
): ComponentResizeMode {
  if (anchor === "rotater") return "resize-frame";
  if (
    anchor &&
    (HORIZONTAL_RESIZE_ANCHORS.has(anchor) ||
      VERTICAL_RESIZE_ANCHORS.has(anchor))
  ) {
    return "resize-element-bounds";
  }
  if (anchor) return "scale-content";

  const changedX = Math.abs(scaleX - 1) > 0.001;
  const changedY = Math.abs(scaleY - 1) > 0.001;
  if (changedX && changedY) return "scale-content";
  if (changedX || changedY) return "resize-element-bounds";
  return "resize-frame";
}

function componentBoxFromTransform(
  component: RawComponent,
  box: Box,
  scaleX: number,
  scaleY: number,
  anchor: ComponentTransformAnchor | null,
): ComponentTransformBox {
  const isVerticalOnly = anchor ? VERTICAL_RESIZE_ANCHORS.has(anchor) : false;
  const isHorizontalOnly = anchor ? HORIZONTAL_RESIZE_ANCHORS.has(anchor) : false;
  const nextScaleX = isVerticalOnly || anchor === "rotater" ? 1 : scaleX;
  const nextScaleY = isHorizontalOnly || anchor === "rotater" ? 1 : scaleY;
  const rawWidth = Math.max(1, box.width * nextScaleX);
  const rawHeight = Math.max(1, box.height * nextScaleY);
  const minimumSize = minimumComponentSizeForElementBoundsResize(component);
  const width = isHorizontalOnly ? Math.max(rawWidth, minimumSize.width) : rawWidth;
  const height = isVerticalOnly ? Math.max(rawHeight, minimumSize.height) : rawHeight;

  return {
    ...box,
    width,
    height,
    scaleX: box.width > 0 ? width / box.width : 1,
    scaleY: box.height > 0 ? height / box.height : 1,
    rawWidth,
    rawHeight,
  };
}

function minimumComponentSizeForElementBoundsResize(component: RawComponent) {
  let width = 1;
  let height = 1;

  const visitElement = (
    element: RawElement,
    box: Box,
    offsetX: number,
    offsetY: number,
  ) => {
    const x = offsetX + box.x;
    const y = offsetY + box.y;
    if (x > 0) width = Math.max(width, x + box.width);
    if (y > 0) height = Math.max(height, y + box.height);

    const childInfo = childArrayInfo(element);
    if (!childInfo) return;
    layoutChildren(element, childInfo.items, box).forEach((childLayout) => {
      visitElement(
        childLayout.child,
        childLayout.box ?? elementBox(childLayout.child),
        x,
        y,
      );
    });
  };

  readArray(component.elements)
    .filter(isRecord)
    .forEach((element) => {
      visitElement(element as RawElement, elementBox(element), 0, 0);
    });

  return { width, height };
}

function positionFromComponentTransform(
  node: Konva.Node,
  nextBox: ComponentTransformBox,
  anchor: ComponentTransformAnchor | null,
): Point {
  const rawPosition = positionFromNodeInParent(node, STAGE_BOX, {
    ...nextBox,
    width: nextBox.rawWidth,
    height: nextBox.rawHeight,
  });
  let x = rawPosition.x;
  let y = rawPosition.y;

  if (anchor === "middle-left") {
    x = rawPosition.x + nextBox.rawWidth - nextBox.width;
  }
  if (anchor === "top-center") {
    y = rawPosition.y + nextBox.rawHeight - nextBox.height;
  }

  return {
    x: clamp(x, 0, Math.max(0, STAGE_BOX.width - nextBox.width)),
    y: clamp(y, 0, Math.max(0, STAGE_BOX.height - nextBox.height)),
  };
}

function componentFromNodeTransform(
  component: RawComponent,
  node: Konva.Group,
  anchor: ComponentTransformAnchor | null,
) {
  const box = componentBox(component);
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const nextBox = componentBoxFromTransform(component, box, scaleX, scaleY, anchor);
  const resizeMode = componentResizeModeForTransform(anchor, scaleX, scaleY);
  node.scaleX(1);
  node.scaleY(1);
  const position = positionFromComponentTransform(node, nextBox, anchor);
  const nextComponentBox = {
    ...position,
    width: nextBox.width,
    height: nextBox.height,
    rotation: node.rotation(),
  };

  if (resizeMode === "resize-frame") {
    return resizeComponentFrame(component, nextComponentBox);
  }
  if (resizeMode === "resize-element-bounds") {
    return resizeComponentElementBounds(component, {
      ...nextComponentBox,
      scaleX: nextBox.scaleX,
      scaleY: nextBox.scaleY,
    });
  }
  return resizeComponent(component, {
    ...nextComponentBox,
    scaleX: nextBox.scaleX,
    scaleY: nextBox.scaleY,
  });
}

export function RawComponentNode({
  component,
  componentIndex,
  isEditMode,
  isMultiSelectedComponent,
  editingKey,
  selectedTableCell,
  setNodeRef,
  onSelect,
  onTableCellSelect,
  onTableCellEdit,
  onOpenElementEditor,
  onComponentChange,
  onComponentDragStart,
  onComponentDragMove,
  onComponentDragEnd,
  onElementChange,
  fontRevision,
}: {
  component: RawComponent;
  componentIndex: number;
  isEditMode: boolean;
  isMultiSelectedComponent: boolean;
  editingKey: string | null;
  selectedTableCell: TableCellSelection | null;
  setNodeRef: (key: string, node: Konva.Node | null) => void;
  onSelect: (selection: Selection, options?: SelectOptions) => void;
  onTableCellSelect: (
    selection: ElementSelection,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onTableCellEdit: (
    selection: ElementSelection,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onOpenElementEditor: (selection: ElementSelection) => void;
  onComponentChange: (
    componentIndex: number,
    updater: (component: RawComponent) => RawComponent,
  ) => void;
  onComponentDragStart: (componentIndex: number, node: Konva.Node) => void;
  onComponentDragMove: (componentIndex: number, node: Konva.Node) => void;
  onComponentDragEnd: (componentIndex: number, node: Konva.Node) => void;
  onElementChange: (
    selection: ElementSelection,
    updater: (element: RawElement) => RawElement,
  ) => void;
  fontRevision: number;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const transformPreviewRef = useRef<RawComponent | null>(null);
  const [transformPreview, setTransformPreview] =
    useState<RawComponent | null>(null);
  const renderedComponent = transformPreview ?? component;
  const box = componentBox(renderedComponent);
  const selection: ComponentSelection = { kind: "component", componentIndex };
  const key = keyForSelection(selection);
  const elements = readArray(renderedComponent.elements).filter(
    isRecord,
  ) as RawElement[];
  const clipBounds = isEditMode
    ? null
    : componentTextClipBounds(elements, box);

  return (
    <Group
      ref={(node) => {
        groupRef.current = node;
        setNodeRef(key, node);
      }}
      x={box.x + box.width / 2}
      y={box.y + box.height / 2}
      width={box.width}
      height={box.height}
      offsetX={box.width / 2}
      offsetY={box.height / 2}
      rotation={readNumber(renderedComponent.rotation) ?? 0}
      clipX={clipBounds?.x}
      clipY={clipBounds?.y}
      clipWidth={clipBounds?.width}
      clipHeight={clipBounds?.height}
      draggable={isEditMode}
      onMouseDown={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        if (isMultiSelectedComponent && !event.evt.shiftKey) return;
        onSelect(selection, { additive: event.evt.shiftKey });
      }}
      onTouchStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        if (isMultiSelectedComponent) return;
        onSelect(selection);
      }}
      onDragStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        if (!isMultiSelectedComponent && !event.evt.shiftKey) {
          onSelect(selection);
        }
        onComponentDragStart(componentIndex, node);
      }}
      onDragMove={(event) => {
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onComponentDragMove(componentIndex, node);
      }}
      onDragEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onComponentDragEnd(componentIndex, node);
      }}
      onTransformStart={() => {
        transformPreviewRef.current = null;
        setTransformPreview(null);
      }}
      onTransform={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const anchor = componentTransformAnchorForNode(node);
        if (anchor === "rotater") return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        if (
          Math.abs(scaleX - 1) < 0.001 &&
          Math.abs(scaleY - 1) < 0.001
        ) {
          return;
        }
        const next = componentFromNodeTransform(
          transformPreviewRef.current ?? component,
          node,
          anchor,
        );
        transformPreviewRef.current = next;
        setTransformPreview(next);
      }}
      onTransformEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const anchor = componentTransformAnchorForNode(node);
        const next = componentFromNodeTransform(
          transformPreviewRef.current ?? component,
          node,
          anchor,
        );
        transformPreviewRef.current = null;
        setTransformPreview(null);
        onComponentChange(componentIndex, () => next);
      }}
    >
      {isEditMode ? <SelectionBoundsRect width={box.width} height={box.height} /> : null}
      {elements.map((element, elementIndex) => (
        <MemoizedRawElementNode
          key={rawElementKey(element, elementIndex)}
          element={element}
          componentIndex={componentIndex}
          elementPath={[elementIndex]}
          isEditMode={isEditMode}
          editingKey={editingKey}
          selectedTableCell={selectedTableCell}
          setNodeRef={setNodeRef}
          onSelect={onSelect}
          onTableCellSelect={onTableCellSelect}
          onTableCellEdit={onTableCellEdit}
          onOpenEditor={onOpenElementEditor}
          onElementChange={onElementChange}
          parentBox={box}
          textConstraintBox={{
            x: 0,
            y: 0,
            width: box.width,
            height: box.height,
          }}
          layoutManaged={false}
          fontRevision={fontRevision}
        />
      ))}
    </Group>
  );
}

function componentTextClipBounds(elements: RawElement[], componentBox: Box): Box {
  let left = 0;
  let top = 0;
  let right = componentBox.width;
  let bottom = componentBox.height;

  const includeBox = (box: Box, offsetX: number, offsetY: number) => {
    left = Math.min(left, offsetX + box.x);
    top = Math.min(top, offsetY + box.y);
    right = Math.max(right, offsetX + box.x + box.width);
    bottom = Math.max(bottom, offsetY + box.y + box.height);
  };

  const visitElement = (
    element: RawElement,
    box: Box,
    offsetX: number,
    offsetY: number,
  ) => {
    const visualBox = constrainedWrappedTextVisualBox(element, box, {
      x: 0,
      y: 0,
      width: Math.max(1, componentBox.width - offsetX),
      height: componentBox.height,
    });
    const type = readString(element.type);
    if (type === "text" || type === "text-list") {
      includeBox(visualBox, offsetX, offsetY);
    }

    const childInfo = childArrayInfo(element);
    if (!childInfo) return;
    layoutChildren(element, childInfo.items, box).forEach((childLayout) => {
      visitElement(
        childLayout.child,
        childLayout.box ?? elementBox(childLayout.child),
        offsetX + box.x,
        offsetY + box.y,
      );
    });
  };

  elements.forEach((element) => visitElement(element, elementBox(element), 0, 0));

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function constrainedWrappedTextVisualBox(
  element: RawElement,
  box: Box,
  parentBox: Box,
): Box {
  const type = readString(element.type);
  if (type !== "text" && type !== "text-list") return box;

  const availableWidth = Math.max(1, parentBox.width - box.x);
  const width = Math.min(box.width, availableWidth);
  if (Math.abs(width - box.width) < 0.01) return box;

  const constrainedBox = { ...box, width };
  return type === "text-list"
    ? textVisualLocalBox(element, constrainedBox, {
        runs: rawTextListRenderTextRuns(element),
      })
    : textVisualLocalBox(element, constrainedBox);
}

export const MemoizedRawComponentNode = memo(
  RawComponentNode,
  (previous, next) => {
    if (
      previous.component !== next.component ||
      previous.componentIndex !== next.componentIndex ||
      previous.isEditMode !== next.isEditMode ||
      previous.isMultiSelectedComponent !== next.isMultiSelectedComponent ||
      previous.setNodeRef !== next.setNodeRef ||
      previous.onSelect !== next.onSelect ||
      previous.onTableCellSelect !== next.onTableCellSelect ||
      previous.onTableCellEdit !== next.onTableCellEdit ||
      previous.onOpenElementEditor !== next.onOpenElementEditor ||
      previous.onComponentChange !== next.onComponentChange ||
      previous.onComponentDragStart !== next.onComponentDragStart ||
      previous.onComponentDragMove !== next.onComponentDragMove ||
      previous.onComponentDragEnd !== next.onComponentDragEnd ||
      previous.onElementChange !== next.onElementChange ||
      previous.selectedTableCell !== next.selectedTableCell ||
      previous.fontRevision !== next.fontRevision
    ) {
      return false;
    }
    return !(
      previous.editingKey !== next.editingKey &&
      (selectionTouchesComponent(
        previous.editingKey,
        previous.componentIndex,
      ) ||
        selectionTouchesComponent(next.editingKey, next.componentIndex))
    );
  },
);

function RawElementNode({
  element,
  componentIndex,
  elementPath,
  isEditMode,
  editingKey,
  selectedTableCell,
  setNodeRef,
  onSelect,
  onTableCellSelect,
  onTableCellEdit,
  onOpenEditor,
  onElementChange,
  parentBox,
  textConstraintBox,
  renderBox,
  layoutManaged = false,
  fontRevision,
}: {
  element: RawElement;
  componentIndex: number;
  elementPath: number[];
  isEditMode: boolean;
  editingKey: string | null;
  selectedTableCell: TableCellSelection | null;
  setNodeRef: (key: string, node: Konva.Node | null) => void;
  onSelect: (selection: Selection, options?: SelectOptions) => void;
  onTableCellSelect: (
    selection: ElementSelection,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onTableCellEdit: (
    selection: ElementSelection,
    rowIndex: number,
    colIndex: number,
  ) => void;
  onOpenEditor: (selection: ElementSelection) => void;
  onElementChange: (
    selection: ElementSelection,
    updater: (element: RawElement) => RawElement,
  ) => void;
  parentBox: Box;
  textConstraintBox?: Box | null;
  renderBox?: Box | null;
  layoutManaged?: boolean;
  fontRevision: number;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const box = renderBox ?? elementBox(element);
  const selection = useMemo<ElementSelection>(
    () => ({
      kind: "element",
      componentIndex,
      elementPath,
    }),
    [componentIndex, elementPath],
  );
  const key = keyForSelection(selection);
  const selectedCell =
    selectedTableCell?.elementPath === key ? selectedTableCell : null;
  const editing = editingKey === key;
  const childInfo = childArrayInfo(element);
  const children = childInfo?.items ?? [];
  const laidOutChildren = layoutChildren(element, children, box);
  const clipChildren = shouldClipElementChildren(element, childInfo);
  const shouldConstrainTextVisual =
    componentIndex !== ROOT_ELEMENTS_COMPONENT_INDEX || elementPath.length > 1;
  const visualBox = shouldConstrainTextVisual
    ? constrainedWrappedTextVisualBox(element, box, textConstraintBox ?? parentBox)
    : box;
  const childTextConstraintBox = childInfo
    ? textConstraintBox
      ? {
          ...textConstraintBox,
          x: textConstraintBox.x + box.x,
          y: textConstraintBox.y + box.y,
        }
      : {
          x: 0,
          y: 0,
          width: box.width,
          height: box.height,
        }
    : null;
  const centerOrigin = shouldUseCenterOrigin(element);
  const handleTableCellSelect = useCallback(
    (rowIndex: number, colIndex: number) => {
      onTableCellSelect(selection, rowIndex, colIndex);
    },
    [onTableCellSelect, selection],
  );
  const handleTableCellEdit = useCallback(
    (rowIndex: number, colIndex: number) => {
      onTableCellEdit(selection, rowIndex, colIndex);
    },
    [onTableCellEdit, selection],
  );

  return (
    <Group
      ref={(node) => {
        groupRef.current = node;
        setNodeRef(key, node);
      }}
      x={centerOrigin ? box.x + box.width / 2 : box.x}
      y={centerOrigin ? box.y + box.height / 2 : box.y}
      width={box.width}
      height={box.height}
      offsetX={centerOrigin ? box.width / 2 : 0}
      offsetY={centerOrigin ? box.height / 2 : 0}
      clipX={clipChildren ? 0 : undefined}
      clipY={clipChildren ? 0 : undefined}
      clipWidth={clipChildren ? box.width : undefined}
      clipHeight={clipChildren ? box.height : undefined}
      rotation={readNumber(element.rotation) ?? 0}
      opacity={readNumber(element.opacity) ?? 1}
      onMouseDown={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = false;
      }}
      onTouchStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = false;
      }}
      onClick={(event) => {
        if (!isEditMode) return;
        if (componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
          event.cancelBubble = true;
          onSelect(selection);
        }
      }}
      onTap={(event) => {
        if (!isEditMode) return;
        if (componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX) {
          event.cancelBubble = true;
          onSelect(selection);
        }
      }}
      onDblClick={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
        onOpenEditor(selection);
      }}
      onDblTap={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        onSelect(selection);
        onOpenEditor(selection);
      }}
      onTransformEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const nextSize = {
          width: Math.max(1, box.width * scaleX),
          height: Math.max(1, box.height * scaleY),
        };
        node.scaleX(1);
        node.scaleY(1);
        const fontScale = fontScaleFromResize(scaleX, scaleY);
        onElementChange(selection, (current) => ({
          ...scaleRawElementTextMetrics(current, fontScale),
          position: positionFromNodeInParent(
            node,
            parentBox,
            { ...box, ...nextSize },
          ),
          size: nextSize,
          rotation: node.rotation(),
          ...(layoutManaged || isManualPositioned(current)
            ? { __presenton_manual_position: true }
            : {}),
        }));
      }}
    >
      {isEditMode ? (
        <SelectionBoundsRect width={box.width} height={box.height} />
      ) : null}
      {editing ? null : (
        <MemoizedRawElementVisual
          element={element}
          width={visualBox.width}
          height={visualBox.height}
          interactive={isEditMode}
          selectedTableCell={selectedCell}
          onTableCellSelect={handleTableCellSelect}
          onTableCellEdit={handleTableCellEdit}
          fontRevision={fontRevision}
        />
      )}
      {laidOutChildren.map(({ child, index, box: childBox, layoutManaged }) => (
        <MemoizedRawElementNode
          key={rawElementKey(child, index)}
          element={child}
          componentIndex={componentIndex}
          elementPath={[...elementPath, index]}
          isEditMode={isEditMode}
          editingKey={editingKey}
          selectedTableCell={selectedTableCell}
          setNodeRef={setNodeRef}
          onSelect={onSelect}
          onTableCellSelect={onTableCellSelect}
          onTableCellEdit={onTableCellEdit}
          onOpenEditor={onOpenEditor}
          onElementChange={onElementChange}
          parentBox={{
            x: parentBox.x + box.x,
            y: parentBox.y + box.y,
            width: box.width,
            height: box.height,
          }}
          textConstraintBox={childTextConstraintBox}
          renderBox={childBox}
          layoutManaged={layoutManaged}
          fontRevision={fontRevision}
        />
      ))}
    </Group>
  );
}

export const MemoizedRawElementNode = memo(RawElementNode, (previous, next) => {
  if (
    previous.element !== next.element ||
    previous.componentIndex !== next.componentIndex ||
    previous.isEditMode !== next.isEditMode ||
    previous.layoutManaged !== next.layoutManaged ||
    previous.fontRevision !== next.fontRevision ||
    previous.selectedTableCell !== next.selectedTableCell ||
    previous.setNodeRef !== next.setNodeRef ||
    previous.onSelect !== next.onSelect ||
    previous.onTableCellSelect !== next.onTableCellSelect ||
    previous.onTableCellEdit !== next.onTableCellEdit ||
    previous.onOpenEditor !== next.onOpenEditor ||
    previous.onElementChange !== next.onElementChange ||
    !numberPathEqual(previous.elementPath, next.elementPath) ||
    !boxEqual(previous.parentBox, next.parentBox) ||
    !nullableBoxEqual(previous.textConstraintBox, next.textConstraintBox) ||
    !nullableBoxEqual(previous.renderBox, next.renderBox)
  ) {
    return false;
  }
  return !(
    previous.editingKey !== next.editingKey &&
    (selectionTouchesElement(
      previous.editingKey,
      previous.componentIndex,
      previous.elementPath,
    ) ||
      selectionTouchesElement(
        next.editingKey,
        next.componentIndex,
        next.elementPath,
      ))
  );
});

function SelectionBoundsRect({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <Rect
      width={width}
      height={height}
      fill="rgba(0,0,0,0)"
      listening={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
}

function RawElementVisual({
  element,
  width,
  height,
  interactive,
  selectedTableCell,
  onTableCellSelect,
  onTableCellEdit,
  fontRevision,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
  selectedTableCell: TableCellSelection | null;
  onTableCellSelect: (rowIndex: number, colIndex: number) => void;
  onTableCellEdit: (rowIndex: number, colIndex: number) => void;
  fontRevision: number;
}) {
  void fontRevision;
  const type = readString(element.type);
  if (isBoxVisualType(type)) {
    const fill = colorWithOpacity(
      fillColor(element.fill),
      fillOpacity(element.fill),
    );
    const stroke = colorWithOpacity(
      strokeColor(element.stroke),
      strokeOpacity(element.stroke),
    );
    if (!fill && !(stroke && strokeWidth(element.stroke) > 0)) return null;
    return (
      <Rect
        width={width}
        height={height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth(element.stroke)}
        cornerRadius={borderRadius(element)}
        {...shadowProps(element)}
        listening={interactive}
      />
    );
  }
  if (type === "ellipse") {
    return (
      <Ellipse
        x={width / 2}
        y={height / 2}
        radiusX={width / 2}
        radiusY={height / 2}
        fill={
          colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill)) ??
          "transparent"
        }
        stroke={colorWithOpacity(
          strokeColor(element.stroke),
          strokeOpacity(element.stroke),
        )}
        strokeWidth={strokeWidth(element.stroke)}
        {...shadowProps(element)}
        listening={interactive}
      />
    );
  }
  if (type === "line") {
    const stroke = colorWithOpacity(
      strokeColor(element.stroke),
      strokeOpacity(element.stroke),
    );
    const lineWidth = strokeWidth(element.stroke);
    const lineDash = readArray(asRecord(element.stroke)?.dash)
      .map(readNumber)
      .filter((value): value is number => value != null && value >= 0);
    if (!stroke || lineWidth <= 0) return null;
    return (
      <Line
        points={linePoints(width, height, lineWidth)}
        stroke={stroke}
        strokeWidth={lineWidth}
        dash={lineDash.length ? lineDash : undefined}
        hitStrokeWidth={Math.max(20, lineWidth)}
        {...shadowProps(element)}
        listening={interactive}
      />
    );
  }
  if (type === "text") {
    return (
      <RawRichTextElement
        element={element}
        width={width}
        height={height}
        interactive={interactive}
      />
    );
  }
  if (type === "text-list") {
    return (
      <RawRichTextElement
        element={element}
        width={width}
        height={height}
        runs={rawTextListRenderTextRuns(element)}
        interactive={interactive}
      />
    );
  }
  if (type === "image") {
    return <RawImageElement element={element} width={width} height={height} interactive={interactive} />;
  }
  if (type === "table") {
    return (
      <RawTableElement
        element={element}
        width={width}
        height={height}
        interactive={interactive}
        selectedCell={selectedTableCell}
        onCellSelect={onTableCellSelect}
        onCellEdit={onTableCellEdit}
      />
    );
  }
  if (type === "chart") {
    const legendState = Object.prototype.hasOwnProperty.call(element, "legend")
      ? String(element.legend)
      : String(element.showLegend ?? "auto");
    return (
      <RawChartElement
        key={`chart-legend-${legendState}`}
        element={element}
        width={width}
        height={height}
        interactive={interactive}
      />
    );
  }
  if (type === "infographic") {
    return <RawInfographicElement element={element} width={width} height={height} interactive={interactive} />;
  }
  return null;
}

const MemoizedRawElementVisual = memo(
  RawElementVisual,
  (previous, next) =>
    previous.element === next.element &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.interactive === next.interactive &&
    previous.selectedTableCell === next.selectedTableCell &&
    previous.onTableCellSelect === next.onTableCellSelect &&
    previous.onTableCellEdit === next.onTableCellEdit &&
    previous.fontRevision === next.fontRevision,
);

function RawRichTextElement({
  element,
  width,
  height,
  text,
  runs: runsOverride,
  interactive,
}: {
  element: RawElement;
  width: number;
  height: number;
  text?: string;
  runs?: RenderTextRun[];
  interactive: boolean;
}) {
  const font = rawFont(element);
  const renderRuns =
    runsOverride ?? (text == null ? rawRenderTextRuns(element) : []);
  const content =
    text ??
    (runsOverride ? textRunsContent(runsOverride) : rawTextContent(element));
  const displayContent = displayText(content);
  const align = readString(element.alignment?.horizontal) ?? "left";
  const verticalAlign = readString(element.alignment?.vertical) ?? "top";
  const textLineHeight = effectiveLineHeight({
    text: displayContent,
    width,
    fontSize: font.size,
    lineHeight: font.lineHeight,
    fallback: 1.15,
    wrap: "word",
  });

  const layoutRuns =
    renderRuns.length > 0 ? renderRuns : [{ text: displayContent, font }];
  const lines = layoutRenderTextRuns(layoutRuns, width, "word");
  const lineMetrics = lines.map((line) => ({
    height: lineRenderHeight(line, textLineHeight),
    width: line.reduce((sum, segment) => sum + segment.width, 0),
  }));
  const totalHeight = lineMetrics.reduce(
    (sum, metric) => sum + metric.height,
    0,
  );
  const startY =
    verticalAlign === "middle"
      ? Math.max(0, (height - totalHeight) / 2)
      : verticalAlign === "bottom"
        ? Math.max(0, height - totalHeight)
        : 0;
  let y = startY;

  return (
    <Group listening={interactive}>
      {lines.map((line, lineIndex) => {
        const lineMetric = lineMetrics[lineIndex] ?? {
          height: font.size * textLineHeight,
          width: 0,
        };
        const startX = lineStartX(align, width, lineMetric.width, false);
        let x = startX;
        const lineY = y;
        y += lineMetric.height;
        return line.map((segment, segmentIndex) => {
          const segmentX = x;
          x += segment.width;
          // Keep width automatic. The custom layout owns the x advance; a fixed
          // tight width lets Konva re-wrap and clip the final glyph.
          return (
            <Text
              key={`${lineIndex}:${segmentIndex}`}
              x={segmentX}
              y={lineY}
              height={lineMetric.height}
              text={segment.text}
              fill={textFill(segment.font)}
              fontFamily={`${segment.font.family}, Helvetica, sans-serif`}
              fontSize={segment.font.size}
              fontStyle={`${segment.font.bold ? "bold" : "normal"} ${segment.font.italic ? "italic" : ""}`}
              textDecoration={segment.font.underline ? "underline" : ""}
              verticalAlign="middle"
              lineHeight={segment.font.lineHeight ?? textLineHeight}
              letterSpacing={segment.font.letterSpacing}
              wrap="none"
              {...shadowProps(element)}
              listening={interactive}
            />
          );
        });
      })}
    </Group>
  );
}

function textFill(font: { color: string; opacity?: number | null }) {
  return colorWithOpacity(withHash(font.color), font.opacity ?? 1);
}

function RawImageElement({
  element,
  width,
  height,
  interactive,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const src = readString(element.data);
  const color = readString(element.color);
  const isIcon = isRawIconElement(element);
  const renderSrc = useMemo(() => {
    if (!src || !color || !isIcon || typeof window === "undefined") return src;
    const baseUrl = window.location.href;
    if (!isStaticSvgIconSource(src, baseUrl)) return src;
    return buildSvgUpdateUrl(src, baseUrl, { color }) ?? src;
  }, [color, isIcon, src]);
  const loaded = useLoadedKonvaImage(renderSrc);

  if (!loaded) {
    return (
      <Rect
        width={width}
        height={height}
        fill="#EEF1F5"
        stroke="#CBD2D9"
        strokeWidth={1}
        listening={interactive}
      />
    );
  }

  const fit = readString(element.fit) ?? "contain";
  const focusX = clamp(readNumber(element.focus_x) ?? 50, 0, 100) / 100;
  const focusY = clamp(readNumber(element.focus_y) ?? 50, 0, 100) / 100;
  const cropScale = clamp(readNumber(element.crop_scale) ?? 1, 1, 6);
  const flipH = readBoolean(element.flip_h) === true;
  const flipV = readBoolean(element.flip_v) === true;
  const clipPath = imageClipPath(element);
  const cornerRadii = imageCornerRadii(element, width, height);
  const naturalRatio = loaded.width / loaded.height || 1;
  const boxRatio = width / height || 1;
  let drawW = width;
  let drawH = height;
  let offsetX = 0;
  let offsetY = 0;
  let crop:
    | {
      x: number;
      y: number;
      width: number;
      height: number;
    }
    | undefined;

  if (fit === "cover") {
    if (naturalRatio > boxRatio) {
      const baseCropWidth = loaded.height * boxRatio;
      const cropWidth = Math.min(loaded.width, baseCropWidth / cropScale);
      const cropHeight = Math.min(loaded.height, loaded.height / cropScale);
      crop = {
        x: Math.max(0, (loaded.width - cropWidth) * focusX),
        y: Math.max(0, (loaded.height - cropHeight) * focusY),
        width: cropWidth,
        height: cropHeight,
      };
    } else {
      const baseCropHeight = loaded.width / boxRatio;
      const cropWidth = Math.min(loaded.width, loaded.width / cropScale);
      const cropHeight = Math.min(loaded.height, baseCropHeight / cropScale);
      crop = {
        x: Math.max(0, (loaded.width - cropWidth) * focusX),
        y: Math.max(0, (loaded.height - cropHeight) * focusY),
        width: cropWidth,
        height: cropHeight,
      };
    }
  } else if (fit === "contain") {
    if (naturalRatio > boxRatio) {
      drawH = width / naturalRatio;
      offsetY = (height - drawH) * focusY;
    } else {
      drawW = height * naturalRatio;
      offsetX = (width - drawW) * focusX;
    }
  }

  const imageNode = (
    <KonvaImage
      image={loaded}
      x={offsetX + (flipH ? drawW : 0)}
      y={offsetY + (flipV ? drawH : 0)}
      width={drawW}
      height={drawH}
      crop={crop}
      scaleX={flipH ? -1 : 1}
      scaleY={flipV ? -1 : 1}
      listening={interactive}
    />
  );

  const clippedImageNode = clipPath ? (
    <Group
      clipFunc={(context) =>
        drawImageClipPath(context, clipPath, width, height)
      }
      listening={interactive}
    >
      {imageNode}
    </Group>
  ) : (
    imageNode
  );

  return (
    <Group
      clipFunc={(context) =>
        drawRoundedImageClip(context, width, height, cornerRadii)
      }
      listening={interactive}
    >
      {clippedImageNode}
    </Group>
  );
}

type ParsedImageClipPath =
  | { kind: "polygon"; points: Point[] }
  | { kind: "path"; data: string }
  | {
    kind: "inset";
    top: number;
    right: number;
    bottom: number;
    left: number;
    radius: number;
  }
  | { kind: "rect"; x: number; y: number; width: number; height: number; radius: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "ellipse"; x: number; y: number; radiusX: number; radiusY: number };

function imageClipPath(element: RawElement): string | null {
  const raw = readString(element.clippath ?? element.clipPath ?? element.clip_path);
  const clipPath = raw?.trim();
  return clipPath && clipPath.toLowerCase() !== "none" ? clipPath : null;
}

function drawImageClipPath(
  context: Konva.Context,
  clipPath: string,
  width: number,
  height: number,
) {
  const parsed = parseImageClipPath(clipPath, width, height);
  if (!parsed) {
    context.rect(0, 0, width, height);
    return;
  }

  if (parsed.kind === "path") {
    if (typeof Path2D !== "undefined") {
      try {
        return [new Path2D(parsed.data)] as [Path2D];
      } catch {
        // Fall through to the basic path drawer below.
      }
    }
    if (drawBasicSvgClipPath(context, parsed.data)) return;
    context.rect(0, 0, width, height);
    return;
  }

  if (parsed.kind === "polygon") {
    parsed.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    return;
  }

  if (parsed.kind === "inset") {
    const x = parsed.left;
    const y = parsed.top;
    const insetWidth = Math.max(0, width - parsed.left - parsed.right);
    const insetHeight = Math.max(0, height - parsed.top - parsed.bottom);
    const radius = Math.min(parsed.radius, insetWidth / 2, insetHeight / 2);
    if (radius > 0) {
      context.roundRect(x, y, insetWidth, insetHeight, radius);
    } else {
      context.rect(x, y, insetWidth, insetHeight);
    }
    return;
  }

  if (parsed.kind === "rect") {
    const radius = Math.min(parsed.radius, parsed.width / 2, parsed.height / 2);
    if (radius > 0) {
      context.roundRect(parsed.x, parsed.y, parsed.width, parsed.height, radius);
    } else {
      context.rect(parsed.x, parsed.y, parsed.width, parsed.height);
    }
    return;
  }

  if (parsed.kind === "circle") {
    context.arc(parsed.x, parsed.y, parsed.radius, 0, Math.PI * 2);
    return;
  }

  context.ellipse(
    parsed.x,
    parsed.y,
    parsed.radiusX,
    parsed.radiusY,
    0,
    0,
    Math.PI * 2,
  );
}

function parseImageClipPath(
  value: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const pathData = clipPathDataFromValue(value);
  if (pathData) return { kind: "path", data: pathData };

  const clipFunction = readCssClipFunction(value);
  if (!clipFunction) return null;

  const { kind, body } = clipFunction;
  if (kind === "polygon") return parsePolygonClipPath(body, width, height);
  if (kind === "inset") return parseInsetClipPath(body, width, height);
  if (kind === "rect") return parseRectClipPath(body, width, height);
  if (kind === "xywh") return parseXywhClipPath(body, width, height);
  if (kind === "circle") return parseCircleClipPath(body, width, height);
  if (kind === "ellipse") return parseEllipseClipPath(body, width, height);
  return null;
}

function parsePolygonClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const pointSource = body.replace(/^(evenodd|nonzero)\s*,\s*/i, "");
  const rawPoints = pointSource.split(/\s*,\s*/).filter(Boolean);
  const points =
    rawPoints.length >= 3
      ? rawPoints.map((point) => parseClipPoint(point, width, height))
      : parseClipPointPairs(splitCssTokens(pointSource), width, height);

  if (points.length < 3 || points.some((point) => point == null)) return null;
  return {
    kind: "polygon",
    points: points as Point[],
  };
}

function parseInsetClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [insetPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(insetPart);
  if (values.length === 0) return null;

  const top = parseClipLength(values[0], height);
  const right = parseClipLength(values[1] ?? values[0], width);
  const bottom = parseClipLength(values[2] ?? values[0], height);
  const left = parseClipLength(values[3] ?? values[1] ?? values[0], width);
  if (top == null || right == null || bottom == null || left == null) {
    return null;
  }

  const radius = parseClipBoxRadius(radiusPart, width, height);
  return {
    kind: "inset",
    top,
    right,
    bottom,
    left,
    radius,
  };
}

function parseRectClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [rectPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(rectPart);
  if (values.length < 4) return null;

  const top = parseClipLength(values[0], height);
  const right = parseClipLength(values[1], width);
  const bottom = parseClipLength(values[2], height);
  const left = parseClipLength(values[3], width);
  if (top == null || right == null || bottom == null || left == null) {
    return null;
  }

  return {
    kind: "rect",
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    radius: parseClipBoxRadius(radiusPart, width, height),
  };
}

function parseXywhClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [boxPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(boxPart);
  if (values.length < 4) return null;

  const x = parseClipLength(values[0], width);
  const y = parseClipLength(values[1], height);
  const rectWidth = parseClipLength(values[2], width);
  const rectHeight = parseClipLength(values[3], height);
  if (x == null || y == null || rectWidth == null || rectHeight == null) {
    return null;
  }

  return {
    kind: "rect",
    x,
    y,
    width: Math.max(0, rectWidth),
    height: Math.max(0, rectHeight),
    radius: parseClipBoxRadius(radiusPart, width, height),
  };
}

function parseCircleClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [radiusPart, positionPart] = splitCssAt(body);
  const radiusToken = splitCssTokens(radiusPart)[0];
  const center = parseClipPosition(positionPart, width, height);
  if (!center) return null;
  const radius = radiusToken
    ? parseCircleRadius(radiusToken, center, width, height)
    : Math.min(center.x, width - center.x, center.y, height - center.y);
  if (radius == null || !center) return null;
  return {
    kind: "circle",
    x: center.x,
    y: center.y,
    radius,
  };
}

function parseEllipseClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [radiusPart, positionPart] = splitCssAt(body);
  const radiusTokens = splitCssTokens(radiusPart);
  const center = parseClipPosition(positionPart, width, height);
  if (!center) return null;
  const radiusX = radiusTokens[0]
    ? parseEllipseRadius(radiusTokens[0], center.x, width)
    : Math.min(center.x, width - center.x);
  const radiusY = radiusTokens[1]
    ? parseEllipseRadius(radiusTokens[1], center.y, height)
    : radiusTokens[0]
      ? parseEllipseRadius(radiusTokens[0], center.y, height)
      : Math.min(center.y, height - center.y);
  if (radiusX == null || radiusY == null || !center) return null;
  return {
    kind: "ellipse",
    x: center.x,
    y: center.y,
    radiusX,
    radiusY,
  };
}

function parseClipBoxRadius(
  value: string | null,
  width: number,
  height: number,
) {
  const radiusToken = value ? splitCssTokens(value)[0] : null;
  return radiusToken
    ? parseClipLength(radiusToken, Math.min(width, height)) ?? 0
    : 0;
}

function parseCircleRadius(
  token: string,
  center: Point,
  width: number,
  height: number,
) {
  const normalized = token.toLowerCase();
  if (normalized === "closest-side") {
    return Math.min(center.x, width - center.x, center.y, height - center.y);
  }
  if (normalized === "farthest-side") {
    return Math.max(center.x, width - center.x, center.y, height - center.y);
  }
  return parseClipLength(token, Math.min(width, height));
}

function parseEllipseRadius(token: string, center: number, size: number) {
  const normalized = token.toLowerCase();
  if (normalized === "closest-side") return Math.min(center, size - center);
  if (normalized === "farthest-side") return Math.max(center, size - center);
  return parseClipLength(token, size);
}

function drawBasicSvgClipPath(context: Konva.Context, data: string) {
  const tokens =
    data.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ??
    [];
  let index = 0;
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let lastCubicControl: Point | null = null;
  let lastQuadraticControl: Point | null = null;

  const isCommand = (token: string | undefined) =>
    Boolean(token && /^[A-Za-z]$/.test(token));
  const readPathNumber = () => {
    const token = tokens[index];
    if (token == null || isCommand(token)) return null;
    index += 1;
    const value = Number.parseFloat(token);
    return Number.isFinite(value) ? value : null;
  };
  const readPoint = (relative: boolean): Point | null => {
    const x = readPathNumber();
    const y = readPathNumber();
    if (x == null || y == null) return null;
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const reflectPoint = (point: Point | null) =>
    point ? { x: current.x * 2 - point.x, y: current.y * 2 - point.y } : current;

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index] ?? "";
      index += 1;
    } else if (!command) {
      return false;
    }

    const relative = command === command.toLowerCase();
    switch (command.toLowerCase()) {
      case "m": {
        const point = readPoint(relative);
        if (!point) return false;
        context.moveTo(point.x, point.y);
        current = point;
        subpathStart = point;
        command = relative ? "l" : "L";
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "l": {
        const point = readPoint(relative);
        if (!point) return false;
        context.lineTo(point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "h": {
        const value = readPathNumber();
        if (value == null) return false;
        current = { x: relative ? current.x + value : value, y: current.y };
        context.lineTo(current.x, current.y);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "v": {
        const value = readPathNumber();
        if (value == null) return false;
        current = { x: current.x, y: relative ? current.y + value : value };
        context.lineTo(current.x, current.y);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "c": {
        const control1 = readPoint(relative);
        const control2 = readPoint(relative);
        const point = readPoint(relative);
        if (!control1 || !control2 || !point) return false;
        context.bezierCurveTo(
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          point.x,
          point.y,
        );
        current = point;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        break;
      }
      case "s": {
        const control1 = reflectPoint(lastCubicControl);
        const control2 = readPoint(relative);
        const point = readPoint(relative);
        if (!control2 || !point) return false;
        context.bezierCurveTo(
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          point.x,
          point.y,
        );
        current = point;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        break;
      }
      case "q": {
        const control = readPoint(relative);
        const point = readPoint(relative);
        if (!control || !point) return false;
        context.quadraticCurveTo(control.x, control.y, point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = control;
        break;
      }
      case "t": {
        const control = reflectPoint(lastQuadraticControl);
        const point = readPoint(relative);
        if (!point) return false;
        context.quadraticCurveTo(control.x, control.y, point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = control;
        break;
      }
      case "z": {
        context.closePath();
        current = subpathStart;
        command = "";
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      default:
        return false;
    }
  }

  return true;
}

function parseClipPoint(
  value: string,
  width: number,
  height: number,
): Point | null {
  const [rawX, rawY] = splitCssTokens(value);
  const x = parseClipLength(rawX, width);
  const y = parseClipLength(rawY, height);
  return x == null || y == null ? null : { x, y };
}

function parseClipPointPairs(
  tokens: string[],
  width: number,
  height: number,
) {
  const points: Array<Point | null> = [];
  for (let index = 0; index < tokens.length; index += 2) {
    points.push(parseClipPoint(`${tokens[index]} ${tokens[index + 1]}`, width, height));
  }
  return points;
}

function parseClipPosition(
  value: string | null,
  width: number,
  height: number,
): Point | null {
  const tokens = splitCssTokens(value ?? "");
  if (tokens.length === 0) return { x: width / 2, y: height / 2 };
  if (tokens.length === 1) {
    const token = tokens[0].toLowerCase();
    if (token === "center") return { x: width / 2, y: height / 2 };
    if (token === "left" || token === "right") {
      return {
        x: parseClipPositionLength(token, width, "left", "right") ?? width / 2,
        y: height / 2,
      };
    }
    if (token === "top" || token === "bottom") {
      return {
        x: width / 2,
        y: parseClipPositionLength(token, height, "top", "bottom") ?? height / 2,
      };
    }
    const x = parseClipLength(token, width);
    return x == null ? null : { x, y: height / 2 };
  }

  const x = parseClipPositionLength(tokens[0], width, "left", "right");
  const y = parseClipPositionLength(tokens[1], height, "top", "bottom");
  return x == null || y == null ? null : { x, y };
}

function parseClipPositionLength(
  token: string | undefined,
  reference: number,
  startKeyword: string,
  endKeyword: string,
) {
  if (!token) return null;
  const normalized = token.toLowerCase();
  if (normalized === "center") return reference / 2;
  if (normalized === startKeyword) return 0;
  if (normalized === endKeyword) return reference;
  return parseClipLength(normalized, reference);
}

function parseClipLength(token: string | undefined, reference: number) {
  if (!token) return null;
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith("%")) {
    const value = Number.parseFloat(normalized.slice(0, -1));
    return Number.isFinite(value) ? (value / 100) * reference : null;
  }
  if (normalized.endsWith("px")) {
    const value = Number.parseFloat(normalized.slice(0, -2));
    return Number.isFinite(value) ? value : null;
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function splitCssAt(value: string): [string, string | null] {
  const parts = value.split(/\s+at\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? null];
}

function splitCssRound(value: string): [string, string | null] {
  const parts = value.split(/\s+round\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? null];
}

function splitCssTokens(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function readCssClipFunction(value: string) {
  const match = /([a-z-]+)\(/i.exec(value);
  if (!match || match.index == null) return null;

  const kind = match[1].toLowerCase();
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let quote: string | null = null;

  for (let index = bodyStart; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && index + 1 < value.length) {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          kind,
          body: value.slice(bodyStart, index).trim(),
        };
      }
    }
  }

  return null;
}

function clipPathDataFromValue(value: string) {
  const clipFunction = readCssClipFunction(value);
  if (clipFunction?.kind === "path") {
    const data = extractCssPathData(clipFunction.body);
    return data && isSafeSvgClipPathData(data) ? data : null;
  }

  const data = extractCssPathData(value);
  return data && isSafeSvgClipPathData(data) ? data : null;
}

function extractCssPathData(value: string) {
  const body = value.trim().replace(/^(evenodd|nonzero)\s*,\s*/i, "");
  const quoted = /^(['"])([\s\S]*)\1$/.exec(body);
  return quoted ? quoted[2].trim() : body;
}

function isSafeSvgClipPathData(value: string) {
  return (
    /[A-Za-z]/.test(value) &&
    /^[AaCcHhLlMmQqSsTtVvZz0-9eE\s.,+\-]*$/.test(value)
  );
}

function useLoadedKonvaImage(src: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setLoaded(null);
      return;
    }

    let cancelled = false;
    void loadKonvaImage(src).then((image) => {
      if (!cancelled) setLoaded(image);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return loaded;
}

function imageCornerRadii(
  element: RawElement,
  width: number,
  height: number,
): [number, number, number, number] {
  const rawRadius = borderRadius(element);
  const values = Array.isArray(rawRadius)
    ? rawRadius
    : [rawRadius, rawRadius, rawRadius, rawRadius];
  const maxRadius = Math.max(0, Math.min(width, height) / 2);
  return [
    clamp(values[0] ?? 0, 0, maxRadius),
    clamp(values[1] ?? 0, 0, maxRadius),
    clamp(values[2] ?? 0, 0, maxRadius),
    clamp(values[3] ?? 0, 0, maxRadius),
  ];
}

function drawRoundedImageClip(
  context: Konva.Context,
  width: number,
  height: number,
  [topLeft, topRight, bottomRight, bottomLeft]: [
    number,
    number,
    number,
    number,
  ],
) {
  context.beginPath();
  context.moveTo(topLeft, 0);
  context.lineTo(width - topRight, 0);
  context.quadraticCurveTo(width, 0, width, topRight);
  context.lineTo(width, height - bottomRight);
  context.quadraticCurveTo(width, height, width - bottomRight, height);
  context.lineTo(bottomLeft, height);
  context.quadraticCurveTo(0, height, 0, height - bottomLeft);
  context.lineTo(0, topLeft);
  context.quadraticCurveTo(0, 0, topLeft, 0);
  context.closePath();
}



function RawInfographicElement({
  element,
  width,
  height,
  interactive,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const infographicType =
    readString(element.infographic_type) ??
    readString(element.infographicType) ??
    "gauge";
  const progress = valueProgress(element);
  const baseColor =
    withHash(readString(element.base_color) ?? readString(element.baseColor)) ??
    "#E5E7EB";
  const highlightColor =
    withHash(
      readString(element.highlight_color) ?? readString(element.highlightColor),
    ) ?? "#2563EB";

  if (infographicType === "progress_bar") {
    const radius = Math.min(height / 2, 8);
    return (
      <Group listening={interactive} {...shadowProps(element)}>
        <Rect width={width} height={height} cornerRadius={radius} fill={baseColor} />
        <Rect
          width={width * progress}
          height={height}
          cornerRadius={radius}
          fill={highlightColor}
        />
      </Group>
    );
  }

  const valueAngle = 180 * progress;
  const thickness = Math.max(6, Math.min(width, height) * 0.18);
  const outerRadius = Math.max(1, Math.min(width * 0.43, height * 0.86));
  const innerRadius = Math.max(1, outerRadius - thickness);
  const middleRadius = (outerRadius + innerRadius) / 2;
  const capRadius = thickness / 2;
  const centerX = width / 2;
  const centerY = Math.min(height - capRadius, height * 0.86);
  const start = pointOnCircle(centerX, centerY, middleRadius, 180);
  const end = pointOnCircle(centerX, centerY, middleRadius, 180 + valueAngle);
  return (
    <Group listening={interactive} {...shadowProps(element)}>
      <Arc
        x={centerX}
        y={centerY}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        angle={180}
        rotation={180}
        fill={baseColor}
      />
      <Circle x={start.x} y={start.y} radius={capRadius} fill={baseColor} />
      <Circle
        x={pointOnCircle(centerX, centerY, middleRadius, 360).x}
        y={pointOnCircle(centerX, centerY, middleRadius, 360).y}
        radius={capRadius}
        fill={baseColor}
      />
      {valueAngle > 0 ? (
        <>
          <Arc
            x={centerX}
            y={centerY}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            angle={valueAngle}
            rotation={180}
            fill={highlightColor}
          />
          <Circle x={start.x} y={start.y} radius={capRadius} fill={highlightColor} />
          <Circle x={end.x} y={end.y} radius={capRadius} fill={highlightColor} />
        </>
      ) : null}
      <Text
        x={0}
        y={height * 0.5}
        width={width}
        height={height * 0.3}
        text={String(Math.round(readNumber(element.value) ?? 0))}
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={Math.max(10, Math.min(width, height) * 0.22)}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        fill="#172033"
      />
    </Group>
  );
}
