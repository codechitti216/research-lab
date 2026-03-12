/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      lineHeight: {
        body: '1.6',
        heading: '1.3',
      },
      letterSpacing: {
        'track-label': '0.025em',
      },
      colors: {
        background: '#ffffff',
        foreground: '#0f0f0f',
        border: '#e8e8e8',
        dark: {
          bg: '#0f0f0f',
          surface: '#1f1f1f',
          raised: '#2d2d2d',
          border: 'rgba(255, 255, 255, 0.1)',
        },
        emerald: {
          100: '#d1fae5',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          800: '#065f46',
        },
        glass: {
          panel: 'rgba(15, 23, 42, 0.85)',
          border: 'rgba(255, 255, 255, 0.1)',
          card: 'rgba(59, 130, 246, 0.45)',
        },
        space: {
          top: '#050816',
          mid: '#02010a',
          base: '#000000',
        },
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 18px 35px rgba(15, 23, 42, 0.8)',
        'card-hover': '0 22px 45px rgba(15, 23, 42, 0.9)',
        emerald: '0 0 0 1px rgba(52, 211, 153, 0.35), 0 12px 24px rgba(16, 185, 129, 0.25)',
      },
      transitionDuration: {
        fast: '120ms',
        normal: '200ms',
      },
      backdropBlur: {
        panel: '12px',
      },
    },
  },
  plugins: [],
};

