/**
 * Background frame registry + message routing (pure enough to unit-test with a fake sender/tabs API).
 * COLLECT only extracts the exact frameIds the top frame probed — never every hello'd frame.
 */
import {
  FRAME_ACK, FRAME_BYE, FRAME_COLLECT, FRAME_EXTRACT, FRAME_HELLO, FRAME_LOCATE, FRAME_PING,
  isFiniteFrameId, isTopFrameId,
  type FrameAckMsg, type FrameCollectMsg, type FrameExtractReply, type FrameLocateReply, type FramePingReply,
} from './frame-protocol';

export type FrameInfo = { href: string; isTop: boolean };

export interface FrameRelayTabs {
  sendMessage(tabId: number, msg: object, opts: { frameId: number }): Promise<unknown>;
}

export interface FrameRelaySender {
  tabId?: number;
  frameId?: number;
  /** Trusted URL from Chrome for this content-script frame */
  url?: string;
}

type PendingAck = {
  tabId: number;
  resolve: (v: { frameId: number; href: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function createFrameRelay(tabs: FrameRelayTabs, opts?: { ackTimeoutMs?: number }) {
  const tabFrames = new Map<number, Map<number, FrameInfo>>();
  const pendingAcks = new Map<string, PendingAck>();
  const ackTimeoutMs = opts?.ackTimeoutMs ?? 2000;

  function remember(tabId: number, frameId: number, info: FrameInfo) {
    let m = tabFrames.get(tabId);
    if (!m) tabFrames.set(tabId, (m = new Map()));
    m.set(frameId, info);
  }
  function forget(tabId: number, frameId: number) {
    const m = tabFrames.get(tabId);
    if (!m) return;
    m.delete(frameId);
    if (!m.size) tabFrames.delete(tabId);
  }
  function dropTab(tabId: number) {
    tabFrames.delete(tabId);
    for (const [nonce, p] of pendingAcks) {
      if (p.tabId === tabId) {
        clearTimeout(p.timer);
        pendingAcks.delete(nonce);
        p.reject(new Error('tab closed'));
      }
    }
  }

  function requireTop(sender: FrameRelaySender): string | null {
    if (sender.tabId == null) return 'missing tab';
    if (!isTopFrameId(sender.frameId)) return 'top frame only';
    return null;
  }

  async function askFrame<T>(tabId: number, frameId: number, msg: object): Promise<T> {
    return await tabs.sendMessage(tabId, msg, { frameId }) as T;
  }

  /**
   * Handle one runtime message. Returns:
   * - `{ async: true }` if reply will be called asynchronously
   * - `{ handled: false }` if not a frame message
   * - otherwise calls reply synchronously via returned promise settle — use handle() wrapper
   */
  function handle(
    msg: any,
    sender: FrameRelaySender,
    reply: (r: object) => void,
  ): boolean {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;

    if (msg.type === FRAME_HELLO) {
      if (sender.tabId == null || sender.frameId == null) {
        reply({ ok: false, error: 'missing sender' });
        return true;
      }
      const href = typeof sender.url === 'string' && sender.url ? sender.url : '';
      remember(sender.tabId, sender.frameId, { href, isTop: isTopFrameId(sender.frameId) });
      reply({ ok: true });
      return true;
    }

    if (msg.type === FRAME_BYE) {
      if (sender.tabId != null && sender.frameId != null) forget(sender.tabId, sender.frameId);
      reply({ ok: true });
      return true;
    }

    if (msg.type === FRAME_ACK) {
      const nonce = typeof (msg as FrameAckMsg).nonce === 'string' ? (msg as FrameAckMsg).nonce : '';
      if (!nonce || sender.tabId == null || sender.frameId == null) {
        reply({ ok: false, error: 'invalid ack' });
        return true;
      }
      const pending = pendingAcks.get(nonce);
      if (!pending || pending.tabId !== sender.tabId) {
        reply({ ok: false, error: 'unknown nonce' });
        return true;
      }
      clearTimeout(pending.timer);
      pendingAcks.delete(nonce);
      const href = typeof sender.url === 'string' ? sender.url : '';
      remember(sender.tabId, sender.frameId, { href, isTop: isTopFrameId(sender.frameId) });
      pending.resolve({ frameId: sender.frameId, href });
      reply({ ok: true });
      return true;
    }

    if (msg.type === FRAME_COLLECT) {
      const gate = requireTop(sender);
      if (gate) { reply({ ok: false, error: gate }); return true; }
      const tabId = sender.tabId!;
      const req = msg as FrameCollectMsg;
      const timeoutMs = Math.max(200, Math.min(Number(req.timeoutMs) || 3000, 8000));
      const ids = Array.isArray(req.frameIds) ? req.frameIds.filter(isFiniteFrameId) : [];
      // Dedupe while preserving order; never expand to "all registered frames".
      const seen = new Set<number>();
      const frameIds = ids.filter((id) => {
        if (seen.has(id) || isTopFrameId(id)) return false;
        seen.add(id);
        return true;
      });
      (async () => {
        const registered = tabFrames.get(tabId) ?? new Map();
        const tasks = frameIds.map(async (frameId) => {
          if (!registered.has(frameId)) {
            return { frameId, error: 'unknown frame' };
          }
          try {
            const r = await Promise.race([
              askFrame<FrameExtractReply>(tabId, frameId, { type: FRAME_EXTRACT }),
              new Promise<FrameExtractReply>((resolve) =>
                setTimeout(() => resolve({ ok: false, error: 'timeout', href: registered.get(frameId)?.href }), timeoutMs)),
            ]);
            if (!r.ok) return { frameId, error: r.error, href: r.href };
            return {
              frameId,
              href: r.href,
              title: r.title,
              content: r.content,
              anchors: r.anchors,
              nestedContentFrames: r.nestedContentFrames,
              nestedFrames: Array.isArray(r.nestedFrames) ? r.nestedFrames.slice(0, 20) : undefined,
              ...(Array.isArray(r.diagBlocks) ? { diagBlocks: r.diagBlocks } : {}),
              docSig: r.docSig,
            };
          } catch (e: any) {
            return { frameId, error: String(e?.message ?? e), href: registered.get(frameId)?.href };
          }
        });
        reply({ ok: true, frames: await Promise.all(tasks) });
      })();
      return true;
    }

    if (msg.type === FRAME_LOCATE) {
      const gate = requireTop(sender);
      if (gate) { reply({ ok: false, error: gate }); return true; }
      const tabId = sender.tabId!;
      if (!isFiniteFrameId(msg.frameId)) { reply({ ok: false, error: 'invalid frameId' }); return true; }
      const frameId = msg.frameId as number;
      if (isTopFrameId(frameId)) { reply({ ok: false, error: 'use top document locally' }); return true; }
      (async () => {
        try {
          const r = await askFrame<FrameLocateReply>(tabId, frameId, {
            type: FRAME_LOCATE,
            fingerprint: msg.fingerprint,
            text: msg.text,
            expectHref: msg.expectHref,
            expectDocSig: msg.expectDocSig,
            expectGeneration: msg.expectGeneration,
          });
          reply(r);
        } catch (e: any) {
          reply({ ok: false, error: String(e?.message ?? e) });
        }
      })();
      return true;
    }

    if (msg.type === FRAME_PING) {
      const gate = requireTop(sender);
      if (gate) { reply({ ok: false, error: gate }); return true; }
      if (!isFiniteFrameId(msg.frameId)) { reply({ ok: false, error: 'invalid frameId' }); return true; }
      const tabId = sender.tabId!;
      (async () => {
        try {
          reply(await askFrame<FramePingReply>(tabId, msg.frameId, { type: FRAME_PING }));
        } catch (e: any) {
          reply({ ok: false, error: String(e?.message ?? e) });
        }
      })();
      return true;
    }

    // Top registers a probe nonce; child ACK resolves it.
    if (msg.type === 'rp-frame-wait-ack') {
      const gate = requireTop(sender);
      if (gate) { reply({ ok: false, error: gate }); return true; }
      const nonce = typeof msg.nonce === 'string' ? msg.nonce : '';
      if (!nonce || nonce.length > 128) { reply({ ok: false, error: 'invalid nonce' }); return true; }
      if (pendingAcks.has(nonce)) { reply({ ok: false, error: 'nonce in use' }); return true; }
      const tabId = sender.tabId!;
      (async () => {
        try {
          const result = await new Promise<{ frameId: number; href: string }>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingAcks.delete(nonce);
              reject(new Error('ack timeout'));
            }, ackTimeoutMs);
            pendingAcks.set(nonce, { tabId, resolve, reject, timer });
          });
          reply({ ok: true, ...result });
        } catch (e: any) {
          reply({ ok: false, error: String(e?.message ?? e) });
        }
      })();
      return true;
    }

    return false;
  }

  return {
    handle,
    dropTab,
    /** test helpers */
    _frames: tabFrames,
    _pendingAcks: pendingAcks,
  };
}

export type FrameRelay = ReturnType<typeof createFrameRelay>;
