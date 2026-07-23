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
			<head>
				{/* Preconnect to Google Fonts so the per-pack template fonts
				    (Poppins / Montserrat / Playfair Display / Albert Sans) start
				    loading immediately on first paint instead of waiting for the
				    slide-render path to lazily inject <link> tags — eliminates the
				    visible fallback-font flash users were seeing. */}
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link
					rel="stylesheet"
					href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700;800&family=Playfair+Display:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700&display=swap"
				/>
			</head>
			<body suppressHydrationWarning className="h-full text-zinc-100">
				<SessionProvider>{children}</SessionProvider>
			</body>
		</html>
	);
}
