import { handleError } from 'csdm/server/handlers/handle-error';
import { fetchAimOutlierSuspicions } from 'csdm/node/database/aim-outlier/fetch-aim-outlier-suspicions';

export async function fetchAimOutlierSuspicionsHandler(checksum: string) {
  try {
    const suspicions = await fetchAimOutlierSuspicions(checksum);

    return suspicions;
  } catch (error) {
    handleError(error, 'Error while fetching aim-outlier suspicions');
  }
}
