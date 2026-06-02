from pathlib import Path
import re
p=Path('templates/actor/skills.hbs')
s=p.read_text()
pattern=re.compile(r'({{#(if|each|with)\b[^}]*}}|{{/(if|each|with)}}|{{else}})')
stack=[]
line_starts=[0]
for i,ch in enumerate(s):
    if ch=='\n': line_starts.append(i+1)

def lineno(pos):
    return 1 + sum(1 for x in line_starts if x <= pos)

for m in pattern.finditer(s):
    token=m.group(0)
    line = lineno(m.start())
    print(f"TOKEN @ {line}: {token}")
    if token.startswith('{{#'):
        t = token[3:]
        t = t.split()[0].strip('}}')
        stack.append((t,line))
        print('  push', t, 'at', line)
    elif token=='{{else}}':
        print('  else (no stack change)')
        continue
    elif token.startswith('{{/'):
        t=token[3:-2]
        if not stack:
            print('Unmatched close', token, 'at', line)
            break
        top,topline=stack.pop()
        print('  pop', top, 'opened at', topline)
        if top!=t:
            print('Mismatched close', token, 'at', line, 'expected closing for', top, 'opened at',topline)
            break
    print('  stack size', len(stack))
else:
    if stack:
        print('Unclosed blocks remain:')
        for t,l in stack[-50:]: print(t,'opened at',l)
    else:
        print('All blocks matched')
