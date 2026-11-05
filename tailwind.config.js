/** @type {import('tailwindcss').Config} */
export default {
  content: [new URL('./web/index.html', import.meta.url).pathname, new URL('./web/src', import.meta.url).pathname + '/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#030b1f', 900: '#061633', 850: '#081c40', 800: '#0b2350', 700: '#123170', 600: '#1a4296' },
        cyan: { 350: '#4fe0f0' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { glow: '0 0 0 1px rgba(79,224,240,.25), 0 8px 30px -8px rgba(34,211,238,.35)' },
    },
  },
  plugins: [],
};
