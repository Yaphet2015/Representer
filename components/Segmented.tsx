import { SegmentedControl } from './bui/SegmentedControl';
import { useT } from './i18n';
export type Tab = 'overview' | 'chat';

/** The panel's primary navigation. `generating` marks the overview as still being written while the chat is shown. */
export function Segmented({ value, onChange, generating = false, compact = false }: { value: Tab; onChange: (t: Tab) => void; generating?: boolean; compact?: boolean }) {
  const m = useT();
  return (
    <SegmentedControl<Tab>
      label={m.tabsLabel} value={value} onChange={onChange} compact={compact}
      items={[
        {
          id: 'overview', label: m.tabOverview,
          badge: generating && (
            <>
              <span data-generating aria-hidden className="ml-1.5 size-1.5 shrink-0 rounded-full bg-accent animate-[pulse_1.4s_cubic-bezier(0.4,0,0.6,1)_infinite] motion-reduce:animate-none" />
              <span className="sr-only">{m.summarizing}</span>
            </>
          ),
        },
        { id: 'chat', label: m.tabChat },
      ]}
    />
  );
}
