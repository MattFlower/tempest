import type { ElectrobunConfig } from "electrobun/bun";

export default {
  app: {
    name: "Tempest",
    identifier: "com.tempest.app",
    version: "0.23.1",
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
      "src/bun/hooks/tempest-hook.ts": "bun/tempest-hook.ts",
      "src/bun/hooks/tempest-channel.ts": "bun/tempest-channel.ts",
      "src/bun/hooks/pi-tempest-extension.ts": "bun/pi-tempest-extension.ts",
      "node_modules/monaco-editor/min/vs": "views/main/monaco-editor/min/vs",
      "src/vendor/monaco-vim.bundle.js": "views/main/monaco-vim.bundle.js",
    },
    mac: {
      icons: "icon.iconset",
      codesign: true,
      notarize: false,
      entitlements: {
        "com.apple.security.device.microphone":
          "Tempest needs microphone access for Claude Code voice input.",
      },
    },
  },
} satisfies ElectrobunConfig;
