import { createRouter } from '@/config/create-app'
import { GenerateHandler } from '@/modules/generate/handler'

const generateRoute = createRouter().basePath('/generate')

generateRoute.post('/outline', (c) => new GenerateHandler(c).outline())
generateRoute.post('/deck', (c) => new GenerateHandler(c).deck())
generateRoute.post('/slide', (c) => new GenerateHandler(c).slide())
generateRoute.post('/agent', (c) => new GenerateHandler(c).agent())

export default generateRoute
