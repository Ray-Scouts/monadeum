export function bullmqEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REDIS_URL);
}
