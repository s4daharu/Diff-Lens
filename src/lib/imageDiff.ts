export const IMAGE_TILE_SIZE = 16;
export const MAX_IMAGE_REGIONS = 200;

export interface ImageChangeRegion {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
}

export interface ImageDiffResult {
  width: number;
  height: number;
  changedPixels: number;
  totalPixels: number;
  changePercent: number;
  regions: ImageChangeRegion[];
  totalRegions: number;
  regionsTruncated: boolean;
  mask: Uint8Array;
}

interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function pixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function channelDelta(
  left: Uint8ClampedArray,
  leftOffset: number,
  right: Uint8ClampedArray,
  rightOffset: number,
  ignoreAlpha: boolean,
): number {
  let delta = 0;
  for (let channel = 0; channel < 3; channel++) {
    delta = Math.max(
      delta,
      Math.abs(left[leftOffset + channel] - right[rightOffset + channel]),
    );
  }
  if (!ignoreAlpha) {
    delta = Math.max(
      delta,
      Math.abs(left[leftOffset + 3] - right[rightOffset + 3]),
    );
  }
  return delta;
}

function buildRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  tileCounts: Uint32Array,
  tileColumns: number,
  tileRows: number,
): {
  regions: ImageChangeRegion[];
  totalRegions: number;
  regionsTruncated: boolean;
} {
  const visited = new Uint8Array(tileCounts.length);
  const regions: Omit<ImageChangeRegion, 'id'>[] = [];

  for (let tileIndex = 0; tileIndex < tileCounts.length; tileIndex++) {
    if (visited[tileIndex] || tileCounts[tileIndex] === 0) continue;

    const stack = [tileIndex];
    visited[tileIndex] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let changedPixels = 0;

    while (stack.length > 0) {
      const current = stack.pop()!;
      const tileX = current % tileColumns;
      const tileY = Math.floor(current / tileColumns);
      changedPixels += tileCounts[current];

      const startX = tileX * IMAGE_TILE_SIZE;
      const startY = tileY * IMAGE_TILE_SIZE;
      const endX = Math.min(width, startX + IMAGE_TILE_SIZE);
      const endY = Math.min(height, startY + IMAGE_TILE_SIZE);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          if (mask[y * width + x] === 0) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      const neighbors = [
        tileX > 0 ? current - 1 : -1,
        tileX + 1 < tileColumns ? current + 1 : -1,
        tileY > 0 ? current - tileColumns : -1,
        tileY + 1 < tileRows ? current + tileColumns : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          !visited[neighbor] &&
          tileCounts[neighbor] > 0
        ) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }

    if (maxX >= minX && maxY >= minY) {
      regions.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        changedPixels,
      });
    }
  }

  regions.sort(
    (a, b) =>
      b.changedPixels - a.changedPixels ||
      a.y - b.y ||
      a.x - b.x,
  );
  const totalRegions = regions.length;
  const limited = regions.slice(0, MAX_IMAGE_REGIONS).map((region, index) => ({
    id: index + 1,
    ...region,
  }));

  return {
    regions: limited,
    totalRegions,
    regionsTruncated: totalRegions > limited.length,
  };
}

export function comparePixelBuffers(
  original: PixelBuffer,
  changed: PixelBuffer,
  threshold: number,
  ignoreAlpha: boolean,
): ImageDiffResult {
  const width = Math.max(original.width, changed.width);
  const height = Math.max(original.height, changed.height);
  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);
  const tileColumns = Math.ceil(width / IMAGE_TILE_SIZE);
  const tileRows = Math.ceil(height / IMAGE_TILE_SIZE);
  const tileCounts = new Uint32Array(tileColumns * tileRows);
  const effectiveThreshold = clampThreshold(threshold);
  let changedPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const originalInside = x < original.width && y < original.height;
      const changedInside = x < changed.width && y < changed.height;
      let different = originalInside !== changedInside;

      if (originalInside && changedInside) {
        const originalOffset = pixelOffset(x, y, original.width);
        const changedOffset = pixelOffset(x, y, changed.width);
        different =
          channelDelta(
            original.data,
            originalOffset,
            changed.data,
            changedOffset,
            ignoreAlpha,
          ) > effectiveThreshold;
      }

      if (!different) continue;
      const index = y * width + x;
      mask[index] = 255;
      changedPixels++;
      const tileX = Math.floor(x / IMAGE_TILE_SIZE);
      const tileY = Math.floor(y / IMAGE_TILE_SIZE);
      tileCounts[tileY * tileColumns + tileX]++;
    }
  }

  const regionData = buildRegions(
    mask,
    width,
    height,
    tileCounts,
    tileColumns,
    tileRows,
  );

  return {
    width,
    height,
    changedPixels,
    totalPixels,
    changePercent:
      totalPixels === 0
        ? 0
        : Number(((changedPixels / totalPixels) * 100).toFixed(4)),
    ...regionData,
    mask,
  };
}
