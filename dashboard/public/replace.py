import os

files = [
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\styles.css',
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\index.html',
    r'c:\Users\Admin\Downloads\stellapp-main\stellapp-main\public\roadmap.html'
]

replacements = {
    '#81C784': '#00E5FF',
    '#173F35': '#0B2545',
    '#2E7D32': '#0088CC',
    'rgba(23, 63, 53': 'rgba(11, 37, 69',
    'rgba(129, 199, 132': 'rgba(0, 229, 255',
    '#F3F8F2': '#F0F4F8',
    '#4A635D': '#3A4B61',
    'color: "#007d11"': 'color: "#00e5ff"'
}

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(content)

# Append features animation CSS to styles.css
css_append = '''
/* Animated Floating Orbs for Features */
.features-bg {
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    z-index: -1;
    overflow: hidden;
}
.features-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.5;
    animation: float 20s infinite alternate ease-in-out;
}
.orb-1 { width: 400px; height: 400px; background: rgba(0, 229, 255, 0.3); top: -10%; left: 0%; }
.orb-2 { width: 500px; height: 500px; background: rgba(181, 0, 255, 0.2); bottom: -10%; right: -5%; animation-delay: -5s; }
.orb-3 { width: 300px; height: 300px; background: rgba(0, 136, 204, 0.25); top: 40%; left: 40%; animation-delay: -10s; }

@keyframes float {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(50px, -50px) scale(1.2); }
}
'''
with open(files[0], 'a', encoding='utf-8') as f:
    f.write(css_append)
print("Done!")
