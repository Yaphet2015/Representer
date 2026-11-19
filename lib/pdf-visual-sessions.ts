/** In-memory PDF visual sessions for the service worker. Never written to chrome.storage. */
import { pdfCacheUrl } from './pdf-contract';
import type { PdfVisualSession } from './pdf-visual';

const sessions = new Map<string, PdfVisualSession>();

export function visualSessionKey(sourceUrl: string): string {
  return sourceUrl.startsWith('pdf:v1:') ? sourceUrl : pdfCacheUrl(sourceUrl);
}

export function visualSession(url: string): PdfVisualSession | undefined {
  return sessions.get(visualSessionKey(url));
}

export async function setVisualSession(url: string, session: PdfVisualSession): Promise<void> {
  const key = visualSessionKey(url);
  const prev = sessions.get(key);
  sessions.set(key, session);
  if (prev && prev !== session) await prev.close().catch(() => {});
}

export async function closeVisualSession(url: string): Promise<void> {
  const key = visualSessionKey(url);
  const prev = sessions.get(key);
  sessions.delete(key);
  if (prev) await prev.close().catch(() => {});
}
