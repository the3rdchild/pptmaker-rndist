import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends HTTPException {
	constructor(
		public statusCode: ContentfulStatusCode,
		public message: string,
		public errorCode?: string,
	) {
		super(statusCode, { message });
	}

	static badRequest(message: string, errorCode?: string) {
		return new AppError(400, message, errorCode);
	}

	static notFound(message: string, errorCode?: string) {
		return new AppError(404, message, errorCode);
	}

	static internalServerError(message: string, errorCode?: string) {
		return new AppError(500, message, errorCode);
	}

	static conflict(message: string, errorCode?: string) {
		return new AppError(409, message, errorCode);
	}

	static cantProcess(message: string, errorCode?: string) {
		return new AppError(422, message, errorCode);
	}
}
