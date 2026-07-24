import { createRouter } from '@/config/create-app'
import { DeckHandler } from '@/modules/deck/handler'
import { DeckVersionHandler } from '@/modules/deck-version/handler'

const deckRoute = createRouter().basePath('/decks')

deckRoute.get('/', (c) => new DeckHandler(c).list())
deckRoute.get('/:id', (c) => new DeckHandler(c).getById())
deckRoute.post('/', (c) => new DeckHandler(c).create())
deckRoute.put('/:id', (c) => new DeckHandler(c).update())
deckRoute.patch('/:id', (c) => new DeckHandler(c).patch())
deckRoute.delete('/:id', (c) => new DeckHandler(c).remove())

deckRoute.get('/:id/versions', (c) => new DeckVersionHandler(c).list())
deckRoute.get('/:id/versions/:versionId', (c) => new DeckVersionHandler(c).getOne())
deckRoute.post('/:id/versions/:versionId/restore', (c) => new DeckVersionHandler(c).restore())

export default deckRoute
