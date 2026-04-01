#!/usr/bin/env python3
"""
Query LogScope telemetry data from Azure Application Insights.

Usage:
    python3 telemetry-query.py                # Summary dashboard
    python3 telemetry-query.py --events 10    # Last N events
    python3 telemetry-query.py --dau          # Daily active users (last 30 days)
    python3 telemetry-query.py --retention    # 7-day and 30-day retention
    python3 telemetry-query.py --features     # Feature usage breakdown
    python3 telemetry-query.py --query "customEvents | take 5"  # Custom Kusto query
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def load_credentials():
    """Load from ~/.claude/credentials/api-keys.env or environment."""
    import os
    env_file = os.path.expanduser("~/.claude/credentials/api-keys.env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    app_id = os.environ.get("APPINSIGHTS_APP_ID", "")
    api_key = os.environ.get("APPINSIGHTS_API_KEY", "")
    if not app_id or not api_key:
        print("ERROR: APPINSIGHTS_APP_ID and APPINSIGHTS_API_KEY not found.")
        print("Set them in ~/.claude/credentials/api-keys.env or as environment variables.")
        sys.exit(1)
    return app_id, api_key

APP_ID, API_KEY = load_credentials()
BASE_URL = f"https://api.applicationinsights.io/v1/apps/{APP_ID}"


def query(kql: str) -> dict:
    """Execute a Kusto query against Application Insights."""
    url = f"{BASE_URL}/query"
    body = json.dumps({"query": kql}).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("x-api-key", API_KEY)
    req.add_header("Content-Type", "application/json")

    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(f"API Error ({e.code}): {error_body}")
        sys.exit(1)


def parse_rows(result: dict) -> list[dict]:
    """Convert API response into list of dicts."""
    if not result.get("tables"):
        return []
    table = result["tables"][0]
    columns = [col["name"] for col in table["columns"]]
    return [dict(zip(columns, row)) for row in table["rows"]]


def get_marketplace_stats() -> dict:
    """Fetch install/download stats from VS Code Marketplace."""
    import urllib.request
    url = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
    body = json.dumps({
        "filters": [{"criteria": [{"filterType": 7, "value": "novelbits.novelbits-logscope"}]}],
        "flags": 914
    }).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json;api-version=6.0-preview.1")
    try:
        with urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ext = data["results"][0]["extensions"][0]
        stats = {s["statisticName"]: s["value"] for s in ext.get("statistics", [])}
        stats["version"] = ext["versions"][0]["version"]
        return stats
    except Exception:
        return {}


def cmd_summary():
    """Show a summary dashboard."""
    print("=" * 60)
    print("  LogScope Telemetry Dashboard")
    print("=" * 60)

    # Marketplace stats
    mp = get_marketplace_stats()
    if mp:
        print(f"\n  --- VS Code Marketplace ---")
        print(f"  Installs:                         {int(mp.get('install', 0))}")
        print(f"  Downloads:                        {int(mp.get('downloadCount', 0))}")
        print(f"  Updates:                          {int(mp.get('updateCount', 0))}")
        rating_count = int(mp.get('ratingCount', 0))
        if rating_count > 0:
            print(f"  Rating:                           {mp.get('averagerating', 0):.1f}/5 ({rating_count} reviews)")
        else:
            print(f"  Rating:                           No reviews yet")
        print(f"  Published version:                v{mp.get('version', '?')}")
        print(f"\n  --- Azure Telemetry ---")

    # Total unique installs (all time)
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | extend installId = tostring(customDimensions.installId)
        | summarize totalInstalls = dcount(installId)
    """))
    total = rows[0]["totalInstalls"] if rows else 0
    # Telemetry start date
    rows_start = parse_rows(query("""
        customEvents
        | summarize firstEvent = min(timestamp)
    """))
    if rows_start and rows_start[0]["firstEvent"]:
        first = rows_start[0]["firstEvent"][:19].replace("T", " ")
        days_active = (datetime.now(tz=None) - datetime.strptime(first, "%Y-%m-%d %H:%M:%S")).days
        print(f"\n  Telemetry since:                  {first} UTC ({days_active} days)")

    print(f"  Total unique installs (all time): {total}")

    # DAU (today)
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | where timestamp >= startofday(now())
        | extend installId = tostring(customDimensions.installId)
        | summarize dau = dcount(installId)
    """))
    dau = rows[0]["dau"] if rows else 0
    print(f"  Active today (DAU):               {dau}")

    # MAU (last 30 days)
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | where timestamp >= ago(30d)
        | extend installId = tostring(customDimensions.installId)
        | summarize mau = dcount(installId)
    """))
    mau = rows[0]["mau"] if rows else 0
    print(f"  Active last 30 days (MAU):        {mau}")

    # DAU/MAU ratio
    if mau > 0:
        ratio = (dau / mau) * 100
        print(f"  DAU/MAU ratio:                    {ratio:.1f}%")

    # Total events
    rows = parse_rows(query("""
        customEvents
        | summarize total = count()
    """))
    total_events = rows[0]["total"] if rows else 0
    print(f"  Total events:                     {total_events}")

    # Events by type
    rows = parse_rows(query("""
        customEvents
        | summarize count() by name
        | order by count_ desc
    """))
    if rows:
        print(f"\n  Events by type:")
        for row in rows:
            print(f"    {row['name']:30s} {row['count_']}")

    # Platform distribution
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | extend platform = tostring(customDimensions.platform)
        | extend arch = tostring(customDimensions.arch)
        | summarize count() by platform, arch
        | order by count_ desc
    """))
    if rows:
        print(f"\n  Platform distribution:")
        for row in rows:
            print(f"    {row['platform']}/{row['arch']:10s} {row['count_']}")

    # Version distribution
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | extend version = tostring(customDimensions.extensionVersion)
        | summarize count() by version
        | order by count_ desc
    """))
    if rows:
        print(f"\n  Version distribution:")
        for row in rows:
            print(f"    v{row['version']:10s} {row['count_']}")

    print()


