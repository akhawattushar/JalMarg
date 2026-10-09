import time

import httpx

from .. import config as C

client = httpx.Client(timeout=10, headers={"User-Agent": C.USER_AGENT})
_cache = {}


def cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    val = fn()
    _cache[key] = (time.time() + ttl, val)
    return val


class ProviderError(Exception):
    pass


def get(url, **kw):
    r = client.get(url, **kw)
    if r.status_code >= 400:
        raise ProviderError(f"{url.split('?')[0]} -> {r.status_code}")
    return r.json()


def post(url, **kw):
    r = client.post(url, **kw)
    if r.status_code >= 400:
        raise ProviderError(f"{url.split('?')[0]} -> {r.status_code}")
    return r.json()
