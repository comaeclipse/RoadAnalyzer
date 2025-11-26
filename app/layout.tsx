import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SensorProvider } from "@/components/providers/SensorProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Road Analyzer - iOS Sensor Dashboard",
  description: "Live accelerometer and GPS sensor visualization for iOS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body className={inter.className}>
        <SensorProvider>{children}</SensorProvider>
      </body>
    </html>
  );
}
