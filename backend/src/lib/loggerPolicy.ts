/** Keep transports that require worker-side package resolution off serverless runtimes. */
export function shouldUsePrettyTransport(isDevelopment: boolean, isVercel: boolean): boolean {
  return isDevelopment && !isVercel;
}
