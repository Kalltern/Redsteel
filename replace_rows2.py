from pathlib import Path
p = Path('templates/actor/skills.hbs')
text = p.read_text()
old = '''            {{#if @root.skillsEditMode}}
            <div class="skill-rank-editor">
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="-1" data-min="0" data-max="{{skillRankMax skill}}">-</button>
              <span class="skill-rank-progress">{{skill.value}} / {{skillRankMax skill}}</span>
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="1" data-min="0" data-max="{{skillRankMax skill}}">+</button>
            </div>
            {{/if}}
            <input\n'''
new = '''            {{#if @root.skillsEditMode}}
            <div class="skill-rank-editor">
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="-1" data-min="0" data-max="{{skillRankMax skill}}">-</button>
              <span class="skill-rank-progress">{{skill.value}} / {{skillRankMax skill}}</span>
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="1" data-min="0" data-max="{{skillRankMax skill}}">+</button>
            </div>
            {{else}}
            {{#if skill.value}}
            <span class="skill-rank-label">Rank {{skill.value}}</span>
            {{/if}}
            {{/if}}
            <input\n'''
count = text.count(old)
print('matches', count)
if count > 0:
    text = text.replace(old, new)
    p.write_text(text)
    print('replaced', count)
else:
    print('no matches')
