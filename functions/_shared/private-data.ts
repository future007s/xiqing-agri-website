/** Public telemetry is retired. Never query D1 or accept a browser/publisher token here. */
export function privateDataResponse(): Response {
	return new Response(JSON.stringify({ code: 'data_moved_to_private_field', error: '数据已移入登录后的现场管理；公开数据接口已关闭。' }), {
		status: 410,
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, noarchive' },
	});
}
