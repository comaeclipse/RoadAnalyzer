import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SensorProvider } from "@/components/providers/SensorProvider";
import { RecordingProvider } from "@/components/providers/RecordingProvider";
import Script from "next/script";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Road Analyzer - iOS Sensor Dashboard",
  description: "Live accelerometer and GPS sensor visualization for iOS",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body className={inter.className}>
        <SensorProvider>
          <RecordingProvider>{children}</RecordingProvider>
        </SensorProvider>
      </body>
    </html>
  );
}
