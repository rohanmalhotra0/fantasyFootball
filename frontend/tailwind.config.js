/**
 * DraftEngine design system — "broadcast booth" dark-first theme.
 *
 * Accessibility contract (user has dyslexia + ADHD):
 *  - base font 18px+, line-height 1.7, Inter for body / Space Grotesk for
 *    display numbers and headings
 *  - color never carries meaning alone (icons/text always paired)
 *  - position hues are validated against both surfaces (dataviz method);
 *    in charts, position identity comes from small multiples or marker
 *    shape — never 4-hue all-pairs color
 *  - motion is decorative only and respects prefers-reduced-motion
 *
 * All colors flow through CSS custom properties (styles/index.css) so the
 * light/dark toggle swaps the whole system at :root.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Verdana', 'Segoe UI', 'Arial', 'sans-serif'],
        display: ['Space Grotesk', 'Inter Variable', 'sans-serif'],
      },
      fontSize: {
        base: ['1.125rem', { lineHeight: '1.7' }],
        lg: ['1.25rem', { lineHeight: '1.7' }],
        xl: ['1.5rem', { lineHeight: '1.5' }],
        '2xl': ['1.875rem', { lineHeight: '1.4' }],
        '3xl': ['2.375rem', { lineHeight: '1.25' }],
        '4xl': ['3rem', { lineHeight: '1.1' }],
      },
      colors: {
        bg: 'rgb(var(--de-bg) / <alpha-value>)',
        surface: 'rgb(var(--de-surface) / <alpha-value>)',
        raised: 'rgb(var(--de-raised) / <alpha-value>)',
        edge: 'rgb(var(--de-edge) / <alpha-value>)',
        ink: 'rgb(var(--de-ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--de-ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--de-ink-3) / <alpha-value>)',
        accent: 'rgb(var(--de-accent) / <alpha-value>)',
        'accent-2': 'rgb(var(--de-accent-2) / <alpha-value>)',
        good: 'rgb(var(--de-good) / <alpha-value>)',
        bad: 'rgb(var(--de-bad) / <alpha-value>)',
        warn: 'rgb(var(--de-warn) / <alpha-value>)',
        pos: {
          qb: 'rgb(var(--de-pos-qb) / <alpha-value>)',
          rb: 'rgb(var(--de-pos-rb) / <alpha-value>)',
          wr: 'rgb(var(--de-pos-wr) / <alpha-value>)',
          te: 'rgb(var(--de-pos-te) / <alpha-value>)',
          k: 'rgb(var(--de-pos-k) / <alpha-value>)',
          dst: 'rgb(var(--de-pos-dst) / <alpha-value>)',
        },
      },
      boxShadow: {
        glow: '0 0 24px -6px rgb(var(--de-accent) / 0.55)',
        'glow-sm': '0 0 12px -4px rgb(var(--de-accent) / 0.5)',
        card: '0 8px 30px -12px rgb(0 0 0 / 0.45)',
      },
      keyframes: {
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--de-accent) / 0.45)' },
          '50%': { boxShadow: '0 0 0 10px rgb(var(--de-accent) / 0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        ticker: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.35s ease-out both',
        'pulse-ring': 'pulse-ring 2s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        ticker: 'ticker 30s linear infinite',
      },
    },
  },
  plugins: [],
}
