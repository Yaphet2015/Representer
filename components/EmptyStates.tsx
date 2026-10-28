import { useT } from './i18n';
import { Button } from './bui/Button';

export function ErrorView({ error, retry, onChat }: { error: string; retry: () => void; onChat: () => void }) {
  const t = useT();
  return (
    <div className="space-y-3 p-6 text-center text-[13px] text-zinc-600">
      <p>{t.summaryFailed(error)}</p>
      <div className="flex justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={retry}>{t.retry}</Button>
        <Button variant="quiet" size="sm" onClick={onChat}>{t.chatNow}</Button>
      </div>
    </div>
  );
}

/** Shown after the automatic summary was cancelled: start it by hand, or go straight to the chat. */
export function NoOverview({ onStart, onChat }: { onStart: () => void; onChat: () => void }) {
  const t = useT();
  return (
    <div data-no-overview className="space-y-3 p-6 pt-10 text-center text-[13px] text-zinc-600">
      <p className="font-medium text-ink">{t.summaryCancelled}</p>
      <p className="leading-relaxed text-ink-3">{t.noOverviewHint}</p>
      <div className="flex justify-center gap-2">
        <Button variant="primary" size="sm" onClick={onStart}>{t.startSummary}</Button>
        <Button variant="secondary" size="sm" onClick={onChat}>{t.chatNow}</Button>
      </div>
    </div>
  );
}
