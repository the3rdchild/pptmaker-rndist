import { Hono } from "hono";

export type ValidatedData = {
	params?: Record<string, unknown>;
	body?: Record<string, unknown>;
	query?: Record<string, unknown>;
};

export type AppEnv = {
	Variables: {
		validated: ValidatedData;
		sessionId?: string;   // resolved session row UUID (from x-session-token header)
	};
};

export function createRouter() {
	return new Hono<AppEnv>({
		strict: false,
	});
}

export default function createApp() {
	const app = createRouter();

	return app;
}
