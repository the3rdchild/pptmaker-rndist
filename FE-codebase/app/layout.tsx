import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/session-provider";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
	weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
	title: "PPT Maker",
	description: "Buat presentasi memukau dengan AI dalam hitungan menit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="id" className={`h-full antialiased ${inter.variable}`} suppressHydrationWarning>
			<body suppressHydrationWarning className="h-full text-zinc-100">
				<SessionProvider>{children}</SessionProvider>
			</body>
		</html>
	);
}
