/**
 * Browser-only: shrink a camera photo before upload (iPad photos are often
 * 3–8 MB). Re-encodes as JPEG, longest side ≤ maxSide. PDFs and small files
 * pass through unchanged. Re-encoding also drops EXIF metadata (GPS etc.).
 */
export async function shrinkImage(file: File, maxSide = 2000, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // e.g. HEIC the browser can't decode — the server will say if it can't use it
  }
}