def cmd_events(n: int):
    """Show the last N events."""
    rows = parse_rows(query(f"""
        customEvents
        | order by timestamp desc
        | take {n}
        | project timestamp, name, customDimensions
    """))
    if not rows:
        print("No events found.")
        return

    print(f"\nLast {n} events:\n")
    for row in rows:
        ts = row["timestamp"][:19].replace("T", " ")
        name = row["name"]
        dims = json.loads(row["customDimensions"]) if isinstance(row["customDimensions"], str) else row["customDimensions"]
        # Remove installId for cleaner display
        dims.pop("installId", None)
        dims_str = ", ".join(f"{k}={v}" for k, v in dims.items()) if dims else ""
        print(f"  {ts}  {name:25s} {dims_str}")


def cmd_dau():
    """Show daily active users for the last 30 days."""
    rows = parse_rows(query("""
        customEvents
        | where name endswith "activation"
        | where timestamp >= ago(30d)
        | extend installId = tostring(customDimensions.installId)
        | summarize dau = dcount(installId) by bin(timestamp, 1d)
        | order by timestamp asc
    """))
    if not rows:
        print("No data yet.")
        return

    print(f"\nDaily Active Users (last 30 days):\n")
    for row in rows:
        date = row["timestamp"][:10]
        count = row["dau"]
        bar = "#" * min(int(count), 50)
        print(f"  {date}  {count:4}  {bar}")


def cmd_retention():
    """Show retention metrics."""
    # 7-day retention
    rows = parse_rows(query("""
        let installs = customEvents
        | where name endswith "activation"
        | extend installId = tostring(customDimensions.installId)
        | summarize firstSeen = min(timestamp) by installId;
        let recent = installs
        | where firstSeen >= ago(37d) and firstSeen < ago(7d);
        let returned = customEvents
        | where name endswith "activation"
        | where timestamp >= ago(7d)
        | extend installId = tostring(customDimensions.installId)
        | distinct installId;
        recent
        | join kind=leftouter returned on installId
        | summarize
            totalCohort = count(),
            returned = countif(isnotempty(installId1))
    """))

    print(f"\nRetention Metrics:\n")
    if rows and rows[0]["totalCohort"] > 0:
        total = rows[0]["totalCohort"]
        ret = rows[0]["returned"]
        pct = (ret / total) * 100
        print(f"  7-day retention:  {ret}/{total} ({pct:.1f}%)")
    else:
        print(f"  7-day retention:  Not enough data yet (need 7+ days)")

    # 30-day retention
    rows = parse_rows(query("""
        let installs = customEvents
        | where name endswith "activation"
        | extend installId = tostring(customDimensions.installId)
        | summarize firstSeen = min(timestamp) by installId;
        let older = installs
        | where firstSeen >= ago(60d) and firstSeen < ago(30d);
        let returned = customEvents
        | where name endswith "activation"
        | where timestamp >= ago(30d)
        | extend installId = tostring(customDimensions.installId)
        | distinct installId;
        older
        | join kind=leftouter returned on installId
        | summarize
            totalCohort = count(),
            returned = countif(isnotempty(installId1))
    """))

    if rows and rows[0]["totalCohort"] > 0:
        total = rows[0]["totalCohort"]
        ret = rows[0]["returned"]
        pct = (ret / total) * 100
        print(f"  30-day retention: {ret}/{total} ({pct:.1f}%)")
    else:
        print(f"  30-day retention: Not enough data yet (need 30+ days)")

    print()


