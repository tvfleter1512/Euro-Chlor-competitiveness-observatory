"""Minimal JSON-stat 2.0 reader for Eurostat dissemination/Comext API responses."""
from math import prod


def iter_observations(payload: dict):
    """Yield (coords: dict[dim_id -> category_code], value) for each observation."""
    dims = payload["id"]
    sizes = payload["size"]
    codes_per_dim = {}
    for d in dims:
        index = payload["dimension"][d]["category"]["index"]
        if isinstance(index, dict):
            ordered = sorted(index, key=index.get)
        else:
            ordered = list(index)
        codes_per_dim[d] = ordered

    strides = [prod(sizes[i + 1:]) for i in range(len(dims))]
    for flat, value in payload["value"].items():
        idx = int(flat)
        coords = {
            d: codes_per_dim[d][(idx // strides[i]) % sizes[i]]
            for i, d in enumerate(dims)
        }
        yield coords, value
