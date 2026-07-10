import app from '@/app'
import { env } from '@/config/env'
import { checkDatabaseConnection, disconnectDatabase } from '@/db'
import RedisClient from '@/lib/redis'
import QueueClient from '@/lib/queue'

const globalRuntime = globalThis as typeof globalThis & {
	__signalHandlers?: {
		sigint: () => void
		sigterm: () => void
	}
}

export async function bootstrap() {
	console.log('⚡ Checking service dependencies...')

	const postgresConnected = await checkDatabaseConnection()
	if (!postgresConnected) {
		throw new Error('PostgreSQL connection failed')
	}

	const redisConnected = await RedisClient.checkConnection()
	if (!redisConnected) {
		throw new Error('Redis connection failed')
	}

	const port = env.PORT ? Number(env.PORT) : 8080

	const server = Bun.serve({
		hostname: '0.0.0.0',
		port,
		idleTimeout: 0,   // disable idle timeout — SSE stream bisa panjang
		fetch(request) {
			return app.fetch(request)
		},
	})

	console.log('✅ Service status:')
	console.log(`- API: running on http://localhost:${port}`)
	console.log('- PostgreSQL: connected')
	console.log('- Redis: connected')

	let isShuttingDown = false
	const shutdown = async (signal: string) => {
		if (isShuttingDown) return
		isShuttingDown = true

		console.log(`🛑 Received ${signal}, shutting down...`)
		try {
			await server.stop(true)
			await QueueClient.close()
			await RedisClient.disconnect()
			await disconnectDatabase()
		} catch (error) {
			console.warn('⚠️ Graceful shutdown cleanup warning', error)
		} finally {
			process.exit(0)
		}
	}

	if (globalRuntime.__signalHandlers) {
		process.removeListener('SIGINT', globalRuntime.__signalHandlers.sigint)
		process.removeListener('SIGTERM', globalRuntime.__signalHandlers.sigterm)
	}

	const handleSigint = () => { void shutdown('SIGINT') }
	const handleSigterm = () => { void shutdown('SIGTERM') }

	process.on('SIGINT', handleSigint)
	process.on('SIGTERM', handleSigterm)
	globalRuntime.__signalHandlers = { sigint: handleSigint, sigterm: handleSigterm }
}
