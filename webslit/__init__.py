with open("version.info") as f:
    __version__ = f.read().strip()

MAJOR, MINOR, COMMIT = __version__.split(".")
