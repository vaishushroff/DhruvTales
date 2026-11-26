/**
 * HTTP byte-range parser with a 3 MB chunk cap for Vercel Serverless streaming.
 *
 * Vercel Serverless Function responses are subject to a 4.5 MB payload cap.
 * Capping every streamed chunk to ~3 MB ensures both <audio> and <video> seeking
 * (Range requests) succeed reliably while keeping memory and latency low.
 */

export const MAX_STREAM_CHUNK_BYTES = 3 * 1024 * 1024; // 3 MB

export type ParsedRangeResult =
  | {
      ok: true;
      status: 200 | 206;
      start: number;
      end: number;
      length: number;
      totalSize: number;
      isPartial: boolean;
    }
  | {
      ok: false;
      status: 416;
      totalSize: number;
      message: string;
    };

export function parseByteRange(
  rangeHeader: string | undefined | null,
  totalSize: number,
  maxChunkBytes: number = MAX_STREAM_CHUNK_BYTES
): ParsedRangeResult {
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return {
      ok: false,
      status: 416,
      totalSize: 0,
      message: 'File size is empty or unavailable.',
    };
  }

  const safeTotal = Math.floor(totalSize);
  const safeMaxChunk = Math.max(1, Math.floor(maxChunkBytes));

  if (!rangeHeader || !rangeHeader.trim()) {
    if (safeTotal <= safeMaxChunk) {
      return {
        ok: true,
        status: 200,
        start: 0,
        end: safeTotal - 1,
        length: safeTotal,
        totalSize: safeTotal,
        isPartial: false,
      };
    }

    const cappedEnd = safeMaxChunk - 1;
    return {
      ok: true,
      status: 206,
      start: 0,
      end: cappedEnd,
      length: cappedEnd + 1,
      totalSize: safeTotal,
      isPartial: true,
    };
  }

  const trimmed = rangeHeader.trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      status: 416,
      totalSize: safeTotal,
      message: 'Unsupported or malformed Range header.',
    };
  }

  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let requestedEnd: number;

  if (!startStr && !endStr) {
    return {
      ok: false,
      status: 416,
      totalSize: safeTotal,
      message: 'Empty Range header.',
    };
  } else if (!startStr && endStr) {
    // Suffix byte range: bytes=-500 (last 500 bytes)
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return {
        ok: false,
        status: 416,
        totalSize: safeTotal,
        message: 'Invalid suffix byte range.',
      };
    }
    const clampedSuffix = Math.min(suffixLength, safeTotal, safeMaxChunk);
    start = safeTotal - clampedSuffix;
    requestedEnd = safeTotal - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    requestedEnd = endStr ? Number.parseInt(endStr, 10) : safeTotal - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    start < 0 ||
    start >= safeTotal ||
    requestedEnd < start
  ) {
    return {
      ok: false,
      status: 416,
      totalSize: safeTotal,
      message: 'Requested byte range is outside file bounds.',
    };
  }

  const maxAllowedEnd = Math.min(safeTotal - 1, start + safeMaxChunk - 1);
  const end = Math.min(requestedEnd, maxAllowedEnd);
  const length = end - start + 1;

  return {
    ok: true,
    status: 206,
    start,
    end,
    length,
    totalSize: safeTotal,
    isPartial: true,
  };
}
