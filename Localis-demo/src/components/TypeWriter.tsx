import React from 'react';
import { useCurrentFrame } from 'remotion';

interface TypeWriterProps {
  text: string;
  /** Frame within the scene at which typing begins */
  startFrame: number;
  /** Characters revealed per second */
  charsPerSecond?: number;
  style?: React.CSSProperties;
}

export const TypeWriter: React.FC<TypeWriterProps> = ({
  text,
  startFrame,
  charsPerSecond = 40,
  style,
}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - startFrame);
  const charsToShow = Math.min(
    text.length,
    Math.floor((localFrame / 30) * charsPerSecond),
  );
  return <span style={style}>{text.slice(0, charsToShow)}</span>;
};
