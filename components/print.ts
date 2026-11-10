"use client";

/**
 * Print label PDF(s) for the given orders. Loads the PDF in a hidden iframe and opens the
 * browser print dialog (choose the thermal printer, 10×15 cm, margins: none, scale: actual size).
 * Falls back to opening the PDF in a new tab.
 */
export async function printLabels(orderIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const url = `/api/labels?ids=${orderIds.map(encodeURIComponent).join(",")}`;
  const res = await fetch(url);
  if (!res.ok || !res.headers.get("content-type")?.includes("pdf")) {
    const html = await res.text();
    const msg = html.match(/color:#8c1d2a">([^<]+)/)?.[1] ?? `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = blobUrl;
  document.body.appendChild(frame);
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(blobUrl, "_blank");
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  };
  return { ok: true };
}
