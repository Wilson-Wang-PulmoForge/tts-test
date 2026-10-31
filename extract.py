import io, ipaddress, socket
from urllib.parse import urlparse, urljoin
from textprep import clean_text

MAX_BYTES = 25 * 1024 * 1024


def from_file(name: str, data: bytes) -> dict:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    title = name.rsplit(".", 1)[0]
    if ext == "pdf":
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(data))
        text = "\n\n".join((p.extract_text() or "") for p in r.pages)
        if not text.strip():
            raise ValueError("That PDF has no selectable text (it may be a scan).")
        meta = (r.metadata.title if r.metadata else None)
        title = meta or title
    elif ext == "docx":
        import docx
        text = "\n\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    elif ext in ("html", "htm"):
        title2, text = _html(data.decode("utf-8", "replace"))
        title = title2 or title
    elif ext in ("txt", "md", "markdown", ""):
        text = data.decode("utf-8", "replace")
    else:
        raise ValueError(f"Unsupported file type: .{ext}")
    text = clean_text(text)
    if not text:
        raise ValueError("No readable text found in that file.")
    return {"title": title.strip() or "Untitled", "text": text}


def _html(html: str):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript", "svg"]):
        t.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    parts = [e.get_text(" ", strip=True) for e in root.find_all(["h1", "h2", "h3", "p", "li", "blockquote"])]
    title = soup.title.get_text(strip=True) if soup.title else ""
    return title, "\n\n".join(p for p in parts if p)


def _check_public(url: str):
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("Enter a full http(s) link.")
    for info in socket.getaddrinfo(u.hostname, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("That address isn't a public website.")


def from_url(url: str) -> dict:
    import httpx
    url = url.strip()
    for _ in range(4):  # follow redirects manually so each hop is checked
        _check_public(url)
        r = httpx.get(url, timeout=15, follow_redirects=False,
                      headers={"User-Agent": "Mozilla/5.0 Lectern"})
        if r.is_redirect:
            url = urljoin(url, r.headers["location"]); continue
        break
    else:
        raise ValueError("Too many redirects.")
    if r.status_code >= 400:
        raise ValueError(f"The site answered with error {r.status_code}.")
    if len(r.content) > MAX_BYTES:
        raise ValueError("That page is too large.")
    if "pdf" in r.headers.get("content-type", ""):
        return from_file("download.pdf", r.content)
    title, text = _html(r.text)
    text = clean_text(text)
    if not text:
        raise ValueError("Couldn't find readable text on that page.")
    return {"title": title or urlparse(url).hostname, "text": text}
