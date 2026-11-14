/**
 * Картинка после обрезки/сжатия в вебе — это data:- или blob:-адрес. Читать его через fetch() нельзя:
 * политика безопасности сайта (CSP connect-src 'self') такие запросы блокирует («Failed to fetch»).
 * data: раскодируем сами, без сети.
 */
export async function uriToBlob(uri: string): Promise<Blob> {
  if (uri.startsWith('data:')) {
    const [head, body] = uri.split(',', 2);
    const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'image/jpeg';
    if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  // blob: разрешён в CSP (deploy/nginx/security-headers.conf)
  return (await fetch(uri)).blob();
}
