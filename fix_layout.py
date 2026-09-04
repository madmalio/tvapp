import sys

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\Settings.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove the </div></div> before the System Tab
old_structure = """        </div>
      </div>

      {/* System Tab */}
      {activeTab === 'system' && (
        <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 p-3 sm:p-6 md:p-8">"""

new_structure = """        {/* System Tab */}
        {activeTab === 'system' && (
          <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">"""

content = content.replace(old_structure, new_structure)

# 2. Add the </div></div> back before the Wipe Modal
old_wipe = """      )}

      {/* Wipe Modal */}"""

new_wipe = """        )}
      </div>
    </div>

    {/* Wipe Modal */}"""

content = content.replace(old_wipe, new_wipe)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
