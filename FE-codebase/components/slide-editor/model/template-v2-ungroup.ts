type RawRecord = Record<string, any>;

export type TemplateV2UngroupBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ChildArrayInfo = {
  items: unknown[];
};

type LaidOutChild = {
  child: RawRecord;
  box: TemplateV2UngroupBox | null;
};

type UngroupDeps = {
  childArrayInfo: (element: RawRecord) => ChildArrayInfo | null;
  componentBox: (component: RawRecord) => TemplateV2UngroupBox;
  elementBox: (element: RawRecord) => TemplateV2UngroupBox;
  layoutChildren: (
    parent: RawRecord,
    children: unknown[],
    parentBox: TemplateV2UngroupBox,
  ) => LaidOutChild[];
};

export type TemplateV2UngroupSelection = {
  kind: "component";
  componentIndex: number;
};

export function canUngroupTemplateV2Component(
  component: RawRecord | null | undefined,
) {
  if (!component) return false;
  const elements = readArray(component.elements).filter(isRecord);
  if (elements.length > 1) return true;
  return elements.some(hasUngroupableLayout);
}

export function ungroupTemplateV2ComponentInUi(
  sourceUi: RawRecord,
  componentIndex: number,
  deps: UngroupDeps,
): { ui: RawRecord; selection: TemplateV2UngroupSelection } | null {
  const components = [...readArray(sourceUi.components)];
  const component = asRecord(components[componentIndex]);
  if (!component || !canUngroupTemplateV2Component(component)) return null;

  const ungroupedComponents = ungroupedComponentsFromComponent(
    component,
    componentIndex,
    deps,
  );
  if (ungroupedComponents.length === 0) return null;

  components.splice(componentIndex, 1, ...ungroupedComponents);
  return {
    ui: {
      ...sourceUi,
      components,
    },
    selection: {
      kind: "component",
      componentIndex,
    },
  };
}

function ungroupedComponentsFromComponent(
  component: RawRecord,
  componentIndex: number,
  deps: UngroupDeps,
): RawRecord[] {
  const componentBoxValue = deps.componentBox(component);
  const idBase = normalizeId(
    readString(component.id) ??
      readString(component.name) ??
      readString(component.description) ??
      `component_${componentIndex + 1}`,
  );
  const elements = readArray(component.elements).filter(isRecord);
  const entries =
    elements.length === 1
      ? ungroupElementOneLevel(
          elements[0],
          absoluteElementBox(elements[0], componentBoxValue, deps),
          deps,
        )
      : elements.map((element) => ({
          element,
          box: absoluteElementBox(element, componentBoxValue, deps),
        }));

  return entries.map((entry, index) => ungroupedComponent(entry, idBase, index));
}

function absoluteElementBox(
  element: RawRecord,
  componentBoxValue: TemplateV2UngroupBox,
  deps: UngroupDeps,
): TemplateV2UngroupBox {
  const box = deps.elementBox(element);
  return {
    x: componentBoxValue.x + box.x,
    y: componentBoxValue.y + box.y,
    width: box.width,
    height: box.height,
  };
}

function ungroupElementOneLevel(
  element: RawRecord,
  box: TemplateV2UngroupBox,
  deps: UngroupDeps,
): Array<{ element: RawRecord; box: TemplateV2UngroupBox }> {
  const childInfo = deps.childArrayInfo(element);
  if (!childInfo) return [];

  return deps
    .layoutChildren(
      element,
      childInfo.items,
      { x: 0, y: 0, width: box.width, height: box.height },
    )
    .map((item) => {
      const childBox = item.box ?? deps.elementBox(item.child);
      return {
        element: item.child,
        box: {
          x: box.x + childBox.x,
          y: box.y + childBox.y,
          width: childBox.width,
          height: childBox.height,
        },
      };
    });
}

function hasUngroupableLayout(element: RawRecord): boolean {
  const childInfo = childArrayInfoFromRecord(element);
  if (!childInfo) return false;
  const children = childInfo.items.filter(isRecord);
  if (isUngroupableLayoutType(readString(element.type)) && children.length > 0) {
    return true;
  }
  return children.some(hasUngroupableLayout);
}

function ungroupedComponent(
  entry: { element: RawRecord; box: TemplateV2UngroupBox },
  idBase: string,
  index: number,
): RawRecord {
  const { box, element } = entry;
  return {
    id: `${idBase}_part_${index + 1}`,
    description: "Ungrouped component element",
    position: { x: box.x, y: box.y },
    size: { width: box.width, height: box.height },
    elements: [
      {
        ...cloneJson(element),
        position: { x: 0, y: 0 },
        size: { width: box.width, height: box.height },
        __presenton_manual_position: true,
      },
    ],
  };
}

function childArrayInfoFromRecord(element: RawRecord): ChildArrayInfo | null {
  if (Array.isArray(element.children)) return { items: element.children };
  if (Array.isArray(element.elements)) return { items: element.elements };
  if (asRecord(element.child)) return { items: [element.child] };
  return null;
}

function isFlowLayoutType(type: string | null) {
  return (
    type === "flex" ||
    type === "grid" ||
    type === "list-view" ||
    type === "grid-view"
  );
}

function isUngroupableLayoutType(type: string | null) {
  return isFlowLayoutType(type) || type === "group";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(asRecord(value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "component";
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
