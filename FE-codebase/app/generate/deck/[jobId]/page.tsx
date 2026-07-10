import { DeckLoadingPage } from '@/components/generate/deck-loading-page'

export default function Page({ params }: { params: Promise<{ jobId: string }> }) {
	return <DeckLoadingPage params={params} />
}
