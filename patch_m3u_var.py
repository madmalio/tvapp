with open('internal/iptv/m3u.go', 'r', encoding='utf-8') as f:
    content = f.read()

repl_var = '''var (
	extinfRe  = regexp.MustCompile(#EXTINF:-?\d+(?:\.\d+)?\s*(.*))
	tvgLogo   = regexp.MustCompile(	vg-logo="([^"]*)")
	groupRe   = regexp.MustCompile(group-title="([^"]*)")
	tvgIDRe   = regexp.MustCompile(	vg-id="([^"]*)")
	channelID = regexp.MustCompile(channel-id="([^"]*)")
	epgUrlRe  = regexp.MustCompile((?:url-tvg|x-tvg-url)="?([^"\s]+)"?)
)'''

content = re.sub(r'var \(\n\textinfRe.*?channelID.*?\n\)', repl_var, content, flags=re.DOTALL)

with open('internal/iptv/m3u.go', 'w', encoding='utf-8') as f:
    f.write(content)
