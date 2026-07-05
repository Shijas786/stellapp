import os

files = [
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\styles.css',
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\index.html',
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\roadmap.html'
]

replacements = {
    '#00E5FF': '#81C784',
    '#0B2545': '#173F35',
    '#0088CC': '#2E7D32',
    'rgba(11, 37, 69': 'rgba(23, 63, 53',
    'rgba(0, 229, 255': 'rgba(129, 199, 132',
    '#F0F4F8': '#F3F8F2',
    '#3A4B61': '#4A635D',
    'color: "#00e5ff"': 'color: "#007d11"',
    'rgba(181, 0, 255': 'rgba(23, 63, 53',
    'rgba(0, 136, 204': 'rgba(46, 125, 50'
}

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(content)

print("Done!")
