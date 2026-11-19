#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把当前目录下的 HTML 共享到局域网，供其他电脑在线阅读或下载。

用法：
    python3 serve.py            # 默认端口 8000
    python3 serve.py 9000       # 指定端口
"""

import http.server
import os
import socket
import socketserver
import sys

FILE_NAME = "book.html"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def get_lan_ip():
    """获取本机在局域网中的 IP（不会真的发包）。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ShareHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        raw_path, sep, query = self.path.partition("?")
        if raw_path == "/":
            raw_path = "/" + FILE_NAME
        self.path = raw_path + ("?" + query if sep else "")
        self._want_download = "download" in query
        return super().do_GET()

    def end_headers(self):
        if getattr(self, "_want_download", False) and self.path.startswith("/" + FILE_NAME):
            self.send_header("Content-Disposition", 'attachment; filename="book.html"')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    ip = get_lan_ip()
    print("=" * 56)
    print("  局域网 HTML 分享服务已启动")
    print("=" * 56)
    print(f"  共享文件 : {os.path.join(BASE_DIR, FILE_NAME)}")
    print(f"  本机阅读 : http://127.0.0.1:{PORT}/")
    print(f"  局域网阅读: http://{ip}:{PORT}/")
    print(f"  下载链接 : http://{ip}:{PORT}/book.html?download=1")
    print("-" * 56)
    print("  其他电脑需与本机处于同一局域网；如无法访问，请检查防火墙。")
    print("  按 Ctrl+C 停止服务。")
    print("=" * 56)

    with ThreadingHTTPServer(("0.0.0.0", PORT), ShareHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止。")


if __name__ == "__main__":
    main()
