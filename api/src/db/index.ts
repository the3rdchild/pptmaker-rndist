import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";

import * as schema from "./schemas";

const queryClient = postgres(env.DATABASE_URL || "");

export const checkDatabaseConnection = async () => {
	try {
		await queryClient`SELECT 1`;
		return true;
	} catch (error) {
		console.error("Failed to check database connection", error);
		return false;
	}
};

const db = drizzle({ client: queryClient, schema });

export const disconnectDatabase = async () => {
	await queryClient.end()
}

export default db;
