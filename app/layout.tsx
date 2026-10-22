import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = safeBaseUrl(protocol, host);
  const image = new URL("/og.png", baseUrl).toString();

  return {
    title: "Job Agent — Personal Job Search Workspace",
    description: "Discover, compare, tailor, and track your best job opportunities.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Job Agent",
      description: "Your next role, organized.",
      images: [{ url: image, width: 1728, height: 909, alt: "Job Agent personal job-search dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Job Agent",
      description: "Your next role, organized.",
      images: [image],
    },
  };
}

// Applies a saved light/dark choice before first paint so the page never
// flashes the wrong theme. No saved choice means "follow the system".
const THEME_BOOT = `try{var t=localStorage.getItem("jobagent:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body>{children}</body>
    </html>
  );
}

function safeBaseUrl(protocol: string, host: string) {
  try {
    return new URL(`${protocol === "http" ? "http" : "https"}://${host}`);
  } catch {
    return new URL("http://localhost:3000");
  }
}
