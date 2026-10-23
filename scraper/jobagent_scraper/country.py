"""Per-country search defaults, keyed by config.yml `search.country` ("US" or "CA").

Everything that used to assume the United States reads from here: the jobspy
Indeed/Glassdoor domain, the remote search location, which two-letter region
codes count as home, which markers name the home country (so a "Toronto or
New York" posting survives either search), and the markers that make a
location foreign. Explicit config.yml keys still win over these defaults.
"""

from __future__ import annotations

_US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
    "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
    "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
}
# Full state names: Workday and others write "Boston, Massachusetts", which the
# two-letter region-code rule cannot see.
_US_STATE_NAMES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
    "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
    "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
    "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
]
_CA_PROVINCES = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}

COUNTRIES: dict[str, dict] = {
    "US": {
        "name": "United States",
        "indeed": "USA",
        "remote_location": "United States",
        "amazon_code": "USA",
        "region_codes": _US_STATES,
        "foreign_words": "",
        "home_markers": ["united states", "usa", "u.s."],
        # Canada is next door and its postings leak into US feeds constantly.
        "foreign_markers": [
            "Canada", "Ontario", "Quebec", "Québec", "British Columbia", "Alberta",
            "Toronto", "Vancouver", "Montreal", "Montréal", "Calgary", "Ottawa", "Mississauga",
        ],
    },
    "CA": {
        "name": "Canada",
        "indeed": "Canada",
        "remote_location": "Canada",
        "amazon_code": "CAN",
        "region_codes": _CA_PROVINCES,
        "home_markers": [
            "canada", "ontario", "quebec", "québec", "british columbia", "alberta", "manitoba",
            "saskatchewan", "nova scotia", "new brunswick", "newfoundland", "prince edward island",
        ],
        # US-only postings ("Remote - USA", "United States") leak into Canadian
        # feeds; "City, ST" US locations are already caught by the region-code rule.
        "foreign_markers": [
            "United States", "U.S.", *_US_STATE_NAMES,
            # Big US hubs that ATS feeds name without a state.
            "New York City", "NYC", "San Francisco", "Seattle", "Boston", "Chicago", "Austin", "Los Angeles",
            "Denver", "Atlanta", "Miami", "Dallas", "Houston", "Philadelphia", "San Diego", "San Jose",
            "Palo Alto", "Mountain View", "Bay Area", "Silicon Valley",
        ],
        # Case-sensitive whole words, location field only: "Remote - US".
        "foreign_words": r"\b(?:US|USA)\b",
    },
}


def country_code(cfg: dict) -> str:
    code = str((cfg.get("search") or {}).get("country") or "US").upper()
    return code if code in COUNTRIES else "US"


def country(cfg: dict) -> dict:
    return COUNTRIES[country_code(cfg)]
