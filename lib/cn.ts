import { twMerge } from 'tailwind-merge';
// twMerge so caller overrides (e.g. `w-12` over a base `w-full`) actually win
// instead of both classes landing in the DOM and CSS order deciding.
export const cn = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(' '));