def cmd_features():
    """Show feature usage breakdown."""
    print(f"\nFeature Usage:\n")

    # Transport split
    rows = parse_rows(query("""
        customEvents
        | where name endswith "session_start"
        | extend transport = tostring(customDimensions.transport)
        | summarize count() by transport
    """))
    if rows:
        print(f"  Transport split:")
        for row in rows:
            print(f"    {row['transport']:10s} {row['count_']}")

    # Parser adoption
    rows = parse_rows(query("""
        customEvents
        | where name endswith "session_start"
        | extend parser = tostring(customDimensions.parserMode)
        | summarize count() by parser
    """))
    if rows:
        print(f"\n  Parser adoption:")
        for row in rows:
            print(f"    {row['parser']:10s} {row['count_']}")

    # Export format usage
    rows = parse_rows(query("""
        customEvents
        | where name endswith "export"
        | extend format = tostring(customDimensions.format)
        | summarize count() by format
    """))
    if rows:
        print(f"\n  Export formats:")
        for row in rows:
            print(f"    {row['format']:10s} {row['count_']}")

    # Average session duration
    rows = parse_rows(query("""
        customEvents
        | where name endswith "session_end"
        | extend durationMs = todouble(customMeasurements.durationMs)
        | where durationMs > 0
        | summarize
            avgMin = avg(durationMs) / 60000,
            medianMin = percentile(durationMs, 50) / 60000,
            sessions = count()
    """))
    if rows and rows[0]["sessions"] > 0:
        print(f"\n  Session duration:")
        print(f"    Average:  {rows[0]['avgMin']:.1f} minutes")
        print(f"    Median:   {rows[0]['medianMin']:.1f} minutes")
        print(f"    Sessions: {rows[0]['sessions']}")

    # Connect flow abandonment
    rows = parse_rows(query("""
        customEvents
        | where name endswith "connect_flow_abandoned"
        | extend step = tostring(customDimensions.step)
        | summarize count() by step
        | order by count_ desc
    """))
    if rows:
        print(f"\n  Connect flow drop-off:")
        for row in rows:
            print(f"    Step: {row['step']:15s} {row['count_']} abandoned")

    # Error rates
    rows = parse_rows(query("""
        customEvents
        | where name endswith "connect_failed"
        | extend errorCode = tostring(customDimensions.errorCode)
        | summarize count() by errorCode
        | order by count_ desc
    """))
    if rows:
        print(f"\n  Connection errors:")
        for row in rows:
            print(f"    {row['errorCode']:25s} {row['count_']}")

    print()


def cmd_custom(kql: str):
    """Run a custom Kusto query."""
    rows = parse_rows(query(kql))
    if not rows:
        print("No results.")
        return
    # Print as table
    cols = list(rows[0].keys())
    print("  ".join(f"{c:20s}" for c in cols))
    print("-" * (22 * len(cols)))
    for row in rows:
        print("  ".join(f"{str(row.get(c, '')):20s}" for c in cols))


def main():
    parser = argparse.ArgumentParser(description="Query LogScope telemetry from Application Insights")
    parser.add_argument("--events", type=int, metavar="N", help="Show last N events")
    parser.add_argument("--dau", action="store_true", help="Daily active users (last 30 days)")
    parser.add_argument("--retention", action="store_true", help="Retention metrics")
    parser.add_argument("--features", action="store_true", help="Feature usage breakdown")
    parser.add_argument("--query", type=str, metavar="KQL", help="Custom Kusto query")

    args = parser.parse_args()

    if args.events:
        cmd_events(args.events)
    elif args.dau:
        cmd_dau()
    elif args.retention:
        cmd_retention()
    elif args.features:
        cmd_features()
    elif args.query:
        cmd_custom(args.query)
    else:
        cmd_summary()


if __name__ == "__main__":
    main()
