from pathlib import Path
p = Path('templates/actor/skills.hbs')
text = p.read_text()
old = '''            <label
              class="skill-label rollable flexlarge align-left skill-name"
              data-action="roll"
              data-roll="{{skill.rating}}-1d100"
              data-roll-type="skill"
              data-label="{{key}}"
            >
              {{localize (concat 'REDSTEEL.Actor.Character.skills.' key '.label')}}
            </label>
            {{#if @root.skillsEditMode}}
            <div class="skill-rank-editor">
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="-1" data-min="0" data-max="{{skillRankMax skill}}">-</button>
              <span class="skill-rank-progress">{{skill.value}} / {{skillRankMax skill}}</span>
              <button type="button" class="skill-rank-button" data-action="adjustActorNumber" data-path="system.skills.{{key}}.value" data-delta="1" data-min="0" data-max="{{skillRankMax skill}}">+</button>
            </div>
            {{/if}}
            <input
              type="text"
              class="skill-rating"
              data-dtype="Number"
              value="{{skill.rating}}"
              readonly
            />'''
new = '''            <label
              class="skill-label rollable flexlarge align-left skill-name"
              data-action="roll"
              data-roll="{{skill.rating}}-1d100"
              data-roll-type="skill"
              data-label="{{key}}"
            >
              {{localize (concat 'REDSTEEL.Actor.Character.skills.' key '.label')}}
            </label>
            {{#if @root.skillsEditMode}}
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
            <input
              type="text"
              class="skill-rating"
              data-dtype="Number"
              value="{{skill.rating}}"
              readonly
            />'''
count = text.count(old)
print('matches', count)
text = text.replace(old, new)
p.write_text(text)
print('replaced', count)
