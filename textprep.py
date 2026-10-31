import re


def clean_text(t: str) -> str:
    t = t.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "").replace("\u00a0", " ")
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)                      # re-join hyphenated line wraps
    t = re.sub(r"https?://\S+", "", t)                           # spoken URLs are noise
    t = re.sub(r"\[\d+(?:\s*[,–-]\s*\d+)*\]", "", t)             # citation markers [12], [3-5]
    lines = [l.strip() for l in t.split("\n")]
    lines = [l for l in lines if not re.fullmatch(r"(page\s*)?\d{1,4}", l, re.I)]  # bare page numbers
    t = "\n".join(lines)
    t = re.sub(r"(?<!\n)\n(?!\n)", " ", t)                       # soft wraps -> spaces
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()
