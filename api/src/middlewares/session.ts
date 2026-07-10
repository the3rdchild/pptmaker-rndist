import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import db from "@/db";
import { session } from "@/db/schemas";
import { AppEnv } from "@/config/create-app";

/**
 * Resolve the anonymous session from the `x-session-token` header.
 * Creates a new session row if the token doesn't exist yet (idempotent).
 * Sets c.var.sessionId (the session row UUID) for downstream handlers.
 */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const token = c.req.header("x-session-token");

	if (!token) {
		// endpoints without a session header (e.g. health) just skip
		await next();
		return;
	}

	const [existing] = await db
		.select()
		.from(session)
		.where(eq(session.token, token))
		.limit(1);

	if (existing) {
		c.set("sessionId", existing.id);
	} else {
		const [created] = await db
			.insert(session)
			.values({ token })
			.returning();
		c.set("sessionId", created.id);
	}

	await next();
});
