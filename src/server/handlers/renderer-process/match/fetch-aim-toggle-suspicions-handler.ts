import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchAimToggleSuspicions } from 'csdm/node/database/aim-toggle/fetch-aim-toggle-suspicions';

export async function fetchAimToggleSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchAimToggleSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching aim-toggle suspicions');
  }
}
