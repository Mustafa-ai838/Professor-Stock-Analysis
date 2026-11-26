/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#050816",
          900: "#0a0e1a",
          800: "#0f1629",
          700: "#141c33",
          600: "#1a2342",
          500: "#1e293b",
        },
        card: {
          DEFAULT: "#111827",
          hover: "#1a2035",
          border: "#1e293b",
        },
        accent: {
          blue: "#3b82f6",
          green: "#10b981",
          red: "#ef4444",
          yellow: "#f59e0b",
          purple: "#8b5cf6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
