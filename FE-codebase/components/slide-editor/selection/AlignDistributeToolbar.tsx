"use client";

import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  type LucideIcon,
} from "lucide-react";
import type { AlignAction, DistributeAxis } from "@/components/slide-editor/model/model";

const ALIGN_ACTIONS: Array<{ action: AlignAction; label: string; icon: LucideIcon }> = [
  { action: "align-left", label: "Align left", icon: AlignHorizontalJustifyStart },
  { action: "align-center-h", label: "Align center", icon: AlignHorizontalJustifyCenter },
  { action: "align-right", label: "Align right", icon: AlignHorizontalJustifyEnd },
  { action: "align-top", label: "Align top", icon: AlignVerticalJustifyStart },
  { action: "align-middle-v", label: "Align middle", icon: AlignVerticalJustifyCenter },
  { action: "align-bottom", label: "Align bottom", icon: AlignVerticalJustifyEnd },
];

const DISTRIBUTE_ACTIONS: Array<{ axis: DistributeAxis; label: string; icon: LucideIcon }> = [
  { axis: "horizontal", label: "Distribute horizontally", icon: AlignHorizontalDistributeCenter },
  { axis: "vertical", label: "Distribute vertically", icon: AlignVerticalDistributeCenter },
];

export function AlignDistributeToolbar({
  position,
  canDistribute,
  onAlign,
  onDistribute,
}: {
  position: { left: number; top: number } | null;
  canDistribute: boolean;
  onAlign: (action: AlignAction) => void;
  onDistribute: (axis: DistributeAxis) => void;
}) {
  if (!position) return null;
  return (
    <div
      data-template-v2-floating-toolbar="true"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-[10000] inline-flex items-center gap-[2px] rounded-[6px] bg-[#FFF] p-[6px] shadow-[0_0_4px_rgba(0,0,0,0.15)]"
    >
      {ALIGN_ACTIONS.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onAlign(action)}
          className="grid h-7 w-7 place-items-center rounded-[4px] text-[#191919] hover:bg-[#F6F6F9]"
        >
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </button>
      ))}
      <div className="mx-1 h-4 w-px bg-[#E7E8EC]" />
      {DISTRIBUTE_ACTIONS.map(({ axis, label, icon: Icon }) => (
        <button
          key={axis}
          type="button"
          title={canDistribute ? label : `${label} (needs 3+ selected)`}
          aria-label={label}
          disabled={!canDistribute}
          onClick={() => onDistribute(axis)}
          className="grid h-7 w-7 place-items-center rounded-[4px] text-[#191919] hover:bg-[#F6F6F9] disabled:cursor-not-allowed disabled:text-[#B0B3BB] disabled:hover:bg-transparent"
        >
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </button>
      ))}
    </div>
  );
}
