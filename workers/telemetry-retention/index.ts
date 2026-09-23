interface Env {
	DB: {
		prepare(sql: string): {
			bind(...values: unknown[]): { run(): Promise<{ meta?: { changes?: number } }> };
		};
	};
}

export default {
	async scheduled(_event: { cron: string; scheduledTime: number }, env: Env): Promise<void> {
		const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const result = await env.DB.prepare('DELETE FROM telemetry_10m WHERE bucket_start < ?').bind(cutoff).run();
		console.log(JSON.stringify({ task: 'telemetry_retention', deleted: result.meta?.changes ?? 0 }));
	},
};
