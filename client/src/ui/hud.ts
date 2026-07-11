import { GOOD_CAP, MARS_SOL_SECONDS, type HudSummary } from "@miworld/shared";

// Top-left HUD: title, connection status, sol clock, and a row of colony vitals
// (population + key stockpiles as mini-meters + dust).
const VITALS: { key: keyof HudSummary["stock"]; label: string }[] = [
  { key: "power", label: "PWR" },
  { key: "oxygen", label: "O₂" },
  { key: "water", label: "H₂O" },
  { key: "food", label: "FOOD" },
];

export class Hud {
  private readonly statusEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly vitalsEl: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div id="hud">
        <div id="title">MiWorld</div>
        <div id="status">connecting…</div>
        <div id="clock"></div>
        <div id="vitals"></div>
      </div>
      <div id="hint">drag orbit · shift-drag pan · scroll zoom · click a colonist</div>
    `;
    this.statusEl = root.querySelector("#status")!;
    this.clockEl = root.querySelector("#clock")!;
    this.vitalsEl = root.querySelector("#vitals")!;
    injectStyles();
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setClock(worldTimeSec: number): void {
    const sol = Math.floor(worldTimeSec / MARS_SOL_SECONDS);
    const f = (worldTimeSec % MARS_SOL_SECONDS) / MARS_SOL_SECONDS;
    const hh = String(Math.floor(f * 24)).padStart(2, "0");
    const mm = String(Math.floor(((f * 24) % 1) * 60)).padStart(2, "0");
    this.clockEl.textContent = `Sol ${sol} · ${hh}:${mm}`;
  }

  setVitals(h: HudSummary): void {
    const meters = VITALS.map(({ key, label }) => {
      const v = h.stock[key] ?? 0;
      const frac = Math.max(0, Math.min(1, v / (GOOD_CAP[key] || 1)));
      const hue = 90 * frac + 8; // red(low) → green(full)
      return `<span class="v"><b>${label}</b><span class="bar"><span style="width:${(frac * 100).toFixed(0)}%;background:hsl(${hue} 60% 50%)"></span></span></span>`;
    }).join("");
    this.vitalsEl.innerHTML =
      `<span class="v pop">👥 ${h.pop}</span>${meters}<span class="v dust">🌫 ${(h.dust * 100).toFixed(0)}%</span>`;
  }
}

function injectStyles(): void {
  const s = document.createElement("style");
  s.textContent = `
    #app { background:#0b0a0e; overflow:hidden; }
    canvas { display:block; }
    #hud { position:absolute; top:14px; left:16px; color:#e9dcc3;
      font-family: ui-sans-serif, system-ui, sans-serif; text-shadow:0 1px 3px rgba(0,0,0,.6);
      user-select:none; pointer-events:none; }
    #title { font-size:20px; letter-spacing:.14em; font-weight:600; }
    #status { font-size:13px; opacity:.85; margin-top:2px; }
    #clock { font-size:15px; font-variant-numeric:tabular-nums; margin-top:4px; }
    #vitals { display:flex; gap:10px; align-items:center; margin-top:8px; font-size:12px; }
    #vitals .v { display:flex; align-items:center; gap:4px; }
    #vitals .v b { font-weight:600; opacity:.8; }
    #vitals .bar { display:inline-block; width:42px; height:6px; border-radius:3px;
      background:rgba(255,255,255,.15); overflow:hidden; }
    #vitals .bar > span { display:block; height:100%; }
    #vitals .pop { font-size:13px; }
    #hint { position:fixed; bottom:14px; left:16px; font-size:12px; opacity:.5; color:#e9dcc3;
      font-family: ui-sans-serif, system-ui, sans-serif; pointer-events:none; }
  `;
  document.head.appendChild(s);
}
