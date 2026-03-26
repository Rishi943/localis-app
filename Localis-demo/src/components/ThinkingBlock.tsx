import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { colors, fonts, glass } from '../lib/design';

interface ThinkingBlockProps {
  /** Scene-relative frame when block appears */
  startFrame: number;
  /** Scene-relative frame when thinking ends (block stays but dims) */
  endFrame?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  const progress = spring({
    frame: localFrame,
    fps,
    config: { damping: 22, stiffness: 120 },
  });

  const opacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const height = interpolate(progress, [0, 1], [0, 64]);

  // Dots animation — 3 dots cycling
  const dotPhase = (frame * 0.12) % (Math.PI * 2);
  const dot1 = 0.4 + 0.6 * Math.abs(Math.sin(dotPhase));
  const dot2 = 0.4 + 0.6 * Math.abs(Math.sin(dotPhase + 1.0));
  const dot3 = 0.4 + 0.6 * Math.abs(Math.sin(dotPhase + 2.0));

  const PREVIEW_TEXT = 'Okay, the user wants me to summarise the file. Let me read through the content. The file is about Localis, an AI assistant that runs on the user\'s own computer using their GPU…';
  const charsVisible = Math.min(
    PREVIEW_TEXT.length,
    Math.floor((localFrame / 30) * 60),
  );

  return (
    <div style={{
      opacity,
      height,
      overflow: 'hidden',
      ...glass,
      background: 'rgba(10,12,16,0.75)',
      border: `1px solid rgba(255,255,255,0.06)`,
      borderRadius: 10,
      padding: height > 20 ? '10px 14px' : 0,
      fontFamily: fonts.mono,
      fontSize: 11,
      color: colors.textDim,
      maxWidth: 600,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.ui }}>⚙ Reasoning</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {[dot1, dot2, dot3].map((o, i) => (
            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: colors.textDim, opacity: o }} />
          ))}
        </div>
      </div>
      <div style={{ lineHeight: 1.5, fontSize: 11 }}>
        {PREVIEW_TEXT.slice(0, charsVisible)}
      </div>
    </div>
  );
};
