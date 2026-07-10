import "dotenv/config";

export const env = {
	NODE_ENV: process.env.NODE_ENV,
	DATABASE_URL: process.env.DATABASE_URL,
	PORT: process.env.PORT,
	ORIGIN: process.env.ORIGIN,

	REDIS_HOST: process.env.REDIS_HOST || "localhost",
	REDIS_PORT: Number(process.env.REDIS_PORT) || 6379,
	REDIS_PASSWORD: process.env.REDIS_PASSWORD,

	CDN_BUCKET_NAME: process.env.CDN_BUCKET_NAME,
	CDN_ENDPOINT: process.env.CDN_ENDPOINT,
	CDN_PUBLIC_URL: process.env.CDN_PUBLIC_URL,
	CDN_ACCESS_KEY_ID: process.env.CDN_ACCESS_KEY_ID,
	CDN_SECRET_ACCESS_KEY: process.env.CDN_SECRET_ACCESS_KEY,
	CDN_REGION: process.env.CDN_REGION,

	SERVICE_URL: process.env.SERVICE_URL,

	DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
	DEEPINFRA_BASE_URL: process.env.DEEPINFRA_BASE_URL,
	DEEPINFRA_MODEL: process.env.DEEPINFRA_MODEL,

	PPT_QUEUE_NAME: process.env.PPT_QUEUE_NAME,
	PPT_JOB_NAME: process.env.PPT_JOB_NAME,
};

export function parseOrigin(origin: string): string[] | undefined {
	if (!origin) return undefined;
	const trimmed = origin.trim();
	if (trimmed === "*") return ["*"];
	return trimmed.split(",").map((o) => o.trim());
}

export function validateEnv() {
	const requiredEnvVars: (keyof typeof env)[] = [
		"NODE_ENV",
		"DATABASE_URL",
		"PORT",
	];

	requiredEnvVars.forEach((key) => {
		if (!env[key]) {
			throw new Error(`🔑 Missing environment variable: ${key}`);
		}
	});

	console.info("🔑 Environment variables validated successfully");
}
