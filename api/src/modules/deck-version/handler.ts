import type { Context } from 'hono'
import { z } from 'zod'
import BaseHandler from '@/modules/base.handler'
import { DeckVersionService } from './service'

const params = z.object({ id: z.string().uuid(), versionId: z.string().uuid().optional() })

export class DeckVersionHandler extends BaseHandler {
	constructor(context: Context) {
		super(context)
	}

	async list(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsed = params.safeParse({ id: this.context.req.param('id') })
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map((e) => e.message) })
		return this.run(() => new DeckVersionService().list(sessionId, parsed.data.id))
	}

	async getOne(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsed = params.safeParse({
			id: this.context.req.param('id'),
			versionId: this.context.req.param('versionId'),
		})
		if (!parsed.success || !parsed.data.versionId) {
			return this.error({ errors: parsed.success ? ['Missing versionId'] : parsed.error.issues.map((e) => e.message) })
		}
		return this.run(() => new DeckVersionService().getOne(sessionId, parsed.data.id, parsed.data.versionId!))
	}

	async restore(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsed = params.safeParse({
			id: this.context.req.param('id'),
			versionId: this.context.req.param('versionId'),
		})
		if (!parsed.success || !parsed.data.versionId) {
			return this.error({ errors: parsed.success ? ['Missing versionId'] : parsed.error.issues.map((e) => e.message) })
		}
		return this.run(() => new DeckVersionService().restore(sessionId, parsed.data.id, parsed.data.versionId!))
	}
}
