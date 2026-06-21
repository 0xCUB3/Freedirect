#!/usr/bin/env python3
"""Optional SafariDriver smoke test for the unpacked Freedirect extension.

Prereqs:
  - Safari automation enabled: `safaridriver --enable` (user-approved system change)
  - selenium Python package with Safari WebExtension/BiDi support
  - Safari 26+ / matching safaridriver

This script is intentionally optional because enabling safaridriver is a local
security setting and should not be done by automation without user consent.

After manually granting Safari site access, add redirect runtime checks:
  ./scripts/safaridriver-extension-smoke.py --redirect-service youtube
  ./scripts/safaridriver-extension-smoke.py --redirect-defaults
"""

from pathlib import Path
from urllib.parse import urlparse
import argparse
import json
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "Shared (Extension)" / "Resources"
SERVICE_TEST_CASES = ROOT / "scripts" / "service-test-cases.json"
SERVICE_CASES = json.loads(SERVICE_TEST_CASES.read_text())
DEFAULT_ENABLED_SERVICES = ["youtube", "reddit", "twitter", "instagram", "search"]
DEFAULT_EXPECTED_HOSTS = {
    "youtube": "inv.thepixora.com",
    "reddit": "redlib.net",
    "twitter": "nitter.net",
    "instagram": "kittygr.am",
    "search": "search.sapti.me",
}

parser = argparse.ArgumentParser(description="Optional SafariDriver smoke test for Freedirect.")
parser.add_argument("--redirect-service", choices=sorted(SERVICE_CASES), help="After extension install, navigate to a service sample and require the generated default redirect host. Requires manual Safari site access grants.")
parser.add_argument("--redirect-defaults", action="store_true", help="Assert redirects for the balanced-profile default services after manual Safari site-access grants.")
parser.add_argument("--timeout", type=float, default=8.0, help="Seconds to wait for each optional redirect assertion.")
args = parser.parse_args()

try:
    from selenium import webdriver
except Exception as exc:  # pragma: no cover - environment dependent
    print(f"SKIP: selenium is not installed ({exc})")
    sys.exit(0)

try:
    driver = webdriver.Safari()
except Exception as exc:  # pragma: no cover - environment dependent
    print(f"SKIP: SafariDriver session could not start ({exc})")
    sys.exit(0)


def wait_for_redirect(service_id, sample_url, expected_host):
    driver.get(sample_url)
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        if urlparse(driver.current_url).hostname == expected_host:
            break
        time.sleep(0.25)
    actual = driver.current_url
    actual_host = urlparse(actual).hostname
    assert actual_host == expected_host, f"{service_id}: expected redirect to {expected_host}, got {actual}"
    print(f"SafariDriver redirect smoke ok: {service_id} -> {actual}")


try:
    result = None
    if hasattr(driver, "webextension"):
        result = driver.webextension.install(path=str(EXTENSION))
    else:
        driver.command_executor._commands["load_web_extension"] = ("POST", "/session/$sessionId/webextension")
        result = driver.execute("load_web_extension", {"path": str(EXTENSION)})

    driver.get("https://example.com/")
    assert "Example Domain" in driver.title

    redirect_ids = []
    if args.redirect_service:
        redirect_ids.append(args.redirect_service)
    if args.redirect_defaults:
        redirect_ids.extend(service_id for service_id in DEFAULT_ENABLED_SERVICES if service_id not in redirect_ids)

    if redirect_ids:
        for service_id in redirect_ids:
            expected_host = DEFAULT_EXPECTED_HOSTS.get(service_id)
            if not expected_host:
                raise SystemExit(f"No default expected host is configured for {service_id}")
            wait_for_redirect(service_id, SERVICE_CASES[service_id], expected_host)
    else:
        print(f"SafariDriver extension smoke ok: {result}")
finally:
    driver.quit()
