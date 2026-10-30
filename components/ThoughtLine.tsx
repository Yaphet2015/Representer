import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * The status row's text while the model reasons: one line that rolls up as each new sentence finishes (the old line
 * slides up and out, the new one in from below). With reduced motion it crossfades instead. Single line, cut with "…".
 */
export function ThoughtLine({ line }: { line: string }) {
  const reduce = useReducedMotion();
  const move = reduce ? {} : { y: '100%' };
  const away = reduce ? {} : { y: '-100%' };
  return (
    <span data-thought className="relative block h-[18px] min-w-0 flex-1 overflow-hidden" title={line}>
      <AnimatePresence initial={false}>
        <motion.span
          key={line} data-thought-line
          initial={{ opacity: 0, ...move }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, ...away }}
          transition={{ duration: reduce ? 0.15 : 0.25, ease: [0.2, 0, 0, 1] }}
          className="absolute inset-0 truncate text-[13px] leading-[18px] text-ink-2"
        >{line}</motion.span>
      </AnimatePresence>
    </span>
  );
}
