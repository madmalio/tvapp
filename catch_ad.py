import urllib.request
import urllib.parse
import sys

def main():
    print("Fetching master playlist...")
    url = "https://jmp2.uk/plu-5ca525b650be2571e3943c63.m3u8"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req)
        base_url = resp.url
        lines = resp.read().decode('utf-8').splitlines()
    except Exception as e:
        print(f"Failed to fetch master playlist: {e}")
        return

    variant_url = ""
    for i, line in enumerate(lines):
        if "BANDWIDTH=" in line:
            variant_url = lines[i+1]
            if "3063648" in line or "1080p" in line:
                break

    if not variant_url:
        print("Could not find variant URL.")
        return

    final_url = urllib.parse.urljoin(base_url, variant_url)
    print(f"Fetching variant playlist...")
    
    try:
        vreq = urllib.request.Request(final_url, headers={'User-Agent': 'Mozilla/5.0'})
        vresp = urllib.request.urlopen(vreq)
        raw_text = vresp.read().decode('utf-8')
        
        with open("ad_playlist.txt", "w") as f:
            f.write(raw_text)
            
        print("\nSUCCESS! Saved to ad_playlist.txt")
    except Exception as e:
        print(f"Failed to fetch variant playlist: {e}")

if __name__ == '__main__':
    main()
