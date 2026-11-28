import {
  handleUniversalEdgeApiRequest,
  type UniversalEdgeEnv,
} from '../../api/_lib/universalEdgeHandler';

function readNetlifyEnv(): UniversalEdgeEnv {
  const netlifyGlobal = (
    globalThis as {
      Netlify?: { env?: { toObject?: () => Record<string, string | undefined> } };
    }
  ).Netlify;

  const rawEnv =
    netlifyGlobal?.env?.toObject?.() ??
    (typeof process !== 'undefined' && process.env ? process.env : {});

  return {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: rawEnv.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    GOOGLE_SERVICE_ACCOUNT_JSON: rawEnv.GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_DRIVE_CLIENT_EMAIL: rawEnv.GOOGLE_DRIVE_CLIENT_EMAIL,
    GOOGLE_DRIVE_PRIVATE_KEY: rawEnv.GOOGLE_DRIVE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_JSON: rawEnv.FIREBASE_SERVICE_ACCOUNT_JSON,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: rawEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    MEDIA_SIGNING_SECRET: rawEnv.MEDIA_SIGNING_SECRET,
    ALLOWED_ORIGINS: rawEnv.ALLOWED_ORIGINS,
  };
}

export default async function handler(request: Request): Promise<Response> {
  const response = await handleUniversalEdgeApiRequest(
    request,
    readNetlifyEnv(),
    'dhruv-tales-netlify'
  );
  return response ?? new Response('Not Found', { status: 404 });
}
