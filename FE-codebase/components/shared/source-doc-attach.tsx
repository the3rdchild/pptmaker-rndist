'use client'

// Attach-a-document control, shared by the homepage prompt box and the
// /outline page so both steps show the same chips and the same counts.
//
// Parsing is synchronous-feeling but genuinely slow on a big thesis (a few
// seconds, most of it re-encoding figures), so the button reports progress
// rather than freezing silently.

import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/shared/button'
import { notify } from '@/components/ui/sonner'
import { extractDocx, isSupportedSourceFile } from '@/lib/source-docs/docx-extract'
import {
	deleteSourceDoc,
	loadSourceDocs,
	saveSourceDoc,
	serializeSourceIds,
} from '@/lib/source-docs/store'
import type { SourceDoc } from '@/lib/source-docs/types'

/** Word caps out well below this; anything larger is a sign the file is not
 *  what it claims to be, and parsing it would lock the tab for a long time. */
const MAX_FILE_BYTES = 60 * 1024 * 1024

export function useSourceDocs(initialIds: string[]) {
	const [docs, setDocs] = useState<SourceDoc[]>([])
	const [loading, setLoading] = useState(initialIds.length > 0)
	// Restore-once: the ids come from the URL, and re-running on every render
	// pass would refetch the whole payload (megabytes of base64) each time.
	const restoredRef = useRef(false)

	useEffect(() => {
		if (restoredRef.current) return
		restoredRef.current = true
		if (initialIds.length === 0) {
			setLoading(false)
			return
		}
		let cancelled = false
		loadSourceDocs(initialIds)
			.then((loaded) => {
				if (!cancelled) setDocs(loaded)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [initialIds])

	const add = useCallback((doc: SourceDoc) => {
		setDocs((current) => [...current.filter((d) => d.id !== doc.id), doc])
	}, [])

	const remove = useCallback((id: string) => {
		setDocs((current) => current.filter((d) => d.id !== id))
		void deleteSourceDoc(id)
	}, [])

	return { docs, loading, add, remove, ids: serializeSourceIds(docs.map((d) => d.id)) }
}

export function summarizeSourceDoc(doc: SourceDoc): string {
	const parts: string[] = []
	if (doc.figures.length > 0) parts.push(`${doc.figures.length} gambar`)
	if (doc.tables.length > 0) parts.push(`${doc.tables.length} tabel`)
	return parts.length > 0 ? parts.join(' · ') : 'teks saja'
}

interface SourceDocAttachProps {
	docs: SourceDoc[]
	onAdd: (doc: SourceDoc) => void
	onRemove: (id: string) => void
	disabled?: boolean
	/** Compact variant for the /outline toolbar, which is already crowded. */
	size?: 'sm' | 'xs'
}

export function SourceDocAttach({ docs, onAdd, onRemove, disabled, size = 'sm' }: SourceDocAttachProps) {
	const inputRef = useRef<HTMLInputElement | null>(null)
	const [parsing, setParsing] = useState(false)

	const handleFile = async (file: File | null | undefined) => {
		if (!file) return
		if (!isSupportedSourceFile(file.name)) {
			notify.warning('Format belum didukung', 'Untuk sekarang baru file .docx yang bisa dilampirkan.')
			return
		}
		if (file.size > MAX_FILE_BYTES) {
			notify.warning('File terlalu besar', 'Maksimal 60 MB.')
			return
		}
		setParsing(true)
		try {
			const doc = await extractDocx(file)
			if (doc.blocks.length === 0) {
				notify.warning('Dokumen kosong', 'Tidak ada teks, gambar, atau tabel yang bisa dibaca.')
				return
			}
			await saveSourceDoc(doc)
			onAdd(doc)
			notify.success(
				'Dokumen dilampirkan',
				`${doc.fileName} — ${summarizeSourceDoc(doc)} siap dipakai di slide.`,
			)
		} catch (error) {
			notify.error(
				'Gagal membaca dokumen',
				error instanceof Error ? error.message : 'File .docx tidak bisa diproses.',
			)
		} finally {
			setParsing(false)
		}
	}

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept=".docx"
				className="hidden"
				onChange={(e) => {
					void handleFile(e.target.files?.[0])
					e.target.value = ''
				}}
			/>
			<Button
				variant="subtle"
				size="sm"
				disabled={disabled || parsing}
				onClick={() => inputRef.current?.click()}
				title="Lampirkan dokumen .docx sebagai bahan. Teksnya jadi sumber isi slide, dan gambar/tabel di dalamnya bisa langsung dipasang ke slide."
			>
				{parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
				{parsing ? 'Membaca dokumen…' : size === 'xs' ? 'Dokumen' : 'Tambah Dokumen'}
			</Button>

			{docs.map((doc) => (
				<span
					key={doc.id}
					className="flex max-w-[22rem] items-center gap-1.5 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-2.5 py-1.5 text-xs text-zinc-300"
					title={`${doc.fileName} — ${summarizeSourceDoc(doc)}`}
				>
					<FileText className="h-3.5 w-3.5 shrink-0 text-[#a29bfe]" />
					<span className="truncate">{doc.fileName}</span>
					<span className="shrink-0 text-zinc-500">{summarizeSourceDoc(doc)}</span>
					<button
						type="button"
						onClick={() => onRemove(doc.id)}
						className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
						aria-label={`Hapus ${doc.fileName}`}
					>
						<X className="h-3 w-3" />
					</button>
				</span>
			))}
		</>
	)
}
