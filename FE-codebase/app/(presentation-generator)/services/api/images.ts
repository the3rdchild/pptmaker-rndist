import type { ImageAssetResponse } from "./types";

// Stub: real upload is a backend feature. For the RnD prototype, returns a local
// object URL so images can be placed on the canvas without a backend round-trip.
export class ImagesApi {
  static async uploadImage(file: File): Promise<ImageAssetResponse> {
    const objectUrl = URL.createObjectURL(file);
    return {
      message: "ok",
      path: objectUrl,
      id: crypto.randomUUID(),
      file_url: objectUrl,
    };
  }
}
