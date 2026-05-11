#!/usr/bin/env python3
"""
Fetches Airbnb and Booking.com iCal feeds and writes data/availability.json.
Run by the GitHub Action every 4 hours — no CORS proxy needed server-side.

To update the iCal URLs:
  Airbnb:      Listing → Calendar → Availability settings → Export calendar
  Booking.com: Extranet → Calendar → iCal → Export
"""

import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

FEEDS = [
    # TODO: replace with your actual iCal URLs from Airbnb and Booking.com
    'https://www.airbnb.co.uk/calendar/ical/1660620875880657269.ics?t=565a1786098f4c759644d9008e8022c1',
    'https://ical.booking.com/v1/export?t=48dd88ab-ac97-4f0c-a00f-5e9e2882ca08',
]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8', errors='replace')


def parse_blocked(ics: str) -> set:
    blocked = set()
    for chunk in ics.split('BEGIN:VEVENT')[1:]:
        sm = re.search(r'DTSTART(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})', chunk)
        em = re.search(r'DTEND(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})', chunk)
        if not sm or not em:
            continue
        s, e = sm.group(1), em.group(1)
        curr = datetime(int(s[:4]), int(s[4:6]), int(s[6:]), tzinfo=timezone.utc)
        stop = datetime(int(e[:4]), int(e[4:6]), int(e[6:]), tzinfo=timezone.utc)
        while curr < stop:
            blocked.add(curr.strftime('%Y-%m-%d'))
            curr += timedelta(days=1)
    return blocked


all_blocked: set = set()

for url in FEEDS:
    try:
        ics = fetch(url)
        dates = parse_blocked(ics)
        all_blocked |= dates
        print(f'✓  {len(dates):>4} dates  {url[:60]}')
    except Exception as exc:
        print(f'✗  FAILED  {url[:60]}\n   {exc}')

output = {
    'updated': datetime.now(timezone.utc).isoformat(),
    'blocked': sorted(all_blocked),
}

Path('data').mkdir(exist_ok=True)
Path('data/availability.json').write_text(json.dumps(output, indent=2))
print(f'\nSaved {len(output["blocked"])} blocked dates → data/availability.json')
