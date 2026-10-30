import "./globals.css";

export const metadata = {
  title: "Face AI Detector",
  description: "Real-time client-side face expression, age, and gender analysis.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}