/**
 * OpenCharts Mobile addition: the start screen while the live adapter loads
 * the exchanges' pair lists (each exchange has up to 12 s to answer). Inline
 * styles: it renders before the terminal's scoped stylesheet applies.
 */
export function MobileSplash() {
  return (
    <div
      data-testid="mobile-splash"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#0B1015",
        color: "#e6e8ec",
        font: "15px/1.4 system-ui, -apple-system, Roboto, sans-serif",
      }}
    >
      <style>{"@keyframes oc-spin{to{transform:rotate(360deg)}}"}</style>
      <img src="./icons/app-icon-192.png" alt="" width={84} height={84} style={{ borderRadius: 20 }} />
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>OpenCharts</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#a3a8b3", fontSize: 14 }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid #14b8a6",
            borderTopColor: "transparent",
            animation: "oc-spin 0.8s linear infinite",
          }}
        />
        Connecting to the exchanges…
      </div>
    </div>
  );
}
