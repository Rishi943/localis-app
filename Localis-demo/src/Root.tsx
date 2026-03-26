import React from 'react';
import './index.css';
import { Composition } from 'remotion';
import { LocalisDemoComposition } from './Composition';

/**
 * Net frame count:
 * Scenes: 90 + 576 + 432 + 576 + 360 + 432 = 2466
 * Transitions: 5 × 18 = 90
 * Total: 2466 - 90 = 2376
 */
const TOTAL_FRAMES = 2376;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LocalisDemo"
      component={LocalisDemoComposition}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
