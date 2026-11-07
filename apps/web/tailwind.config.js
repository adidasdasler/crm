/** Бренд MioFlow: ультрамарин, пудра, ночь (docs/BRAND.md) */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#F3F4FF', 100: '#E6E8FF', 200: '#CDD1FF', 500: '#4A55FF', 600: '#2F3BFF', 700: '#1F28D6', 900: '#0E0F2B' },
        blush: { 100: '#FFE3EB', 300: '#FFC7D6' },
        ink: { DEFAULT: '#0E0F2B', muted: '#5A5E7E' },
        paper: '#F7F7FC',
      },
      fontFamily: {
        sans: ['"Golos Text"', 'system-ui', 'sans-serif'],
        display: ['"Yeseva One"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
