/// <reference lib="webworker" />

import {
  comparePixelBuffers,
  type ImageDiffResult,
} from './lib/imageDiff';

interface ImageDiffRequest {
  id: number;
  original: File;
  changed: File;
  threshold: number;
  ignoreAlpha: boolean;
}

interface ImageDiffResponse {
  id: number;
  ok: boolean;
  result?: ImageDiffResult;
  error?: string;
}

async function bitmapPixels(
  file: File,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in this worker.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create image canvas context.');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      data: image.data,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<ImageDiffRequest>) => {
  const { id, original, changed, threshold, ignoreAlpha } = event.data;
  try {
    const [originalPixels, changedPixels] = await Promise.all([
      bitmapPixels(original),
      bitmapPixels(changed),
    ]);
    const result = comparePixelBuffers(
      originalPixels,
      changedPixels,
      threshold,
      ignoreAlpha,
    );
    const response: ImageDiffResponse = { id, ok: true, result };
    self.postMessage(response, { transfer: [result.mask.buffer] });
  } catch (error) {
    const response: ImageDiffResponse = {
      id,
      ok: false,
      error:
        error instanceof Error ? error.message : 'Image comparison failed.',
    };
    self.postMessage(response);
  }
};

export {};
