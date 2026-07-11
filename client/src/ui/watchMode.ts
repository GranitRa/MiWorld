import type { ChronicleEvent } from "@miworld/shared";

// "Watch mode": the screensaver / documentary view. Hides every UI panel, letterboxes the
// frame, hands the camera to the auto-director, and shows the latest chronicle beat as a
// lower-third caption. Toggle with the on-screen button or the "W" key; the button stays
// visible so a viewer can always get out.

export class WatchMode {
  private on = false;
  private readonly capTitle: HTMLElement;
  private readonly capBody: HTMLElement;
  private readonly btn: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (on: boolean) => void,
  ) {
    injectStyles();
    const layer = document.createElement("div");
    layer.id = "watch";
    layer.innerHTML = `
      <div class="wbar wtop"></div>
      <div class="wbar wbot"></div>
      <div id="wcap"><div id="wcap-t"></div><div id="wcap-b"></div></div>
    `;
    root.appendChild(layer);
    this.capTitle = layer.querySelector("#wcap-t")!;
    this.capBody = layer.querySelector("#wcap-b")!;

    this.btn = document.createElement("button");
    this.btn.id = "watch-btn";
    this.btn.textContent = "◉ Watch";
    this.btn.addEventListener("click", () => this.toggle());
    root.appendChild(this.btn);

    window.addEventListener("keydown", (e) => {
      if (e.key === "w" || e.key === "W") this.toggle();
    });
  }

  toggle(): void {
    this.set(!this.on);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    document.body.classList.toggle("watch-on", on);
    this.btn.textContent = on ? "✕ Exit" : "◉ Watch";
    this.onChange(on);
  }

  /** Show a beat as the lower-third caption (only while watch mode is on). */
  setCaption(e: ChronicleEvent): void {
    this.capTitle.textContent = e.title;
    this.capBody.textContent = e.body;
    // Re-trigger the fade-in animation.
    const cap = this.capTitle.parentElement!;
    cap.classList.remove("show");
    void cap.offsetWidth; // reflow
    cap.classList.add("show");
  }
}

function injectStyles(): void {
  const s = document.createElement("style");
  s.textContent = `
    #watch { position:fixed; inset:0; pointer-events:none; z-index:40; }
    #watch .wbar { position:absolute; left:0; right:0; height:0; background:#000;
      transition:height .6s ease; }
    #watch .wtop { top:0; } #watch .wbot { bottom:0; }
    body.watch-on #watch .wbar { height:8vh; }
    #wcap { position:absolute; left:0; right:0; bottom:9vh; text-align:center;
      color:#f4ead3; font-family: ui-serif, Georgia, serif; opacity:0;
      transform:translateY(8px); transition:opacity .5s ease, transform .5s ease;
      text-shadow:0 2px 14px rgba(0,0,0,.85); padding:0 8vw; }
    body.watch-on #wcap.show { opacity:1; transform:translateY(0); }
    body:not(.watch-on) #wcap { opacity:0 !important; }
    #wcap-t { font-size:clamp(18px,2.4vw,30px); font-weight:600; letter-spacing:.01em; }
    #wcap-b { font-size:clamp(12px,1.4vw,17px); opacity:.85; margin-top:4px; font-family: ui-sans-serif, system-ui, sans-serif; }
    #watch-btn { position:fixed; left:14px; bottom:14px; z-index:41; cursor:pointer;
      background:rgba(20,16,12,.6); color:#e9dcc3; border:1px solid rgba(233,220,195,.22);
      border-radius:999px; padding:7px 14px; font:600 12px/1 ui-sans-serif,system-ui,sans-serif;
      letter-spacing:.06em; backdrop-filter:blur(3px); transition:background .2s; }
    #watch-btn:hover { background:rgba(40,32,24,.8); }
    /* Hide all interactive UI while watching. */
    body.watch-on #hud, body.watch-on #hint, body.watch-on #chronicle, body.watch-on #inspector {
      opacity:0 !important; pointer-events:none !important; transition:opacity .4s ease; }
  `;
  document.head.appendChild(s);
}
