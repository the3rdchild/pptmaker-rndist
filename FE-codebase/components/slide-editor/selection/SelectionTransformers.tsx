"use client";

import { useEffect, useRef, type RefObject } from "react";
import type Konva from "konva";
import { Transformer } from "react-konva";

const CORNER_HANDLE_SIZE = 14;
const EDGE_HANDLE_LENGTH = 28;
const EDGE_HANDLE_THICKNESS = 9;
const ROTATION_HANDLE_SIZE = 28;
const BOTTOM_CENTER_ROTATION_ANCHOR_OFFSET = 26;
const BOTTOM_CENTER_ROTATION_ANCHOR_ANGLE = 180;
const ROTATION_ICON_SIZE = 18;
const ROTATION_ICON_VIEWBOX_SIZE = 24;
const REFRESH_CW_ICON_PATHS = [
  "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
  "M21 3v5h-5",
  "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
  "M8 16H3v5",
];
const SHADOW_EVENT_NAMESPACE = ".presentonSelectionShadows";
const BOTTOM_CENTER_ROTATION_ANCHOR_EVENT_NAMESPACE =
  ".presentonBottomCenterRotationAnchor";
const MULTI_SELECTION_GROUP_DASH = [5, 5];
const MULTI_SELECTION_MEMBER_DASH = [7, 4];
const HORIZONTAL_ONLY_ANCHORS = ["middle-left", "middle-right"];
let refreshCwIconPaths: Path2D[] | null = null;

type SelectionKind = "component" | "multi-component" | "element" | null;

type TemplateV2SelectionTransformersProps = {
  nodeRefs: RefObject<Map<string, Konva.Node>>;
  parentComponentKey: string | null;
  selectedKey: string | null;
  selectedKeys?: string[];
  selectionKind: SelectionKind;
  horizontalResizeOnly?: boolean;
  suppressSelectedOutline?: boolean;
};

function drawRotationHandle(context: Konva.Context, shape: Konva.Shape) {
  const center = ROTATION_HANDLE_SIZE / 2;

  context.beginPath();
  context.arc(center, center, center - 1, 0, Math.PI * 2, false);
  context.closePath();
  context.fillStrokeShape(shape);

  context.save();
  context.setAttr("strokeStyle", "#111111");
  context.setAttr("lineWidth", 2);
  context.setAttr("lineCap", "round");
  context.setAttr("lineJoin", "round");
  context.translate(
    center - ROTATION_ICON_SIZE / 2,
    center - ROTATION_ICON_SIZE / 2,
  );
  context.scale(
    ROTATION_ICON_SIZE / ROTATION_ICON_VIEWBOX_SIZE,
    ROTATION_ICON_SIZE / ROTATION_ICON_VIEWBOX_SIZE,
  );
  if (!refreshCwIconPaths && typeof Path2D !== "undefined") {
    refreshCwIconPaths = REFRESH_CW_ICON_PATHS.map((path) => new Path2D(path));
  }
  refreshCwIconPaths?.forEach((path) => context.stroke(path));
  context.restore();
}

function styleAnchor(anchor: Konva.Rect) {
  const name = anchor.name();
  const isRotationHandle = name.includes("rotater");
  const isHorizontalEdge =
    name.includes("top-center") || name.includes("bottom-center");
  const isVerticalEdge =
    name.includes("middle-left") || name.includes("middle-right");

  let width = CORNER_HANDLE_SIZE;
  let height = CORNER_HANDLE_SIZE;
  if (isHorizontalEdge) {
    width = EDGE_HANDLE_LENGTH;
    height = EDGE_HANDLE_THICKNESS;
  } else if (isVerticalEdge) {
    width = EDGE_HANDLE_THICKNESS;
    height = EDGE_HANDLE_LENGTH;
  } else if (isRotationHandle) {
    width = ROTATION_HANDLE_SIZE;
    height = ROTATION_HANDLE_SIZE;
  }

  anchor.setAttrs({
    width,
    height,
    offsetX: width / 2,
    offsetY: height / 2,
    cornerRadius: Math.min(width, height) / 2,
    fill: "#FFFFFF",
    stroke: "#E5E7EB",
    strokeWidth: 1,
    shadowColor: "#101828",
    shadowBlur: isRotationHandle ? 5 : 4,
    shadowOffsetX: 0,
    shadowOffsetY: isRotationHandle ? 2 : 2,
    shadowOpacity: isRotationHandle ? 0.16 : 0.13,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
  });

  if (isRotationHandle) anchor.sceneFunc(drawRotationHandle);
}

