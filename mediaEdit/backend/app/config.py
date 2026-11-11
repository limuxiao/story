import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE = os.path.join(BASE, "storage")
ORIGIN_DIR = os.path.join(STORAGE, "origin")
MP4_DIR = os.path.join(STORAGE, "mp4")
EXPORT_DIR = os.path.join(STORAGE, "exports")
# 时间轴缩略图：每个素材一个独立目录，0001.jpg / 0002.jpg ...（每秒一帧）。
THUMB_DIR = os.path.join(STORAGE, "thumbs")
# 每个项目一个目录，工程以 project.xml 为唯一数据源。
PROJECT_DIR = os.path.join(STORAGE, "projects")
DB_PATH = os.path.join(STORAGE, "meta.db")

for _d in (ORIGIN_DIR, MP4_DIR, EXPORT_DIR, THUMB_DIR, PROJECT_DIR):
    os.makedirs(_d, exist_ok=True)
