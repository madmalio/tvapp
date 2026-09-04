import os
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Make sure getApiHeaders is imported
    if "fetch(" in content and "getApiHeaders" not in content and filepath.endswith(".tsx"):
        if "from '../lib/api'" in content:
            content = content.replace("from '../lib/api'", "from '../lib/api'") # Just a placeholder
            # Actually let's just do a regex replace for the import
            content = re.sub(r'import\s+\{([^}]+)\}\s+from\s+[\'"]\.\./lib/api[\'"]',
                             lambda m: f'import {{{m.group(1)}, getApiHeaders}} from "../lib/api"', content)
        elif "from './lib/api'" in content:
            content = re.sub(r'import\s+\{([^}]+)\}\s+from\s+[\'"]\./lib/api[\'"]',
                             lambda m: f'import {{{m.group(1)}, getApiHeaders}} from "./lib/api"', content)

    # We only care about fetch(getApiUrl(...), { ... })
    # This regex looks for fetch(..., { method: '...', body: '...' })
    # and we just inject headers: getApiHeaders(), before body or method or at the end.
    
    # 1. ping in App.tsx
    content = content.replace(
        "fetch(getApiUrl('/api/system/ping'), { method: 'POST' })",
        "fetch(getApiUrl('/api/system/ping'), { method: 'POST', headers: getApiHeaders() })"
    )

    # 2. Settings stats
    content = content.replace(
        "fetch(getApiUrl(\"/api/system/stats\"))",
        "fetch(getApiUrl(\"/api/system/stats\"), { headers: getApiHeaders() })"
    )
    content = content.replace(
        "fetch(getApiUrl(\"/api/settings\"))",
        "fetch(getApiUrl(\"/api/settings\"), { headers: getApiHeaders() })"
    )

    # 3. Stream start/stop in VideoPlayer & MiniPlayer
    content = content.replace(
        "fetch(getApiUrl(\"/api/stream/start\"), {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body",
        "fetch(getApiUrl(\"/api/stream/start\"), {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\", ...(getApiHeaders() as any) },\n        body"
    )
    content = content.replace(
        "fetch(getApiUrl(`/api/stream/stop/${streamId}`), { method: 'POST' })",
        "fetch(getApiUrl(`/api/stream/stop/${streamId}`), { method: 'POST', headers: getApiHeaders() })"
    )
    content = content.replace(
        "fetch(getApiUrl(`/api/stream/stop/${id}`), { method: 'POST' })",
        "fetch(getApiUrl(`/api/stream/stop/${id}`), { method: 'POST', headers: getApiHeaders() })"
    )

    # 4. Recordings
    content = content.replace(
        "await fetch(getApiUrl(`/api/recordings/${id}`), { method: 'DELETE' });",
        "await fetch(getApiUrl(`/api/recordings/${id}`), { method: 'DELETE', headers: getApiHeaders() });"
    )
    content = content.replace(
        "await fetch(getApiUrl(`/api/recordings/stop/${id}`), { method: 'POST' });",
        "await fetch(getApiUrl(`/api/recordings/stop/${id}`), { method: 'POST', headers: getApiHeaders() });"
    )
    content = content.replace(
        "await fetch(getApiUrl(`/api/recordings/${recordingId}`), { method: 'DELETE' });",
        "await fetch(getApiUrl(`/api/recordings/${recordingId}`), { method: 'DELETE', headers: getApiHeaders() });"
    )

    # 5. EPG Grid
    content = content.replace(
        "fetch(getApiUrl(`/api/recordings/schedule`), {\n                            method: 'POST',\n                            headers: { 'Content-Type': 'application/json' },",
        "fetch(getApiUrl(`/api/recordings/schedule`), {\n                            method: 'POST',\n                            headers: { 'Content-Type': 'application/json', ...(getApiHeaders() as any) },"
    )
    content = content.replace(
        "fetch(getApiUrl(`/api/recordings/${scheduledId}`), { method: 'DELETE' })",
        "fetch(getApiUrl(`/api/recordings/${scheduledId}`), { method: 'DELETE', headers: getApiHeaders() })"
    )

    # Fix missed ones in VideoPlayer
    content = content.replace(
        "fetch(getApiUrl(`/api/recordings/schedule`), {\n                        method: 'POST',\n                        headers: { 'Content-Type': 'application/json' },",
        "fetch(getApiUrl(`/api/recordings/schedule`), {\n                        method: 'POST',\n                        headers: { 'Content-Type': 'application/json', ...(getApiHeaders() as any) },"
    )

    content = content.replace(
        "fetch(getApiUrl(`/api/recordings/${scheduledRecordingId}`), { method: 'DELETE' })",
        "fetch(getApiUrl(`/api/recordings/${scheduledRecordingId}`), { method: 'DELETE', headers: getApiHeaders() })"
    )

    # Speedtest
    content = content.replace(
        "const response = await fetch(getApiUrl('/api/system/speedtest'));",
        "const response = await fetch(getApiUrl('/api/system/speedtest'), { headers: getApiHeaders() });"
    )

    # Make sure import is there for Speedtest
    if "getApiHeaders" not in content and "fetch(" in content and "useSpeedTest" in content:
        content = content.replace("import { getApiUrl } from '../lib/api';", "import { getApiUrl, getApiHeaders } from '../lib/api';")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)


for root, dirs, files in os.walk("web/src"):
    for file in files:
        if file.endswith(('.ts', '.tsx')):
            process_file(os.path.join(root, file))
