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
  Path,
  Rect,
  Text,
} from "react-konva";
import {
  readPathData,
  readPathFillRule,
  readPathViewBox,
} from "@/components/slide-editor/model/path-element";
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
import {
  componentFromNodeTransform,
  componentTransformAnchorForNode,
  HORIZONTAL_RESIZE_ANCHORS,
  VERTICAL_RESIZE_ANCHORS,
} from "@/components/slide-editor/surface/component-transform-math";
import { drawImageClipPath, imageClipPath } from "@/components/slide-editor/surface/css-clip-path";
import { TemplateV2ChartJsElement as RawChartElement } from "@/components/slide-editor/charts/TemplateV2ChartJsElement";
import { TemplateV2FormulaElement as RawFormulaElement } from "@/components/slide-editor/formula/TemplateV2FormulaElement";
import { TemplateV2MediaElement as RawMediaElement } from "@/components/slide-editor/media/TemplateV2MediaElement";
import {
  TemplateV2TableElement as RawTableElement,
  type TableSelectModifiers,
} from "@/components/slide-editor/tables/TemplateV2TableElement";
import { transformSvgMarkup } from "@/lib/svg-color";
import { ShapeFillRect } from "@/components/slide-editor/surface/shape-fill";
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
  resizeRootElement,
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
  strokeDash,
  strokeOpacity,
  strokeWidth,
  unclampedPositionFromNodeInParent,
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

