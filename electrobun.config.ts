import type { ElectrobunConfig } from "electrobun/bun";

export default {
  app: {
    name: "Tempest",
    identifier: "com.tempest.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      main: {
        entrypoint: "src/views/main/index.tsx",
      },
    },
    copy: {
      "node_modules/@xterm/xterm/css/xterm.css": "views/main/xterm.css",
      "src/views/main/styles/tailwind.css": "views/main/tailwind.css",
      "src/views/main/index.html": "views/main/index.html",
    },
    mac: {
      bundleCEF: true,
    },
  },
} satisfies ElectrobunConfig;
