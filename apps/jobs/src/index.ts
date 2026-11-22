import { handleAdmin } from './admin.ts';
import { depsFromEnv } from './deps.ts';
import type { Env } from './env.ts';
import { runJobs } from './run.ts';

/** `bluelytics-jobs`: the five-minute cron pipeline and the bearer-token admin API (ARCHITECTURE §7). */
export default {
  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    // The scheduled minute (not the start time) is the run's instant, so a re-delivered run keeps its `run_at`.
    const report = await runJobs(depsFromEnv(env), new Date(controller.scheduledTime).toISOString());
    // A failed step makes the invocation fail, which Workers Issues and Cron Events record.
    if (report.errors.length > 0) throw new Error(`jobs run ${report.at}: ${report.errors.join('; ')}`);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    return handleAdmin(request, depsFromEnv(env), env.ADMIN_TOKEN, new Date().toISOString());
  },
};
