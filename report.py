# -*- coding:utf-8 -*-


def main():
    f = open("侠鹿.txt", "r", encoding="utf-8")
    total = 0
    for s in f.readlines():
        for ch in s:
            if '\u4e00' <= ch <= '\u9fff':
                total += 1
                pass
    f.close()
    return total


if __name__ == "__main__":
    total = main()
    print(total)
