import './index.css';
import { Composition } from 'remotion';
import { LocalisDemoComposition } from './Composition';

/**
 * Net frame count:
 * Scenes: 216 + 576 + 432 + 576 + 360 + 432 = 2592
 * Transitions: 5 × 18 = 90
 * Total: 2592 - 90 = 2502
 */
const TOTAL_FRAMES = 2502;

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
