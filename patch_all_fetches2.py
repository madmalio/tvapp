import os
import re

files_to_patch = [
    "web/src/App.tsx",
    "web/src/components/Cameras.tsx",
    "web/src/components/MiniPlayer.tsx",
    "web/src/components/VideoPlayer.tsx"
]

for file in files_to_patch:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if "import { getApiUrl } from" in content:
        content = content.replace("import { getApiUrl } from", "import { getApiUrl, getApiHeaders } from")
    elif "import { getApiUrl," in content:
        if "getApiHeaders" not in content:
            content = content.replace("import { getApiUrl,", "import { getApiUrl, getApiHeaders,")
    
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

# Fix the useSpeedTest unused import
with open("web/src/hooks/useSpeedTest.ts", 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "const response = await fetch(getApiUrl('/api/system/speedtest'));",
    "const response = await fetch(getApiUrl('/api/system/speedtest'), { headers: getApiHeaders() });"
)
with open("web/src/hooks/useSpeedTest.ts", 'w', encoding='utf-8') as f:
    f.write(content)
