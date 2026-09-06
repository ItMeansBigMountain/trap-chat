// Which mode the app is currently in, and therefore what colour it is.
//
// Held in context rather than derived per screen, because the accent has to
// agree everywhere at once: the sidebar, the room code, the buttons and the
// meters are all the same colour at the same time, or the effect reads as a
// bug instead of a theme.

import React, { createContext, useContext, useMemo } from 'react';
import { ACCENTS, ACCENT_INK, Mode } from '../theme';

interface Accent {
  mode: Mode;
  /** The accent for this mode. */
  accent: string;
  /** What to print on top of it. Lime needs black ink; violet needs white. */
  ink: string;
}

const ModeContext = createContext<Mode>('social');

export function ModeProvider({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>;
}

export function useAccent(): Accent {
  const mode = useContext(ModeContext);
  return useMemo(
    () => ({ mode, accent: ACCENTS[mode], ink: ACCENT_INK[mode] }),
    [mode],
  );
}
