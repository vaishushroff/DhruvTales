import {
  handleUniversalEdgeApiRequest,
  type UniversalEdgeEnv,
} from './api/_lib/universalEdgeHandler';

interface CloudflareWorkerEnv extends UniversalEdgeEnv {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: CloudflareWorkerEnv): Promise<Response> {
    const apiResponse = await handleUniversalEdgeApiRequest(
      request,
      env,
      'dhruv-tales-cloudflare-worker'
    );
    if (apiResponse) {
      return apiResponse;
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
