#!/usr/bin/env python3
"""把 fps 文件夹通过 HTTP 共享给局域网内其他人下载。

用法：
    python3 share_fps.py
    python3 share_fps.py --port 9000

局域网内其他人打开终端打印的地址即可浏览文件，
访问 /download.zip 可直接打包下载整个文件夹。
"""

import argparse
import html
import io
import socket
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

BASE_DIR = Path(__file__).resolve().parent
SCRIPT_NAME = Path(__file__).name
EXCLUDE_NAMES = {SCRIPT_NAME, "__pycache__", ".DS_Store"}


def lan_ip() -> str:
    """获取本机在局域网中的 IP。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


def iter_entries():
    """遍历需要共享的文件/目录，跳过脚本自身与隐藏文件。"""
    for item in sorted(BASE_DIR.rglob("*")):
        rel = item.relative_to(BASE_DIR)
        if any(part in EXCLUDE_NAMES or part.startswith(".") for part in rel.parts):
            continue
        yield item, rel


def build_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item, rel in iter_entries():
            arcname = rel.as_posix()
            if item.is_dir():
                archive.write(item, arcname + "/")
            elif item.is_file():
                archive.write(item, arcname)
    return buf.getvalue()


class ShareHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/download.zip", "/download"):
            self._send_zip(head_only=False)
        elif path in ("/", ""):
            self._send_index()
        else:
            super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if path in ("/download.zip", "/download"):
            self._send_zip(head_only=True)
        else:
            super().do_HEAD()

    def _send_zip(self, head_only: bool):
        data = build_zip()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", 'attachment; filename="fps.zip"')
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def _send_index(self):
        rows = []
        for item, rel in iter_entries():
            if item.is_file():
                size = f"{item.stat().st_size / 1024:.1f} KB"
                link = quote(rel.as_posix(), safe="/")
                rows.append(
                    f'<li><a href="/{link}">{html.escape(rel.as_posix())}</a> '
                    f'<span class="size">{size}</span></li>'
                )
        body = "".join(rows) or "<li>（目录为空）</li>"
        page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fps 文件夹共享</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 720px; margin: 48px auto; padding: 0 20px; color: #222; }}
  h1 {{ font-size: 24px; }}
  a.download {{ display: inline-block; padding: 12px 24px; background: #2563eb;
                color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; }}
  ul {{ list-style: none; padding: 0; }}
  li {{ padding: 8px 0; border-bottom: 1px solid #eee; }}
  .size {{ color: #888; font-size: 13px; float: right; }}
</style>
</head>
<body>
  <h1>fps 文件夹共享</h1>
  <p><a class="download" href="/download.zip">下载整个文件夹（ZIP）</a></p>
  <h2>文件列表</h2>
  <ul>{body}</ul>
</body>
</html>""".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)


def main():
    parser = argparse.ArgumentParser(description="在局域网共享 fps 文件夹")
    parser.add_argument("--port", type=int, default=8765, help="监听端口，默认 8765")
    args = parser.parse_args()

    ip = lan_ip()
    print(f"共享目录: {BASE_DIR}")
    print(f"浏览文件: http://{ip}:{args.port}/")
    print(f"一键下载: http://{ip}:{args.port}/download.zip")
    print("按 Ctrl+C 停止共享")

    server = ThreadingHTTPServer(("0.0.0.0", args.port), ShareHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止共享")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
