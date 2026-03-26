import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { Shell } from '../components/Shell';
import { NotesPanel } from '../components/NotesPanel';
import { VoiceBar } from '../components/VoiceBar';
import { BEAT, BAR } from '../lib/beats';

const DURATION = 360; // 5 bars

const NOTES_START = 0;
const VOICE_START = BEAT * 6;  // f108

const NOTES_DATA = [
  {
    title: 'Push Day',
    body: 'Bench Press x5 · Arnold Press x3 · Pac Dec x1 · Tricep Pushdown x4 · Tricep Lockdown x4 · Abs - crunches 20 × 6',
    appearFrame: BEAT,          // f18
  },
  {
    title: 'Record Localis DEMO',
    body: 'Post (LinkedIn + Reddit)',
    appearFrame: BEAT * 3,      // f54
  },
  {
    title: 'Order Eggs, Milk, Dinner Rolls, Chicken thighs from Instacart',
    deadline: '22 May, 11:00',
    isNew: true,
    appearFrame: BAR * 2 + BEAT * 2, // f180 — after voice goes green
  },
];

export const NotesScene: React.FC = () => {
  const frame = useCurrentFrame();

  // VoiceBar row position — absolute overlay above notes panel
  const voiceBarOpacity = interpolate(frame, [VOICE_START, VOICE_START + 10], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <Shell sceneDuration={DURATION} chatOpacity={0.3}>
      {/* Notes panel fills the viewport overlay */}
      <NotesPanel startFrame={NOTES_START} notes={NOTES_DATA} />

      {/* Voice bar — centered at top of notes panel */}
      <div style={{
        position: 'absolute',
        top: 140, left: '50%', transform: 'translateX(-50%)',
        opacity: voiceBarOpacity,
        zIndex: 30,
      }}>
        <VoiceBar
          startFrame={VOICE_START}
          states={[
            { frame: 0, state: 'idle' },
            { frame: 0, state: 'listening' },          // immediately listening when it appears
            { frame: BAR + BEAT * 2, state: 'done' },
          ]}
        />
      </div>
    </Shell>
  );
};
