import { createSession, getSessionByToken } from '@/repository/session'

export class SessionService {
	async upsert(token: string) {
		const existing = await getSessionByToken(token)
		if (existing) return existing
		return createSession({ token })
	}
}