function drawContextBoundary(context: Konva.Context, shape: Konva.Shape) {
  const width = shape.width();
  const height = shape.height();

  context.save();
  context.setAttr("lineWidth", 2);
  context.setAttr("lineJoin", "miter");
  context.setLineDash([]);
  context.setAttr("strokeStyle", "#D9D9DE");
  context.beginPath();
  context.rect(0, 0, width, height);
  context.stroke();

  context.setLineDash([4, 8]);
  context.setAttr("strokeStyle", "#FFFFFF");
  context.beginPath();
  context.rect(0, 0, width, height);
  context.stroke();
  context.restore();
}

function applyContextBoundaryStyle(transformer: Konva.Transformer) {
  const back = transformer.findOne<Konva.Rect>(".back");
  back?.sceneFunc(drawContextBoundary);
  back?.setAttrs({
    shadowColor: "#101828",
    shadowBlur: 6,
    shadowOffsetX: 0,
    shadowOffsetY: 1,
    shadowOpacity: 0.16,
    shadowForStrokeEnabled: true,
    perfectDrawEnabled: false,
  });
}

function setTransformerShadowsEnabled(
  transformers: Array<Konva.Transformer | null>,
  enabled: boolean,
) {
  transformers.forEach((transformer) => {
    if (!transformer) return;
    transformer.find<Konva.Rect>("._anchor").forEach((anchor) => {
      anchor.shadowEnabled(enabled);
    });
    transformer.findOne<Konva.Rect>(".back")?.shadowEnabled(enabled);
  });
  transformers[0]?.getLayer()?.batchDraw();
}

function TemplateV2MultiSelectionMemberOutline({
  nodeRefs,
  selectedKey,
}: {
  nodeRefs: RefObject<Map<string, Konva.Node>>;
  selectedKey: string;
}) {
  const transformerRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const node = nodeRefs.current?.get(selectedKey);
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();

    return () => {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    };
  }, [nodeRefs, selectedKey]);

  return (
    <Transformer
      ref={transformerRef}
      anchorSize={0}
      borderDash={MULTI_SELECTION_MEMBER_DASH}
      borderEnabled
      borderStroke="#7A5AF8"
      borderStrokeWidth={1}
      enabledAnchors={[]}
      listening={false}
      resizeEnabled={false}
      rotateEnabled={false}
      rotateLineVisible={false}
    />
  );
}

function getBottomCenterRotationAnchorAngle(
  node: Konva.Node | null | undefined,
) {
  return (
    BOTTOM_CENTER_ROTATION_ANCHOR_ANGLE - (node?.getAbsoluteRotation() ?? 0)
  );
}

function applyBottomCenterRotationAnchor(
  transformer: Konva.Transformer | null,
  node: Konva.Node | null | undefined,
) {
  if (!transformer) return;

  transformer.rotateAnchorAngle(getBottomCenterRotationAnchorAngle(node));
  transformer.rotateAnchorOffset(BOTTOM_CENTER_ROTATION_ANCHOR_OFFSET);
  transformer.forceUpdate();
  transformer.getLayer()?.batchDraw();
}

