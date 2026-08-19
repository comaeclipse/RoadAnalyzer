import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import { SensorProvider } from "@/components/providers/SensorProvider";

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
      <body className={inter.className}>
        {/* Live browser sensors, for /calibration. Recording happens on the
            phone; the browser recorder that used to wrap this is gone. */}
        <SensorProvider>{children}</SensorProvider>
      </body>
    </html>
  );
}
