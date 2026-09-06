// Trap Chat — Design tokens
// The app is a doomscroll replacement, so it borrows TikTok's visual language:
// a pure black ground, white type, and exactly one hot accent used sparingly.
// Everything is defined here so a screen never invents its own grey.

export const T = {
  // GROUNDS
  bg: '#000000',            // the feed itself, always pure black
  surface: '#121212',       // cards, sheets, the web sidebar
  surfaceHi: '#1f1f1f',     // pressed and hovered rows
  border: 'rgba(255,255,255,0.12)',

  // TYPE
  text: '#ffffff',
  textDim: '#a1a1a1',       // captions, counts, secondary rows
  textFaint: '#6b6b6b',     // timestamps and hints

  // ACCENTS
  accent: '#FE2C55',        // TikTok red: primary action, active nav, likes
  accentCyan: '#25F4EE',    // used only for the chromatic-split brand mark
  danger: '#FE2C55',
  live: '#FE2C55',

  // SHAPE
  radius: 8,                // TikTok is much squarer than the old design
  radiusPill: 999,

  // CHROME SIZES
  sidebarWidth: 240,
  sidebarWide: 300,
  tabBarHeight: 52,
  railGap: 20,
} as const;

// The breakpoint where the phone layout gives way to the web layout: a left
// sidebar and a centred video card, rather than a full-bleed feed.
export const WIDE_BREAKPOINT = 1000;
