import { describe, expect, it } from 'vitest';
import { bitDepthOf, isHdrTransfer } from './ffprobe.js';

describe('bitDepthOf', () => {
  it('reads the sample depth out of ffprobe pixel formats', () => {
    expect(bitDepthOf('yuv420p')).toBe(8);
    expect(bitDepthOf('yuv420p10le')).toBe(10);
    expect(bitDepthOf('yuv422p10le')).toBe(10);
    expect(bitDepthOf('yuv420p12le')).toBe(12);
    expect(bitDepthOf('p010le')).toBe(10);
    expect(bitDepthOf('nv12')).toBe(8);
    expect(bitDepthOf('gbrp10le')).toBe(10);
    expect(bitDepthOf(undefined)).toBeNull();
  });
});

describe('isHdrTransfer', () => {
  it('flags PQ and HLG only', () => {
    expect(isHdrTransfer('smpte2084')).toBe(true);
    expect(isHdrTransfer('arib-std-b67')).toBe(true);
    expect(isHdrTransfer('bt709')).toBe(false);
    expect(isHdrTransfer(undefined)).toBe(false);
  });
});
