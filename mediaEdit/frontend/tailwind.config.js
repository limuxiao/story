/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // demo 原有硬编码色值收敛为语义 token，组件里统一用 className 引用。
      colors: {
        me: {
          bg: "#1e1e23",
          app: "#232329",
          panel: "#19191e",
          surface: "#26262d",
          raised: "#2e2e35",
          track: "#28282e",
          "track-active": "#303035",
          line: "#2a2a2c",
          divider: "#2a2a2e",
          border: "#3a3a42",
          minor: "#343337",
          major: "#505057",
          text: "#fafafa",
          dim: "#aeaeb2",
          mute: "#7c7c84",
          soft: "#8a8a92",
          primary: "#308dff",
          "primary-hover": "#1f7ae5",
          blue: "#2563eb",
          warn: "#f4d000",
          violet: "#7562ff",
          green: "#43cc8b",
          red: "#e06c6c",
          "red-soft": "#fca5a5",
          "red-bg": "#3a2020",
          stage: "#0b0b0f",
          disabled: "#55555c",
          select: "#eeeeee",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};
