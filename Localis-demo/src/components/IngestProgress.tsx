import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { colors, fonts } from '../lib/design';
import { BEAT } from '../lib/beats';

const ITEMS = [
  { label: 'From File: Ingest complete ♥', isHeader: true },
  { label: 'Upload', isHeader: false },
  { label: 'Extract', isHeader: false },
  { label: 'Chunk', isHeader: false },
  { label: 'Index', isHeader: false },
];

interface IngestProgressProps {
  /** Scene-relative frame when first item appears */
  startFrame: number;
}

export const IngestProgress: React.FC<IngestProgressProps> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - startFrame);
  const { fps } = useVideoConfig();
  const entryProgress = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 180 } });
  const entryY = interpolate(entryProgress, [0, 1], [18, 0]);

  return (
    <div style={{
      position: 'absolute',
      top: 20, left: 20,
      fontFamily: fonts.mono,
      fontSize: 12,
      lineHeight: 1.8,
      transform: `translateY(${entryY}px)`,
    }}>
      {ITEMS.map((item, i) => {
        const itemFrame = i * BEAT; // each item appears 1 beat apart
        const opacity = interpolate(localFrame, [itemFrame, itemFrame + 10], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <div key={i} style={{ opacity, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: colors.green }}>✓</span>
            <span style={{ color: item.isHeader ? colors.green : colors.textMuted }}>
              {item.label}
            </span>
          </div>
        );
      })}
      {/* Files: 1/1 */}
      <div style={{
        opacity: interpolate(localFrame, [ITEMS.length * BEAT, ITEMS.length * BEAT + 10], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
        color: colors.textDim, fontSize: 11, marginTop: 2,
      }}>
        Files: 1/1
      </div>
    </div>
  );
};
