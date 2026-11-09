import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE = os.path.join(BASE, "storage")
ORIGIN_DIR = os.path.join(STORAGE, "origin")
MP4_DIR = os.path.join(STORAGE, "mp4")
EXPORT_DIR = os.path.join(STORAGE, "exports")
DB_PATH = os.path.join(STORAGE, "meta.db")

for _d in (ORIGIN_DIR, MP4_DIR, EXPORT_DIR):
    os.makedirs(_d, exist_ok=True)
