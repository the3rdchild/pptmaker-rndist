import { EditorPage } from '@/components/editor/editor-page'

export default function Page({ params }: { params: Promise<{ deckId: string }> }) {
	return <EditorPage params={params} />
}
