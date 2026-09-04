import re

with open("web/src/components/Settings.tsx", "r") as f:
    content = f.read()

# Fix Profile type at the top
content = content.replace(
    "type Source = { id: number; name: string; type: string; url: string; epg_url: string; };",
    "type Profile = { id: number; name: string; avatar_url: string; is_admin: boolean; has_pin?: boolean; };\n"
    "type Source = { id: number; name: string; type: string; url: string; epg_url: string; };"
)

# Fix getApiHeaders import
content = content.replace(
    "import { getApiUrl, clearApiCache } from \"../lib/api\";",
    "import { getApiUrl, getApiHeaders, clearApiCache } from \"../lib/api\";"
)

with open("web/src/components/Settings.tsx", "w") as f:
    f.write(content)
