export enum MixpanelEvent {
  Editor_Side_Panel_Tab_Selected = "Editor Side Panel Tab Selected",
  Editor_Insert_Palette_Item_Selected = "Editor Insert Palette Item Selected",
  Editor_Template_Block_Inserted = "Editor Template Block Inserted",
  Editor_Template_Blocks_Loaded = "Editor Template Blocks Loaded",
  Editor_Template_Blocks_Load_Failed = "Editor Template Blocks Load Failed",
  Editor_Element_Text_Edited = "Editor Element Text Edited",
  Editor_Element_Style_Changed = "Editor Element Style Changed",
  Editor_Element_Deleted = "Editor Element Deleted",
  Editor_Element_Duplicated = "Editor Element Duplicated",
  Editor_Component_Ungrouped = "Editor Component Ungrouped",
  Editor_Component_Layer_Changed = "Editor Component Layer Changed",
  Editor_Image_Replaced = "Editor Image Replaced",
  Editor_Image_Replace_Failed = "Editor Image Replace Failed",
  Editor_Icon_Replaced = "Editor Icon Replaced",
}

export function trackEvent(_event: MixpanelEvent | string, _properties?: Record<string, unknown>): void {
  // No-op stub — analytics disabled in the RnD prototype.
}
