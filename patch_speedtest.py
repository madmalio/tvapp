import re

with open("web/src/hooks/useSpeedTest.ts", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "import { getApiUrl } from '../lib/api';",
    "import { getApiUrl, getApiHeaders } from '../lib/api';"
)

content = content.replace(
    "const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store' });",
    "const response = await fetch(getApiUrl('/api/speedtest'), { cache: 'no-store', ...(getApiHeaders() as any) });"
)

with open("web/src/hooks/useSpeedTest.ts", "w", encoding="utf-8") as f:
    f.write(content)
