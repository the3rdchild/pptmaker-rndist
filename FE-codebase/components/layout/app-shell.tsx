import { Sidebar } from './sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full w-full overflow-hidden">
			<Sidebar />
			<main className="flex-1 overflow-y-auto">{children}</main>
		</div>
	)
}
