// QR codes via qrcodejs 1.0.0, loaded once on first use.
const SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
let loading;

function load() {
  if (window.QRCode) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.onload = resolve;
    script.onerror = () => { loading = null; reject(new Error("QR code library failed to load")); };
    document.head.append(script);
  });
  return loading;
}

// Draws a QR code for text into el (replacing what was there). Shows the text if the library can't load.
export async function showQR(el, text, size = 220) {
  if (el.dataset.qr === text) return;
  el.dataset.qr = text;
  try {
    await load();
    el.innerHTML = "";
    new window.QRCode(el, { text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
    el.removeAttribute("title"); // qrcodejs adds the link as a tooltip
  } catch {
    el.textContent = text;
  }
}
