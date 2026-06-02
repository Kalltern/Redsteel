from pathlib import Path
p = Path('templates/actor/skills.hbs')
lines = p.read_text().splitlines(True)
for i in range(50,85):
    print(f"{i+1}:{repr(lines[i])}")
