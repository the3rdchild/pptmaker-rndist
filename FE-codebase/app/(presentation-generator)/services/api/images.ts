import type { ImageAssetResponse } from "./types";

// Stub: real upload is a backend feature. For now, embeds the file as a
// base64 data URL so the image survives a page reload (a blob: URL would
// be revoked when the document unloads and leave a broken element).
export class ImagesApi {
  static async uploadImage(file: File): Promise<ImageAssetResponse> {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      message: "ok",
      path: dataUrl,
      id: crypto.randomUUID(),
      file_url: dataUrl,
    };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === "string" ? result : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
