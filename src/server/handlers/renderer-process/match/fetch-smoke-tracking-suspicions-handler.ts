import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchSmokeTrackingSuspicions } from 'csdm/node/database/smoke-tracking/fetch-smoke-tracking-suspicions';

export async function fetchSmokeTrackingSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchSmokeTrackingSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching smoke-tracking suspicions');
  }
}
