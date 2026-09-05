import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectHardware } from './hardware.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-hw-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeFfmpeg(name: string, exitCode: number, stderr = ''): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${stderr ? `echo "${stderr}" >&2\n` : ''}exit ${exitCode}\n`);
  chmodSync(file, 0o755);
  return file;
}
const device = (() => {
  const d = path.join(dir, 'renderD128');
  writeFileSync(d, '');
  return d;
})();

describe('detectHardware', () => {
  it('honours the explicit settings without probing', async () => {
    expect(
      await detectHardware({
        ffmpegPath: '/nonexistent',
        vaapiDevice: device,
        hardwareAccel: 'none',
      }),
    ).toMatchObject({ encoder: null });
    expect(
      await detectHardware({
        ffmpegPath: '/nonexistent',
        vaapiDevice: device,
        hardwareAccel: 'vaapi',
      }),
    ).toMatchObject({ encoder: 'vaapi' });
  });

  it('falls back to software when the render node is missing', async () => {
    const r = await detectHardware({
      ffmpegPath: 'ffmpeg',
      vaapiDevice: path.join(dir, 'missing'),
      hardwareAccel: 'auto',
    });
    expect(r.encoder).toBeNull();
    expect(r.reason).toContain('does not exist');
  });

  it('enables vaapi when the self-test encode succeeds', async () => {
    const r = await detectHardware({
      ffmpegPath: fakeFfmpeg('ok.sh', 0),
      vaapiDevice: device,
      hardwareAccel: 'auto',
    });
    expect(r).toMatchObject({ encoder: 'vaapi' });
    expect(r.reason).toContain('passed');
  });

  it('falls back with the ffmpeg error when the self-test fails', async () => {
    const r = await detectHardware({
      ffmpegPath: fakeFfmpeg(
        'fail.sh',
        1,
        'Failed to initialise VAAPI connection: -1 (unknown libva error).',
      ),
      vaapiDevice: device,
      hardwareAccel: 'auto',
    });
    expect(r.encoder).toBeNull();
    expect(r.reason).toContain('libva');
  });

  it('with the real ffmpeg on a machine without /dev/dri it stays on libx264', async () => {
    const r = await detectHardware({
      ffmpegPath: 'ffmpeg',
      vaapiDevice: '/dev/dri/renderD128',
      hardwareAccel: 'auto',
    });
    if (process.platform === 'darwin') expect(r.encoder).toBeNull();
    else expect(['vaapi', null]).toContain(r.encoder);
  });
});
