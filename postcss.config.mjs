const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Old TV WebView fallbacks preset-env doesn't cover; must run between Tailwind and preset-env
    "./scripts/postcss-legacy-webview.cjs": {},
    "postcss-preset-env": {
      features: {
        "cascade-layers": true,
        "color-mix": true,
      },
      // Chrome 66: Android 9 / Amlogic TV WebViews
      browsers: "Safari >= 15, iOS >= 15, Chrome >= 66",
    },
    // Must run after preset-env
    "./scripts/postcss-legacy-where.cjs": {},
  },
};

export default config;
