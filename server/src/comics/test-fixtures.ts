// Builds small comic books for tests: real PNG pages in CBZ, CB7 and CBT, and a PDF.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import sharp from 'sharp';
import yazl from 'yazl';
import { sevenZipPath } from './archive.js';

export interface FixturePage {
  name: string;
  width?: number;
  height?: number;
}

export function png(width = 40, height = 60, red = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: red, g: 30, b: 30 } } })
    .png()
    .toBuffer();
}

export async function makeCbz(
  file: string,
  pages: FixturePage[],
  extra: Record<string, string> = {},
): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const p of pages) zip.addBuffer(await png(p.width, p.height), p.name);
  for (const [name, text] of Object.entries(extra)) zip.addBuffer(Buffer.from(text), name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const c of zip.outputStream) chunks.push(c as Buffer);
  await writeFile(file, Buffer.concat(chunks));
}

/** A .cb7 or .cbt built with the bundled 7-Zip from the pages laid out in a temp folder. */
export async function makeWith7z(
  file: string,
  type: '7z' | 'tar',
  pages: FixturePage[],
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'comic-src-'));
  try {
    for (const p of pages) {
      const target = path.join(dir, p.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await png(p.width, p.height));
    }
    await execa(await sevenZipPath(), ['a', `-t${type}`, path.resolve(file), '.'], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A minimal valid PDF with blank pages of the given sizes in points. */
export async function makePdf(file: string, sizes: [number, number][]): Promise<void> {
  const objects: string[] = [];
  const kids = sizes.map((_, i) => `${3 + i} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${sizes.length} >>`);
  for (const [w, h] of sizes)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(file, out, 'latin1');
}
