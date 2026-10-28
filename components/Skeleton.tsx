const Bar = ({ w, h = 'h-3' }: { w: string; h?: string }) => (
  <div className={`relative ${h} overflow-hidden rounded-full bg-zinc-100`} style={{ width: w }}>
    <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/80 to-transparent" />
  </div>
);

/** line widths cycle so neighbouring groups don't look stamped from one mold */
const LINES = [['94%', '78%'], ['88%'], ['96%', '64%'], ['82%'], ['92%', '70%']];
const Group = ({ n }: { n: number }) => (
  <div>
    <div className="mb-2 flex items-center gap-2"><div className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-100" /><Bar w={`${34 + (n % 3) * 9}%`} h="h-3.5" /></div>
    <div className="ml-[4.5px] space-y-2.5 border-l-[1.5px] border-zinc-100 pl-[30px]">
      {[0, 1, 2 + (n % 2)].map((j) => (
        <div key={j} className="space-y-2">{LINES[(n + j) % LINES.length]!.map((w, k) => <Bar key={k} w={w} />)}</div>
      ))}
    </div>
  </div>
);

/**
 * Mirrors the overview's own layout (heading, paragraph, section groups) and always carries more groups than
 * a tall panel can show; the parent clips it, so the placeholder fills the whole screen and fades out at the bottom.
 */
export function Skeleton() {
  return (
    <div className="relative h-full overflow-hidden" aria-hidden>
      <div className="space-y-5 px-4 py-4">
        <div>
          <div className="mb-3 flex items-center gap-1.5"><div className="h-4 w-4 rounded-md bg-zinc-100" /><Bar w="22%" h="h-3.5" /></div>
          <div className="space-y-2.5"><Bar w="100%" /><Bar w="97%" /><Bar w="99%" /><Bar w="62%" /></div>
        </div>
        {Array.from({ length: 16 }, (_, n) => <Group key={n} n={n} />)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />
    </div>
  );
}
