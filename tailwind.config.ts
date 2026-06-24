import type { Config } from "tailwindcss";

// Palette modeled on the SignFlow reference: light gray canvas, white cards,
// subtle gray borders, a single indigo accent, restrained status colors.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f6f7f9", // app background
        cream: "#f6f7f9", // legacy alias used as subtle hover/background
        ink: "#1a1d24", // primary text / dark surfaces
        brand: {
          DEFAULT: "#4338ca",
          dark: "#372fb0",
          light: "#5b51e0",
          soft: "#eef0fc",
        },
        line: {
          DEFAULT: "#e9ebef",
          soft: "#eef0f3",
          input: "#e3e6ea",
        },
        muted: {
          DEFAULT: "#6b7382",
          light: "#9aa3b2",
          dark: "#41474f",
        },
        // restrained accents for stat tiles / statuses
        purple: { DEFAULT: "#5b51e0", soft: "#eef0fc" },
        amber: { DEFAULT: "#b45309", deep: "#92400e", soft: "#fbf0df" },
        teal: { DEFAULT: "#0e7490", soft: "#e2f1f5" },
        ok: { DEFAULT: "#15803d", soft: "#e7f5ec" },
        danger: { DEFAULT: "#c5333a", soft: "#fdebec" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "12px",
        tile: "9px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04)",
        brand: "0 1px 2px rgba(67,56,202,.25)",
        "brand-lg": "0 6px 16px rgba(67,56,202,.28)",
        toast: "0 12px 30px rgba(16,24,40,.18)",
        pop: "0 10px 34px rgba(16,24,40,.14)",
      },
      keyframes: {
        pop: {
          from: { transform: "scale(.97) translateY(6px)", opacity: "0" },
          to: { transform: "scale(1) translateY(0)", opacity: "1" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        spin: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        pop: "pop .18s ease",
        fade: "fade .2s ease",
        spin: "spin .8s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
