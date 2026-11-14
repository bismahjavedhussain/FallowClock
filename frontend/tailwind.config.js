/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        soil:    { bare: '#8a6240', dry: '#a67c52', dark: '#4a3728' },
        canopy:  { deep: '#1f6f43', mid: '#2f9e5f', light: '#6fcf8f' },
        residue: { base: '#c9a227', light: '#e3c35c' },
        risk:    { high: '#d4452e', mid: '#e8894a' },
        ink:     { DEFAULT: '#14110e', soft: '#6b625a' },
        paper:   { DEFAULT: '#faf7f2', card: '#ffffff' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
