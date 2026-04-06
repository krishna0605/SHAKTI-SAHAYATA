/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--primary-foreground)',
        },
        shakti: {
          50:  '#edf4ff',
          100: '#dbe8ff',
          200: '#bdd0ff',
          300: '#91b0ff',
          400: '#648cff',
          500: '#3f67f2',
          600: '#2443cb',
          700: '#1d348f',
          800: '#172a72',
          900: '#122153',
          950: '#0a1333',
        },
        police: {
          navy: '#102257',
          royal: '#1c3f9e',
          gold: '#d5a11e',
          saffron: '#e38b17',
          crimson: '#b61f2a',
          ivory: '#f6f0df',
        },
        surface: {
          50:  '#f8f5ed',
          100: '#f0ebdd',
          200: '#ddd6c0',
          800: '#172142',
          850: '#121936',
          900: '#0b1229',
          950: '#060b1a',
        },
        status: {
          active: '#10b981',
          closed: '#6b7280',
          archived: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 24px rgba(28, 63, 158, 0.18)',
        'glow-lg': '0 0 56px rgba(213, 161, 30, 0.2)',
        'card': '0 12px 40px rgba(6, 11, 26, 0.12)',
        'card-hover': '0 18px 48px rgba(6, 11, 26, 0.2)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        meteor: {
          '0%': { transform: 'rotate(215deg) translateX(0)', opacity: '1' },
          '70%': { opacity: '1' },
          '100%': { transform: 'rotate(215deg) translateX(-500px)', opacity: '0' },
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'float': 'float 5s ease-in-out infinite',
        'shimmer': 'shimmer 1.8s linear infinite',
        'meteor-effect': 'meteor 5s linear infinite',
      },
    },
  },
  plugins: [],
}
