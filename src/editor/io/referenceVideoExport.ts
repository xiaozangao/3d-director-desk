export type ReferenceVideoExportQuality = "720p" | "1080p";

export interface ReferenceVideoExportOptions {
  fps: number;
  quality: ReferenceVideoExportQuality;
}

export interface ReferenceVideoExportRequest extends ReferenceVideoExportOptions {
  fileName: string;
}

type ReferenceVideoExportHandler = (request: ReferenceVideoExportRequest) => Promise<void>;

let exportHandler: ReferenceVideoExportHandler | null = null;

export function setReferenceVideoExportHandler(handler: ReferenceVideoExportHandler) {
  exportHandler = handler;
}

export function clearReferenceVideoExportHandler() {
  exportHandler = null;
}

export async function requestReferenceVideoExport(request: ReferenceVideoExportRequest) {
  if (!exportHandler) throw new Error("参考视频导出器尚未准备好");
  await exportHandler(request);
}

export function getSupportedReferenceVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}
