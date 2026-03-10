import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#09090b",
          1: "#111113",
          2: "#18181b",
          3: "#27272a",
        },
        accent: {
          DEFAULT: "#f97316",
          muted: "#c2410c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
