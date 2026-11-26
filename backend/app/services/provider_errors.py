class ProviderUnavailable(Exception):
    """A configured market provider could not supply a response."""


class ProviderNotFound(Exception):
    """A provider confirmed that a requested symbol does not exist."""


class DataUnavailable(Exception):
    """Neither a fresh provider response nor a cached response is available."""
