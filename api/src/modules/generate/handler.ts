import type { Context } from 'hono'
import BaseHandler from '@/modules/base.handler'
import {
	generateAgentSchema,
	generateDeckSchema,
	generateOutlineSchema,
	generateSlideSchema,
} from './dto'
import { GenerateService } from './service'

export class GenerateHandler extends BaseHandler {
	constructor(context: Context) {
		super(context)
	}

	private sessionId(): string | null {
		return this.context.var.sessionId ?? null
	}

	async outline(): Promise<Response> {
		const sessionId = this.sessionId()
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const body = await this.context.req.json().catch(() => ({}))
		const parsed = generateOutlineSchema.safeParse(body)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new GenerateService().outline(sessionId, parsed.data), { status: 202 })
	}

	async deck(): Promise<Response> {
		const sessionId = this.sessionId()
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const body = await this.context.req.json().catch(() => ({}))
		const parsed = generateDeckSchema.safeParse(body)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new GenerateService().deck(sessionId, parsed.data), { status: 202 })
	}

	async slide(): Promise<Response> {
		const sessionId = this.sessionId()
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const body = await this.context.req.json().catch(() => ({}))
		const parsed = generateSlideSchema.safeParse(body)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new GenerateService().slide(sessionId, parsed.data), { status: 202 })
	}

	async agent(): Promise<Response> {
		const sessionId = this.sessionId()
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const body = await this.context.req.json().catch(() => ({}))
		const parsed = generateAgentSchema.safeParse(body)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new GenerateService().agent(sessionId, parsed.data), { status: 202 })
	}
}
