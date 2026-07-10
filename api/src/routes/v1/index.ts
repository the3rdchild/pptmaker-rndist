import health from './health.route'
import sessionRoute from './session.route'
import deckRoute from './deck.route'
import generateRoute from './generate.route'
import statusRoute from './status.route'
import streamRoute from './stream.route'

export const v1Routes = [
	health,
	sessionRoute,
	deckRoute,
	generateRoute,
	statusRoute,
	streamRoute,
]
