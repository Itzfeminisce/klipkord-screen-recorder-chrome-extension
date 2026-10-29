import { reportPermission, requestAccess } from '@/lib/setup';

// Chrome shows its prompt for this extension's origin; the side panel waits for the report.
const wantCamera = new URLSearchParams(location.search).get('camera') === '1';

requestAccess(wantCamera)
  .then(async (result) => {
    await reportPermission(result);
    if (result.mic) window.close();
  })
  .catch((error) => console.error('Klipkord: could not ask for mic access', error));
