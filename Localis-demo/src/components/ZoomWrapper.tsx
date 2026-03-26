import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

interface ZoomWrapperProps {
  /** Scene-relative frame at which the punch-in starts */
  startFrame: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const ZoomWrapper: React.FC<ZoomWrapperProps> = ({ startFrame, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  const progress = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 1 },
  });

  const scale = interpolate(progress, [0, 1], [0.92, 1.0]);

  return (
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center', ...style }}>
      {children}
    </div>
  );
};
