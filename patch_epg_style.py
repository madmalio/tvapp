import sys

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\EpgGrid.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the block backgroundStyle and className logic
old_block_logic = """              let backgroundStyle = {};
              if (isActive) {
                const visibleStartMinutes = Math.max(0, offsetMinutes);
                const minutesPassedInVisibleBox = currentTimeOffset - visibleStartMinutes;
                const visibleDurationMinutes = width / PIXELS_PER_MINUTE;
                // Avoid division by zero edge case
                const percent = visibleDurationMinutes > 0 
                  ? (minutesPassedInVisibleBox / visibleDurationMinutes) * 100 
                  : 0;
                  
                backgroundStyle = {
                  background: `linear-gradient(to right, rgba(37, 99, 235, 0.25) ${percent}%, rgba(38, 38, 38, 0.8) ${percent}%)`
                };
              } else if (isPast) {
                backgroundStyle = { background: 'rgba(37, 99, 235, 0.25)' };
              } else {
                backgroundStyle = { background: 'rgba(38, 38, 38, 0.8)' };
              }

              const Wrapper: any = isActive ? Link : 'button';
              const wrapperProps: any = isActive 
                ? { to: `/player/${ch.id}`, state: { from: '/guide' }, onClick: () => lockToLandscape() }
                : { onClick: () => setSelectedProgram({ entry: e, channel: ch }) };

              return (
                <div
                  key={e.id}
                  className="absolute h-full py-1 pr-1"
                  style={{ left: leftOffset, width }}
                >
                  <Wrapper
                    {...wrapperProps}
                    className="block text-left w-full h-full rounded-md p-2 transition-all group/prog border border-transparent backdrop-blur-sm shadow-sm hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:bg-neutral-800/80 focus:outline-none"
                    style={backgroundStyle}
                  >
                    <div className="max-md:sticky max-md:left-24 max-w-full w-max overflow-hidden flex flex-col">
                      <h4 className={`font-medium text-sm truncate leading-tight mb-1 ${isActive ? 'text-blue-100 font-bold' : 'text-white'}`}>{e.title}</h4>
                      <p className={`text-xs truncate ${isActive ? 'text-blue-300' : 'text-neutral-400 group-hover/prog:text-blue-200'}`}>
                        {start.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {end.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                      </p>
                    </div>
                  </Wrapper>"""

new_block_logic = """              const isScheduled = scheduledEpgIds.has(e.id);
              let backgroundStyle = {};
              if (isActive) {
                const visibleStartMinutes = Math.max(0, offsetMinutes);
                const minutesPassedInVisibleBox = currentTimeOffset - visibleStartMinutes;
                const visibleDurationMinutes = width / PIXELS_PER_MINUTE;
                const percent = visibleDurationMinutes > 0 ? (minutesPassedInVisibleBox / visibleDurationMinutes) * 100 : 0;
                backgroundStyle = { background: `linear-gradient(to right, rgba(37, 99, 235, 0.25) ${percent}%, rgba(38, 38, 38, 0.8) ${percent}%)` };
              } else if (isScheduled) {
                backgroundStyle = { background: 'rgba(220, 38, 38, 0.15)' }; // subtle red background for scheduled
              } else if (isPast) {
                backgroundStyle = { background: 'rgba(37, 99, 235, 0.25)' };
              } else {
                backgroundStyle = { background: 'rgba(38, 38, 38, 0.8)' };
              }

              const Wrapper: any = isActive ? Link : 'button';
              const wrapperProps: any = isActive 
                ? { to: `/player/${ch.id}`, state: { from: '/guide' }, onClick: () => lockToLandscape() }
                : { onClick: () => setSelectedProgram({ entry: e, channel: ch }) };

              return (
                <div
                  key={e.id}
                  className="absolute h-full py-1 pr-1"
                  style={{ left: leftOffset, width }}
                >
                  <Wrapper
                    {...wrapperProps}
                    className={`block text-left w-full h-full rounded-md p-2 transition-all group/prog border backdrop-blur-sm shadow-sm hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:bg-neutral-800/80 focus:outline-none ${isScheduled ? 'border-red-500' : 'border-transparent hover:border-blue-500'}`}
                    style={backgroundStyle}
                  >
                    <div className="max-md:sticky max-md:left-24 max-w-full w-max overflow-hidden flex flex-col">
                      <h4 className={`font-medium text-sm truncate leading-tight mb-1 ${isActive ? 'text-blue-100 font-bold' : (isScheduled ? 'text-red-100 font-bold' : 'text-white')}`}>
                        {e.title} {isScheduled && <span className="ml-1 text-[10px] uppercase tracking-wider text-red-500 font-bold">REC</span>}
                      </h4>
                      <p className={`text-xs truncate ${isActive ? 'text-blue-300' : 'text-neutral-400 group-hover/prog:text-blue-200'}`}>
                        {start.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {end.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                      </p>
                    </div>
                  </Wrapper>"""

if old_block_logic in content:
    content = content.replace(old_block_logic, new_block_logic)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced block rendering logic successfully")
else:
    print("Could not find block logic")
