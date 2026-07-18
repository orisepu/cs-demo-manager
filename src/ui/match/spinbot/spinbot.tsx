import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from 'react-router';
import { Content } from 'csdm/ui/components/content';
import { useCurrentMatch } from 'csdm/ui/match/use-current-match';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RendererClientMessageName } from 'csdm/server/renderer-client-message-name';
import { Status } from 'csdm/common/types/status';
import { Spinner } from 'csdm/ui/components/spinner';
import { ErrorMessage } from 'csdm/ui/components/error-message';
import { Message } from 'csdm/ui/components/message';
import { Button } from 'csdm/ui/components/buttons/button';
import type { SpinbotSuspicion } from 'csdm/common/types/spinbot-suspicion';
import { roundNumber } from 'csdm/common/math/round-number';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { DetectionMoments } from 'csdm/ui/match/detection-moments';

export function Spinbot() {
  const client = useWebSocketClient();
  const match = useCurrentMatch();
  const navigate = useNavigate();
  const [suspicions, setSuspicions] = useState<SpinbotSuspicion[]>([]);
  const [status, setStatus] = useState<Status>(Status.Loading);

  const jumpToViewer = (roundNumber: number, tick: number) => {
    void navigate(buildMatch2dViewerRoundPath(match.checksum, roundNumber), { state: { tick } });
  };

  useEffect(() => {
    const fetchSuspicions = async () => {
      try {
        setStatus(Status.Loading);
        const result = await client.send({
          name: RendererClientMessageName.FetchSpinbotSuspicions,
          payload: match.checksum,
        });
        setSuspicions(result);
        setStatus(Status.Success);
      } catch (error) {
        setStatus(Status.Error);
      }
    };

    void fetchSuspicions();
  }, [client, match.checksum]);

  const renderContent = () => {
    if (status === Status.Error) {
      return <ErrorMessage message={<Trans>An error occurred while fetching spinbot suspicions.</Trans>} />;
    }

    if (status === Status.Loading) {
      return <Spinner size={42} />;
    }

    if (suspicions.length === 0) {
      return <Message message={<Trans>No player position data found for this match.</Trans>} />;
    }

    return (
      <div className="flex w-fit min-w-[640px] flex-col">
        <div className="flex border-b border-gray-300 pb-8 text-body-strong">
          <p className="w-[240px]">
            <Trans>Player</Trans>
          </p>
          <p className="w-[140px] text-right">
            <Trans>Max yaw rotation (°/tick)</Trans>
          </p>
          <p className="w-[140px] text-right">
            <Trans>Flagged</Trans>
          </p>
          <p className="w-[120px]" />
        </div>
        {suspicions.map((suspicion) => {
          const { tick, roundNumber: representativeRoundNumber } = suspicion;

          return (
            <div key={suspicion.playerSteamId} className="flex flex-col gap-8 border-b border-gray-200 py-8">
              <div className="flex items-center">
                <p className="w-[240px] selectable truncate" title={suspicion.playerName}>
                  {suspicion.playerName}
                </p>
                <p
                  className={clsx('w-[140px] selectable text-right', {
                    'text-red-700': suspicion.isFlagged,
                  })}
                >
                  {roundNumber(suspicion.maxRollingMeanYawDelta, 1)}
                </p>
                <p className={clsx('w-[140px] text-right', suspicion.isFlagged ? 'text-red-700' : 'text-gray-800')}>
                  {suspicion.isFlagged ? <Trans>Yes</Trans> : <Trans>No</Trans>}
                </p>
                <div className="flex w-[120px] justify-end">
                  {tick !== null && representativeRoundNumber !== null && (
                    <Button onClick={() => jumpToViewer(representativeRoundNumber, tick)}>
                      <Trans>View in 2D</Trans>
                    </Button>
                  )}
                </div>
              </div>
              {suspicion.isFlagged && <DetectionMoments moments={suspicion.moments} onJump={jumpToViewer} />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Content>
      <div className="flex flex-col gap-12">{renderContent()}</div>
    </Content>
  );
}
