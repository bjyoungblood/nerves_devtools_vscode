export function log(message: string, ...rest: unknown[]) {
  console.log(`[nerves-devtools] ${message}`, ...rest);
}
