with open('internal/iptv/m3u.go', 'r', encoding='utf-8') as f:
    content = f.read()

repl = '''	if len(lines) > 0 && strings.HasPrefix(lines[0], "#EXTM3U") {
		if m := epgUrlRe.FindStringSubmatch(lines[0]); len(m) > 1 {
			epgUrl = m[1]
		}
	}'''

import re
content = re.sub(r'if len\(lines\) > 0 && strings\.HasPrefix\(lines\[0\], "#EXTM3U"\) \{.*?\n\t\}', repl, content, flags=re.DOTALL)

with open('internal/iptv/m3u.go', 'w', encoding='utf-8') as f:
    f.write(content)
