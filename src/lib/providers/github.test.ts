import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './github';

describe('parseSkillFrontmatter', () => {
  it('reads plain and quoted values', () => {
    expect(parseSkillFrontmatter('---\nname: bug\ndescription: "Create bugs"\n---\n# x')).toEqual({
      name: 'bug',
      description: 'Create bugs',
    });
  });

  it('joins folded and literal block scalars', () => {
    const folded = parseSkillFrontmatter(
      '---\nname: app-video-capture\ndescription: >\n  Capture video of a mobile app\n  and extract frames.\n---\n'
    );
    expect(folded.description).toBe('Capture video of a mobile app and extract frames.');
    const literal = parseSkillFrontmatter(
      '---\ndescription: |\n  line one\n  line two\nname: x\n---\n'
    );
    expect(literal).toEqual({ description: 'line one\nline two', name: 'x' });
  });

  it('returns nothing without frontmatter', () => {
    expect(parseSkillFrontmatter('# just markdown')).toEqual({});
  });
});
