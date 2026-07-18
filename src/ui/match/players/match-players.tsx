import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { Content } from 'csdm/ui/components/content';
import { Message } from 'csdm/ui/components/message';
import { useCurrentMatch } from '../use-current-match';
import { buildMatchPlayerPath } from 'csdm/ui/routes-paths';
import { Avatar } from 'csdm/ui/components/avatar';
import { TabLinks } from 'csdm/ui/components/tabs/tab-links';
import { TabLink } from 'csdm/ui/components/tabs/tab-link';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RendererClientMessageName } from 'csdm/server/renderer-client-message-name';
import type { PlayerCheatFlags } from 'csdm/common/types/match-cheat-flags';
import { ExclamationTriangleIcon } from 'csdm/ui/icons/exclamation-triangle-icon';
import { Tooltip } from 'csdm/ui/components/tooltip';
import { KillsPanel } from './kills-panel';
import { MultiKillsPanel } from 'csdm/ui/components/panels/multi-kills-panel';
import { KillDeathRatioPanel } from 'csdm/ui/components/panels/kill-death-ratio-panel';
import { AverageDamagesPerRoundPanel } from 'csdm/ui/components/panels/average-damages-per-round-panel';
import { HeadshotPanel } from 'csdm/ui/components/panels/headshot-panel';
import { KastPanel } from 'csdm/ui/components/panels/kast-panel';
import { ObjectivesPanel } from 'csdm/ui/components/panels/objectives-panel';
import { WeaponsPanel } from './weapons-panel';
import { UtilitiesPanel } from './utilities-panel';
import { ClutchesPanel } from './clutches-panel';
import { PlayerActionBar } from './player-action-bar';
import { HltvRating2Panel } from 'csdm/ui/components/panels/hltv-rating-2-panel';
import { AverageKillsPerRoundPanel } from 'csdm/ui/components/panels/average-kills-per-round-panel';
import { AverageDeathsPerRoundPanel } from 'csdm/ui/components/panels/average-deaths-per-round-panel';
import { HltvRatingPanel } from 'csdm/ui/components/panels/hltv-rating-panel';
import { WeaponInspectionsPanel } from 'csdm/ui/components/panels/weapon-inspections-panel';

export function MatchPlayers() {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const match = useCurrentMatch();
  const { steamId } = useParams<{ steamId: string }>();
  const player = match.players.find((player) => player.steamId === steamId);
  const [cheatFlagsBySteamId, setCheatFlagsBySteamId] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    const fetchCheatFlags = async () => {
      try {
        const cheatFlags = await client.send({
          name: RendererClientMessageName.FetchMatchCheatFlags,
          payload: match.checksum,
        });
        const flagsBySteamId = new Map<string, string[]>(
          cheatFlags.map((flags: PlayerCheatFlags) => [flags.steamId, flags.flaggedBy]),
        );
        setCheatFlagsBySteamId(flagsBySteamId);
      } catch {
        // Silently ignore: the cheat flag is a non-critical hint next to the player name.
      }
    };

    void fetchCheatFlags();
  }, [client, match.checksum]);

  if (player === undefined) {
    return <Message message={<Trans>Player not found.</Trans>} />;
  }

  const kills = match.kills.filter((kill) => kill.killerSteamId === steamId);
  const deaths = match.kills.filter((kill) => kill.victimSteamId === steamId);

  return (
    <>
      <TabLinks>
        {match.players.map((player) => {
          const flaggedBy = cheatFlagsBySteamId.get(player.steamId);

          return (
            <TabLink key={player.steamId} url={buildMatchPlayerPath(match.checksum, player.steamId)}>
              <div className="flex items-center gap-x-4">
                <Avatar avatarUrl={player.avatar} playerName={player.name} size={20} />
                <p>{player.name}</p>
                {flaggedBy !== undefined && flaggedBy.length > 0 && (
                  <Tooltip
                    content={
                      <p>
                        <Trans>Possible cheater</Trans>: {flaggedBy.join(', ')}
                      </p>
                    }
                  >
                    <ExclamationTriangleIcon className="size-16 text-red-700" />
                  </Tooltip>
                )}
              </div>
            </TabLink>
          );
        })}
      </TabLinks>
      <PlayerActionBar player={player} />
      <Content>
        <div className="flex flex-col gap-y-12">
          <div className="flex flex-wrap gap-8">
            <div className="flex flex-col gap-y-8">
              <HltvRatingPanel hltvRating={player.hltvRating} />
              <HltvRating2Panel hltvRating2={player.hltvRating2} />
            </div>
            <div className="flex flex-col gap-y-8">
              <KastPanel kast={player.kast} />
            </div>
            <div className="flex flex-col gap-y-8">
              <AverageDamagesPerRoundPanel averageDamagePerRound={player.averageDamagePerRound} />
              <KillDeathRatioPanel killDeathRatio={player.killDeathRatio} />
            </div>
            <div className="flex flex-col gap-y-8">
              <AverageKillsPerRoundPanel averageKillsPerRound={player.averageKillsPerRound} />
              <AverageDeathsPerRoundPanel averageDeathsPerRound={player.averageDeathsPerRound} />
            </div>
            <HeadshotPanel
              headshotCount={player.headshotCount}
              headshotPercentage={player.headshotPercentage}
              killCount={player.killCount}
              assistCount={player.assistCount}
              deathCount={player.deathCount}
            />
            <MultiKillsPanel
              oneKillCount={player.oneKillCount}
              twoKillCount={player.twoKillCount}
              threeKillCount={player.threeKillCount}
              fourKillCount={player.fourKillCount}
              fiveKillCount={player.fiveKillCount}
            />
            <UtilitiesPanel shots={match.shots} steamId={player.steamId} />
            <ObjectivesPanel
              bombDefusedCount={player.bombDefusedCount}
              bombPlantedCount={player.bombPlantedCount}
              hostageRescuedCount={player.hostageRescuedCount}
            />
            <WeaponInspectionsPanel
              inspectionCount={player.inspectWeaponCount}
              deathWhileInspectingCount={player.deathWhileInspectingWeaponCount}
            />
          </div>
          <div className="flex flex-wrap gap-8">
            <KillsPanel
              header={t`Kills`}
              kills={kills}
              demoPath={match.demoFilePath}
              tickrate={match.tickrate}
              rounds={match.rounds}
            />
            <KillsPanel
              header={t`Deaths`}
              kills={deaths}
              demoPath={match.demoFilePath}
              tickrate={match.tickrate}
              rounds={match.rounds}
            />
            <div className="flex flex-col gap-y-8">
              <WeaponsPanel match={match} player={player} kills={kills} />
              <ClutchesPanel
                clutches={match.clutches}
                demoPath={match.demoFilePath}
                game={match.game}
                playerSteamId={player.steamId}
                tickrate={match.tickrate}
              />
            </div>
          </div>
        </div>
      </Content>
    </>
  );
}
