// SVG icons for external apps used in the "Open In" dropdown.

export const editorIcons: Record<string, React.ReactNode> = {
  // --- Editors ---
  cursor: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#000" />
      <path d="M6 6l12 6-7 2-2 7L6 6z" fill="#fff" />
    </svg>
  ),
  intellij: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#000" />
      <rect x="4" y="4" width="16" height="16" fill="#000" />
      <rect x="5" y="17" width="8" height="2" fill="#fff" />
      <text x="5.5" y="14" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="sans-serif">IJ</text>
    </svg>
  ),
  neovim: (
    <svg className="w-4 h-4" viewBox="0 0 742 886" fill="none">
      <path d="M0 886V0l357 446V0h385v886L385 440v446H0z" fill="#57A143" />
      <path d="M0 886V0l357 446V0" fill="#57A143" />
      <path d="M385 886V440L742 886V0H385" fill="#57A143" />
      <path d="M357 0L0 0v886l357-446" fill="#222" fillOpacity="0.13" />
    </svg>
  ),
  vscode: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <path d="M17.5 0L7 9l-4-3.5L0 7v10l3 1.5 4-3.5 10.5 9L24 21V3l-6.5-3z" fill="#007ACC" />
      <path d="M0 7l3-1.5 4 3.5L17.5 0 7 9 0 7z" fill="#1F9CF0" />
      <path d="M7 15l-4 3.5L0 17V7l7 8z" fill="#0065A9" />
      <path d="M17.5 24L7 15l10-6v15l7.5 3L24 21V3l-6.5 21z" fill="#007ACC" />
      <path d="M17.5 0L24 3v18l-6.5-21z" fill="#1F9CF0" />
    </svg>
  ),
  xcode: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#147EFB" />
      <path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="#fff" strokeWidth="1.5" />
    </svg>
  ),
  zed: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#1e88e5" />
      <path d="M6 8h12L6 16h12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),

  // --- Terminals ---
  alacritty: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#F46D23" />
      <path d="M12 4l6 16h-3.5L12 12.5 9.5 20H6l6-16z" fill="#fff" />
    </svg>
  ),
  "apple-terminal": (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#000" />
      <path d="M6 8l5 4-5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12 17h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  ghostty: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#1a1a2e" />
      <path d="M7 7c0-2 2-3 5-3s5 1 5 3v7c0 3-2 6-5 6s-5-3-5-6V7z" fill="#e0e0e0" />
      <circle cx="10" cy="9" r="1.5" fill="#1a1a2e" />
      <circle cx="14" cy="9" r="1.5" fill="#1a1a2e" />
      <path d="M9 13h6" stroke="#1a1a2e" strokeWidth="1" strokeLinecap="round" strokeDasharray="1.5 1.5" />
    </svg>
  ),
  "gnome-terminal": (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#2E3436" />
      <path d="M6 8l5 4-5 4" stroke="#4E9A06" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12 17h6" stroke="#4E9A06" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  iterm2: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#000" />
      <rect x="4" y="4" width="16" height="16" rx="2" fill="#0B3B0B" />
      <path d="M7 9l4 3-4 3" stroke="#33FF33" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12 16h5" stroke="#33FF33" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  kitty: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#23211E" />
      <path d="M6 18V8l3-4v6l3-3 3 3V4l3 4v10" stroke="#E8C547" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="9.5" cy="13" r="1" fill="#E8C547" />
      <circle cx="14.5" cy="13" r="1" fill="#E8C547" />
    </svg>
  ),
  wezterm: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#4E49EE" />
      <path d="M6 8l5 4-5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12 17h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  // --- File Managers ---
  dolphin: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#1D99F3" />
      <path d="M4 10h16v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" fill="#fff" />
      <path d="M4 10l2-4h12l2 4" stroke="#fff" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  explorer: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#F0C808" />
      <path d="M4 8h7l2 2h7v10H4V8z" fill="#F9DC5C" stroke="#C8A200" strokeWidth="0.5" />
      <path d="M4 8v-2h7l2 2" fill="#F9DC5C" stroke="#C8A200" strokeWidth="0.5" />
    </svg>
  ),
  finder: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#4AABF0" />
      <rect x="5" y="3" width="14" height="18" rx="2" fill="#fff" />
      <circle cx="9.5" cy="10" r="1.5" fill="#333" />
      <circle cx="14.5" cy="10" r="1.5" fill="#333" />
      <path d="M9 14.5c0 1.5 1.5 2.5 3 2.5s3-1 3-2.5" stroke="#333" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M12 8V13" stroke="#333" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  nautilus: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#3D3846" />
      <path d="M4 10h16v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8z" fill="#E5E1D8" />
      <path d="M4 10l2-4h12l2 4" stroke="#E5E1D8" strokeWidth="1.5" fill="none" />
    </svg>
  ),
};
