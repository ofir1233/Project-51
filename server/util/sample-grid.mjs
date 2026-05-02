// Sample an image (Buffer of bytes) down to a small luminance grid.
//
// The output is what we persist instead of the source image:
//   { w, h, lum }
//     w, h — grid dimensions
//     lum  — Uint8Array of length w*h, each byte 0..255 (greyscale value)
//
// The renderer reads `lum` as a per-vertex attribute; the existing
// pointcloud shader treats luminance as Z-depth + brightness.
//
// We never write the source image to disk and we never return it from this
// module. Callers should let the original Buffer go out of scope after
// passing it in.

import sharp from 'sharp';

export async function sampleGridFromImage(bytes, { gridSize = 200 } = {}) {
  const meta = await sharp(bytes).metadata();
  const srcW = meta.width  || gridSize;
  const srcH = meta.height || gridSize;

  const aspect = srcW / srcH;
  const w = aspect >= 1 ? gridSize : Math.max(1, Math.round(gridSize * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(gridSize / aspect)) : gridSize;

  const raw = await sharp(bytes)
    .resize(w, h, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  return {
    w,
    h,
    lum: Array.from(raw),
    srcWidth:  srcW,
    srcHeight: srcH,
  };
}
