// The application and its authentication stay on the private monitoring host.
export const onRequest = () =>
  new Response(null, {
    status: 302,
    headers: { Location: 'http://100.74.100.18:8765/', 'Cache-Control': 'no-store' },
  });
