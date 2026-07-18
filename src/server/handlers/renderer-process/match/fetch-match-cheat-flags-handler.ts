import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchMatchCheatFlags } from 'csdm/node/database/cheat-detection/fetch-match-cheat-flags';

export async function fetchMatchCheatFlagsHandler(checksum: string) {
  try {
    const cheatFlags = await fetchMatchCheatFlags(checksum);

    return cheatFlags;
  } catch (error) {
    handleError(error, 'Error while fetching match cheat flags');
  }
}
