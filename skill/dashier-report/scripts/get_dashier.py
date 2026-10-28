#!/usr/bin/env python3
"""
Downloads the current Dashier editor, the template every report is built from.

    python3 get_dashier.py [OUT.html]        (default: dashier.html)

Tries the site first, then the copy in the GitHub repository. Read the EDITING GUIDE comment in its head; never
the packed app below it. build_report.py calls this itself when it is given no template.
"""
import sys, urllib.request

URLS = (
    'https://mvit.github.io/dashier/dashier.html',
    'https://raw.githubusercontent.com/mvit/dashier/main/dist/dashier.html',
)


def is_dashier(html):
    return 'id="dashier-doc"' in html and 'id="dashier-js"' in html


def fetch(source=None):
    """The HTML of a Dashier file: a local path or URL when given, else the current editor from URLS."""
    if source and not source.startswith(('http://', 'https://')):
        return open(source, encoding='utf-8').read()
    errors = []
    for url in [source] if source else URLS:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'dashier-skill'})
            with urllib.request.urlopen(req, timeout=30) as r:
                html = r.read().decode('utf-8')
        except Exception as e:
            errors.append(f'  {url}: {e}')
            continue
        if is_dashier(html):
            return html
        errors.append(f'  {url}: not a Dashier file')
    sys.exit('Could not download the Dashier editor:\n' + '\n'.join(errors) +
             '\nAsk the user for a Dashier file (any report, or dashier.html from https://mvit.github.io/dashier/)'
             ' and pass its path as the template.')


if __name__ == '__main__':
    if len(sys.argv) > 2 or sys.argv[1:2] in (['-h'], ['--help']):
        sys.exit(__doc__)
    out = sys.argv[1] if len(sys.argv) == 2 else 'dashier.html'
    html = fetch()
    open(out, 'w', encoding='utf-8').write(html)
    print(f'wrote {out} ({len(html.encode()):,} bytes)')
