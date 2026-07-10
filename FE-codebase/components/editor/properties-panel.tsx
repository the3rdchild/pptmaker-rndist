'use client'

import { useEditorStore } from '@/store/editor.store'
import { Trash2 } from 'lucide-react'

export function PropertiesPanel() {
	const { presentation, slideIndex, activeElementIds } = useEditorStore()
	const { updateElement, deleteElement } = useEditorStore()

	const slide = presentation.slides[slideIndex]
	const rawEl = slide?.elements.find((el) => el.id === activeElementIds[0])
	// Lines have no height/rotate — exclude from properties panel (deferred)
	const selectedEl = rawEl && rawEl.type !== 'line' ? rawEl : null

	if (!selectedEl) {
		return (
			<aside className="flex h-full w-[240px] shrink-0 flex-col border-l border-[#1e1e30] bg-[#13131f] p-4">
				<p className="text-xs text-zinc-500">Select an element to edit its properties</p>
			</aside>
		)
	}

	const isText = selectedEl.type === 'text'
	const textEl = isText ? (selectedEl as typeof selectedEl & { content: string; defaultColor: string; lineHeight?: number }) : null

	return (
		<aside className="flex h-full w-[240px] shrink-0 flex-col overflow-y-auto border-l border-[#1e1e30] bg-[#13131f] p-4">
			<h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
				{selectedEl.type} Properties
			</h3>

			{/* Position */}
			<Section label="Position">
				<div className="grid grid-cols-2 gap-2">
					<NumberField label="X" value={Math.round(selectedEl.left)} onChange={(v) => updateElement(selectedEl.id, { left: v })} />
					<NumberField label="Y" value={Math.round(selectedEl.top)} onChange={(v) => updateElement(selectedEl.id, { top: v })} />
					<NumberField label="W" value={Math.round(selectedEl.width)} onChange={(v) => updateElement(selectedEl.id, { width: v })} />
					<NumberField label="H" value={Math.round(selectedEl.height)} onChange={(v) => updateElement(selectedEl.id, { height: v })} />
				</div>
			</Section>

			{/* Rotation */}
			<Section label="Rotation">
				<NumberField label="°" value={Math.round(selectedEl.rotate)} onChange={(v) => updateElement(selectedEl.id, { rotate: v })} />
			</Section>

			{/* Text properties */}
			{isText && textEl && (
				<>
					<Section label="Color">
						<input
							type="color"
							value={textEl.defaultColor}
							onChange={(e) => updateElement(selectedEl.id, { defaultColor: e.target.value })}
							className="h-8 w-full cursor-pointer rounded border border-[#2d2e42] bg-transparent"
						/>
					</Section>
					<Section label="Line Height">
						<input
							type="range"
							min={1}
							max={3}
							step={0.1}
							value={textEl.lineHeight ?? 1.5}
							onChange={(e) => updateElement(selectedEl.id, { lineHeight: Number(e.target.value) })}
							className="w-full"
						/>
					</Section>
				</>
			)}

			{/* Delete */}
			<button
				onClick={() => deleteElement(selectedEl.id)}
				className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-red-900/50 bg-red-950/30 py-2 text-xs text-red-400 hover:bg-red-950/50"
			>
				<Trash2 className="h-3.5 w-3.5" /> Delete Element
			</button>
		</aside>
	)
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="mb-4">
			<label className="mb-1.5 block text-[11px] font-medium text-zinc-500">{label}</label>
			{children}
		</div>
	)
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
	return (
		<div className="flex items-center gap-1">
			<span className="text-[10px] text-zinc-600 w-3">{label}</span>
			<input
				type="number"
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="h-7 w-full rounded border border-[#2d2e42] bg-[#1a1b2e] px-2 text-xs text-zinc-200 outline-none focus:border-[#6c5ce7]"
			/>
		</div>
	)
}
