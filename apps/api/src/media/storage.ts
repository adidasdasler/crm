import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config';

/**
 * Хранилище файлов. Сейчас — диск сервера (том Docker `uploads`, попадает в зашифрованный бэкап).
 * Интерфейс общий, чтобы позже переключиться на S3 (например, Selectel) без изменения остального кода.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

/** Ключ: <tenantId>/<uuid>-(full|thumb).jpg — никаких «..» и чужих путей */
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-(full|thumb)\.jpg$/;
const PREFIX_RE = /^[0-9a-f-]{36}$/;

class LocalStorage implements FileStorage {
  private readonly root = resolve(env.UPLOADS_DIR);
  private path(key: string) {
    if (!KEY_RE.test(key)) throw new Error('bad storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('bad storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
  async removePrefix(prefix: string) {
    if (!PREFIX_RE.test(prefix)) throw new Error('bad storage prefix');
    await rm(join(this.root, prefix), { recursive: true, force: true });
  }
}

export const storage: FileStorage = new LocalStorage();

/**
 * Проверить, что это JPEG (по содержимому, а не по расширению), вырезать метаданные
 * (EXIF/XMP с координатами GPS и моделью телефона, IPTC, комментарии) и узнать размеры.
 * Возвращает null, если файл не JPEG или повреждён.
 */
export function cleanJpeg(buf: Buffer): { data: Buffer; width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2, width = 0, height = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); break; } // EOI
    if (marker === 0xda) { out.push(buf.subarray(i)); break; } // SOS: дальше сжатые данные — копируем как есть
    if (marker >= 0xd0 && marker <= 0xd7) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    // SOF0..SOF15 (кроме DHT/JPG/DAC) — размеры кадра
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      height = buf.readUInt16BE(i + 5);
      width = buf.readUInt16BE(i + 7);
    }
    // Выбрасываем APP1 (EXIF/XMP), APP2–APP15 кроме ICC-профиля (APP2 оставляем ради цветов), COM
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe;
    if (!drop) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (!width || !height) return null;
  return { data: Buffer.concat(out), width, height };
}
