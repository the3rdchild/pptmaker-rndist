'use client'

import { AppShell } from '@/components/layout/app-shell'
import { PromptInput } from './prompt-input'
import { TemplateCards } from './template-cards'
import { RecentGrid } from './recent-grid'

export function DashboardPage() {
	return (
		<AppShell>
			<div className="mx-auto max-w-4xl px-8 py-10">
				<PromptInput />
				<TemplateCards />
				<RecentGrid />
			</div>
		</AppShell>
	)
}