export function TemplateV2SelectionTransformers({
  nodeRefs,
  parentComponentKey,
  selectedKey,
  selectedKeys,
  selectionKind,
  horizontalResizeOnly = false,
  suppressSelectedOutline = false,
}: TemplateV2SelectionTransformersProps) {
  const selectedTransformerRef = useRef<Konva.Transformer | null>(null);
  const contextTransformerRef = useRef<Konva.Transformer | null>(null);
  const isMultiComponentSelection = selectionKind === "multi-component";
  const selectedNode =
    selectionKind === "component" && selectedKey
      ? nodeRefs.current?.get(selectedKey)
      : null;
  const bottomCenterRotationAnchorAngle =
    getBottomCenterRotationAnchorAngle(selectedNode);
  const multiSelectionMemberKeys =
    isMultiComponentSelection && !suppressSelectedOutline
      ? selectedKeys ?? []
      : [];

  useEffect(() => {
    const keys = selectedKeys?.length
      ? selectedKeys
      : selectedKey
        ? [selectedKey]
        : [];
    const selectedNodes = suppressSelectedOutline
      ? []
      : keys.flatMap((key) => {
          const node = nodeRefs.current?.get(key);
          return node ? [node] : [];
        });
    const parentComponentNode = parentComponentKey
      ? nodeRefs.current?.get(parentComponentKey)
      : null;

    const selectedTransformer = selectedTransformerRef.current;
    if (selectedTransformer) {
      selectedTransformer.nodes(selectedNodes);
    }

    const contextTransformer = contextTransformerRef.current;
    if (contextTransformer) {
      contextTransformer.nodes(parentComponentNode ? [parentComponentNode] : []);
      applyContextBoundaryStyle(contextTransformer);
    }

    const selectedRotationNode =
      selectionKind === "component" && selectedNodes.length === 1
        ? selectedNodes[0]
        : null;
    const refreshBottomCenterRotationAnchor = () => {
      if (selectedTransformer?.isTransforming()) return;
      applyBottomCenterRotationAnchor(selectedTransformer, selectedRotationNode);
    };
    refreshBottomCenterRotationAnchor();

    selectedTransformer?.getLayer()?.batchDraw();

    const transformers = [selectedTransformer, contextTransformer];
    const dragNodes = Array.from(
      new Set([...selectedNodes, parentComponentNode].filter(Boolean)),
    ) as Konva.Node[];
    const disableShadows = () =>
      setTransformerShadowsEnabled(transformers, false);
    const enableShadows = () =>
      setTransformerShadowsEnabled(transformers, true);

    dragNodes.forEach((node) => {
      node.on(`dragstart${SHADOW_EVENT_NAMESPACE}`, disableShadows);
      node.on(`dragend${SHADOW_EVENT_NAMESPACE}`, enableShadows);
    });
    selectedRotationNode?.on(
      `rotationChange${BOTTOM_CENTER_ROTATION_ANCHOR_EVENT_NAMESPACE}`,
      refreshBottomCenterRotationAnchor,
    );
    selectedRotationNode?.on(
      `absoluteTransformChange${BOTTOM_CENTER_ROTATION_ANCHOR_EVENT_NAMESPACE}`,
      refreshBottomCenterRotationAnchor,
    );
    selectedRotationNode?.on(
      `transformend${BOTTOM_CENTER_ROTATION_ANCHOR_EVENT_NAMESPACE}`,
      refreshBottomCenterRotationAnchor,
    );

    return () => {
      dragNodes.forEach((node) => node.off(SHADOW_EVENT_NAMESPACE));
      selectedRotationNode?.off(BOTTOM_CENTER_ROTATION_ANCHOR_EVENT_NAMESPACE);
      enableShadows();
    };
  }, [
    nodeRefs,
    parentComponentKey,
    selectedKey,
    selectedKeys,
    selectionKind,
    suppressSelectedOutline,
  ]);

  return (
    <>
      <Transformer
        ref={contextTransformerRef}
        anchorCornerRadius={7}
        anchorFill="#FFFFFF"
        anchorSize={CORNER_HANDLE_SIZE}
        anchorStroke="#D0D5DD"
        anchorStrokeWidth={1}
        anchorStyleFunc={styleAnchor}
        borderStroke="#D9D9DE"
        borderStrokeWidth={1}
        rotateEnabled={false}
      />
      <Transformer
        ref={selectedTransformerRef}
        anchorCornerRadius={7}
        anchorFill="#FFFFFF"
        anchorSize={CORNER_HANDLE_SIZE}
        anchorStroke="#E5E7EB"
        anchorStrokeWidth={1}
        anchorStyleFunc={styleAnchor}
        borderDash={
          isMultiComponentSelection ? MULTI_SELECTION_GROUP_DASH : undefined
        }
        borderEnabled
        borderStroke={isMultiComponentSelection ? "#D9D9DE" : "#7A5AF8"}
        borderStrokeWidth={1}
        enabledAnchors={
          selectionKind === "component"
            ? horizontalResizeOnly
              ? HORIZONTAL_ONLY_ANCHORS
              : undefined
            : []
        }
        resizeEnabled={selectionKind === "component"}
        rotateAnchorAngle={bottomCenterRotationAnchorAngle}
        rotateAnchorOffset={BOTTOM_CENTER_ROTATION_ANCHOR_OFFSET}
        rotateEnabled={selectionKind === "component"}
        rotateLineVisible={false}
      />
      {multiSelectionMemberKeys.map((key) => (
        <TemplateV2MultiSelectionMemberOutline
          key={key}
          nodeRefs={nodeRefs}
          selectedKey={key}
        />
      ))}
    </>
  );
}
