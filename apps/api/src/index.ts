import { createApi } from './api.ts';
import type { Env, ExecutionContextLike } from './env.ts';

const api = createApi();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return api.fetch(request, env, ctx);
  },
};
