import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import { env, validateEnv } from "./config/env";
import createApp from "./config/create-app";
import { v1Routes } from "./routes/v1";
import { httpLogger } from "./utils/http-logger";
import { sessionMiddleware } from "./middlewares/session";

validateEnv();

const app = createApp();

app.use(httpLogger);
app.use(poweredBy({ serverName: "ppt-maker API" }));

const corsConfig = {
	development: {
		origin: env.ORIGIN || "*",
		credentials: true,
	},
	production: {
		origin: env.ORIGIN || "*",
		allowHeaders: ["Content-Type", "Authorization", "Cookie"],
		allowMethods: ["POST", "GET", "PATCH", "DELETE", "PUT", "OPTIONS"],
		exposeHeaders: ["Content-Length", "Set-Cookie"],
		maxAge: 600,
		credentials: true,
	},
};

app.use(
	"*",
	cors(
		corsConfig[env.NODE_ENV as keyof typeof corsConfig] ||
		corsConfig.development,
	),
);

// Session resolution on all v1 routes except /health
app.use("/api/v1/*", async (c, next) => {
	if (c.req.path.startsWith("/api/v1/health")) {
		return next()
	}
	return sessionMiddleware(c, next)
});

v1Routes.forEach((route) => {
	app.basePath("/api").route("/v1", route);
});

export default app;
