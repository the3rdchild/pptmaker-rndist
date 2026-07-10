'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Undo2, Redo2, Palette, Wand2, Play, Download, HelpCircle, Sparkles, Loader2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { Button } from '@/components/shared/button'
import { exportPPTX } from '@/lib/export-pptx'

export function EditorHeader({ onAIGenerate, onAgent, onTheme, onPresent }: { onAIGenerate: () => void; onAgent: () => void; onTheme: () => void; onPresent: () => void }) {
	const router = useRouter()
	const { presentation, undo, redo, historyIndex, history, saving, dirty } = useEditorStore()
	const [exporting, setExporting] = useState(false)

	const handleExport = async () => {
		setExporting(true)
		try {
			await exportPPTX(presentation)
		} catch (e) {
			console.error('Export failed', e)
		} finally {
			setExporting(false)
		}
	}

	const canUndo = historyIndex > 0
	const canRedo = historyIndex < history.length - 1

	return (
		<header className="flex h-12 shrink-0 items-center justify-between border-b border-[#1e1e30] bg-[#13131f] px-3">
			<div className="flex items-center gap-2">
				<button onClick={() => router.push('/')} className="rounded p-1.5 text-zinc-400 hover:bg-[#2d2e42] hover:text-white">
					<ArrowLeft className="h-4 w-4" />
				</button>
				<div className="flex items-center gap-1.5">
					<div className="flex h-6 w-6 items-center justify-center rounded bg-[#6c5ce7]">
						<Wand2 className="h-3 w-3 text-white" />
					</div>
					<input
						value={presentation.title}
						onChange={(e) => useEditorStore.getState().setTitle(e.target.value)}
						className="w-64 bg-transparent text-sm font-medium text-white outline-none hover:text-[#a29bfe] focus:text-[#a29bfe]"
					/>
					{saving && <span className="text-[10px] text-zinc-500">Saving...</span>}
					{dirty && !saving && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
				</div>
				<div className="ml-3 flex items-center gap-0.5">
					<button onClick={undo} disabled={!canUndo} className="rounded p-1.5 text-zinc-400 hover:bg-[#2d2e42] hover:text-white disabled:opacity-30">
						<Undo2 className="h-4 w-4" />
					</button>
					<button onClick={redo} disabled={!canRedo} className="rounded p-1.5 text-zinc-400 hover:bg-[#2d2e42] hover:text-white disabled:opacity-30">
						<Redo2 className="h-4 w-4" />
					</button>
				</div>
			</div>

			<div className="flex items-center gap-1">
				<Button variant="ghost" size="sm" onClick={onTheme}>
					<Palette className="h-3.5 w-3.5" /> Theme
				</Button>
				<Button variant="ghost" size="sm" onClick={onAgent}>
					<Wand2 className="h-3.5 w-3.5" /> AI Assistant
				</Button>
				<Button variant="ghost" size="sm" onClick={onAIGenerate}>
					<Sparkles className="h-3.5 w-3.5" /> Generate
				</Button>
				<Button variant="ghost" size="sm" onClick={onPresent}>
					<Play className="h-3.5 w-3.5" /> Preview
				</Button>
				<Button variant="primary" size="sm" onClick={handleExport} disabled={exporting}>
					{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
					{exporting ? 'Exporting...' : 'Export'}
				</Button>
				<button className="ml-1 rounded-full bg-orange-500 p-1 text-white hover:bg-orange-600">
					<HelpCircle className="h-3.5 w-3.5" />
				</button>
			</div>
		</header>
	)
}
