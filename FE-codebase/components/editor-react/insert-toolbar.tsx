"use client";

import { useState } from "react";
import {
  BarChart3,
  Circle,
  CircleDot,
  Heading1,
  Heading2,
  Image as ImageIcon,
  LineChart,
  List,
  ListOrdered,
  PaintBucket,
  PieChart,
  Quote,
  Shapes,
  Slash,
  Square,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PopItem, PopPanel, PanelLabel } from "@/components/editor-react/ui";
import BackgroundPanel from "@/components/editor-react/background-panel";
import { appendInsertedContent } from "@/components/slide-editor/model/inserted-content";
import {
  createChartInsertElements,
  createElementInsertElements,
  createImageInsertContent,
  createTableInsertElements,
  createTextInsertElements,
} from "@/components/slide-editor/insert/insert-elements";
import type { RawUi } from "@/components/slide-editor/model/core";

type InsertHandler = (ui: Record<string, unknown>) => void;

export interface InsertToolbarProps {
  activeUi: Record<string, unknown> | null;
  onInsert: InsertHandler;
}

export default function InsertToolbar({ activeUi, onInsert }: InsertToolbarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  if (!activeUi) return null;

  const run = (elements: ReturnType<typeof createTextInsertElements>) => {
    const next = appendInsertedContent(activeUi as RawUi, elements, []);
    onInsert(next);
  };

  const tools = [
    {
      id: "text",
      icon: Type,
      label: "Text",
      onClick: () => run(createTextInsertElements("body-text")),
      submenu: [
        { label: "Title", kind: "title-block", icon: Heading1 },
        { label: "Subtitle", kind: "subtitle", icon: Heading2 },
        { label: "Body text", kind: "body-text", icon: Type },
        { label: "Bullet list", kind: "bullet-list", icon: List },
        { label: "Numbered list", kind: "numbered-list", icon: ListOrdered },
        { label: "Quote", kind: "quote", icon: Quote },
      ],
      submenuKind: (k: string) => run(createTextInsertElements(k)),
    },
    {
      id: "image",
      icon: ImageIcon,
      label: "Image",
      onClick: () => {
        const content = createImageInsertContent();
        const next = appendInsertedContent(
          activeUi as RawUi,
          content.elements ?? [],
          content.components ?? []
        );
        onInsert(next);
      },
    },
    {
      id: "shape",
      icon: Shapes,
      label: "Shape",
      onClick: () => run(createElementInsertElements("rectangle")),
      submenu: [
        { label: "Rectangle", kind: "rectangle", icon: Square },
        { label: "Ellipse", kind: "ellipse", icon: Circle },
        { label: "Line", kind: "line", icon: Slash },
      ],
      submenuKind: (k: string) => run(createElementInsertElements(k)),
    },
    {
      id: "chart",
      icon: BarChart3,
      label: "Chart",
      onClick: () => run(createChartInsertElements("bar")),
      submenu: [
        { label: "Bar", kind: "bar", icon: BarChart3 },
        { label: "Line", kind: "line", icon: LineChart },
        { label: "Pie", kind: "pie", icon: PieChart },
        { label: "Donut", kind: "donut", icon: CircleDot },
      ],
      submenuKind: (k: string) => run(createChartInsertElements(k)),
    },
    {
      id: "table",
      icon: TableIcon,
      label: "Table",
      onClick: () => run(createTableInsertElements("simple-table")),
    },
  ];

  return (
    <div className="relative flex h-full w-[60px] shrink-0 flex-col items-center gap-1 border-l border-[var(--border)] bg-[var(--bg-panel)] py-3">
      {tools.map((tool) => (
        <div key={tool.id} className="relative">
          <button
            className={cn(
              "flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] font-medium transition-colors",
              openMenu === tool.id
                ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            )}
            title={tool.label}
            onClick={() => {
              if (tool.submenu) {
                setOpenMenu((cur) => (cur === tool.id ? null : tool.id));
              } else {
                tool.onClick();
                setOpenMenu(null);
              }
            }}
          >
            <tool.icon size={17} />
            <span>{tool.label}</span>
          </button>

          {tool.submenu && openMenu === tool.id && (
            <PopPanel className="absolute right-full top-0 z-50 mr-2 w-40">
              <PanelLabel>{tool.label}</PanelLabel>
              {tool.submenu.map((item) => (
                <PopItem
                  key={item.kind}
                  icon={<item.icon size={13} className="shrink-0" />}
                  label={item.label}
                  onClick={() => {
                    tool.submenuKind(item.kind);
                    setOpenMenu(null);
                  }}
                />
              ))}
            </PopPanel>
          )}
        </div>
      ))}

      <div className="relative mt-auto">
        <button
          className={cn(
            "flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] font-medium transition-colors",
            openMenu === "background"
              ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          )}
          title="Background"
          onClick={() =>
            setOpenMenu((cur) => (cur === "background" ? null : "background"))
          }
        >
          <PaintBucket size={17} />
          <span>BG</span>
        </button>
        {openMenu === "background" && (
          <PopPanel className="absolute bottom-0 right-full z-50 mr-2">
            <BackgroundPanel activeUi={activeUi} onApply={onInsert} />
          </PopPanel>
        )}
      </div>
    </div>
  );
}
