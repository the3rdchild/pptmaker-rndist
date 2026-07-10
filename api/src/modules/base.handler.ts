import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { ErrorResponse, SuccessResponse } from '@/types/response'
import { AppError } from '@/utils/error'
import { AppEnv } from '@/config/create-app'

export default abstract class BaseHandler {
	constructor(protected readonly context: Context<AppEnv>) { }

	protected success<T>(
		{
			data,
			status = 200,
			message = 'sukses',
			description,
		}: {
			data?: T
			status?: ContentfulStatusCode
			message?: string
			description?: string
		}): Response {
		this.context.status(status)
		const respon: SuccessResponse<T> = { message }
		if (data !== undefined && data !== null) respon.data = data
		if (description) respon.description = description
		return this.context.json(respon)
	}

	protected error({ errors, status = 400, message = 'Bad Request' }: {
		errors: string[]
		status?: ContentfulStatusCode
		message?: string
	}): Response {
		this.context.status(status)
		const response: ErrorResponse = { message, errors }
		return this.context.json(response)
	}

	protected failFromError(e: unknown): Response {
		if (e instanceof AppError) {
			return this.error({ errors: [e.message], status: e.statusCode })
		}
		const message = e instanceof Error ? e.message : 'internal server error'
		return this.error({ errors: [message], status: 500, message: 'internal server error' })
	}

	protected async run<T>(
		fn: () => Promise<T>,
		options?: { status?: ContentfulStatusCode; message?: string },
	): Promise<Response> {
		try {
			const data = await fn()
			return this.success({ data, status: options?.status, message: options?.message })
		} catch (e) {
			return this.failFromError(e)
		}
	}
}
