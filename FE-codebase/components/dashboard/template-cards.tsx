'use client'

const TEMPLATES = [
	{ name: 'Business Pitch', gradient: 'from-blue-600 to-indigo-800' },
	{ name: 'Education', gradient: 'from-emerald-500 to-teal-700' },
	{ name: 'Marketing', gradient: 'from-orange-500 to-red-600' },
	{ name: 'Minimalist', gradient: 'from-zinc-600 to-zinc-800' },
]

export function TemplateCards() {
	return (
		<div className="mt-5">
			<p className="mb-2 text-xs text-zinc-500">Perlu inspirasi?</p>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{TEMPLATES.map((t) => (
					<button
						key={t.name}
						className={`group relative h-20 overflow-hidden rounded-lg bg-gradient-to-br ${t.gradient} text-left transition-transform hover:scale-[1.02]`}
					>
						<div className="absolute inset-0 bg-black/20" />
						<div className="absolute bottom-2 left-2 text-xs font-medium text-white">{t.name}</div>
					</button>
				))}
			</div>
		</div>
	)
}
