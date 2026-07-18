import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchAntiAimSuspicions } from 'csdm/node/database/anti-aim/fetch-anti-aim-suspicions';

export async function fetchAntiAimSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchAntiAimSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching anti-aim suspicions');
  }
}
