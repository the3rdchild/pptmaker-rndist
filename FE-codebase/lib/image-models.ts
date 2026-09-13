export interface ImageModelOption {
  id: string;
  label: string;
}

/** Public Runware presets. The browser only receives aliases and labels; the
 * worker owns both the alias-to-AIR mapping and the API key. */
export const RUNWARE_IMAGE_MODELS: ImageModelOption[] = [
  { id: "runware-cheap", label: "FLUX.2 Klein 4B · Murah" },
  { id: "runware-mid", label: "FLUX.2 Dev · Mid" },
  { id: "runware-premium", label: "FLUX.2 Pro · Mahal" },
];

export const DEFAULT_IMAGE_MODEL = "runware-mid";

export function resolveImageModelId(id: string | null | undefined): string {
  return RUNWARE_IMAGE_MODELS.some((option) => option.id === id)
    ? id!
    : DEFAULT_IMAGE_MODEL;
}

export function availableImageModels(): ImageModelOption[] {
  return process.env.RUNWARE_API_KEY ? RUNWARE_IMAGE_MODELS : [];
}
