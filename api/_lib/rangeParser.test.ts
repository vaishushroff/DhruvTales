import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_STREAM_CHUNK_BYTES, parseByteRange } from './rangeParser';

test('returns 200 full file when no Range header and file <= 3 MB', () => {
  const size = 1_000_000;
  const res = parseByteRange(undefined, size);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.status, 200);
    assert.equal(res.isPartial, false);
    assert.equal(res.start, 0);
    assert.equal(res.end, size - 1);
    assert.equal(res.length, size);
  }
});

test('caps initial non-Range request on large file (> 3 MB) to 206 3 MB chunk', () => {
  const size = 25 * 1024 * 1024;
  const res = parseByteRange(undefined, size);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.status, 206);
    assert.equal(res.isPartial, true);
    assert.equal(res.start, 0);
    assert.equal(res.end, MAX_STREAM_CHUNK_BYTES - 1);
    assert.equal(res.length, MAX_STREAM_CHUNK_BYTES);
    assert.equal(res.totalSize, size);
  }
});

test('caps open-ended Range (bytes=0- and mid-file seek) at 3 MB chunk', () => {
  const size = 20 * 1024 * 1024;

  const fromStart = parseByteRange('bytes=0-', size);
  assert.equal(fromStart.ok, true);
  if (fromStart.ok) {
    assert.equal(fromStart.status, 206);
    assert.equal(fromStart.start, 0);
    assert.equal(fromStart.length, MAX_STREAM_CHUNK_BYTES);
  }

  const midSeek = parseByteRange('bytes=5000000-', size);
  assert.equal(midSeek.ok, true);
  if (midSeek.ok) {
    assert.equal(midSeek.status, 206);
    assert.equal(midSeek.start, 5_000_000);
    assert.equal(midSeek.end, 5_000_000 + MAX_STREAM_CHUNK_BYTES - 1);
    assert.equal(midSeek.length, MAX_STREAM_CHUNK_BYTES);
  }
});

test('honors explicit bounded Range under 3 MB and caps explicit Range over 3 MB', () => {
  const size = 10 * 1024 * 1024;

  const small = parseByteRange('bytes=1024-65535', size);
  assert.equal(small.ok, true);
  if (small.ok) {
    assert.equal(small.status, 206);
    assert.equal(small.start, 1024);
    assert.equal(small.end, 65535);
    assert.equal(small.length, 65535 - 1024 + 1);
  }

  const huge = parseByteRange('bytes=0-9000000', size);
  assert.equal(huge.ok, true);
  if (huge.ok) {
    assert.equal(huge.status, 206);
    assert.equal(huge.length, MAX_STREAM_CHUNK_BYTES);
    assert.equal(huge.end, MAX_STREAM_CHUNK_BYTES - 1);
  }
});

test('handles suffix byte ranges and rejects out-of-bounds ranges with 416', () => {
  const size = 10_000;

  const suffix = parseByteRange('bytes=-512', size);
  assert.equal(suffix.ok, true);
  if (suffix.ok) {
    assert.equal(suffix.status, 206);
    assert.equal(suffix.start, size - 512);
    assert.equal(suffix.end, size - 1);
    assert.equal(suffix.length, 512);
  }

  const pastEnd = parseByteRange('bytes=15000-', size);
  assert.equal(pastEnd.ok, false);
  if (!pastEnd.ok) assert.equal(pastEnd.status, 416);

  const reversed = parseByteRange('bytes=500-100', size);
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.equal(reversed.status, 416);

  const invalid = parseByteRange('items=0-5', size);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 416);
});
