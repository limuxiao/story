# -*- coding:utf-8 -*-

import codecs


def main():
    with codecs.open("侠鹿.txt", "r", "utf-8") as f:
        print(f.readline())


if __name__ == "__main__":
    main()