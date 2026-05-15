const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        ink: '#07111f',
        panel: '#101b2f',
        panelSoft: '#17243a',
        fromtherm: {
          blue: '#2563eb',
          cyan: '#06b6d4',
          red: '#9f1239',
          green: '#10b981',
          amber: '#f59e0b',
        },
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(37, 99, 235, 0.35)',
      },
    },
  },
  plugins: [],
};
