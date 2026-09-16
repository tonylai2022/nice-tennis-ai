/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0f172a',
        card: '#111827',
        accent: '#22c55e',
        accentBlue: '#3b82f6',
      },
    },
  },
  plugins: [],
};
