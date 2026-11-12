export interface VirtualRange {
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
}

export function buildVirtualOffsets(
  count: number,
  measured: ReadonlyMap<number, number>,
  estimate: (index: number) => number,
): number[] {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) {
    const measuredHeight = measured.get(i);
    const height =
      measuredHeight != null && measuredHeight > 0
        ? measuredHeight
        : Math.max(1, estimate(i));
    offsets[i + 1] = offsets[i] + height;
  }
  return offsets;
}

export function findVirtualIndex(offsets: number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1);
  if (count === 0) return 0;

  const target = Math.max(0, Math.min(offset, offsets[count]));
  let low = 0;
  let high = count - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid + 1] <= target) low = mid + 1;
    else high = mid;
  }

  return low;
}

export function getVirtualRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = 500,
): VirtualRange {
  const count = Math.max(0, offsets.length - 1);
  const totalHeight = offsets[count] ?? 0;
  if (count === 0) {
    return {
      start: 0,
      end: 0,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
    };
  }

  const safeViewport = Math.max(1, viewportHeight);
  const from = Math.max(0, scrollTop - overscanPx);
  const to = Math.min(totalHeight, scrollTop + safeViewport + overscanPx);
  const start = findVirtualIndex(offsets, from);
  const end = Math.min(count, findVirtualIndex(offsets, to) + 1);

  return {
    start,
    end,
    topPadding: offsets[start],
    bottomPadding: Math.max(0, totalHeight - offsets[end]),
    totalHeight,
  };
}
