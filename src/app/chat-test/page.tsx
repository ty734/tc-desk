import Script from "next/script";

// Internal test page for the storefront chat widget — same script tag the
// Shopify theme will use, served same-origin so CORS isn't in play here.
export default function ChatTestPage() {
  return (
    <div className="min-h-screen bg-violet-50 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <h1 className="text-2xl font-bold mb-2">Chat widget test page</h1>
        <p className="text-gray-500 text-sm">
          The bubble in the bottom-right corner is exactly what storefront visitors will see.
          Ask it about products, shipping, returns, or an order.
        </p>
      </div>
      <Script src="/chat-widget.js" strategy="afterInteractive" data-brand="living-well" />
    </div>
  );
}
