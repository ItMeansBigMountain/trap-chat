// Trap Chat — Design tokens
// A pure black ground and white type, borrowed from the grammar of vertical
// video. The accent is ours, and it is not one colour: the app has two modes
// and they are lit differently.
//
// Social is violet, Competitive is acid lime. That is the brand doing work
// rather than decorating: you can tell which world you are in from across the
// room, before reading a word of the screen.

export const ACCENTS = {
  social: '#7B5CFF',
  competitive: '#CCFF00',
} as const;

export type Mode = keyof typeof ACCENTS;

// What to print on top of each accent. Lime is bright enough that white type
// on it is unreadable, so the ink is part of the accent, not a constant.
export const ACCENT_INK: Record<Mode, string> = {
  social: '#ffffff',
  competitive: '#000000',
};

export const T = {
  // GROUNDS
  bg: '#000000',            // the feed itself, always pure black
  surface: '#121212',       // cards, sheets, the sidebar
  surfaceHi: '#1f1f1f',     // pressed and hovered rows
  border: 'rgba(255,255,255,0.12)',

  // TYPE
  text: '#ffffff',
  textDim: '#a1a1a1',       // captions, counts, secondary rows
  textFaint: '#6b6b6b',     // timestamps and hints

  // ACCENTS
  // The default is Social, because that is where you land. Screens that can
  // be either read the live accent from useAccent() instead of this.
  accent: ACCENTS.social,
  accentInk: ACCENT_INK.social,
  // Errors and destructive actions are never the mode accent: on Competitive
  // the accent is a bright lime, which reads as success, not danger.
  danger: '#FF4757',

  // SHAPE
  radius: 8,
  radiusPill: 999,

  // CHROME SIZES
  sidebarWidth: 240,
  tabBarHeight: 52,
} as const;

// The breakpoint where the phone layout gives way to the web layout: a left
// sidebar and a centred video card, rather than a full-bleed feed.
export const WIDE_BREAKPOINT = 1000;
