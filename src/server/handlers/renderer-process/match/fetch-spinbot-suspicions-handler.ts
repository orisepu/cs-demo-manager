import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchSpinbotSuspicions } from 'csdm/node/database/spinbot/fetch-spinbot-suspicions';

export async function fetchSpinbotSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchSpinbotSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching spinbot suspicions');
  }
}
