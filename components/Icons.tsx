import type { IconType } from '@/lib/types';
type P = { className?: string };
const S = (d: React.ReactNode) => ({ className = 'w-4 h-4' }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>{d}</svg>
);
export const Sparkle = S(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />);
export const Close = S(<path d="M6 6l12 12M18 6L6 18" />);
export const Refresh = S(<><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 5v6h-6" /></>);
export const Check = S(<path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={2.2} />);
export const Copy = S(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 017.5 4H15" /></>);
export const Send = S(<path d="M5 12h14M13 6l6 6-6 6" />);
export const BulletIcons: Record<IconType, (p: P) => React.JSX.Element> = {
  target: S(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>),
  lightbulb: S(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0012 3z" /></>),
  list: S(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />),
  chart: S(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  flag: S(<path d="M5 21V4h11l-1.5 4L16 12H5" />),
  book: S(<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16" />),
  warning: S(<><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17h.01" /></>),
  check: S(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>),
};

export const Fork = S(<><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M6 7v2a3 3 0 003 3h6a3 3 0 003-3V7M12 12v5" /></>);
export const ChatBubble = S(<path d="M5 6.5A2.5 2.5 0 017.5 4h9A2.5 2.5 0 0119 6.5v7a2.5 2.5 0 01-2.5 2.5H11l-4 3.5V16h0A2 2 0 015 14z" />);
export const Plus = S(<path d="M12 5v14M5 12h14" />);
export const Translate = S(<><path d="M4 5h8M8 3v2M6 5c0 4 2.5 7 6 8M10 5c-.5 3.5-3 6.5-6 8" /><path d="M13 21l4-9 4 9M14.5 18h5" /></>);
export const QuizIcon = S(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" /></>);
