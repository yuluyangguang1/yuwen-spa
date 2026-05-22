/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 足韵配色：中国风 + 现代感
        ink: {
          DEFAULT: '#1a1a1a',
          muted: '#6b6b6b',
          light: '#a3a3a3',
        },
        paper: {
          DEFAULT: '#fafaf7',
          warm: '#f5f0e8',
        },
        tan: {
          DEFAULT: '#a0826d',
          light: '#c8a882',
          dark: '#7a5f4f',
        },
        moss: '#5a7a5a',
        cinnabar: '#8b3a3a',
        gold: '#b8860b',
      },
      fontFamily: {
        sans: ['"LXGW WenKai"', 'system-ui', 'sans-serif'],
        display: ['"Ma Shan Zheng"', 'cursive'],
      },
      borderRadius: {
        lg: '0.75rem',
        xl: '1rem',
      },
    },
  },
  plugins: [],
}
