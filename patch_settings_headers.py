import re

with open("web/src/components/Settings.tsx", "r") as f:
    content = f.read()

# Fix saveSource
content = content.replace(
    "headers: { 'Content-Type': 'application/json' },",
    "headers: { 'Content-Type': 'application/json', ...getApiHeaders() as any },",
    1 # Only the first one inside saveSource, but there are multiple, let's just do all occurrences that match exactly this string and don't have getApiHeaders
)

# wait, there might be multiple. Let's be precise.
content = content.replace(
    "const res = await fetch(getApiUrl(`/api/sources/${id}`), { method: 'DELETE' });",
    "const res = await fetch(getApiUrl(`/api/sources/${id}`), { method: 'DELETE', headers: getApiHeaders() });"
)

content = content.replace(
    "const res = await fetch(getApiUrl(`/api/sources/${src.id}/refresh`), {\n        method: 'POST',\n      });",
    "const res = await fetch(getApiUrl(`/api/sources/${src.id}/refresh`), {\n        method: 'POST',\n        headers: getApiHeaders(),\n      });"
)

content = content.replace(
    "const res = await fetch(getApiUrl(\"/api/sources/refresh-all\"), {\n        method: 'POST',\n      });",
    "const res = await fetch(getApiUrl(\"/api/sources/refresh-all\"), {\n        method: 'POST',\n        headers: getApiHeaders(),\n      });"
)

content = content.replace(
    "const res = await fetch(getApiUrl(\"/api/sources/order\"), {\n        method: \"PUT\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify(ids)\n      });",
    "const res = await fetch(getApiUrl(\"/api/sources/order\"), {\n        method: \"PUT\",\n        headers: { \"Content-Type\": \"application/json\", ...getApiHeaders() as any },\n        body: JSON.stringify(ids)\n      });"
)

content = content.replace(
    "const res = await fetch(getApiUrl('/api/system/settings'), {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },",
    "const res = await fetch(getApiUrl('/api/system/settings'), {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', ...getApiHeaders() as any },"
)

# Replace the saveSource header
content = content.replace(
    "      const res = await fetch(getApiUrl(url), {\n        method,\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify(payload)\n      });",
    "      const res = await fetch(getApiUrl(url), {\n        method,\n        headers: { 'Content-Type': 'application/json', ...getApiHeaders() as any },\n        body: JSON.stringify(payload)\n      });"
)

# And Wipe Database 
content = content.replace(
    "const res = await fetch(getApiUrl('/api/system/wipe'), { method: 'POST' });",
    "const res = await fetch(getApiUrl('/api/system/wipe'), { method: 'POST', headers: getApiHeaders() });"
)

# And Import Database
content = content.replace(
    "      const res = await fetch(getApiUrl('/api/system/import'), {\n        method: 'POST',\n        body: formData\n      });",
    "      const res = await fetch(getApiUrl('/api/system/import'), {\n        method: 'POST',\n        headers: getApiHeaders(),\n        body: formData\n      });"
)

# The profile endpoints were already patched to use getApiHeaders in our manual python script, let's verify.
# Profiles uses headers: getApiHeaders()

with open("web/src/components/Settings.tsx", "w") as f:
    f.write(content)
