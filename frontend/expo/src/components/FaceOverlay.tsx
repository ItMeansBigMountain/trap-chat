// Trap Chat — Face Overlay
//
// Draws what Mog Off is actually measuring, over your own camera.
//
// The score was a number with nothing behind it: 71 out of 100 and no way to
// tell whether the model had found your face, found the lamp behind you, or
// simply disliked you. Drawing the lines makes the claim checkable — you can
// see the midline sit on your nose, watch the pairs go lopsided when you turn
// your head, and understand why the number moved.
//
// So this deliberately draws the *measurement*, not a 468-point mesh. The
// midline the score is taken from, the ten pairs that are compared against it,
// and a rung between each pair so the asymmetry is visible as a shape rather
// than inferred from dots. A full mesh would look more impressive and explain
// less.

import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { FacePoint, MIDLINE, PAIRS } from '../services/faceScorer';

const isWeb = Platform.OS === 'web';

export function FaceOverlay({
  points,
  accent,
  visible,
}: {
  points: FacePoint[] | null;
  accent: string;
  visible: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Landmarks are normalised 0..1, so the canvas is sized to its own box
    // and everything scales with it. Matching the backing store to the
    // displayed size keeps the lines from going soft.
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (!visible || !points || points.length === 0) return;

    const at = (index: number) => {
      const point = points[index];
      if (!point) return null;
      // The camera is mirrored, so the drawing has to be too or the lines sit
      // on the wrong side of your face.
      return { x: (1 - point.x) * width, y: point.y * height };
    };

    // The rungs first, so the dots sit on top of them.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    for (const [left, right] of PAIRS) {
      const a = at(left);
      const b = at(right);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // The midline: the axis every pair is measured against.
    const top = at(MIDLINE[0]);
    const bottom = at(MIDLINE[MIDLINE.length - 1]);
    if (top && bottom) {
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();

      for (const index of MIDLINE) {
        const point = at(index);
        if (!point) continue;
        ctx.beginPath();
        ctx.fillStyle = accent;
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The measured points themselves.
    ctx.fillStyle = '#ffffff';
    for (const [left, right] of PAIRS) {
      for (const index of [left, right]) {
        const point = at(index);
        if (!point) continue;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [points, accent, visible]);

  if (!isWeb) return null;
  return React.createElement('canvas', {
    ref,
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      // It is a picture of what is happening, never something to click on.
      pointerEvents: 'none',
    },
  });
}
