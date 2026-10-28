/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          sidebar: "var(--bg-sidebar)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
          active: "var(--bg-active)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent-primary)",
          hover: "var(--accent-hover)",
          light: "var(--accent-light)",
        },
        bubble: {
          in: "var(--bubble-in-bg)",
          inText: "var(--bubble-in-text)",
          out: "var(--bubble-out-bg)",
          outText: "var(--bubble-out-text)",
        },
        border: {
          subtle: "var(--border-subtle)",
          divider: "var(--border-divider)",
        },
      },
      borderRadius: {
        bubble: "var(--radius-bubble)",
        card: "var(--radius-card)",
      },
    },
  },
  plugins: [],
};
