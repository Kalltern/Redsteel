from pathlib import Path
p = Path('templates/actor/skills.hbs')
lines = p.read_text().splitlines(True)
for i in [150, 205, 258, 309, 354, 418, 460, 477, 494, 511, 532, 553, 574]:
    print('---', i+1)
    for j in range(i, i+15):
        print(f"{j+1}:{lines[j].rstrip()}")
