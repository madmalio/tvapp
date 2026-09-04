import sys

def main():
    with open('web/src/components/VideoPlayer.tsx', 'r', encoding='utf-8') as f:
        content = f.read()

    with open('preloader.tsx', 'r', encoding='utf-8') as f:
        preloader = f.read()
        
    end_str = "export default function VideoPlayer() {"
    
    end_idx = content.find(end_str)
    
    if end_idx == -1:
        print("Could not find end bounds for replacement")
        return
        
    new_content = content[:end_idx] + preloader + "\n\n" + content[end_idx:]
    
    with open('web/src/components/VideoPlayer.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == '__main__':
    main()
