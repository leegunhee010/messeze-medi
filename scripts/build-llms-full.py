# llms-full.txt 생성: sitemap.xml의 페이지 본문을 AI가 읽기 쉬운 텍스트로 모은다.
# 실행: python scripts/build-llms-full.py  (레포 루트 기준)
import re, os, json, html
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
BASE = 'https://medi.messeze.com/'

def text(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'</(div|span|b|em|i|small|strong|li|p|h\d)>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()

def page(path):
    s = open(path, encoding='utf-8').read()
    title = text(re.search(r'<title>(.*?)</title>', s, re.S).group(1))
    m = re.search(r'<meta name="description" content="([^"]*)"', s)
    desc = html.unescape(m.group(1)) if m else ''
    body = s.split('<body', 1)[1]
    body = body.split('<footer', 1)[0]
    body = re.sub(r'<header.*?</header>', '', body, flags=re.S)
    body = re.sub(r'<(script|style|svg|nav|noscript)\b.*?</\1>', '', body, flags=re.S)
    body = re.sub(r'<div class="(mk|mini-win|svc-vis|feat-vis|mega)[^"]*".*?</div></div>', '', body, flags=re.S)
    out, seen = [], set()
    for m in re.finditer(r'<(h1|h2|h3|p|li)\b[^>]*>(.*?)</\1>', body, re.S):
        t = text(m.group(2))
        if len(t) < 2 or t in seen: continue
        seen.add(t)
        tag = m.group(1)
        out.append(('\n## ' if tag in ('h1', 'h2') else '\n### ' if tag == 'h3' else '- ' if tag == 'li' else '') + t)
    faqs = []
    for j in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try: d = json.loads(j)
        except Exception: continue
        for it in (d.get('@graph', [d]) if isinstance(d, dict) else d):
            if isinstance(it, dict) and it.get('@type') == 'FAQPage':
                for q in it.get('mainEntity', []):
                    faqs.append((q['name'], q['acceptedAnswer']['text']))
    return title, desc, out, faqs

urls = re.findall(r'<loc>([^<]+)</loc>', open('sitemap.xml', encoding='utf-8').read())
parts = [open('llms.txt', encoding='utf-8').read().rstrip(), '\n\n---\n\n# 페이지 전문\n']
for u in urls:
    rel = u.replace(BASE, '') or 'index.html'
    if rel.endswith('/'): rel += 'index.html'
    if not os.path.exists(rel): continue
    title, desc, out, faqs = page(rel)
    parts.append('\n\n========================================\n# %s\nURL: %s\n%s\n' % (title, u, desc))
    parts.append('\n'.join(out))
    if faqs:
        parts.append('\n\n## 자주 묻는 질문')
        for q, a in faqs:
            parts.append('\nQ. %s\nA. %s' % (q, a))
open('llms-full.txt', 'w', encoding='utf-8', newline='\n').write(''.join(parts).strip() + '\n')
print('llms-full.txt', os.path.getsize('llms-full.txt'), 'bytes,', len(urls), 'pages')
