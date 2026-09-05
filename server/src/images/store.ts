import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_WIDTHS = [300, 780, 1280] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export type Fetcher = (url: string) => Promise<Response>;

/**
 * Artwork cache under DATA_DIR/images. Originals are stored once by key (a hash of the source
 * URL); resized variants are produced on first request and cached beside them as JPEG.
 */
export class ImageStore {
  constructor(
    private readonly dir: string,
    private readonly fetcher: Fetcher = (url) => fetch(url),
  ) {}

  static keyFor(sourceUrl: string): string {
    return createHash('sha1').update(sourceUrl).digest('hex');
  }

  originalPath(key: string): string {
    return path.join(this.dir, key.slice(0, 2), `${key}.jpg`);
  }

  variantPath(key: string, width: ImageWidth): string {
    return path.join(this.dir, key.slice(0, 2), `${key}_w${width}.jpg`);
  }

  /** Downloads sourceUrl unless already cached. Returns the key. Throws on a failed download. */
  async ensure(sourceUrl: string): Promise<string> {
    const key = ImageStore.keyFor(sourceUrl);
    const target = this.originalPath(key);
    if (existsSync(target)) return key;
    const res = await this.fetcher(sourceUrl);
    if (!res.ok) throw new Error(`image download failed: ${res.status} ${sourceUrl}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(target), { recursive: true });
    // Normalise to JPEG so every cached file has one format regardless of source.
    await writeFile(target, await sharp(buffer).jpeg({ quality: 90 }).toBuffer());
    return key;
  }

  /** Path of the image at the requested width (or the original), resizing and caching on demand. */
  async resolve(key: string, width: ImageWidth | null): Promise<string | null> {
    if (!/^[a-f0-9]{40}$/.test(key)) return null;
    const original = this.originalPath(key);
    if (!existsSync(original)) return null;
    if (width === null) return original;
    const variant = this.variantPath(key, width);
    if (!existsSync(variant)) {
      await sharp(original)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(variant);
    }
    return variant;
  }
}
