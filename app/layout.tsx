import type { Metadata } from "next";
import Link from "next/link";
import { Building2, FileText, Heart, Landmark, Settings, Target } from "lucide-react";

import "./globals.css";

const navigation = [
  { href: "/opportunities", label: "Opportunities", icon: Target },
  { href: "/saved", label: "Saved", icon: Heart },
  { href: "/bids", label: "Bids", icon: FileText },
  { href: "/company", label: "Company", icon: Building2 },
  { href: "/admin", label: "Admin", icon: Settings },
];

export const metadata: Metadata = {
  title: { default: "govTract", template: "%s | govTract" },
  description: "Government contracting opportunity intelligence and bid workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
          <aside className="border-b bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
            <div className="flex h-16 items-center gap-2 border-b px-6">
              <div className="grid size-9 place-items-center rounded-xl bg-[var(--primary)] text-white">
                <Landmark className="size-5" />
              </div>
              <div>
                <div className="font-semibold tracking-tight">govTract</div>
                <div className="text-xs text-[var(--muted-foreground)]">Houston-first procurement</div>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col">
              {navigation.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
