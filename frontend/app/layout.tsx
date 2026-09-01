import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// Variable font: omit `weight`, and list extra axes. `wght` is implicit and
// must not appear in `axes` — next/font throws if it does.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

// IBM Plex Mono is not a variable font on Google Fonts, so weights are explicit.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DebtPilot — a debt plan your budget can support",
  description:
    "Turn monthly income, expenses, and debts into an affordable payoff plan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body>
        <AppHeader />
        {children}
        <footer className="mx-auto flex max-w-[1280px] flex-col justify-between gap-3 border-t border-rule px-5 py-8 text-sm text-ink-soft sm:flex-row sm:px-8 lg:px-10">
          <p>DebtPilot · deterministic planning, private by default.</p>
          <p>Estimates only — not financial advice.</p>
        </footer>
      </body>
    </html>
  );
}
