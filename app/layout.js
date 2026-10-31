import "./globals.css";

export const metadata = {
  title: "Study Support · Daybreak",
  description: "A private-by-choice study and emotional support chat for your study day.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
