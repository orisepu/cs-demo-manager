import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchAntiFlashSuspicions } from 'csdm/node/database/anti-flash/fetch-anti-flash-suspicions';

export async function fetchAntiFlashSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchAntiFlashSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching anti-flash suspicions');
  }
}
