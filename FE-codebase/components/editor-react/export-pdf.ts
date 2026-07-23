import jsPDF from "jspdf";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
} from "@/components/slide-editor/types";

// Builds a PDF with one page per slide from already-rasterized slide
// images (see PdfExportCapture.tsx for how those get produced — this
// function only does the image-to-PDF part). Pages use the slide's own
// pixel dimensions as the page size in "px" units, so a higher-resolution
// capture (e.g. 2x pixelRatio) just makes the placed image sharper without
// changing the page's logical size.
export async function buildPdfFromSlideImages(
  dataUrls: string[],
): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT],
    compress: true,
  });

  dataUrls.forEach((dataUrl, index) => {
    if (index > 0) {
      pdf.addPage([EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT], "landscape");
    }
    pdf.addImage(dataUrl, "PNG", 0, 0, EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT);
  });

  return pdf.output("blob");
}
