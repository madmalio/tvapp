import re

with open("web/src/hooks/useSpeedTest.ts", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store', ...(getApiHeaders() as any) });",
    "const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store', headers: getApiHeaders() });"
)

with open("web/src/hooks/useSpeedTest.ts", "w", encoding="utf-8") as f:
    f.write(content)
