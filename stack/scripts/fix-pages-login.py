#!/usr/bin/env python3
"""Fix GitHub Pages login: define isGitHubPages + refresh tunnel URL."""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def tunnel_url() -> str:
    for rel in ("stack/runtime/public-url.json", "docs/public-url.json"):
        p = ROOT / rel
        if p.exists():
            try:
                data = json.loads(p.read_text())
                base = str(data.get("baseUrl") or "").rstrip("/")
                if base:
                    return base
            except Exception:
                pass
    return "https://herbs-thomson-promo-painting.trycloudflare.com"


def fix_config(path: Path, tunnel: str) -> None:
    if not path.exists():
        print("skip missing", path)
        return
    t = path.read_text()
    if "const isGitHubPages" not in t and "function isGitHubPages" not in t:
        needle = "export const config = {"
        if needle not in t:
            raise SystemExit(f"no config export in {path}")
        preamble = (
            "const isGitHubPages =\n"
            '  typeof location !== "undefined" && /github\\.io$/i.test(location.hostname);\n'
            "\n"
        )
        t = t.replace(needle, preamble + needle, 1)

    t = re.sub(r"https://[a-z0-9-]+\.trycloudflare\.com", tunnel, t)

    if "fintekBaseUrl" not in t:
        t = t.replace(
            "export const config = {",
            (
                "export const config = {\n"
                f'  fintekBaseUrl: isGitHubPages\n    ? "{tunnel}"\n    : "",'
            ),
            1,
        )
    else:
        t = re.sub(
            r"fintekBaseUrl:\s*isGitHubPages\s*\?[\s\S]*?: \"\",",
            f'fintekBaseUrl: isGitHubPages\n    ? "{tunnel}"\n    : "",',
            t,
            count=1,
        )

    path.write_text(t)
    print("fixed config", path.relative_to(ROOT))


NEXT_OLD = """function nextTarget() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/dashboard/";
  // Evitar open redirect
  if (!next.startsWith("/") && !next.includes("/dashboard")) return "/dashboard/";
  if (next.includes("://") && !next.includes(location.host) && !/github\\.io/.test(next)) {
    return "/dashboard/";
  }
  return next;
}"""

NEXT_NEW = """function nextTarget() {
  const params = new URLSearchParams(location.search);
  const onPages = /github\\.io$/i.test(location.hostname);
  const fallback = onPages ? new URL("./dashboard/", location.href).href : "/dashboard/";
  let next = params.get("next") || fallback;
  // Evitar open redirect
  if (next.includes("://") && !next.includes(location.host) && !/github\\.io/.test(next)) {
    return fallback;
  }
  if (onPages) {
    if (next.startsWith("/dashboard")) {
      return new URL("." + next, location.href).href;
    }
    if (next === "/" || next === "/login.html") {
      return fallback;
    }
  } else if (!next.startsWith("/") && !next.includes("/dashboard")) {
    return fallback;
  }
  return next;
}"""

RESOLVE_OLD = """async function resolveApiBase() {
  if (!/github\\.io$/i.test(location.hostname)) return;
  try {
    const mod = await import("./config.js");
    const base = mod.config?.fintekBaseUrl || "";
    if (base) window.__PP_API_BASE__ = String(base).replace(/\\/+$/, "");
  } catch {
    /* config opcional */
  }
}"""

RESOLVE_NEW = """async function resolveApiBase() {
  if (!/github\\.io$/i.test(location.hostname)) return;
  let base = "";
  try {
    const mod = await import("./config.js");
    base = mod.config?.fintekBaseUrl || mod.config?.serverBaseUrl || "";
  } catch {
    /* config puede fallar; seguimos con public-url */
  }
  if (!base) {
    try {
      const res = await fetch(new URL("./public-url.json", location.href).href, {
        cache: "no-store",
      });
      const data = await res.json();
      base = data?.baseUrl || "";
    } catch {
      /* ignore */
    }
  }
  if (base) window.__PP_API_BASE__ = String(base).replace(/\\/+$/, "");
}"""


def fix_login_page(path: Path) -> None:
    if not path.exists():
        print("skip missing", path)
        return
    t = path.read_text()
    if NEXT_OLD in t:
        t = t.replace(NEXT_OLD, NEXT_NEW)
        print("patched nextTarget", path.relative_to(ROOT))
    elif "onPages" in t:
        print("nextTarget already patched", path.relative_to(ROOT))
    else:
        print("WARN nextTarget pattern mismatch", path.relative_to(ROOT))

    if RESOLVE_OLD in t:
        t = t.replace(RESOLVE_OLD, RESOLVE_NEW)
        print("hardened resolveApiBase", path.relative_to(ROOT))
    elif "public-url.json" in t:
        print("resolve already hardened", path.relative_to(ROOT))
    else:
        print("WARN resolve pattern mismatch", path.relative_to(ROOT))

    path.write_text(t)


def write_public_url(tunnel: str) -> None:
    payload = {
        "ok": True,
        "status": "up",
        "baseUrl": tunnel,
        "chatUrl": tunnel + "/",
        "dashboardUrl": tunnel + "/dashboard/",
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    text = json.dumps(payload, indent=2) + "\n"
    for rel in ("docs/public-url.json", "stack/runtime/public-url.json"):
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        print("wrote", rel)


def main() -> int:
    tunnel = tunnel_url()
    print("TUNNEL", tunnel)
    for rel in ("docs/js/config.js", "web/app/js/config.js"):
        fix_config(ROOT / rel, tunnel)
    for rel in ("docs/js/login-page.js", "web/app/js/login-page.js"):
        fix_login_page(ROOT / rel)
    write_public_url(tunnel)
    cfg = (ROOT / "docs/js/config.js").read_text()
    assert "const isGitHubPages" in cfg, "isGitHubPages missing"
    assert tunnel in cfg, "tunnel missing from config"
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
