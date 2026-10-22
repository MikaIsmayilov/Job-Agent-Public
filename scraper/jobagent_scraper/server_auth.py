"""Authentication for the private dashboard; credentials never go in config.yml."""
from urllib.parse import urlparse
from .common import env_value


def access_headers(base_url: str) -> dict[str, str]:
    url = urlparse(base_url)
    if url.hostname in {"localhost", "127.0.0.1", "::1"}:
        return {}
    if url.scheme != "https":
        raise ValueError("Remote dashboard connections require HTTPS")
    client_id = env_value("CF_ACCESS_CLIENT_ID")
    client_secret = env_value("CF_ACCESS_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError("Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET before using the cloud dashboard")
    return {"CF-Access-Client-Id": client_id, "CF-Access-Client-Secret": client_secret}