export function RawComponentNode({
  component,
  componentIndex,
  isBackground = false,
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
  isBackground?: boolean;
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
    modifiers?: TableSelectModifiers,
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
      listening={!isBackground}
      draggable={isEditMode && !isBackground}
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
      previous.isBackground !== next.isBackground ||
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
  onSnapDragStart,
  onSnapDragMove,
  onSnapDragEnd,
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
    modifiers?: TableSelectModifiers,
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
  /** Snap-guide overlay callbacks for root-level element drag. Only passed
   *  for root elements; components handle their own overlay. */
  onSnapDragStart?: (selection: ElementSelection, node: Konva.Node) => void;
  onSnapDragMove?: (selection: ElementSelection, node: Konva.Node) => void;
  onSnapDragEnd?: (selection: ElementSelection, node: Konva.Node) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const isRootElement = componentIndex === ROOT_ELEMENTS_COMPONENT_INDEX;
  const transformPreviewRef = useRef<RawElement | null>(null);
  const [transformPreview, setTransformPreview] =
    useState<RawElement | null>(null);
  const renderedElement = isRootElement ? transformPreview ?? element : element;
  const box = renderBox ?? elementBox(renderedElement);
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
  const childInfo = childArrayInfo(renderedElement);
  const children = childInfo?.items ?? [];
  const laidOutChildren = layoutChildren(renderedElement, children, box);
  const clipChildren = shouldClipElementChildren(renderedElement, childInfo);
  const shouldConstrainTextVisual =
    componentIndex !== ROOT_ELEMENTS_COMPONENT_INDEX || elementPath.length > 1;
  const visualBox = shouldConstrainTextVisual
    ? constrainedWrappedTextVisualBox(
        renderedElement,
        box,
        textConstraintBox ?? parentBox,
      )
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
  const centerOrigin = shouldUseCenterOrigin(renderedElement);
  const handleTableCellSelect = useCallback(
    (rowIndex: number, colIndex: number, modifiers?: TableSelectModifiers) => {
      onTableCellSelect(selection, rowIndex, colIndex, modifiers);
    },
    [onTableCellSelect, selection],
  );
  const handleTableCellEdit = useCallback(
    (rowIndex: number, colIndex: number) => {
      onTableCellEdit(selection, rowIndex, colIndex);
    },
    [onTableCellEdit, selection],
  );
  const handleTableResize = useCallback(
    (columnWidths: number[] | null, rowHeights: number[] | null) => {
      onElementChange(selection, (current) => ({
        ...current,
        ...(columnWidths ? { column_widths: columnWidths } : {}),
        ...(rowHeights ? { row_heights: rowHeights } : {}),
      }));
    },
    [onElementChange, selection],
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
      rotation={readNumber(renderedElement.rotation) ?? 0}
      opacity={readNumber(renderedElement.opacity) ?? 1}
      draggable={isEditMode && isRootElement}
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
      onDragStart={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onSelect(selection);
        onSnapDragStart?.(selection, node);
      }}
      onDragMove={(event) => {
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onSnapDragMove?.(selection, node);
      }}
      onDragEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        onSnapDragEnd?.(selection, node);
        onElementChange(selection, (current) => ({
          ...current,
          position: isRootElement
            ? unclampedPositionFromNodeInParent(node, parentBox, box)
            : positionFromNodeInParent(node, parentBox, box),
          ...(layoutManaged || isManualPositioned(current)
            ? { __presenton_manual_position: true }
            : {}),
        }));
      }}
      onTransformStart={() => {
        if (!isRootElement) return;
        transformPreviewRef.current = null;
        setTransformPreview(null);
      }}
      onTransform={(event) => {
        if (!isEditMode || !isRootElement) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        const anchor = componentTransformAnchorForNode(node);
        if (anchor === "rotater") return;
        const source = transformPreviewRef.current ?? element;
        const sourceBox = elementBox(source);
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        if (
          Math.abs(scaleX - 1) < 0.001 &&
          Math.abs(scaleY - 1) < 0.001
        ) {
          return;
        }
        const horizontalOnly = anchor
          ? HORIZONTAL_RESIZE_ANCHORS.has(anchor)
          : false;
        const verticalOnly = anchor
          ? VERTICAL_RESIZE_ANCHORS.has(anchor)
          : false;
        const nextScaleX = verticalOnly ? 1 : scaleX;
        const nextScaleY = horizontalOnly ? 1 : scaleY;
        const nextSize = {
          width: Math.max(1, sourceBox.width * nextScaleX),
          height: Math.max(1, sourceBox.height * nextScaleY),
        };
        node.scaleX(1);
        node.scaleY(1);
        const position = unclampedPositionFromNodeInParent(node, parentBox, {
          ...sourceBox,
          ...nextSize,
        });
        const next = resizeRootElement(
          source,
          {
            ...position,
            ...nextSize,
            scaleX: nextScaleX,
            scaleY: nextScaleY,
            rotation: node.rotation(),
          },
          horizontalOnly || verticalOnly ? "resize-bounds" : "scale-content",
        );
        transformPreviewRef.current = next;
        setTransformPreview(next);
      }}
      onTransformEnd={(event) => {
        if (!isEditMode) return;
        event.cancelBubble = true;
        const node = groupRef.current;
        if (!node) return;
        if (isRootElement && transformPreviewRef.current) {
          const next = transformPreviewRef.current;
          transformPreviewRef.current = null;
          setTransformPreview(null);
          onElementChange(selection, () => next);
          return;
        }
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
          position: isRootElement
            ? unclampedPositionFromNodeInParent(
                node,
                parentBox,
                { ...box, ...nextSize },
              )
            : positionFromNodeInParent(
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
          element={renderedElement}
          width={visualBox.width}
          height={visualBox.height}
          interactive={isEditMode}
          selectedTableCell={selectedCell}
          onTableCellSelect={handleTableCellSelect}
          onTableCellEdit={handleTableCellEdit}
          onTableResize={handleTableResize}
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
    previous.onSnapDragStart !== next.onSnapDragStart ||
    previous.onSnapDragMove !== next.onSnapDragMove ||
    previous.onSnapDragEnd !== next.onSnapDragEnd ||
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
  onTableResize,
  fontRevision,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
  selectedTableCell: TableCellSelection | null;
  onTableCellSelect: (rowIndex: number, colIndex: number) => void;
  onTableCellEdit: (rowIndex: number, colIndex: number) => void;
  onTableResize: (columnWidths: number[] | null, rowHeights: number[] | null) => void;
  fontRevision: number;
}) {
  void fontRevision;
  const type = readString(element.type);
  if (isBoxVisualType(type)) {
    const fillType = asRecord(element.fill)?.type;
    // Only rectangles ever carry a non-solid ShapeFill (the Template Engine
    // slot panel is the only author of one) — container/flex/grid/card share
    // this render branch but always stay on the plain solid path.
    if (type === "rectangle" && typeof fillType === "string" && fillType !== "solid") {
      const stroke = colorWithOpacity(
        strokeColor(element.stroke),
        strokeOpacity(element.stroke),
      );
      return (
        <ShapeFillRect
          fill={element.fill as never}
          width={width}
          height={height}
          stroke={stroke}
          strokeWidth={strokeWidth(element.stroke)}
          dash={strokeDash(element.stroke)}
          cornerRadius={borderRadius(element)}
          shadowProps={shadowProps(element)}
          listening={interactive}
        />
      );
    }
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
        dash={strokeDash(element.stroke)}
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
        dash={strokeDash(element.stroke)}
        {...shadowProps(element)}
        listening={interactive}
      />
    );
  }
  if (type === "path") {
    const data = readPathData(element);
    if (!data) return null;
    const fill = colorWithOpacity(fillColor(element.fill), fillOpacity(element.fill));
    const stroke = colorWithOpacity(
      strokeColor(element.stroke),
      strokeOpacity(element.stroke),
    );
    const lineWidth = strokeWidth(element.stroke);
    if (!fill && !(stroke && lineWidth > 0)) return null;
    const view = readPathViewBox(element, width, height);
    // Mirroring is how a .pptx points a connector the other way, so it has to
    // reach the geometry — same trick the image node uses: negate the scale
    // and shift the origin to the far edge.
    const mirrorH = readBoolean(element.flip_h) === true;
    const mirrorV = readBoolean(element.flip_v) === true;
    return (
      <Path
        data={data}
        // The path is authored in its own space and scaled onto the box, so a
        // resized element reshapes rather than being frozen at import size.
        // strokeScaleEnabled=false keeps the outline the stated width instead
        // of being stretched with it.
        x={mirrorH ? width : 0}
        y={mirrorV ? height : 0}
        scaleX={(width / view.width) * (mirrorH ? -1 : 1)}
        scaleY={(height / view.height) * (mirrorV ? -1 : 1)}
        fill={fill}
        fillRule={readPathFillRule(element)}
        stroke={stroke && lineWidth > 0 ? stroke : undefined}
        strokeWidth={lineWidth}
        strokeScaleEnabled={false}
        dash={strokeDash(element.stroke)}
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
    const lineDash = strokeDash(element.stroke);
    if (!stroke || lineWidth <= 0) return null;
    return (
      <Line
        points={linePoints(width, height, lineWidth)}
        stroke={stroke}
        strokeWidth={lineWidth}
        dash={lineDash}
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
        onResize={onTableResize}
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
  if (type === "formula") {
    return <RawFormulaElement element={element} width={width} height={height} interactive={interactive} />;
  }
  if (type === "media") {
    return <RawMediaElement element={element} width={width} height={height} interactive={interactive} />;
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
    previous.onTableResize === next.onTableResize &&
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
  const recoloredSrc = useRecoloredIconSrc(src, color, isIcon);
  const renderSrc = recoloredSrc ?? src;
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

  const sourceRect = imageSourceRect(element);
  if (sourceRect) {
    // An explicit source rect is a mapping the file already stated (a .pptx
    // picture fill's srcRect/fillRect), so it wins over any fit heuristic:
    // exactly this slice, stretched across the box.
    crop = {
      x: sourceRect.x * loaded.width,
      y: sourceRect.y * loaded.height,
      width: sourceRect.width * loaded.width,
      height: sourceRect.height * loaded.height,
    };
  } else if (fit === "cover") {
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
      // KNOWN IMPERFECTION, deliberately left: a .pptx flip mirrors the whole
      // shape, geometry included, so strictly this clip should mirror with
      // flip_h/flip_v. An attempt to do that by transforming `context` here
      // made every flipped imported picture VANISH — Konva undoes only its own
      // matrix after clipFunc returns (Container._drawChildren), so the
      // transform leaked onto the children and the image was mirrored twice,
      // landing outside its own clip. Reverted rather than re-fixed blind:
      // verifying it needs a browser that actually composites, because Konva
      // draws through requestAnimationFrame. The visible cost is only that an
      // asymmetric outline on a flipped picture is clipped unmirrored.
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

/** `crop` as fractions of the natural image, or null when the element has no
 *  explicit source rect. Guards against a degenerate/out-of-range rect so a
 *  malformed value falls back to the fit heuristics instead of blanking the
 *  image. */
function imageSourceRect(
  element: RawElement,
): { x: number; y: number; width: number; height: number } | null {
  const crop = asRecord(element.crop);
  if (!crop) return null;
  const x = readNumber(crop.x);
  const y = readNumber(crop.y);
  const width = readNumber(crop.width);
  const height = readNumber(crop.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, 1 - clamp(x, 0, 1)) || width,
    height: clamp(height, 0, 1 - clamp(y, 0, 1)) || height,
  };
}

// Fetches the source SVG text and recolors it client-side via
// transformSvgMarkup — there is no server-side recolour route. Cached by src+color so repeated selections of the same icon/color don't
// refetch.
const recoloredSvgCache = new Map<string, string>();

function useRecoloredIconSrc(
  src: string | null,
  color: string | null,
  isIcon: boolean,
): string | null {
  const [recolored, setRecolored] = useState<string | null>(null);
  const eligible = Boolean(src && color && isIcon && isStaticSvgIconSource(src, typeof window !== "undefined" ? window.location.href : ""));

  useEffect(() => {
    if (!eligible || !src || !color) {
      setRecolored(null);
      return;
    }
    const cacheKey = `${src}::${color}`;
    const cached = recoloredSvgCache.get(cacheKey);
    if (cached) {
      setRecolored(cached);
      return;
    }
    let cancelled = false;
    fetch(src)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`Failed to fetch ${src}`))))
      .then((svgText) => {
        if (cancelled) return;
        const transformed = transformSvgMarkup(svgText, { color });
        const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(transformed)}`;
        recoloredSvgCache.set(cacheKey, dataUrl);
        setRecolored(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setRecolored(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, src, color]);

  return eligible ? recolored : null;
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
