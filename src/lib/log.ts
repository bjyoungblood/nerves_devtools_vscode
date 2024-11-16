export function log(message: string, ...rest: unknown[]) {
  console.log(`[nerves-utils] ${message}`, ...rest);
}
