import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { Button } from 'csdm/ui/components/buttons/button';
import { MAX_DETECTION_MOMENTS, type DetectionMoment } from 'csdm/common/types/detection-moment';

type Props = {
  moments: DetectionMoment[];
  onJump: (roundNumber: number, tick: number) => void;
};

// Expandable list of the incriminating moments surfaced for a single flagged player. Each moment
// shows its (server-built, untranslated) label and a "View in 2D" action that jumps the viewer to
// the moment's round and tick. Renders nothing when the player has no moment.
export function DetectionMoments({ moments, onJump }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (moments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8 pl-16">
      <button
        type="button"
        className="w-fit text-body text-blue-500 hover:underline"
        onClick={() => {
          setIsExpanded((expanded) => !expanded);
        }}
      >
        {isExpanded ? <Trans>Hide moments</Trans> : <Trans>Show moments</Trans>} ({moments.length})
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-4">
          {moments.map((moment, index) => {
            return (
              <div key={`${moment.roundNumber}-${moment.tick}-${index}`} className="flex items-center gap-12">
                <p className="w-[340px] selectable text-gray-900">{moment.label}</p>
                <Button
                  onClick={() => {
                    onJump(moment.roundNumber, moment.tick);
                  }}
                >
                  <Trans>View in 2D</Trans>
                </Button>
              </div>
            );
          })}
          {moments.length >= MAX_DETECTION_MOMENTS && (
            <p className="text-caption text-gray-700">
              <Trans>Only the first {MAX_DETECTION_MOMENTS} moments are shown.</Trans>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
