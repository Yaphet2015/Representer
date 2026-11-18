/** Tiny entry contract. Keep PDF.js out of the content script and background. */
export const PDF_DOCUMENT = 'rp-document-kind';
export const PDF_PING = 'rp-document-ping';
export const PDF_CONTEXT = 'rp-pdf-context';
export interface PdfGrant { tabId: number; url: string; token: string }
export interface PdfAuthorization extends PdfGrant { at: number }
export type PdfContext = { kind: 'pdf'; grant: PdfGrant } | { kind: 'web' } | { kind: 'none' };
export function isPdfContext(v: unknown): v is PdfContext {
  if (!v || typeof v !== 'object' || !('kind' in v)) return false;
  if (v.kind === 'web' || v.kind === 'none') return true;
  if (v.kind !== 'pdf' || !('grant' in v) || !v.grant || typeof v.grant !== 'object') return false;
  const g = v.grant;
  return 'tabId' in g && Number.isInteger(g.tabId) && 'url' in g && typeof g.url === 'string' && 'token' in g && typeof g.token === 'string';
}
/** Only a URL selected by the user is ever fetched. Reject known local/internal names and literal private IPs.
 * This is not DNS resolution; a user-selected public hostname can still resolve to an internal address. */
export function publicPdfUrl(raw: string): string | null {
  try {
    const u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(h) || h.endsWith('.localhost')) return null;
    if (h.startsWith('[')) return null; // conservative: no literal IPv6 in v1
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const n = h.split('.').map(Number), a = n[0]!, b = n[1]!;
      if ([0, 10, 127].includes(a) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && [18, 19].includes(b))) return null;
    }
    u.hash = ''; return u.href;
  } catch { return null; }
}
export function isPdfAuthorization(v: unknown): v is PdfAuthorization {
  return isPdfContext({ kind: 'pdf', grant: v }) && !!v && typeof v === 'object' && 'at' in v && typeof v.at === 'number' && Number.isFinite(v.at);
}
export const pdfCacheUrl = (url: string) => `pdf:v1:${url}`;
