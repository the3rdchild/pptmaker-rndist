import type { Context } from 'hono'
import BaseHandler from '@/modules/base.handler'
import { createDeckSchema, patchDeckSchema, updateDeckSchema } from './dto'
import { DeckService } from './service'
import { z } from 'zod'

const idParam = z.object({ id: z.string().uuid() })

export class DeckHandler extends BaseHandler {
	constructor(context: Context) {
		super(context)
	}

	private requireSession(): string {
		const sessionId = this.context.var.sessionId
		if (!sessionId) {
			return this.error({ errors: ['Missing session'], status: 401 }) as unknown as string
		}
		return sessionId
	}

	async list(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		return this.run(() => new DeckService().list(sessionId))
	}

	async getById(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsed = idParam.safeParse({ id: this.context.req.param('id') })
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new DeckService().getById(sessionId, parsed.data.id))
	}

	async create(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const rawBody = await this.context.req.json().catch(() => ({}))
		const parsed = createDeckSchema.safeParse(rawBody)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new DeckService().create(sessionId, parsed.data), { status: 201 })
	}

	async update(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsedParam = idParam.safeParse({ id: this.context.req.param('id') })
		if (!parsedParam.success) return this.error({ errors: parsedParam.error.issues.map(e => e.message) })
		const rawBody = await this.context.req.json().catch(() => ({}))
		const parsed = updateDeckSchema.safeParse(rawBody)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new DeckService().update(sessionId, parsedParam.data.id, parsed.data))
	}

	async patch(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsedParam = idParam.safeParse({ id: this.context.req.param('id') })
		if (!parsedParam.success) return this.error({ errors: parsedParam.error.issues.map(e => e.message) })
		const rawBody = await this.context.req.json().catch(() => ({}))
		const parsed = patchDeckSchema.safeParse(rawBody)
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new DeckService().patch(sessionId, parsedParam.data.id, parsed.data))
	}

	async remove(): Promise<Response> {
		const sessionId = this.context.var.sessionId
		if (!sessionId) return this.error({ errors: ['Missing session'], status: 401 })
		const parsed = idParam.safeParse({ id: this.context.req.param('id') })
		if (!parsed.success) return this.error({ errors: parsed.error.issues.map(e => e.message) })
		return this.run(() => new DeckService().remove(sessionId, parsed.data.id))
	}
}
