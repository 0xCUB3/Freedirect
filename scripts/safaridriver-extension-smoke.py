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
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "Shared (Extension)" / "Resources"
SERVICE_TEST_CASES = ROOT / "scripts" / "service-test-cases.json"
SERVICE_TEST_DOC = ROOT / "docs" / "service-test-cases.md"
DEFAULT_ENABLED_SERVICES = ["youtube", "reddit", "twitter", "instagram", "tiktok"]


def expected_urls_from_doc():
    rows = {}
    pattern = re.compile(r"^\| ([^| ]+) \| [^|]+ \| `([^`]+)` \| `([^`]+)` \|")
    if not SERVICE_TEST_DOC.exists():
        return rows
    for line in SERVICE_TEST_DOC.read_text().splitlines():
        match = pattern.match(line)
        if match:
            service_id, sample, expected = match.groups()
            rows[service_id] = {"sample": sample, "expected": expected}
    return rows


expected_cases = expected_urls_from_doc()
parser = argparse.ArgumentParser(description="Optional SafariDriver smoke test for Freedirect.")
parser.add_argument("--redirect-service", choices=sorted(expected_cases), help="After extension install, navigate to a service sample and require the generated expected redirect. Requires manual Safari site access grants.")
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


def wait_for_redirect(service_id, sample_url, expected_url):
    expected_host = urlparse(expected_url).hostname
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
        cases = json.loads(SERVICE_TEST_CASES.read_text())
        for service_id in redirect_ids:
            expected = expected_cases[service_id]["expected"]
            wait_for_redirect(service_id, cases[service_id], expected)
    else:
        print(f"SafariDriver extension smoke ok: {result}")
finally:
    driver.quit()
