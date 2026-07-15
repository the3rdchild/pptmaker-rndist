"use client";

import { useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  MousePointerClick,
  PencilLine,
  Shapes,
  Spline,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
        { label: "Title", kind: "title-block", icon: Type },
        { label: "Subtitle", kind: "subtitle", icon: Type },
        { label: "Body text", kind: "body-text", icon: Type },
        { label: "Bullet list", kind: "bullet-list", icon: PencilLine },
        { label: "Numbered list", kind: "numbered-list", icon: PencilLine },
        { label: "Quote", kind: "quote", icon: Type },
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
        { label: "Rectangle", kind: "rectangle", icon: Shapes },
        { label: "Ellipse", kind: "ellipse", icon: Shapes },
        { label: "Line", kind: "line", icon: Spline },
      ],
      submenuKind: (k: string) => run(createElementInsertElements(k)),
    },
    {
      id: "chart",
      icon: MousePointerClick,
      label: "Chart",
      onClick: () => run(createChartInsertElements("bar")),
      submenu: [
        { label: "Bar", kind: "bar", icon: MousePointerClick },
        { label: "Line", kind: "line", icon: Spline },
        { label: "Pie", kind: "pie", icon: MousePointerClick },
        { label: "Donut", kind: "donut", icon: MousePointerClick },
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
    <div className="relative flex h-full shrink-0 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-950 py-2 w-[52px]">
      {tools.map((tool) => (
        <div key={tool.id} className="relative">
          <button
            className={cn(
              "flex h-10 w-10 flex-col items-center justify-center rounded-md text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white",
              openMenu === tool.id && "bg-zinc-800 text-white"
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
            <tool.icon size={18} />
            <span className="mt-0.5">{tool.label}</span>
          </button>

          {tool.submenu && openMenu === tool.id && (
            <div className="absolute right-full top-0 z-50 mr-1 w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              {tool.submenu.map((item) => (
                <button
                  key={item.kind}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  onClick={() => {
                    tool.submenuKind(item.kind);
                    setOpenMenu(null);
                  }}
                >
                  <item.icon size={12} />
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
