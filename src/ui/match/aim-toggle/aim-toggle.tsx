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
import type { AimToggleSuspicion } from 'csdm/common/types/aim-toggle-suspicion';
import { roundNumberPercentage } from 'csdm/common/math/round-number-percentage';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';

export function AimToggle() {
  const client = useWebSocketClient();
  const match = useCurrentMatch();
  const navigate = useNavigate();
  const [suspicions, setSuspicions] = useState<AimToggleSuspicion[]>([]);
  const [status, setStatus] = useState<Status>(Status.Loading);

  const jumpToViewer = (roundNumber: number, tick: number) => {
    void navigate(buildMatch2dViewerRoundPath(match.checksum, roundNumber), { state: { tick } });
  };

  useEffect(() => {
    const fetchSuspicions = async () => {
      try {
        setStatus(Status.Loading);
        const result = await client.send({
          name: RendererClientMessageName.FetchAimToggleSuspicions,
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
      return <ErrorMessage message={<Trans>An error occurred while fetching aim-toggle suspicions.</Trans>} />;
    }

    if (status === Status.Loading) {
      return <Spinner size={42} />;
    }

    if (suspicions.length === 0) {
      return <Message message={<Trans>No kill data found for this match.</Trans>} />;
    }

    return (
      <div className="flex flex-col gap-12">
        <p className="max-w-[720px] text-body text-gray-800">
          <Trans>
            Statistical triage signal, not proof: it flags a mediocre overall headshot rate paired with an isolated
            near-perfect round, a shape consistent with toggling a headshot aimbot on and off. Review the flagged round
            before drawing any conclusion.
          </Trans>
        </p>
        <div className="flex w-fit min-w-[820px] flex-col">
          <div className="flex border-b border-gray-300 pb-8 text-body-strong">
            <p className="w-[240px]">
              <Trans>Player</Trans>
            </p>
            <p className="w-[160px] text-right">
              <Trans>Baseline HS %</Trans>
            </p>
            <p className="w-[120px] text-right">
              <Trans>Hot round</Trans>
            </p>
            <p className="w-[160px] text-right">
              <Trans>Hot round HS %</Trans>
            </p>
            <p className="w-[120px] text-right">
              <Trans>Flagged</Trans>
            </p>
            <p className="w-[120px]" />
          </div>
          {suspicions.map((suspicion) => {
            const { tick, roundNumber } = suspicion;

            return (
              <div key={suspicion.playerSteamId} className="flex items-center border-b border-gray-200 py-8">
                <p className="w-[240px] selectable truncate" title={suspicion.playerName}>
                  {suspicion.playerName}
                </p>
                <p
                  className={clsx('w-[160px] selectable text-right', {
                    'text-red-700': suspicion.isFlagged,
                  })}
                >
                  {roundNumberPercentage(suspicion.baselineHeadshotRate, 1)}%
                </p>
                <p className="w-[120px] selectable text-right text-gray-800">
                  {suspicion.hotRoundNumber === null ? '-' : suspicion.hotRoundNumber}
                </p>
                <p
                  className={clsx('w-[160px] selectable text-right', {
                    'text-red-700': suspicion.isFlagged,
                  })}
                >
                  {roundNumberPercentage(suspicion.hotRoundHeadshotRate, 1)}%
                </p>
                <p className={clsx('w-[120px] text-right', suspicion.isFlagged ? 'text-red-700' : 'text-gray-800')}>
                  {suspicion.isFlagged ? <Trans>Yes</Trans> : <Trans>No</Trans>}
                </p>
                <div className="flex w-[120px] justify-end">
                  {tick !== null && roundNumber !== null && (
                    <Button onClick={() => jumpToViewer(roundNumber, tick)}>
                      <Trans>View in 2D</Trans>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Content>
      <div className="flex flex-col gap-12">{renderContent()}</div>
    </Content>
  );
}
