import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Trans } from '@lingui/react/macro';
import { Content } from 'csdm/ui/components/content';
import { useCurrentMatch } from 'csdm/ui/match/use-current-match';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RendererClientMessageName } from 'csdm/server/renderer-client-message-name';
import { Status } from 'csdm/common/types/status';
import { Spinner } from 'csdm/ui/components/spinner';
import { ErrorMessage } from 'csdm/ui/components/error-message';
import { Message } from 'csdm/ui/components/message';
import type { AntiAimSuspicion } from 'csdm/common/types/anti-aim-suspicion';
import { roundNumberPercentage } from 'csdm/common/math/round-number-percentage';

export function AntiAim() {
  const client = useWebSocketClient();
  const match = useCurrentMatch();
  const [suspicions, setSuspicions] = useState<AntiAimSuspicion[]>([]);
  const [status, setStatus] = useState<Status>(Status.Loading);

  useEffect(() => {
    const fetchSuspicions = async () => {
      try {
        setStatus(Status.Loading);
        const result = await client.send({
          name: RendererClientMessageName.FetchAntiAimSuspicions,
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
      return <ErrorMessage message={<Trans>An error occurred while fetching anti-aim suspicions.</Trans>} />;
    }

    if (status === Status.Loading) {
      return <Spinner size={42} />;
    }

    if (suspicions.length === 0) {
      return <Message message={<Trans>No player position data found for this match.</Trans>} />;
    }

    return (
      <div className="flex w-fit min-w-[520px] flex-col">
        <div className="flex border-b border-gray-300 pb-8 text-body-strong">
          <p className="w-[240px]">
            <Trans>Player</Trans>
          </p>
          <p className="w-[140px] text-right">
            <Trans>Suspicious ticks %</Trans>
          </p>
          <p className="w-[140px] text-right">
            <Trans>Flagged</Trans>
          </p>
        </div>
        {suspicions.map((suspicion) => {
          return (
            <div key={suspicion.playerSteamId} className="flex border-b border-gray-200 py-8">
              <p className="w-[240px] selectable truncate" title={suspicion.playerName}>
                {suspicion.playerName}
              </p>
              <p
                className={clsx('w-[140px] selectable text-right', {
                  'text-red-700': suspicion.isFlagged,
                })}
              >
                {roundNumberPercentage(suspicion.suspiciousFraction, 3)}%
              </p>
              <p className={clsx('w-[140px] text-right', suspicion.isFlagged ? 'text-red-700' : 'text-gray-800')}>
                {suspicion.isFlagged ? <Trans>Yes</Trans> : <Trans>No</Trans>}
              </p>
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
