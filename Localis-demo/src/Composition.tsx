import React from 'react';
import { Audio, staticFile, useVideoConfig, interpolate, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { IntroScene } from './scenes/00-Intro';
import { RagScene } from './scenes/01-Rag';
import { WebSearchScene } from './scenes/02-WebSearch';
import { HomeAssistantScene } from './scenes/03-HomeAssistant';
import { NotesScene } from './scenes/04-Notes';
import { ClimaxScene } from './scenes/05-Climax';
import { BEAT } from './lib/beats';

/** 1-beat fade transition between every scene */
const TRANSITION_FRAMES = BEAT; // 18f

export const LocalisDemoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Audio fade-out over last 60 frames (2s)
  const audioVolume = interpolate(
    frame,
    [durationInFrames - 60, durationInFrames],
    [0.5, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <>
      {/* ADD AUDIO HERE — drop music.mp3 in public/ */}
      <Audio src={staticFile('music.mp3')} volume={audioVolume} />

      <TransitionSeries>
        {/* Scene 00 — Intro: 216f / 3 bars */}
        <TransitionSeries.Sequence durationInFrames={216}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 01 — RAG: 576f / 8 bars */}
        <TransitionSeries.Sequence durationInFrames={576}>
          <RagScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 02 — Web Search: 432f / 6 bars */}
        <TransitionSeries.Sequence durationInFrames={432}>
          <WebSearchScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 03 — Home Assistant: 576f / 8 bars */}
        <TransitionSeries.Sequence durationInFrames={576}>
          <HomeAssistantScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 04 — Notes: 360f / 5 bars */}
        <TransitionSeries.Sequence durationInFrames={360}>
          <NotesScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 05 — Climax: 432f / 6 bars */}
        <TransitionSeries.Sequence durationInFrames={432}>
          <ClimaxScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </>
  );
};
