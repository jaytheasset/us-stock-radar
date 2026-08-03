import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export default function DevelopmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
