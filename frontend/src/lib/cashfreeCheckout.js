/**
 * Opens Cashfree's hosted checkout for a payment session the server created.
 *
 * The SDK is Cashfree's own v3 script, loaded only when a buyer actually pays, so no page of the app
 * carries it otherwise. Nothing here decides an order is paid: Cashfree sends the buyer back to the
 * store's order page, and that page asks the server, which asks Cashfree.
 */
const SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";
let loading = null;

function loadSdk() {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout opens in a browser."));
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error("The payment page could not be opened.")));
      script.onerror = () => { loading = null; reject(new Error("The payment page could not be loaded. Check your connection and try again.")); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** `environment` is the server's SANDBOX or PRODUCTION; the browser never chooses it. */
export async function openCashfreeCheckout({ paymentSessionId, environment }) {
  if (!paymentSessionId) throw new Error("The payment could not be started. Please try again.");
  const Cashfree = await loadSdk();
  const cashfree = Cashfree({ mode: environment === "PRODUCTION" ? "production" : "sandbox" });
  const result = await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
  if (result?.error) throw new Error(result.error.message || "The payment could not be completed.");
  return result;
}
