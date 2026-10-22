import pytest
from jobagent_scraper.server_auth import access_headers


def test_local_server_never_receives_access_credentials(monkeypatch):
    monkeypatch.setattr('jobagent_scraper.server_auth.env_value', lambda key: 'secret')
    assert access_headers('http://localhost:3000') == {}
    assert access_headers('http://127.0.0.1:3000') == {}


def test_remote_server_requires_https_and_both_credentials(monkeypatch):
    monkeypatch.setattr('jobagent_scraper.server_auth.env_value', lambda key: '')
    with pytest.raises(ValueError, match='HTTPS'):
        access_headers('http://example.workers.dev')
    with pytest.raises(ValueError, match='CF_ACCESS_CLIENT_ID'):
        access_headers('https://example.workers.dev')


def test_remote_server_sends_access_headers(monkeypatch):
    values = {'CF_ACCESS_CLIENT_ID': 'test-client', 'CF_ACCESS_CLIENT_SECRET': 'test-secret'}
    monkeypatch.setattr('jobagent_scraper.server_auth.env_value', lambda key: values[key])
    assert access_headers('https://example.workers.dev') == {
        'CF-Access-Client-Id': 'test-client', 'CF-Access-Client-Secret': 'test-secret',
    }
