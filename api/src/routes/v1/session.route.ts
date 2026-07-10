import { createRouter } from '@/config/create-app'
import { SessionHandler } from '@/modules/session/handler'

const sessionRoute = createRouter().basePath('/session')

sessionRoute.post('/', (c) => new SessionHandler(c).handle())

export default sessionRoute
