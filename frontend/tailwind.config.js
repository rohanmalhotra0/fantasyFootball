/**
 * Accessibility-first theme.
 *
 * The user has dyslexia + ADHD, so the scale runs bigger than a default
 * Tailwind app and contrast is high everywhere. Rules used across the app:
 *  - base font 18px, draft-room key numbers larger still
 *  - color is never the only signal (pair with icon or label)
 *  - short labels, no walls of text
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Verdana', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        base: ['1.125rem', { lineHeight: '1.7' }],
        lg: ['1.25rem', { lineHeight: '1.7' }],
        xl: ['1.5rem', { lineHeight: '1.5' }],
        '2xl': ['1.875rem', { lineHeight: '1.4' }],
        '3xl': ['2.375rem', { lineHeight: '1.3' }],
      },
      colors: {
        // Positions get fixed hues (always paired with the position label)
        pos: {
          qb: '#c2410c',
          rb: '#15803d',
          wr: '#1d4ed8',
          te: '#7e22ce',
          k: '#a16207',
          dst: '#334155',
        },
      },
    },
  },
  plugins: [],
}
