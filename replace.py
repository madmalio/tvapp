import sys

def main():
    repl = '''function mapCategory(rawGroup: string, channelName: string = ""): string {
  const lowerGroup = (rawGroup || "").toLowerCase();
  const lowerName = (channelName || "").toLowerCase();
  const target = lowerGroup ? f"{lowerGroup} {lowerName}" : lowerName;

  if (target.match(/movie|cinema|film|box office|hbo|cinemax|starz|tcm|showtime|amc|paramount/)) return 'Movies';
  if (target.match(/news|weather|breaking|journal|cnn|fox news|msnbc|bbc|bloomberg|cnbc/)) return 'News';
  if (target.match(/sport|espn|nfl|nba|mlb|nhl|wwe|racing|golf|tennis|nascar|ufc|boxing/)) return 'Sports';
  if (target.match(/kid|child|family|animation|cartoon|disney|nick|pbs kids/)) return 'Kids';
  if (target.match(/music|mtv|vh1|concert|radio|vevo/)) return 'Music';
  if (target.match(/doc|history|science|discovery|nature|learning|animal planet|nat geo/)) return 'Docs & Learning';
  if (target.match(/nbc|abc|cbs|fox|cw|pbs|local|us|uk|region|city/)) return 'Local';
  if (target.match(/comedy|drama|reality|tv show|sitcom|entertainment/)) return 'Entertainment';
  
  return 'Other';
}'''

    # Fix string interpolation in py script for typescript backticks
    repl = repl.replace('f"{lowerGroup} {lowerName}"', '${lowerGroup} ')

    files = ["web/src/components/ChannelList.tsx", "web/src/components/EpgGrid.tsx", "web/src/components/VideoPlayer.tsx"]
    
    for f_path in files:
        with open(f_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        start_idx = content.find("function mapCategory")
        if start_idx == -1: continue
        
        # Find the closing brace of mapCategory by counting braces
        brace_count = 0
        end_idx = -1
        in_fn = False
        
        for i in range(start_idx, len(content)):
            if content[i] == '{':
                brace_count += 1
                in_fn = True
            elif content[i] == '}':
                brace_count -= 1
            
            if in_fn and brace_count == 0:
                end_idx = i + 1
                break
                
        if end_idx != -1:
            new_content = content[:start_idx] + repl + content[end_idx:]
            with open(f_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

if __name__ == '__main__':
    main()
