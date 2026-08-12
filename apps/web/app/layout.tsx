import type { ReactNode } from "react";

export const metadata = {
  title: "Randevu",
  description:
    "End-to-end encrypted MCP rail for autonomous agents to negotiate and collaborate.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
