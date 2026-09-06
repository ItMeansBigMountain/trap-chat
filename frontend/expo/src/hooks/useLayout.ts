// Which of the two layouts to render. TikTok is not one responsive design but
// two: a full-bleed feed on a phone, and a sidebar with a centred video card
// on the web. useWindowDimensions re-renders on resize, so dragging a desktop
// window across the breakpoint switches layouts live.

import { useWindowDimensions } from 'react-native';
import { WIDE_BREAKPOINT } from '../theme';

export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, isWide: width >= WIDE_BREAKPOINT };
}
