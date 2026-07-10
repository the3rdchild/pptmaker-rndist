import { OutlinePage } from '@/components/outline/outline-page'

export default function GeneratePage({ params }: { params: Promise<{ jobId: string }> }) {
	return <OutlinePage params={params} />
}
