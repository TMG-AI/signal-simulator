import Script from "next/script";

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      {/* Load parsers BEFORE any page code runs */}
      <Script
        src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"
        strategy="beforeInteractive"
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"
        strategy="beforeInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}
