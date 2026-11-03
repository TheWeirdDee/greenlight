import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { HydrationMarker } from "@/components/hydration-marker";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz", "SOFT"] });

export const metadata: Metadata = {
  title: { default: "Greenlight — know when you're actually ready to launch", template: "%s · Greenlight" },
  description:
    "Greenlight is a launch-readiness workspace for Web3 teams on Base. Contributors confirm, funding is verified onchain, and readiness recalculates from real events.",
  openGraph: {
    title: "Greenlight — know when you're actually ready to launch",
    description: "Dependency-driven launch readiness, verified onchain on Base.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e0b" },
  ],
};

// Resolves light / dark / system before first paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var p=localStorage.getItem('gl-theme')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themePref=p;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <HydrationMarker />
        {children}
      </body>
    </html>
  );
}
