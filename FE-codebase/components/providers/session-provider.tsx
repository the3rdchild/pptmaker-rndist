'use client'

import { useEffect } from 'react'
import { useSessionStore } from '@/store/session.store'

/** Mounts once at root to ensure the anonymous session is resolved. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
	const init = useSessionStore((s) => s.init)

	useEffect(() => {
		void init()
	}, [init])

	return <>{children}</>
}
