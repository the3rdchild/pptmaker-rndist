import health from './health.route'
import sessionRoute from './session.route'
import deckRoute from './deck.route'
import statusRoute from './status.route'
import streamRoute from './stream.route'
import toolsRoute from './tools.route'

export const v1Routes = [
	health,
	sessionRoute,
	deckRoute,
	statusRoute,
	streamRoute,
	toolsRoute,
]
