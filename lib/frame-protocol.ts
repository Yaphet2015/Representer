/** Message names + shared types for top ↔ background ↔ child-frame. No DOM / Defuddle. */
import type { Anchors, Fingerprint } from './locate';
import type { NestedFrameInfo } from './frames';

export const FRAME_HELLO = 'rp-frame-hello' as const;
export const FRAME_BYE = 'rp-frame-bye' as const;
export const FRAME_EXTRACT = 'rp-frame-extract' as const;
export const FRAME_LOCATE = 'rp-frame-locate' as const;
export const FRAME_PING = 'rp-frame-ping' as const;
export const FRAME_COLLECT = 'rp-frame-collect' as const;
export const FRAME_ACK = 'rp-frame-ack' as const;
/** window.postMessage probe from top → child (content script listens). */
export const FRAME_PROBE = 'rp-frame-probe' as const;
export const REPRESENTER_SOURCE = 'representer' as const;

export type FrameHelloMsg = { type: typeof FRAME_HELLO };
export type FrameByeMsg = { type: typeof FRAME_BYE };
export type FrameExtractMsg = { type: typeof FRAME_EXTRACT };
export type FrameLocateMsg = {
  type: typeof FRAME_LOCATE;
  fingerprint: Fingerprint;
  text?: string;
  expectHref?: string;
  expectDocSig?: string;
  expectGeneration?: string;
};
export type FramePingMsg = { type: typeof FRAME_PING };
/** Only exact chrome frameIds chosen by the top frame after probe — never "all hellos". */
export type FrameCollectMsg = { type: typeof FRAME_COLLECT; frameIds: number[]; timeoutMs: number };
export type FrameAckMsg = { type: typeof FRAME_ACK; nonce: string };

export type FrameExtractReply =
  | { ok: true; href: string; title: string; content: string; anchors: Anchors; nestedContentFrames: number; nestedFrames?: NestedFrameInfo[]; /** dev diagnostics builds only */ diagBlocks?: string[]; docSig: string }
  | { ok: false; error: string; href?: string };

export type FrameLocateReply =
  | { ok: true; found: boolean; href: string; docSig: string; /** element rect in the frame viewport after it centred itself */ rect?: { top: number; height: number }; matched?: string; exact?: boolean }
  | { ok: false; error: string; stale?: boolean; href?: string; docSig?: string };

export type FramePingReply = { ok: true; href: string; docSig: string } | { ok: false; error: string };

export type FrameCollectReply = {
  ok: true;
  frames: Array<
    | { frameId: number; href: string; title: string; content: string; anchors: Anchors; nestedContentFrames: number; nestedFrames?: NestedFrameInfo[]; /** dev diagnostics builds only */ diagBlocks?: string[]; docSig: string }
    | { frameId: number; error: string; href?: string }
  >;
} | { ok: false; error: string };

export type FrameAckReply = { ok: true } | { ok: false; error: string };

export function urlsLooselyEqual(a: string, b: string): boolean {
  try {
    const ua = new URL(a), ub = new URL(b);
    if (ua.origin !== ub.origin) return false;
    const pa = ua.pathname.replace(/\/$/, '') || '/';
    const pb = ub.pathname.replace(/\/$/, '') || '/';
    return pa === pb;
  } catch {
    return a === b;
  }
}

/** True only for the top frame of a tab (Chrome uses 0). */
export function isTopFrameId(frameId: number | undefined): boolean {
  return frameId === 0;
}

export function isFiniteFrameId(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v;
}
