module.exports = {
  content: ['./entrypoints/**/*.{ts,tsx,html}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Beautiful UI tokens (https://www.beautifului.dev, MIT)
      colors: Object.fromEntries(['page','canvas','surface','inset','hover','hover-2','ink','ink-2','ink-3','line','line-strong','field','accent','accent-ink','accent-tint','accent-ring','green','red','red-tint'].map((k) => [k, `var(--${k})`])),
      boxShadow: { btn: 'var(--shadow-btn)', card: 'var(--shadow-card)', float: 'var(--shadow-float)' },
      borderRadius: { chip: '6px', control: '8px', card: '10px', window: '14px' },
      transitionTimingFunction: { 'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)' },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      keyframes: { shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } } },
      animation: { shimmer: 'shimmer 1.4s ease-in-out infinite' },
    },
  },
  plugins: [],
};
