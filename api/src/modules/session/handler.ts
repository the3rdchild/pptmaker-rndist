import type { Context } from 'hono'
import BaseHandler from '@/modules/base.handler'
import { sessionBodySchema } from './dto'
import { SessionService } from './service'

export class SessionHandler extends BaseHandler {
	constructor(context: Context) {
		super(context)
	}

	async handle(): Promise<Response> {
		const rawBody = await this.context.req.json().catch(() => ({}))
		const parsed = sessionBodySchema.safeParse(rawBody)
		if (!parsed.success) {
			return this.error({ errors: parsed.error.issues.map(e => e.message) })
		}

		const session = await new SessionService().upsert(parsed.data.token)
		return this.success({
			data: { id: session.id, token: session.token },
			message: 'session ready',
		})
	}
}
