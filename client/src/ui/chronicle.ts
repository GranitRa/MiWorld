import { MARS_SOL_SECONDS, type ChronicleEvent, type Vec2 } from "@miworld/shared";

const CATEGORY_COLOR: Record<string, string> = {
  founding: "#c9a227",
  construction: "#7fb0d8",
  population: "#8fd8a0",
  resources: "#d88f6a",
  earth: "#b9a0e0",
  crisis: "#e06a6a",
  milestone: "#ffd27a",
};

/** Scrolling colony log. Click an entry → the camera flies to where it happened. */
export class Chronicle {
  private readonly listEl: HTMLElement;
  private readonly seen = new Set<number>();

  constructor(
    root: HTMLElement,
    private readonly onSelect: (hint: Vec2) => void,
  ) {
    const panel = document.createElement("div");
    panel.id = "chronicle";
    panel.innerHTML = `<div class="chead">The Chronicle</div><div class="clist"></div>`;
    root.appendChild(panel);
    this.listEl = panel.querySelector(".clist")!;
    injectStyles();
  }

  seed(events: ChronicleEvent[]): void {
    for (const e of events) this.add(e);
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  add(e: ChronicleEvent): void {
    if (e.id != null) {
      if (this.seen.has(e.id)) return;
      this.seen.add(e.id);
    }
    const sol = Math.floor(e.worldTimeSec / MARS_SOL_SECONDS);
    const row = document.createElement("div");
    row.className = "centry";
    row.style.borderLeftColor = CATEGORY_COLOR[e.category] ?? "#888";
    row.innerHTML = `<div class="cw">Sol ${sol}</div><div class="ct">${escape(e.title)}</div><div class="cb">${escape(e.body)}</div>`;
    if (e.cameraHint) {
      row.classList.add("clickable");
      row.addEventListener("click", () => this.onSelect(e.cameraHint!));
    }
    this.listEl.appendChild(row);
    while (this.listEl.childElementCount > 120) this.listEl.removeChild(this.listEl.firstChild!);
    const nearBottom =
      this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 60;
    if (nearBottom) this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}

const escape = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

function injectStyles(): void {
  const s = document.createElement("style");
  s.textContent = `
    #chronicle { position:absolute; top:14px; right:14px; width:300px; max-height:60vh;
      display:flex; flex-direction:column; background:rgba(20,16,12,.55); backdrop-filter:blur(3px);
      border:1px solid rgba(233,220,195,.14); border-radius:8px; color:#e9dcc3;
      font-family: ui-sans-serif, system-ui, sans-serif; overflow:hidden; }
    #chronicle .chead { padding:8px 12px; font-size:12px; letter-spacing:.12em; text-transform:uppercase;
      opacity:.7; border-bottom:1px solid rgba(233,220,195,.12); }
    #chronicle .clist { overflow-y:auto; padding:4px 0; }
    #chronicle .centry { padding:6px 12px 7px; border-left:3px solid #888; margin:2px 6px;
      background:rgba(255,255,255,.02); border-radius:0 4px 4px 0; }
    #chronicle .centry.clickable { cursor:pointer; }
    #chronicle .centry.clickable:hover { background:rgba(255,255,255,.07); }
    #chronicle .cw { font-size:10px; opacity:.5; font-variant-numeric:tabular-nums; }
    #chronicle .ct { font-size:13px; font-weight:600; margin-top:1px; }
    #chronicle .cb { font-size:12px; opacity:.8; margin-top:1px; line-height:1.3; }
  `;
  document.head.appendChild(s);
}
