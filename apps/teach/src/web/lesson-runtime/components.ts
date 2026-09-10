// Interactive component kit. The author emits declarative markup with known
// classes (the markup contract documented in the lesson-author prompt); this
// trusted code wires up behaviour. Migrated and EXPANDED from the old
// hydrateLesson() in App.tsx. Existing class names/markup are preserved so
// already-published lessons keep working; `tabs` is new. (collapse, callout,
// stepper and annotated-code are CSS-only — no hydration needed.)

function hydrateQuizzes(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".teach-quiz").forEach((quiz) => {
    if (quiz.dataset.teachHydrated) return;
    quiz.dataset.teachHydrated = "1";
    const answer = (quiz.getAttribute("data-answer") || "").trim();
    const explain = quiz.querySelector<HTMLElement>(".teach-explain");
    if (explain) explain.style.display = "none";
    const opts = Array.from(
      quiz.querySelectorAll<HTMLElement>(".teach-opts > li, .teach-opt"),
    );
    const isAnswer = (o: HTMLElement) =>
      o.hasAttribute("data-correct") ||
      (!!answer && (o.getAttribute("data-key") || "").trim() === answer);
    opts.forEach((opt) => {
      opt.setAttribute("role", "button");
      opt.tabIndex = 0;
      const choose = () => {
        opts.forEach((o) => o.classList.remove("is-chosen", "is-wrong"));
        opt.classList.add("is-chosen");
        if (isAnswer(opt)) {
          opt.classList.add("is-correct");
        } else {
          opt.classList.add("is-wrong");
          opts.forEach((o) => isAnswer(o) && o.classList.add("is-correct"));
        }
        if (explain) explain.style.display = "";
      };
      opt.addEventListener("click", choose);
      opt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
    });
  });
}

function hydrateFlips(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".teach-flip").forEach((flip) => {
    if (flip.dataset.teachHydrated) return;
    flip.dataset.teachHydrated = "1";
    const back = flip.querySelector<HTMLElement>(".teach-back");
    if (!back) return;
    back.style.display = "none";
    const hint = document.createElement("div");
    hint.className = "teach-flip-hint";
    hint.textContent = "Tap to reveal";
    flip.appendChild(hint);
    flip.setAttribute("role", "button");
    flip.tabIndex = 0;
    const toggle = () => {
      const show = back.style.display === "none";
      back.style.display = show ? "" : "none";
      hint.textContent = show ? "Tap to hide" : "Tap to reveal";
    };
    flip.addEventListener("click", toggle);
    flip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function hydrateTabs(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".teach-tabs").forEach((tabs) => {
    if (tabs.dataset.teachHydrated) return;
    tabs.dataset.teachHydrated = "1";
    const buttons = Array.from(tabs.querySelectorAll<HTMLElement>(".teach-tab"));
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>(".teach-tabpanel"));
    if (buttons.length === 0) return;
    const select = (key: string) => {
      buttons.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === key));
      panels.forEach((p) => p.classList.toggle("is-active", p.dataset.tab === key));
    };
    buttons.forEach((b) => {
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => b.dataset.tab && select(b.dataset.tab));
    });
    // Activate the first tab (or whichever the author pre-marked active).
    const initial =
      buttons.find((b) => b.classList.contains("is-active"))?.dataset.tab ??
      buttons[0]?.dataset.tab;
    if (initial) select(initial);
  });
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to execCommand */
  }
  // Sandboxed iframes often lack the async Clipboard API; fall back.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* nothing more we can do */
  }
  document.body.removeChild(ta);
}

// Add copy buttons to every code block. Runs AFTER highlighting so it also
// covers Shiki-rendered <pre>. Skips Mermaid holders.
function hydrateCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    if (pre.dataset.teachCopy) return;
    if (pre.classList.contains("mermaid")) return;
    pre.dataset.teachCopy = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "teach-copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const text = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
      void copyText(text).then(() => {
        btn.textContent = "Copied";
        window.setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

/** Wire up all interactive components. Idempotent (guarded per element). */
export function hydrateComponents(root: ParentNode): void {
  hydrateQuizzes(root);
  hydrateFlips(root);
  hydrateTabs(root);
}

export { hydrateCopyButtons };
