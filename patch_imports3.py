import re

with open("web/src/components/VideoPlayer.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "import { getApiUrl, fetchWithCache } from \"../lib/api\";",
    "import { getApiUrl, fetchWithCache, getApiHeaders } from \"../lib/api\";"
)

with open("web/src/components/VideoPlayer.tsx", "w", encoding="utf-8") as f:
    f.write(content)

with open("web/src/hooks/useSpeedTest.ts", "r", encoding="utf-8") as f:
    content2 = f.read()

content2 = content2.replace(
    "import { getApiUrl, getApiHeaders } from '../lib/api';",
    "import { getApiUrl } from '../lib/api';"
)

content2 = content2.replace(
    "const response = await fetch(getApiUrl('/api/system/speedtest'), { headers: getApiHeaders() });",
    "const response = await fetch(getApiUrl('/api/system/speedtest'));"
)

with open("web/src/hooks/useSpeedTest.ts", "w", encoding="utf-8") as f:
    f.write(content2)

